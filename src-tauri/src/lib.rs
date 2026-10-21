mod audio_devices;
mod calendar;
mod claude;
mod gmail;
mod media;
mod notifications;
mod reminders;
mod system;
mod window;

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::json;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Atajos globales: evento que disparan y candidatos en orden de preferencia
/// (se usa el primero que no esté ocupado por otra app).
const SHORTCUTS: [(&str, &[&str]); 2] = [
    ("island://toggle", &["ctrl+alt+i", "alt+shift+i", "ctrl+alt+o"]),
    ("island://quick-add", &["ctrl+alt+space", "ctrl+shift+space", "alt+shift+r"]),
];

/// Atajo efectivamente registrado por evento.
static ACTIVE_SHORTCUTS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn register_shortcuts(app: &AppHandle) {
    let mut active = HashMap::new();
    for (event, candidates) in SHORTCUTS {
        for sc in candidates {
            let ok = app
                .global_shortcut()
                .on_shortcut(*sc, move |app, _shortcut, e| {
                    if e.state == ShortcutState::Pressed {
                        let _ = app.emit(event, ());
                    }
                })
                .is_ok();
            if ok {
                active.insert(event.trim_start_matches("island://").to_string(), sc.to_string());
                break;
            }
        }
    }
    *ACTIVE_SHORTCUTS.lock().unwrap() = Some(active);
}

/// `{ "toggle": "ctrl+alt+i", "quick-add": "ctrl+alt+space" }`
#[tauri::command]
fn shortcuts() -> HashMap<String, String> {
    ACTIVE_SHORTCUTS.lock().unwrap().clone().unwrap_or_default()
}

fn shortcut_label(name: &str) -> String {
    shortcuts().get(name).map(|s| format!(" ({s})")).unwrap_or_default()
}

/// Alerta de prueba con la misma forma que usarán Gmail y las notificaciones.
fn emit_test_alert(app: &AppHandle, kind: &str) {
    let payload = match kind {
        "mail" => json!({
            "id": format!("test-{}", reminders::now_ms()),
            "kind": "mail",
            "app": "Gmail",
            "title": "Camila Rojas",
            "body": "Re: Propuesta landing — ¡Nos encantó! ¿Podemos agendar una llamada?",
        }),
        _ => json!({
            "id": format!("test-{}", reminders::now_ms()),
            "kind": "notification",
            "app": "WhatsApp",
            "title": "Mamá",
            "body": "¿Vienes a almorzar el domingo? 🍲",
        }),
    };
    let _ = app.emit("island://alert", payload);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", format!("Abrir Wiri{}", shortcut_label("toggle")), true, None::<&str>)?;
    let quick_add = MenuItem::with_id(
        app,
        "quick-add",
        format!("Nuevo recordatorio{}", shortcut_label("quick-add")),
        true,
        None::<&str>,
    )?;
    let test_notif = MenuItem::with_id(app, "test-notif", "Probar notificación", true, None::<&str>)?;
    let test_mail = MenuItem::with_id(app, "test-mail", "Probar correo", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Ocultar isla", true, false, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Iniciar con Windows", true, autostart_enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&open, &quick_add, &test_notif, &test_mail, &sep, &pause, &autostart, &sep2, &quit],
    )?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Wiri")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.emit("island://toggle", ());
            }
            "quick-add" => {
                let _ = app.emit("island://quick-add", ());
            }
            "test-notif" => emit_test_alert(app, "notification"),
            "test-mail" => emit_test_alert(app, "mail"),
            "pause" => window::set_paused(app, pause.is_checked().unwrap_or(false)),
            "autostart" => {
                let launcher = app.autolaunch();
                let _ = if autostart.is_checked().unwrap_or(false) { launcher.enable() } else { launcher.disable() };
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// En la primera ejecución de la versión instalada, Wiri se agrega al inicio de
/// Windows (después se controla desde la bandeja). En desarrollo no toca nada.
fn enable_autostart_once(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let marker = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Wiri").join("autostart-configurado");
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(marker.parent().unwrap());
        let _ = std::fs::write(marker, "");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: si Wiri ya está abierta, abrirla de nuevo solo abre el panel.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit("island://toggle", ());
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(window::IslandState::default())
        .setup(|app| {
            let handle = app.handle();
            app.manage(reminders::Reminders::load(handle));
            window::setup(handle);
            media::start(handle);
            reminders::start(handle);
            notifications::start(handle);
            system::start(handle);
            claude::start(handle);
            let mail = gmail::Gmail::load();
            gmail::start(handle, mail.clone());
            calendar::start(handle, mail.clone());
            app.manage(mail);
            register_shortcuts(handle);
            enable_autostart_once(handle);
            setup_tray(handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            shortcuts,
            window::set_anchor,
            audio_devices::audio_devices,
            claude::claude_hooks_status,
            claude::claude_hooks_install,
            claude::claude_hooks_uninstall,
            claude::claude_focus,
            claude::claude_projects,
            claude::claude_launch,
            claude::claude_draft_reply,
            claude::claude_permission_respond,
            audio_devices::audio_set_default,
            window::set_hit_rect,
            window::grab_focus,
            window::release_focus,
            media::current_media,
            media::media_control,
            reminders::list_reminders,
            reminders::add_reminder,
            reminders::remove_reminder,
            reminders::snooze_reminder,
            gmail::gmail_status,
            gmail::gmail_set_client,
            gmail::gmail_connect,
            gmail::gmail_disconnect,
            gmail::gmail_forget_client,
            gmail::gmail_refresh,
            gmail::gmail_mark_read,
            gmail::gmail_message_text,
            gmail::gmail_list,
            gmail::gmail_reply_info,
            gmail::gmail_reply,
            calendar::calendar_status,
            calendar::calendar_refresh,
            notifications::notif_access,
            notifications::notif_dismiss,
            notifications::notif_open_app,
            notifications::notif_open_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
