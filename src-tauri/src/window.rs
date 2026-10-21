//! Ventana de la isla: posición arriba al centro, click-through dinámico,
//! posición del cursor para la mascota y ocultado automático cuando hay una
//! app en pantalla completa.

use std::sync::Mutex;
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::Shell::{
    QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, IsIconic, SetForegroundWindow,
};

/// Rectángulo interactivo de la píldora, en px CSS relativos a la ventana.
#[derive(Clone, Copy, Default)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct IslandState {
    hit: Mutex<Rect>,
    paused: Mutex<bool>,
}

/// Centro horizontal de la isla como fracción del ancho del monitor (bits de un f64).
/// 0.5 = centro; lo cambia Apariencia → Posición.
static ANCHOR: AtomicU64 = AtomicU64::new(0x3FE0_0000_0000_0000);

/// Última ventana ajena que tuvo el foco, para devolvérselo al cerrar el panel.
static LAST_EXTERNAL_FG: AtomicIsize = AtomicIsize::new(0);

#[derive(Clone, Serialize)]
struct Cursor {
    x: f64,
    y: f64,
}

#[tauri::command]
pub fn set_hit_rect(state: State<IslandState>, x: f64, y: f64, w: f64, h: f64) {
    *state.hit.lock().unwrap() = Rect { x, y, w, h };
}

/// Da el foco del teclado a la isla (panel abierto o quick-add).
#[tauri::command]
pub fn grab_focus(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_focus();
    }
}

/// Devuelve el foco a la ventana que lo tenía antes de usar la isla.
#[tauri::command]
pub fn release_focus() {
    let prev = LAST_EXTERNAL_FG.load(Ordering::Relaxed);
    if prev != 0 {
        unsafe {
            let _ = SetForegroundWindow(HWND(prev as *mut _));
        }
    }
}

#[tauri::command]
pub fn set_anchor(app: AppHandle, fraction: f64) {
    ANCHOR.store(fraction.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("main") {
        if let Some(pos) = top_center(&win) {
            let _ = win.set_position(pos);
        }
    }
}

pub fn set_paused(app: &AppHandle, paused: bool) {
    *app.state::<IslandState>().paused.lock().unwrap() = paused;
}

fn top_center(win: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = win.primary_monitor().ok().flatten()?;
    let size = win.outer_size().ok()?;
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let anchor = f64::from_bits(ANCHOR.load(Ordering::Relaxed));
    let center = m_pos.x + (m_size.width as f64 * anchor) as i32;
    let max_x = m_pos.x + m_size.width as i32 - size.width as i32;
    let x = (center - size.width as i32 / 2).clamp(m_pos.x, max_x.max(m_pos.x));
    Some(PhysicalPosition::new(x, m_pos.y))
}

/// Clases de ventana del escritorio/barra de tareas: tenerlas en primer plano no tapa nada.
const SHELL_CLASSES: [&str; 4] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

/// ¿La ventana activa ocupa el borde superior justo detrás de la isla?
/// (navegador maximizado, editor pegado arriba...). En ese caso la isla se esconde del todo.
fn top_edge_occupied(own: isize, monitor_top: i32, span: (i32, i32)) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg.0 as isize == own || IsIconic(fg).as_bool() {
            return false;
        }
        let mut buf = [0u16; 64];
        let len = GetClassNameW(fg, &mut buf) as usize;
        let class = String::from_utf16_lossy(&buf[..len]);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        // Las ventanas maximizadas sobresalen ~8 px por el borde invisible.
        rect.top <= monitor_top + 6 && rect.bottom > monitor_top + 60 && rect.left < span.1 && rect.right > span.0
    }
}

fn fullscreen_app_active() -> bool {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

pub fn setup(app: &AppHandle) {
    let win = app.get_webview_window("main").expect("main window");
    if let Some(pos) = top_center(&win) {
        let _ = win.set_position(pos);
    }
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.show();
    let own_hwnd = win.hwnd().map(|h| h.0 as isize).unwrap_or(0);

    let app = app.clone();
    thread::spawn(move || {
        let mut inside = false;
        let mut visible = true;
        let mut origin = win.outer_position().unwrap_or_default();
        let mut scale = win.scale_factor().unwrap_or(1.0);
        let mut last_cursor = POINT::default();
        let mut occluded = false;
        let mut tick: u32 = 0;

        loop {
            thread::sleep(Duration::from_millis(16));
            tick = tick.wrapping_add(1);
            let state = app.state::<IslandState>();

            let fg = unsafe { GetForegroundWindow() }.0 as isize;
            if fg != 0 && fg != own_hwnd {
                LAST_EXTERNAL_FG.store(fg, Ordering::Relaxed);
            }

            // Cada ~1 s: reubicar (cambio de monitor/DPI) y revisar pantalla completa.
            if tick % 60 == 0 {
                if let Some(pos) = top_center(&win) {
                    if pos != origin {
                        let _ = win.set_position(pos);
                    }
                }
                origin = win.outer_position().unwrap_or(origin);
                scale = win.scale_factor().unwrap_or(scale);

                let should_show = !*state.paused.lock().unwrap() && !fullscreen_app_active();
                if should_show != visible {
                    visible = should_show;
                    println!("[window] isla {}", if visible { "visible" } else { "oculta (pausa o pantalla completa)" });
                    let _ = if visible { win.show() } else { win.hide() };
                }
            }
            if !visible {
                continue;
            }

            // Cada ~250 ms: ¿hay una ventana usando el borde superior detrás de la isla?
            if tick % 15 == 0 {
                let size = win.outer_size().unwrap_or_default();
                let center = origin.x + size.width as i32 / 2;
                let half = (190.0 * scale) as i32;
                let now_occluded = top_edge_occupied(own_hwnd, origin.y, (center - half, center + half));
                if now_occluded != occluded {
                    occluded = now_occluded;
                    let _ = app.emit("island://occluded", occluded);
                }
            }

            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }

            // La mascota sigue el cursor con la mirada (~20 Hz basta).
            if tick % 3 == 0 && (pt.x != last_cursor.x || pt.y != last_cursor.y) {
                last_cursor = pt;
                let _ = app.emit(
                    "island://cursor",
                    Cursor {
                        x: (pt.x - origin.x) as f64 / scale,
                        y: (pt.y - origin.y) as f64 / scale,
                    },
                );
            }

            let r = *state.hit.lock().unwrap();
            let left = origin.x as f64 + r.x * scale;
            let top = origin.y as f64 + r.y * scale;
            let now_inside = r.w > 0.0
                && (pt.x as f64) >= left
                && (pt.x as f64) <= left + r.w * scale
                && (pt.y as f64) >= top
                && (pt.y as f64) <= top + r.h * scale;

            if now_inside != inside {
                inside = now_inside;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = app.emit("island://pointer", inside);
            }
        }
    });
}
