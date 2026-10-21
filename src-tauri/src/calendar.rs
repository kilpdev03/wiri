//! Google Calendar: próximos eventos de las siguientes 24 h del calendario
//! principal, con el mismo OAuth de Gmail. Sondea cada 5 min y emite
//! `calendar://status`. Las alertas (10 min antes / al empezar) las decide el frontend.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::gmail::{CALENDAR_SCOPE, Gmail};

const EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const POLL_EVERY: Duration = Duration::from_secs(300);
const WINDOW_HOURS: u64 = 24;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    id: String,
    summary: String,
    /// RFC 3339 ("2026-10-21T15:00:00-03:00") o fecha ("2026-10-21") si es de día completo.
    start: String,
    end: String,
    all_day: bool,
    /// Enlace de videollamada (Meet, Zoom, Teams) si lo hay.
    join_url: Option<String>,
    html_link: String,
    location: Option<String>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CalendarStatus {
    /// "disconnected" | "needs_scope" | "api_disabled" | "ok" | "error"
    status: String,
    events: Vec<CalEvent>,
    error: Option<String>,
    last_sync_ms: i64,
}

static LAST: Mutex<Option<CalendarStatus>> = Mutex::new(None);

/// Fecha UTC en RFC 3339 a partir de ms Unix (sin dependencias de fechas).
fn rfc3339_utc(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Algoritmo civil_from_days de Howard Hinnant.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Primer enlace de videollamada en un texto libre (ubicación o descripción).
fn find_meeting_url(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == '"' || c == '<' || c == '>')
        .find(|w| {
            w.starts_with("https://")
                && ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "whereby.com"]
                    .iter()
                    .any(|d| w.contains(d))
        })
        .map(|w| w.trim_end_matches([')', ',', '.', ';']).to_string())
}

fn parse_event(e: &Value) -> Option<CalEvent> {
    if e["status"] == "cancelled" {
        return None;
    }
    // Ignora los que rechazaste.
    let declined = e["attendees"]
        .as_array()
        .is_some_and(|a| a.iter().any(|p| p["self"] == true && p["responseStatus"] == "declined"));
    if declined {
        return None;
    }
    let (start, all_day) = match e["start"]["dateTime"].as_str() {
        Some(dt) => (dt.to_string(), false),
        None => (e["start"]["date"].as_str()?.to_string(), true),
    };
    let end = e["end"]["dateTime"].as_str().or(e["end"]["date"].as_str()).unwrap_or("").to_string();
    let video = e["conferenceData"]["entryPoints"]
        .as_array()
        .and_then(|eps| eps.iter().find(|p| p["entryPointType"] == "video"))
        .and_then(|p| p["uri"].as_str())
        .map(String::from);
    let join_url = e["hangoutLink"]
        .as_str()
        .map(String::from)
        .or(video)
        .or_else(|| e["location"].as_str().and_then(find_meeting_url))
        .or_else(|| e["description"].as_str().and_then(find_meeting_url));

    Some(CalEvent {
        id: e["id"].as_str()?.to_string(),
        summary: e["summary"].as_str().unwrap_or("(sin título)").to_string(),
        start,
        end,
        all_day,
        join_url,
        html_link: e["htmlLink"].as_str().unwrap_or("https://calendar.google.com").to_string(),
        location: e["location"].as_str().map(String::from),
    })
}

async fn fetch(gmail: &Gmail) -> CalendarStatus {
    let base = CalendarStatus { last_sync_ms: crate::reminders::now_ms(), ..Default::default() };
    if !gmail.is_connected() {
        return CalendarStatus { status: "disconnected".into(), ..base };
    }
    let token = match gmail.access_token().await {
        Ok(t) => t,
        Err(e) => return CalendarStatus { status: "error".into(), error: Some(e), ..base },
    };
    let granted = gmail.granted();
    if !granted.is_empty() && !granted.contains(CALENDAR_SCOPE) {
        return CalendarStatus { status: "needs_scope".into(), ..base };
    }

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    // Desde hace 1 h para incluir reuniones en curso.
    let url = Url::parse_with_params(
        EVENTS_URL,
        &[
            ("timeMin", rfc3339_utc(now - 3_600_000).as_str()),
            ("timeMax", rfc3339_utc(now + WINDOW_HOURS as i64 * 3_600_000).as_str()),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "15"),
        ],
    )
    .expect("url válida");

    let res = match gmail.http.get(url).bearer_auth(token).send().await {
        Ok(r) => r,
        Err(e) => return CalendarStatus { status: "error".into(), error: Some(format!("Sin conexión con Google: {e}")), ..base },
    };
    let code = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !code.is_success() {
        let reason = body["error"]["errors"][0]["reason"].as_str().unwrap_or("");
        let message = body["error"]["message"].as_str().unwrap_or("error desconocido").to_string();
        let status = match reason {
            "accessNotConfigured" => "api_disabled",
            "insufficientPermissions" | "ACCESS_TOKEN_SCOPE_INSUFFICIENT" => "needs_scope",
            _ if code.as_u16() == 403 && message.contains("scope") => "needs_scope",
            _ => "error",
        };
        return CalendarStatus { status: status.into(), error: Some(message), ..base };
    }

    let events = body["items"].as_array().map(|a| a.iter().filter_map(parse_event).collect()).unwrap_or_default();
    CalendarStatus { status: "ok".into(), events, ..base }
}

pub fn start(app: &AppHandle, gmail: Arc<Gmail>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let status = fetch(&gmail).await;
            *LAST.lock().unwrap() = Some(status.clone());
            let _ = app.emit("calendar://status", status);
            tokio::select! {
                _ = tokio::time::sleep(POLL_EVERY) => {}
                _ = gmail.cal_wake.notified() => {}
            }
        }
    });
}

#[tauri::command]
pub fn calendar_status() -> Option<CalendarStatus> {
    LAST.lock().unwrap().clone()
}

#[tauri::command]
pub fn calendar_refresh(state: State<'_, Arc<Gmail>>) {
    state.cal_wake.notify_one();
}
