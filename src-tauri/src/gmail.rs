//! Gmail: OAuth de escritorio (loopback + PKCE), tokens en el Administrador de
//! credenciales de Windows y sondeo de no leídos cada 60 s.
//!
//! Emite `gmail://status` con el estado completo (cuenta, no leídos, lista) y
//! `island://alert` por cada correo nuevo que llega después del primer sondeo.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use keyring::Entry;
use rand::RngCore;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

/// Nombre interno heredado de la primera versión: cambiarlo obligaría a reconectar Google.
const SERVICE: &str = "win-island";
const KEY_CLIENT: &str = "gmail-client";
const KEY_REFRESH: &str = "gmail-refresh";
/// Gmail (leer y marcar leído) + Calendar (solo lectura), en una sola autorización.
const SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly";
pub(crate) const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const POLL_EVERY: Duration = Duration::from_secs(60);
const MAX_LISTED: usize = 40;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientCfg {
    client_id: String,
    client_secret: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailItem {
    id: String,
    thread_id: String,
    from_name: String,
    from_email: String,
    subject: String,
    snippet: String,
    date_ms: i64,
    url: String,
    /// Etiquetas de Gmail (IMPORTANT, STARRED, CATEGORY_SOCIAL...) para filtrar.
    labels: Vec<String>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GmailStatus {
    /// Hay un cliente OAuth (client id/secret) guardado.
    configured: bool,
    connected: bool,
    email: Option<String>,
    unread_count: u64,
    messages: Vec<MailItem>,
    error: Option<String>,
    last_sync_ms: i64,
}

#[derive(Default)]
struct Inner {
    client: Option<ClientCfg>,
    refresh: Option<String>,
    access: Option<(String, Instant)>,
    status: GmailStatus,
    /// Ids no leídos vistos en el último sondeo (para detectar nuevos).
    known: HashSet<String>,
    primed: bool,
    cache: HashMap<String, MailItem>,
    /// Scopes que Google concedió realmente (se actualiza en cada token).
    granted: String,
    /// Metadatos de correos ya vistos en listados/búsquedas (leídos incluidos).
    list_cache: HashMap<String, MailItem>,
}

pub struct Gmail {
    inner: Mutex<Inner>,
    wake: Notify,
    /// Despierta al sondeo de Calendar (p. ej. tras reconectar).
    pub(crate) cal_wake: Notify,
    pub(crate) http: reqwest::Client,
}

fn kr_get(key: &str) -> Option<String> {
    Entry::new(SERVICE, key).ok()?.get_password().ok()
}

fn kr_set(key: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(value))
        .map_err(|e| format!("No se pudo guardar en el Administrador de credenciales: {e}"))
}

fn kr_del(key: &str) {
    if let Ok(e) = Entry::new(SERVICE, key) {
        let _ = e.delete_credential();
    }
}

fn random_b64(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    B64URL.encode(buf)
}

fn now_ms() -> i64 {
    crate::reminders::now_ms()
}

fn decode_entities(s: &str) -> String {
    s.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// `"Camila Rojas" <camila@x.cl>` → ("Camila Rojas", "camila@x.cl")
fn parse_from(raw: &str) -> (String, String) {
    if let (Some(start), Some(end)) = (raw.rfind('<'), raw.rfind('>')) {
        let email = raw[start + 1..end].trim().to_string();
        let name = raw[..start].trim().trim_matches('"').trim().to_string();
        let name = if name.is_empty() { email.split('@').next().unwrap_or(&email).to_string() } else { name };
        return (name, email);
    }
    let email = raw.trim().to_string();
    (email.split('@').next().unwrap_or(&email).to_string(), email)
}

impl Gmail {
    pub fn load() -> Arc<Self> {
        let client = kr_get(KEY_CLIENT).and_then(|s| serde_json::from_str::<ClientCfg>(&s).ok());
        let refresh = kr_get(KEY_REFRESH);
        let status = GmailStatus {
            configured: client.is_some(),
            connected: client.is_some() && refresh.is_some(),
            ..Default::default()
        };
        Arc::new(Self {
            inner: Mutex::new(Inner { client, refresh, status, ..Default::default() }),
            wake: Notify::new(),
            cal_wake: Notify::new(),
            http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client"),
        })
    }

    fn emit_status(&self, app: &AppHandle) {
        let status = self.inner.lock().unwrap().status.clone();
        let _ = app.emit("gmail://status", status);
    }

    fn set_error(&self, app: &AppHandle, error: Option<String>) {
        self.inner.lock().unwrap().status.error = error;
        self.emit_status(app);
    }

    fn client(&self) -> Result<ClientCfg, String> {
        self.inner.lock().unwrap().client.clone().ok_or_else(|| "Falta configurar el cliente OAuth de Google.".into())
    }

    pub(crate) fn is_connected(&self) -> bool {
        self.inner.lock().unwrap().status.connected
    }

    /// Scopes concedidos; vacío hasta el primer token de la sesión.
    pub(crate) fn granted(&self) -> String {
        self.inner.lock().unwrap().granted.clone()
    }

    pub(crate) async fn access_token(&self) -> Result<String, String> {
        let (client, refresh) = {
            let inner = self.inner.lock().unwrap();
            if let Some((token, expires)) = &inner.access {
                if *expires > Instant::now() + Duration::from_secs(60) {
                    return Ok(token.clone());
                }
            }
            (inner.client.clone(), inner.refresh.clone())
        };
        let client = client.ok_or("Falta configurar el cliente OAuth de Google.")?;
        let refresh = refresh.ok_or("Gmail no está conectado.")?;

        let res = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client.client_id.as_str()),
                ("client_secret", client.client_secret.as_str()),
                ("refresh_token", refresh.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| format!("Sin conexión con Google: {e}"))?;
        let body: Value = res.json().await.map_err(|e| e.to_string())?;

        if body["error"] == "invalid_grant" {
            // El refresh token fue revocado o caducó (p. ej. app OAuth en modo prueba).
            kr_del(KEY_REFRESH);
            let mut inner = self.inner.lock().unwrap();
            inner.refresh = None;
            inner.access = None;
            inner.status.connected = false;
            return Err("La sesión de Gmail caducó. Vuelve a conectar.".into());
        }
        let token = body["access_token"].as_str().ok_or_else(|| format!("Google rechazó el token: {body}"))?.to_string();
        let ttl = body["expires_in"].as_u64().unwrap_or(3600);
        let mut inner = self.inner.lock().unwrap();
        inner.access = Some((token.clone(), Instant::now() + Duration::from_secs(ttl)));
        if let Some(scope) = body["scope"].as_str() {
            inner.granted = scope.to_string();
        }
        Ok(token)
    }

    async fn api(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let token = self.access_token().await?;
        let mut req = self.http.request(method, format!("{API}{path}")).bearer_auth(token);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(|e| format!("Sin conexión con Gmail: {e}"))?;
        let status = res.status();
        let value: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let msg = value["error"]["message"].as_str().unwrap_or("error desconocido");
            return Err(format!("Gmail respondió {status}: {msg}"));
        }
        Ok(value)
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        self.api(reqwest::Method::GET, path, None).await
    }

    async fn fetch_message(&self, id: &str, thread_id: &str, account: &str) -> Result<MailItem, String> {
        let m = self
            .get(&format!("/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject"))
            .await?;
        let header = |name: &str| {
            m["payload"]["headers"]
                .as_array()
                .and_then(|hs| hs.iter().find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name))))
                .and_then(|h| h["value"].as_str())
                .unwrap_or("")
                .to_string()
        };
        let (from_name, from_email) = parse_from(&header("From"));
        let subject = header("Subject");
        Ok(MailItem {
            id: id.to_string(),
            thread_id: thread_id.to_string(),
            from_name,
            from_email,
            subject: if subject.is_empty() { "(sin asunto)".into() } else { subject },
            snippet: decode_entities(m["snippet"].as_str().unwrap_or("")),
            date_ms: m["internalDate"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
            url: format!("https://mail.google.com/mail/?authuser={account}#inbox/{thread_id}"),
            labels: m["labelIds"]
                .as_array()
                .map(|a| a.iter().filter_map(|l| l.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
    }

    async fn poll(&self, app: &AppHandle) -> Result<(), String> {
        let account = self.inner.lock().unwrap().status.email.clone();
        let account = match account {
            Some(a) => a,
            None => {
                let profile = self.get("/profile").await?;
                let email = profile["emailAddress"].as_str().unwrap_or("").to_string();
                self.inner.lock().unwrap().status.email = Some(email.clone());
                email
            }
        };

        let label = self.get("/labels/INBOX").await?;
        let unread_count = label["messagesUnread"].as_u64().unwrap_or(0);
        let list = self.get(&format!("/messages?q=is%3Aunread%20in%3Ainbox&maxResults={MAX_LISTED}")).await?;
        let refs: Vec<(String, String)> = list["messages"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|m| Some((m["id"].as_str()?.to_string(), m["threadId"].as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        let mut messages = Vec::with_capacity(refs.len());
        for (id, thread_id) in &refs {
            let cached = self.inner.lock().unwrap().cache.get(id).cloned();
            let item = match cached {
                Some(item) => item,
                None => {
                    let item = self.fetch_message(id, thread_id, &account).await?;
                    self.inner.lock().unwrap().cache.insert(id.clone(), item.clone());
                    item
                }
            };
            messages.push(item);
        }

        let fresh: Vec<MailItem> = {
            let mut inner = self.inner.lock().unwrap();
            let ids: HashSet<String> = refs.iter().map(|(id, _)| id.clone()).collect();
            let fresh = if inner.primed {
                messages.iter().filter(|m| !inner.known.contains(&m.id)).take(3).cloned().collect()
            } else {
                Vec::new()
            };
            inner.cache.retain(|id, _| ids.contains(id));
            inner.known = ids;
            inner.primed = true;
            inner.status.unread_count = unread_count;
            inner.status.messages = messages;
            inner.status.error = None;
            inner.status.last_sync_ms = now_ms();
            fresh
        };
        self.emit_status(app);

        for m in fresh.iter().rev() {
            let _ = app.emit(
                "island://alert",
                json!({
                    "id": format!("gmail-{}", m.id),
                    "kind": "mail",
                    "app": "Gmail",
                    "title": m.from_name,
                    "body": m.subject,
                    "url": m.url,
                    "messageId": m.id,
                    "labels": m.labels,
                }),
            );
        }
        Ok(())
    }
}

/// Bucle de sondeo: cada 60 s o cuando algo pide refrescar.
pub fn start(app: &AppHandle, gmail: Arc<Gmail>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let connected = gmail.inner.lock().unwrap().status.connected;
            if connected {
                if let Err(e) = gmail.poll(&app).await {
                    gmail.set_error(&app, Some(e));
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(POLL_EVERY) => {}
                _ = gmail.wake.notified() => {}
            }
        }
    });
}

/// Espera la redirección de Google en el puerto local y devuelve sus parámetros.
async fn wait_for_redirect(listener: TcpListener) -> Result<HashMap<String, String>, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await.map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request.split_whitespace().nth(1).unwrap_or("/");
        if !path.starts_with("/?") {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
            continue;
        }
        let url = Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let ok = params.contains_key("code");
        let page = format!(
            "<!doctype html><meta charset=utf-8><title>Wiri</title>\
             <body style=\"font-family:Segoe UI,sans-serif;background:#0b0b0d;color:#f5f5f7;display:grid;place-items:center;height:100vh;margin:0\">\
             <div style=\"text-align:center\"><div style=\"font-size:44px\">{}</div><h2>{}</h2><p style=\"color:#999\">Ya puedes cerrar esta pestaña y volver a la isla.</p></div>",
            if ok { "✓" } else { "✕" },
            if ok { "Gmail conectado" } else { "No se pudo conectar Gmail" }
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
            page.len()
        );
        let _ = sock.write_all(response.as_bytes()).await;
        return Ok(params);
    }
}

#[tauri::command]
pub fn gmail_status(state: State<'_, Arc<Gmail>>) -> GmailStatus {
    state.inner.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn gmail_set_client(app: AppHandle, state: State<'_, Arc<Gmail>>, client_id: String, client_secret: String) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    if !client_id.ends_with(".apps.googleusercontent.com") {
        return Err("El Client ID debe terminar en .apps.googleusercontent.com".into());
    }
    if client_secret.is_empty() {
        return Err("Falta el Client secret.".into());
    }
    let cfg = ClientCfg { client_id, client_secret };
    kr_set(KEY_CLIENT, &serde_json::to_string(&cfg).unwrap())?;
    {
        let mut inner = state.inner.lock().unwrap();
        inner.client = Some(cfg);
        inner.status.configured = true;
        inner.status.error = None;
    }
    state.emit_status(&app);
    Ok(())
}

#[tauri::command]
pub async fn gmail_connect(app: AppHandle, state: State<'_, Arc<Gmail>>) -> Result<String, String> {
    let client = state.client()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random_b64(48);
    let challenge = B64URL.encode(Sha256::digest(verifier.as_bytes()));
    let csrf = random_b64(16);

    let auth_url = Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/v2/auth",
        &[
            ("client_id", client.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", csrf.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener().open_url(auth_url.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let params = tokio::time::timeout(Duration::from_secs(300), wait_for_redirect(listener))
        .await
        .map_err(|_| "Se acabó el tiempo para autorizar en el navegador.".to_string())??;
    if let Some(err) = params.get("error") {
        return Err(if err == "access_denied" { "Cancelaste el permiso en Google.".into() } else { format!("Google devolvió: {err}") });
    }
    if params.get("state") != Some(&csrf) {
        return Err("La respuesta de Google no coincide con la solicitud (state).".into());
    }
    let code = params.get("code").ok_or("Google no devolvió el código.")?;

    let res = state
        .http
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Sin conexión con Google: {e}"))?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let refresh = body["refresh_token"]
        .as_str()
        .ok_or_else(|| format!("Google no entregó un refresh token: {}", body["error_description"].as_str().unwrap_or("")))?
        .to_string();
    let access = body["access_token"].as_str().unwrap_or("").to_string();
    let ttl = body["expires_in"].as_u64().unwrap_or(3600);
    kr_set(KEY_REFRESH, &refresh)?;

    {
        let mut inner = state.inner.lock().unwrap();
        inner.refresh = Some(refresh);
        inner.access = Some((access, Instant::now() + Duration::from_secs(ttl)));
        inner.granted = body["scope"].as_str().unwrap_or_default().to_string();
        inner.known.clear();
        inner.cache.clear();
        inner.primed = false;
        inner.status = GmailStatus { configured: true, connected: true, ..Default::default() };
    }
    let profile = state.get("/profile").await?;
    let email = profile["emailAddress"].as_str().unwrap_or("").to_string();
    state.inner.lock().unwrap().status.email = Some(email.clone());
    state.emit_status(&app);
    state.wake.notify_one();
    state.cal_wake.notify_one();
    Ok(email)
}

#[tauri::command]
pub async fn gmail_disconnect(app: AppHandle, state: State<'_, Arc<Gmail>>) -> Result<(), String> {
    let refresh = state.inner.lock().unwrap().refresh.take();
    if let Some(token) = refresh {
        // Revocar es cortesía; si falla igual se olvida localmente.
        let _ = state.http.post("https://oauth2.googleapis.com/revoke").form(&[("token", token.as_str())]).send().await;
    }
    kr_del(KEY_REFRESH);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.access = None;
        inner.known.clear();
        inner.cache.clear();
        inner.primed = false;
        let configured = inner.client.is_some();
        inner.status = GmailStatus { configured, ..Default::default() };
    }
    state.emit_status(&app);
    state.cal_wake.notify_one();
    Ok(())
}

/// Borra también el cliente OAuth guardado (para cambiar de proyecto de Google).
#[tauri::command]
pub async fn gmail_forget_client(app: AppHandle, state: State<'_, Arc<Gmail>>) -> Result<(), String> {
    gmail_disconnect(app.clone(), state.clone()).await?;
    kr_del(KEY_CLIENT);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.client = None;
        inner.status.configured = false;
    }
    state.emit_status(&app);
    Ok(())
}

#[tauri::command]
pub fn gmail_refresh(state: State<'_, Arc<Gmail>>) {
    state.wake.notify_one();
}

#[tauri::command]
pub async fn gmail_mark_read(app: AppHandle, state: State<'_, Arc<Gmail>>, id: String) -> Result<(), String> {
    state
        .api(reqwest::Method::POST, &format!("/messages/{id}/modify"), Some(json!({ "removeLabelIds": ["UNREAD"] })))
        .await?;
    {
        let mut inner = state.inner.lock().unwrap();
        inner.cache.remove(&id);
        inner.known.remove(&id);
        if let Some(item) = inner.list_cache.get_mut(&id) {
            item.labels.retain(|l| l != "UNREAD");
        }
        let before = inner.status.messages.len();
        inner.status.messages.retain(|m| m.id != id);
        if inner.status.messages.len() < before {
            inner.status.unread_count = inner.status.unread_count.saturating_sub(1);
        }
    }
    state.emit_status(&app);
    Ok(())
}

/// Busca recursivamente la primera parte con ese tipo MIME y devuelve su texto.
fn find_part(part: &Value, mime: &str) -> Option<String> {
    if part["mimeType"].as_str() == Some(mime) {
        let data = part["body"]["data"].as_str()?;
        let bytes = B64URL.decode(data.trim_end_matches('=')).ok()?;
        return Some(String::from_utf8_lossy(&bytes).into_owned());
    }
    part["parts"].as_array()?.iter().find_map(|p| find_part(p, mime))
}

/// HTML → texto plano aproximado (para correos sin parte text/plain).
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut tag = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let t = tag.to_lowercase();
                if t.starts_with("br") || t.starts_with("/p") || t.starts_with("/div") || t.starts_with("/li") || t.starts_with("/tr") {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(c),
            _ => out.push(c),
        }
    }
    let text = decode_entities(&out.replace("&nbsp;", " "));
    // Colapsa líneas vacías repetidas.
    let mut lines: Vec<&str> = Vec::new();
    for line in text.lines().map(str::trim_end) {
        if !(line.trim().is_empty() && lines.last().is_some_and(|l| l.trim().is_empty())) {
            lines.push(line);
        }
    }
    lines.join("\n").trim().to_string()
}

/// Cuerpo completo de un correo en texto plano (máx. 20.000 caracteres).
#[tauri::command]
pub async fn gmail_message_text(state: State<'_, Arc<Gmail>>, id: String) -> Result<String, String> {
    let m = state.get(&format!("/messages/{id}?format=full")).await?;
    let payload = &m["payload"];
    let text = find_part(payload, "text/plain")
        .or_else(|| find_part(payload, "text/html").map(|h| html_to_text(&h)))
        .unwrap_or_else(|| decode_entities(m["snippet"].as_str().unwrap_or("")));
    Ok(text.chars().take(20_000).collect())
}

/// Lista correos con una búsqueda de Gmail (vacía = bandeja de entrada), leídos
/// incluidos. Los metadatos se piden en paralelo y quedan en caché.
#[tauri::command]
pub async fn gmail_list(state: State<'_, Arc<Gmail>>, query: String) -> Result<Vec<MailItem>, String> {
    let gmail: Arc<Gmail> = state.inner().clone();
    let account = gmail.inner.lock().unwrap().status.email.clone().unwrap_or_default();
    let q = if query.trim().is_empty() { "in:inbox".to_string() } else { query.trim().to_string() };
    let url = Url::parse_with_params("https://x/", &[("q", q.as_str()), ("maxResults", "25")]).map_err(|e| e.to_string())?;
    let list = gmail.get(&format!("/messages?{}", url.query().unwrap_or_default())).await?;
    let refs: Vec<(String, String)> = list["messages"]
        .as_array()
        .map(|a| a.iter().filter_map(|m| Some((m["id"].as_str()?.to_string(), m["threadId"].as_str()?.to_string()))).collect())
        .unwrap_or_default();

    let tasks: Vec<_> = refs
        .into_iter()
        .map(|(id, thread_id)| {
            let gmail = gmail.clone();
            let account = account.clone();
            tauri::async_runtime::spawn(async move {
                let cached = gmail.inner.lock().unwrap().list_cache.get(&id).cloned();
                // El estado leído/no leído cambia: la caché solo ahorra el remitente y asunto.
                match cached {
                    Some(item) if !item.labels.iter().any(|l| l == "UNREAD") => Ok(item),
                    _ => {
                        let item = gmail.fetch_message(&id, &thread_id, &account).await?;
                        gmail.inner.lock().unwrap().list_cache.insert(id, item.clone());
                        Ok::<MailItem, String>(item)
                    }
                }
            })
        })
        .collect();
    let mut items = Vec::with_capacity(tasks.len());
    for task in tasks {
        if let Ok(Ok(item)) = task.await {
            items.push(item);
        }
    }
    Ok(items)
}

/// Encabezado MIME: tal cual si es ASCII; si no, codificado RFC 2047 en UTF-8.
fn mime_header(value: &str) -> String {
    if value.is_ascii() {
        value.to_string()
    } else {
        format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(value))
    }
}

/// Mensaje RFC 2822 en texto plano UTF-8, como respuesta dentro de un hilo.
fn build_reply(to: &str, subject: &str, in_reply_to: &str, references: &str, body: &str) -> String {
    let mut msg = format!("To: {to}\r\nSubject: {}\r\n", mime_header(subject));
    if !in_reply_to.is_empty() {
        let refs = format!("{references} {in_reply_to}").trim().to_string();
        msg += &format!("In-Reply-To: {in_reply_to}\r\nReferences: {refs}\r\n");
    }
    msg += "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n";
    let encoded = base64::engine::general_purpose::STANDARD.encode(body.replace("\r\n", "\n").replace('\n', "\r\n"));
    for chunk in encoded.as_bytes().chunks(76) {
        msg += std::str::from_utf8(chunk).unwrap_or_default();
        msg += "\r\n";
    }
    B64URL.encode(msg)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyInfo {
    to: String,
    subject: String,
}

/// Datos para responder: a quién (Reply-To o From), asunto "Re: …" y encabezados del hilo.
async fn reply_headers(gmail: &Gmail, id: &str) -> Result<(String, String, String, String, String), String> {
    let m = gmail
        .get(&format!(
            "/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References"
        ))
        .await?;
    let header = |name: &str| {
        m["payload"]["headers"]
            .as_array()
            .and_then(|hs| hs.iter().find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name))))
            .and_then(|h| h["value"].as_str())
            .unwrap_or("")
            .to_string()
    };
    let reply_to = header("Reply-To");
    let target = if reply_to.is_empty() { header("From") } else { reply_to };
    let (_, to) = parse_from(&target);
    let subject = header("Subject");
    let subject = if subject.to_lowercase().starts_with("re:") { subject } else { format!("Re: {subject}") };
    let thread_id = m["threadId"].as_str().unwrap_or("").to_string();
    Ok((to, subject, header("Message-ID"), header("References"), thread_id))
}

#[tauri::command]
pub async fn gmail_reply_info(state: State<'_, Arc<Gmail>>, id: String) -> Result<ReplyInfo, String> {
    let (to, subject, ..) = reply_headers(&state, &id).await?;
    Ok(ReplyInfo { to, subject })
}

/// Responde un correo dentro de su hilo: `mode` = "send" lo envía, "draft" lo deja en Borradores.
#[tauri::command]
pub async fn gmail_reply(state: State<'_, Arc<Gmail>>, id: String, body: String, mode: String) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("La respuesta está vacía.".into());
    }
    let (to, subject, message_id, references, thread_id) = reply_headers(&state, &id).await?;
    if to.is_empty() {
        return Err("No se encontró a quién responder.".into());
    }
    let raw = build_reply(&to, &subject, &message_id, &references, &body);
    let message = json!({ "raw": raw, "threadId": thread_id });
    if mode == "send" {
        state.api(reqwest::Method::POST, "/messages/send", Some(message)).await?;
    } else {
        state.api(reqwest::Method::POST, "/drafts", Some(json!({ "message": message }))).await?;
    }
    Ok(())
}

#[cfg(test)]
mod reply_tests {
    use super::*;

    #[test]
    fn respuesta_mime_con_hilo_y_utf8() {
        let raw = build_reply("camila@x.cl", "Re: Reunión en Viña", "<abc@mail>", "<prev@mail>", "Hola Camila,\nel jueves está bien.");
        let msg = String::from_utf8(B64URL.decode(raw).unwrap()).unwrap();
        assert!(msg.starts_with("To: camila@x.cl\r\n"));
        // Asunto con tildes y ñ codificado RFC 2047.
        let subject_line = msg.lines().find(|l| l.starts_with("Subject: ")).unwrap();
        let b64 = subject_line.trim_start_matches("Subject: =?UTF-8?B?").trim_end_matches("?=");
        let subject = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(b64).unwrap()).unwrap();
        assert_eq!(subject, "Re: Reunión en Viña");
        assert!(msg.contains("In-Reply-To: <abc@mail>\r\n"));
        assert!(msg.contains("References: <prev@mail> <abc@mail>\r\n"));
        // Cuerpo en base64 con saltos CRLF.
        let body_b64: String = msg.split("\r\n\r\n").nth(1).unwrap().replace("\r\n", "");
        let body = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(body_b64).unwrap()).unwrap();
        assert_eq!(body, "Hola Camila,\r\nel jueves está bien.");
    }

    #[test]
    fn asunto_ascii_sin_codificar_y_sin_hilo() {
        let raw = build_reply("a@b.c", "Re: Hello", "", "", "ok");
        let msg = String::from_utf8(B64URL.decode(raw).unwrap()).unwrap();
        assert!(msg.contains("Subject: Re: Hello\r\n"));
        assert!(!msg.contains("In-Reply-To"));
    }
}
