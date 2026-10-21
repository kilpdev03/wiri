//! Recordatorios y temporizadores persistidos en `reminders.json` dentro del
//! directorio de datos de la app. Un hilo revisa cada 500 ms los vencidos y
//! emite `reminder://due`; cualquier cambio en la lista emite `reminder://changed`.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    id: String,
    text: String,
    /// "reminder" | "timer"
    kind: String,
    created_ms: i64,
    due_ms: i64,
}

pub struct Reminders {
    path: PathBuf,
    items: Mutex<Vec<Reminder>>,
}

static SEQ: AtomicU64 = AtomicU64::new(0);

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

impl Reminders {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app.path().app_data_dir().expect("app data dir");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("reminders.json");
        let items = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, items: Mutex::new(items) }
    }

    fn save(&self, items: &[Reminder]) {
        if let Ok(json) = serde_json::to_string_pretty(items) {
            let _ = fs::write(&self.path, json);
        }
    }

    /// Aplica `f` a la lista, guarda y notifica al frontend.
    fn mutate<R>(&self, app: &AppHandle, f: impl FnOnce(&mut Vec<Reminder>) -> R) -> R {
        let mut items = self.items.lock().unwrap();
        let out = f(&mut items);
        items.sort_by_key(|r| r.due_ms);
        self.save(&items);
        let _ = app.emit("reminder://changed", &*items);
        out
    }
}

#[tauri::command]
pub fn list_reminders(state: State<Reminders>) -> Vec<Reminder> {
    state.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn add_reminder(app: AppHandle, state: State<Reminders>, text: String, kind: String, due_ms: i64) -> Reminder {
    let now = now_ms();
    let reminder = Reminder {
        id: format!("{now}-{}", SEQ.fetch_add(1, Ordering::Relaxed)),
        text,
        kind,
        created_ms: now,
        due_ms,
    };
    let out = reminder.clone();
    state.mutate(&app, |items| items.push(reminder));
    out
}

#[tauri::command]
pub fn remove_reminder(app: AppHandle, state: State<Reminders>, id: String) {
    state.mutate(&app, |items| items.retain(|r| r.id != id));
}

/// Re-agenda un recordatorio ya vencido (el frontend lo conserva al dispararse).
#[tauri::command]
pub fn snooze_reminder(app: AppHandle, state: State<Reminders>, reminder: Reminder, minutes: i64) {
    let now = now_ms();
    let snoozed = Reminder { created_ms: now, due_ms: now + minutes * 60_000, ..reminder };
    state.mutate(&app, |items| {
        items.retain(|r| r.id != snoozed.id);
        items.push(snoozed);
    });
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(500));
        let state = app.state::<Reminders>();
        let now = now_ms();
        let has_due = state.items.lock().unwrap().iter().any(|r| r.due_ms <= now);
        if !has_due {
            continue;
        }
        let due = state.mutate(&app, |items| {
            let (due, rest): (Vec<_>, Vec<_>) = items.drain(..).partition(|r| r.due_ms <= now);
            *items = rest;
            due
        });
        for r in due {
            let _ = app.emit("reminder://due", &r);
        }
    });
}
