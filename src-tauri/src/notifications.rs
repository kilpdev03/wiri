//! Notificaciones de Windows (WhatsApp, Discord, Teams, Slack...) leídas del
//! centro de notificaciones con `UserNotificationListener`.
//!
//! El evento `NotificationChanged` solo funciona en apps empaquetadas, así que se
//! sondea cada 1,5 s y se emite `island://alert` por cada notificación nueva.
//! `notifs://status` informa si Windows dio acceso.

use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use windows::Foundation::Size;
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Access};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};
use windows::Storage::Streams::{DataReader, RandomAccessStreamReference};

const POLL_EVERY: Duration = Duration::from_millis(1500);
/// Solo se alertan notificaciones creadas hace menos de esto (evita alertas viejas al arrancar).
const FRESH_MS: i64 = 60_000;
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

/// Último estado de acceso, para que la UI lo pida al montar.
static LAST_ACCESS: Mutex<String> = Mutex::new(String::new());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotifStatus {
    /// "allowed" | "denied" | "unspecified" | "error"
    access: String,
    error: Option<String>,
}

struct Parsed {
    id: u32,
    app: String,
    aumid: String,
    title: String,
    body: String,
    created_ms: i64,
}

fn read_logo(stream_ref: &RandomAccessStreamReference) -> windows::core::Result<String> {
    let stream = stream_ref.OpenReadAsync()?.get()?;
    let size = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
    let mime = if mime.is_empty() { "image/png".to_string() } else { mime };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf)))
}

/// "com.squirrel.Discord.Discord" → "Discord"; "5319275A.WhatsAppDesktop_cv1g!App" → "WhatsApp".
fn name_from_aumid(aumid: &str) -> String {
    let lower = aumid.to_lowercase();
    for (needle, name) in [
        ("whatsapp", "WhatsApp"),
        ("discord", "Discord"),
        ("teams", "Teams"),
        ("slack", "Slack"),
        ("telegram", "Telegram"),
        ("outlook", "Outlook"),
        ("spotify", "Spotify"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
    ] {
        if lower.contains(needle) {
            return name.to_string();
        }
    }
    let base = aumid.split('!').next().unwrap_or(aumid);
    let last = base.rsplit(['.', '\\']).find(|s| !s.is_empty() && !s.eq_ignore_ascii_case("exe")).unwrap_or(base);
    let last = last.split('_').next().unwrap_or(last);
    if last.is_empty() { "Notificación".into() } else { last.to_string() }
}

fn parse(n: &UserNotification) -> windows::core::Result<Parsed> {
    let info = n.AppInfo().ok();
    let aumid = info.as_ref().and_then(|i| i.AppUserModelId().ok()).map(|s| s.to_string()).unwrap_or_default();
    let display = info
        .as_ref()
        .and_then(|i| i.DisplayInfo().ok())
        .and_then(|d| d.DisplayName().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app = if !display.is_empty() { display } else if !aumid.is_empty() { name_from_aumid(&aumid) } else { "Notificación".into() };

    let binding = n.Notification()?.Visual()?.GetBinding(&KnownNotificationBindings::ToastGeneric()?)?;
    let texts: Vec<String> = binding
        .GetTextElements()?
        .into_iter()
        .filter_map(|t| t.Text().ok().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .collect();
    let ut = n.CreationTime()?.UniversalTime;

    Ok(Parsed {
        id: n.Id()?,
        app,
        aumid,
        title: texts.first().cloned().unwrap_or_default(),
        body: texts.iter().skip(1).cloned().collect::<Vec<_>>().join(" · "),
        created_ms: (ut - EPOCH_DIFF_TICKS) / 10_000,
    })
}

fn logo_for(n: &UserNotification) -> Option<String> {
    let display = n.AppInfo().ok()?.DisplayInfo().ok()?;
    let logo = display.GetLogo(Size { Width: 64.0, Height: 64.0 }).ok()?;
    read_logo(&logo).ok()
}

fn emit_status(app: &AppHandle, access: &str, error: Option<String>) {
    *LAST_ACCESS.lock().unwrap() = access.to_string();
    let _ = app.emit("notifs://status", NotifStatus { access: access.into(), error });
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let listener = match UserNotificationListener::Current() {
            Ok(l) => l,
            Err(e) => return emit_status(&app, "error", Some(e.to_string())),
        };
        let mut seen: HashSet<u32> = HashSet::new();
        let mut primed = false;
        let mut logos: HashMap<String, Option<String>> = HashMap::new();
        let mut last_access = String::new();

        loop {
            let access = match listener.GetAccessStatus() {
                Ok(Access::Allowed) => "allowed",
                Ok(Access::Denied) => "denied",
                Ok(_) => {
                    // Primera vez: pedirlo (Windows puede mostrar su propio diálogo).
                    let _ = listener.RequestAccessAsync().and_then(|op| op.get());
                    "unspecified"
                }
                Err(_) => "error",
            };
            if access != last_access {
                last_access = access.to_string();
                emit_status(&app, access, None);
            }
            if access != "allowed" {
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            match listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op| op.get()) {
                Ok(list) => {
                    let now = crate::reminders::now_ms();
                    let mut current = HashSet::new();
                    for n in list {
                        let Ok(id) = n.Id() else { continue };
                        current.insert(id);
                        if seen.contains(&id) {
                            continue;
                        }
                        let Ok(p) = parse(&n) else { continue };
                        if !primed || now - p.created_ms > FRESH_MS || p.title.is_empty() {
                            continue;
                        }
                        let key = if p.aumid.is_empty() { p.app.clone() } else { p.aumid.clone() };
                        let icon = logos.entry(key).or_insert_with(|| logo_for(&n)).clone();
                        let _ = app.emit(
                            "island://alert",
                            json!({
                                "id": format!("win-{}", p.id),
                                "kind": "notification",
                                "app": p.app,
                                "title": p.title,
                                "body": p.body,
                                "icon": icon,
                                "aumid": p.aumid,
                                "winId": p.id,
                                "at": p.created_ms,
                            }),
                        );
                    }
                    seen = current;
                    primed = true;
                }
                Err(e) => emit_status(&app, "error", Some(e.to_string())),
            }
            thread::sleep(POLL_EVERY);
        }
    });
}

#[tauri::command]
pub fn notif_access() -> String {
    let a = LAST_ACCESS.lock().unwrap().clone();
    if a.is_empty() { "unknown".into() } else { a }
}

/// Quita la notificación también del centro de notificaciones de Windows.
#[tauri::command]
pub fn notif_dismiss(win_id: u32) -> Result<(), String> {
    UserNotificationListener::Current()
        .and_then(|l| l.RemoveNotification(win_id))
        .map_err(|e| e.to_string())
}

/// Abre (o trae al frente) la app que envió la notificación.
#[tauri::command]
pub fn notif_open_app(aumid: String) -> Result<(), String> {
    if aumid.is_empty() || aumid.contains(['"', '&', '|', '<', '>']) {
        return Err("App desconocida".into());
    }
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{aumid}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Abre la página de privacidad de Windows para dar acceso a las notificaciones.
#[tauri::command]
pub fn notif_open_settings() -> Result<(), String> {
    Command::new("explorer.exe").arg("ms-settings:privacy-notifications").spawn().map(|_| ()).map_err(|e| e.to_string())
}
