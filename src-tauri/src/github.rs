//! GitHub con tu sesión de la CLI `gh` (no guarda tokens propios).
//!
//! Cada 2 minutos consulta tus PR abiertos (con el estado del CI del último commit)
//! y los que te pidieron revisar. Emite `github://status` con todo y una alerta
//! `island://alert` cuando el CI de un PR tuyo termina o te piden una revisión nueva.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const EVERY: Duration = Duration::from_secs(120);

const QUERY: &str = r#"query {
  viewer { login }
  reviews: search(query: "is:open is:pr review-requested:@me archived:false", type: ISSUE, first: 15) {
    nodes { ... on PullRequest { number title url updatedAt isDraft repository { nameWithOwner } author { login } } }
  }
  mine: search(query: "is:open is:pr author:@me archived:false", type: ISSUE, first: 15) {
    nodes { ... on PullRequest { number title url updatedAt isDraft reviewDecision repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }
  }
}"#;

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    number: u64,
    title: String,
    url: String,
    repo: String,
    author: Option<String>,
    updated_at: String,
    draft: bool,
    /// SUCCESS | FAILURE | ERROR | PENDING | EXPECTED | null (sin CI)
    ci: Option<String>,
    /// APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
    review: Option<String>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// `gh` está instalado y con sesión.
    connected: bool,
    login: Option<String>,
    mine: Vec<Pr>,
    reviews: Vec<Pr>,
    error: Option<String>,
    updated_ms: i64,
}

static LAST: Mutex<Option<GithubStatus>> = Mutex::new(None);

fn pr(node: &Value) -> Option<Pr> {
    Some(Pr {
        number: node["number"].as_u64()?,
        title: node["title"].as_str()?.to_string(),
        url: node["url"].as_str()?.to_string(),
        repo: node["repository"]["nameWithOwner"].as_str().unwrap_or_default().to_string(),
        author: node["author"]["login"].as_str().map(str::to_string),
        updated_at: node["updatedAt"].as_str().unwrap_or_default().to_string(),
        draft: node["isDraft"].as_bool().unwrap_or(false),
        ci: node["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"].as_str().map(str::to_string),
        review: node["reviewDecision"].as_str().map(str::to_string),
    })
}

fn fetch() -> GithubStatus {
    let now = crate::reminders::now_ms();
    let out = Command::new("gh")
        .args(["api", "graphql", "-f", &format!("query={QUERY}")])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let out = match out {
        Ok(o) => o,
        Err(_) => {
            return GithubStatus { error: Some("No encontré la CLI de GitHub (gh). Instálala y ejecuta `gh auth login`.".into()), updated_ms: now, ..Default::default() };
        }
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.contains("auth login") || err.contains("not logged") { "gh no tiene sesión: ejecuta `gh auth login`.".to_string() } else { err };
        return GithubStatus { error: Some(msg), updated_ms: now, ..Default::default() };
    }
    let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) else {
        return GithubStatus { error: Some("Respuesta inesperada de gh.".into()), updated_ms: now, ..Default::default() };
    };
    let list = |key: &str| v["data"][key]["nodes"].as_array().map(|n| n.iter().filter_map(pr).collect()).unwrap_or_default();
    GithubStatus {
        connected: true,
        login: v["data"]["viewer"]["login"].as_str().map(str::to_string),
        mine: list("mine"),
        reviews: list("reviews"),
        error: None,
        updated_ms: now,
    }
}

/// Alertas por lo que cambió desde la consulta anterior (nunca en la primera).
fn alerts(app: &AppHandle, prev: &GithubStatus, next: &GithubStatus) {
    if !prev.connected {
        return;
    }
    let before: HashMap<&str, &Pr> = prev.mine.iter().map(|p| (p.url.as_str(), p)).collect();
    for p in &next.mine {
        let Some(old) = before.get(p.url.as_str()) else { continue };
        let finished = old.ci.as_deref() == Some("PENDING") && matches!(p.ci.as_deref(), Some("SUCCESS" | "FAILURE" | "ERROR"));
        if finished {
            let ok = p.ci.as_deref() == Some("SUCCESS");
            let _ = app.emit(
                "island://alert",
                json!({
                    "id": format!("gh-ci-{}-{}", p.url, next.updated_ms),
                    "kind": "notification",
                    "app": "GitHub",
                    "title": if ok { format!("CI pasó · {}#{}", p.repo, p.number) } else { format!("CI falló · {}#{}", p.repo, p.number) },
                    "body": p.title,
                    "url": p.url,
                }),
            );
        }
    }
    let seen: Vec<&str> = prev.reviews.iter().map(|p| p.url.as_str()).collect();
    for p in next.reviews.iter().filter(|p| !seen.contains(&p.url.as_str())) {
        let _ = app.emit(
            "island://alert",
            json!({
                "id": format!("gh-review-{}", p.url),
                "kind": "notification",
                "app": "GitHub",
                "title": format!("Te piden revisar {}#{}", p.repo, p.number),
                "body": format!("{}{}", p.title, p.author.as_ref().map(|a| format!(" · de {a}")).unwrap_or_default()),
                "url": p.url,
            }),
        );
    }
}

fn refresh(app: &AppHandle) -> GithubStatus {
    let next = fetch();
    let prev = LAST.lock().unwrap().replace(next.clone()).unwrap_or_default();
    alerts(app, &prev, &next);
    let _ = app.emit("github://status", &next);
    next
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Deja arrancar la isla antes de la primera consulta.
        std::thread::sleep(Duration::from_secs(6));
        loop {
            refresh(&app);
            std::thread::sleep(EVERY);
        }
    });
}

#[tauri::command]
pub fn github_status() -> GithubStatus {
    LAST.lock().unwrap().clone().unwrap_or_default()
}

#[tauri::command]
pub async fn github_refresh(app: AppHandle) -> GithubStatus {
    tauri::async_runtime::spawn_blocking(move || refresh(&app)).await.unwrap_or_default()
}
