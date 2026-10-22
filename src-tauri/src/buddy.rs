//! Bolo en el escritorio: su propia ventana chiquita, donde lo dejes.
//!
//! La mecánica (ventana estacionada fuera de pantalla, sondeo del cursor que la
//! arrastra y la vuelve "atravesable" salvo sobre el cuerpo, vuelos con easing,
//! acomodarlo dentro del área de trabajo al soltarlo y "soltar sobre la isla = a
//! casa") está adaptada de Coucou (windows/src-tauri/src/desktop.rs,
//! © 2026 Louis Raillé, licencia MIT). El personaje y sus gestos son de Wiri.
//!
//! - La ventana se crea al arrancar y nunca se oculta: se estaciona en
//!   (-32000, -32000). Mostrar una ventana oculta en Windows le puede quitar el
//!   foco a lo que estás escribiendo; moverla, no.
//! - Todo en px físicos de escritorio (los de `GetCursorPos`), sin líos de escala.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos};

pub const LABEL: &str = "buddy";
/// Lado de la ventana, px lógicos.
const SIZE: f64 = 130.0;
/// Distancia a los bordes del área de trabajo (sin barra de tareas).
const MARGIN: f64 = 24.0;
const PARKED: (f64, f64) = (-32000.0, -32000.0);
const TICK_MS: u64 = 16;
/// De la isla a su lugar y de vuelta.
const FLIGHT_MS: u64 = 450;
/// Acomodarse después de soltarlo (con un pequeño rebote).
const SNAP_MS: u64 = 250;
/// Zona de la isla donde soltarlo lo manda a casa (px lógicos, como el panel).
const HOME_W: f64 = 680.0;
const HOME_H: f64 = 340.0;

// ── Geometría pura ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn contains(&self, p: (f64, f64)) -> bool {
        p.0 >= self.x && p.0 < self.x + self.w && p.1 >= self.y && p.1 < self.y + self.h
    }
    fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
}

#[derive(Clone, Copy, Debug)]
struct Display {
    frame: Rect,
    work: Rect,
    scale: f64,
}

/// Cuerpo de Bolo dentro de la ventana (px lógicos): una elipse abajo al centro.
fn over_body(local: (f64, f64)) -> bool {
    let (dx, dy) = ((local.0 - 65.0) / 44.0, (local.1 - 88.0) / 40.0);
    dx * dx + dy * dy <= 1.0
}

fn clamp_origin(o: (f64, f64), size: f64, work: Rect, margin: f64) -> (f64, f64) {
    (
        o.0.max(work.x + margin).min(work.x + work.w - size - margin),
        o.1.max(work.y + margin).min(work.y + work.h - size - margin),
    )
}

fn display_near(p: (f64, f64), all: &[Display]) -> Option<Display> {
    let d2 = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2);
    all.iter().copied().find(|d| d.frame.contains(p)).or_else(|| {
        all.iter().copied().min_by(|a, b| d2(p, a.work.center()).total_cmp(&d2(p, b.work.center())))
    })
}

/// Dónde queda al soltarlo: dentro del área de trabajo del monitor bajo su centro.
fn settle(o: (f64, f64), all: &[Display]) -> (f64, f64) {
    let Some(first) = all.first() else { return o };
    let half = SIZE * first.scale / 2.0;
    let Some(d) = display_near((o.0 + half, o.1 + half), all) else { return o };
    clamp_origin(o, SIZE * d.scale, d.work, MARGIN * d.scale)
}

/// Un lugar guardado, revisado contra los monitores de ahora (None: ese monitor ya no está).
fn restore(spot: (f64, f64), all: &[Display]) -> Option<(f64, f64)> {
    all.iter().find_map(|d| {
        let s = SIZE * d.scale;
        d.frame.contains((spot.0 + s / 2.0, spot.1 + s / 2.0)).then(|| clamp_origin(spot, s, d.work, MARGIN * d.scale))
    })
}

/// Primera vez: esquina inferior derecha del área de trabajo.
fn default_spot(d: &Display) -> (f64, f64) {
    let (s, m) = (SIZE * d.scale, MARGIN * d.scale);
    (d.work.x + d.work.w - s - m, d.work.y + d.work.h - s - m)
}

fn ease_in_out(t: f64) -> f64 {
    if t < 0.5 { 4.0 * t * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(3) / 2.0 }
}

fn ease_out_back(t: f64) -> f64 {
    let (c1, c3) = (1.3, 2.3);
    1.0 + c3 * (t - 1.0).powi(3) + c1 * (t - 1.0).powi(2)
}

fn lerp(a: (f64, f64), b: (f64, f64), t: f64) -> (f64, f64) {
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

// ── Estado ───────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Debug)]
enum Source {
    /// Lo sacaste arrastrándolo desde la isla.
    Island,
    /// Lo tomaste donde estaba en el escritorio.
    Desktop,
}

#[derive(Clone, Copy)]
struct Carry {
    /// Cursor menos la esquina de la ventana al tomarlo (px físicos).
    grab: (f64, f64),
    from: Source,
}

#[derive(Default)]
struct Inner {
    /// En pantalla (no estacionado).
    shown: bool,
    /// Quieto en el escritorio, recibe pinchazos (ni volando ni en la mano).
    landed: bool,
    carry: Option<Carry>,
    pos: (f64, f64),
    ignoring: Option<bool>,
}

static STATE: Mutex<Option<Inner>> = Mutex::new(None);
static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
/// Cada vuelo lo sube: un vuelo viejo que sigue corriendo deja de moverlo.
static FLIGHT: AtomicU64 = AtomicU64::new(0);

fn with<R>(f: impl FnOnce(&mut Inner) -> R) -> R {
    f(STATE.lock().unwrap().get_or_insert_with(Inner::default))
}

/// Lo que se guarda entre sesiones (px físicos).
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Saved {
    on_desktop: bool,
    spot: Option<(f64, f64)>,
}

fn saved_path() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Wiri").join("buddy.json")
}

fn load() -> Saved {
    std::fs::read_to_string(saved_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(change: impl FnOnce(&mut Saved)) {
    let mut s = load();
    change(&mut s);
    let _ = std::fs::write(saved_path(), serde_json::to_string(&s).unwrap_or_default());
}

// ── Ventana ──────────────────────────────────────────────────────────────────

fn displays(app: &AppHandle) -> Vec<Display> {
    let Ok(monitors) = app.available_monitors() else { return Vec::new() };
    monitors
        .iter()
        .map(|m| {
            let (p, s, wa) = (m.position(), m.size(), m.work_area());
            Display {
                frame: Rect { x: p.x as f64, y: p.y as f64, w: s.width as f64, h: s.height as f64 },
                work: Rect { x: wa.position.x as f64, y: wa.position.y as f64, w: wa.size.width as f64, h: wa.size.height as f64 },
                scale: m.scale_factor(),
            }
        })
        .collect()
}

/// Centro superior de la isla y su escala.
fn island_anchor(app: &AppHandle) -> Option<(f64, f64, f64)> {
    let win = app.get_webview_window("main")?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some((pos.x as f64 + size.width as f64 / 2.0, pos.y as f64, win.scale_factor().unwrap_or(1.0)))
}

fn side(app: &AppHandle) -> f64 {
    SIZE * app.get_webview_window(LABEL).and_then(|w| w.scale_factor().ok()).unwrap_or(1.0)
}

/// Mover con SetWindowPos directo: sincrónico y sin pasar por el bucle de eventos.
fn place(pos: (f64, f64)) {
    with(|i| i.pos = pos);
    let raw = HWND_RAW.load(Ordering::Relaxed);
    if raw == 0 {
        return;
    }
    unsafe {
        let _ = SetWindowPos(
            HWND(raw as *mut _),
            None,
            pos.0.round() as i32,
            pos.1.round() as i32,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

fn set_ignore(app: &AppHandle, flag: bool) {
    let changed = with(|i| {
        let c = i.ignoring != Some(flag);
        i.ignoring = Some(flag);
        c
    });
    if changed {
        if let Some(win) = app.get_webview_window(LABEL) {
            let _ = win.set_ignore_cursor_events(flag);
        }
    }
}

fn show(app: &AppHandle, at: (f64, f64)) {
    place(at);
    with(|i| i.shown = true);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_always_on_top(true);
    }
    let _ = app.emit("buddy://away", true);
}

fn park(app: &AppHandle) {
    with(|i| {
        i.shown = false;
        i.landed = false;
        i.carry = None;
    });
    set_ignore(app, true);
    place(PARKED);
    let _ = app.emit("buddy://away", false);
}

fn cursor() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

fn left_down() -> bool {
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 }
}

/// Lo mueve de donde está hasta `to`. False si otro vuelo lo tomó antes de llegar.
fn fly(to: (f64, f64), ms: u64, ease: fn(f64) -> f64) -> bool {
    let token = FLIGHT.fetch_add(1, Ordering::SeqCst) + 1;
    let from = with(|i| i.pos);
    let steps = (ms / TICK_MS).max(1);
    for k in 1..=steps {
        if FLIGHT.load(Ordering::SeqCst) != token {
            return false;
        }
        place(lerp(from, to, ease(k as f64 / steps as f64)));
        thread::sleep(Duration::from_millis(TICK_MS));
    }
    FLIGHT.load(Ordering::SeqCst) == token
}

/// Al soltarlo: a casa si cae sobre la isla; si no, su lugar nuevo.
fn finish_drop(app: &AppHandle, pos: (f64, f64), from: Source) {
    let s = side(app);
    let center = (pos.0 + s / 2.0, pos.1 + s / 2.0);
    let home = island_anchor(app)
        .map(|(cx, top, scale)| Rect { x: cx - HOME_W * scale / 2.0, y: top, w: HOME_W * scale, h: HOME_H * scale }.contains(center))
        .unwrap_or(false);
    with(|i| {
        i.carry = None;
        i.landed = !home;
    });
    if home {
        // Venga de donde venga, vuela hasta la isla (desvaneciéndose) y entra.
        let _ = from;
        fly_home_now(app, true);
        return;
    }
    let spot = settle(pos, &displays(app));
    if spot != pos {
        fly(spot, SNAP_MS, ease_out_back);
    }
    save(|s| {
        s.on_desktop = true;
        s.spot = Some(spot);
    });
    let _ = app.emit_to(LABEL, "buddy://landed", ());
}

fn fly_home_now(app: &AppHandle, forget: bool) {
    let shown = with(|i| {
        i.landed = false;
        i.carry = None;
        i.shown
    });
    if shown {
        set_ignore(app, true);
        let _ = app.emit_to(LABEL, "buddy://flight", "home");
        let done = match island_anchor(app) {
            Some((cx, top, scale)) => fly((cx - SIZE * scale / 2.0, top), FLIGHT_MS, ease_in_out),
            None => true,
        };
        if done {
            park(app);
        }
    }
    if forget {
        save(|s| s.on_desktop = false);
    }
}

// ── Arranque y sondeo ────────────────────────────────────────────────────────

pub fn setup(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?buddy=1".into()))
        .title("Bolo")
        .inner_size(SIZE, SIZE)
        .position(PARKED.0, PARKED.1)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .focusable(false)
        .disable_drag_drop_handler()
        .build();
    let win = match built {
        Ok(w) => w,
        Err(e) => {
            println!("[buddy] no se pudo crear la ventana: {e}");
            return;
        }
    };
    if let Ok(h) = win.hwnd() {
        HWND_RAW.store(h.0 as isize, Ordering::Relaxed);
    }
    let _ = win.set_ignore_cursor_events(true);
    with(|i| {
        i.pos = PARKED;
        i.ignoring = Some(true);
    });
    spawn_poll(app.clone());
}

/// Mientras está afuera: lo lleva al arrastrar, deja pasar los clics fuera de su
/// cuerpo y le pasa el cursor para la mirada.
fn spawn_poll(app: AppHandle) {
    thread::spawn(move || {
        let mut last = (f64::MIN, f64::MIN);
        loop {
            let (shown, carry, landed, pos) = with(|i| (i.shown, i.carry, i.landed, i.pos));
            if !shown {
                thread::sleep(Duration::from_millis(150));
                continue;
            }
            thread::sleep(Duration::from_millis(TICK_MS));
            let Some((cx, cy)) = cursor() else { continue };

            if let Some(c) = carry {
                let to = (cx - c.grab.0, cy - c.grab.1);
                if left_down() {
                    if to != pos {
                        place(to);
                    }
                } else {
                    finish_drop(&app, to, c.from);
                }
                continue;
            }
            if !landed {
                continue;
            }
            let scale = side(&app) / SIZE;
            let local = ((cx - pos.0) / scale, (cy - pos.1) / scale);
            set_ignore(&app, !over_body(local));
            if (local.0 - last.0).abs() >= 1.0 || (local.1 - last.1).abs() >= 1.0 {
                last = local;
                let _ = app.emit_to(LABEL, "buddy://cursor", json!({ "x": local.0, "y": local.1 }));
            }
        }
    });
}

// ── Comandos ─────────────────────────────────────────────────────────────────

/// Si quedó afuera la última vez (la isla lo hace volar a su lugar al arrancar).
#[tauri::command]
pub fn buddy_info() -> bool {
    load().on_desktop
}

/// Arrastrándolo fuera de la isla: aparece bajo el cursor y lo sigue.
#[tauri::command]
pub async fn buddy_pick_up(app: AppHandle) -> bool {
    if with(|i| i.shown) || HWND_RAW.load(Ordering::Relaxed) == 0 {
        return false;
    }
    let Some(c) = cursor() else { return false };
    let s = side(&app);
    FLIGHT.fetch_add(1, Ordering::SeqCst);
    with(|i| i.carry = Some(Carry { grab: (s / 2.0, s * 0.62), from: Source::Island }));
    // Mientras viaja, los clics pasan: la isla sigue recibiendo el mouse.
    set_ignore(&app, true);
    show(&app, (c.0 - s / 2.0, c.1 - s * 0.62));
    // Si la última vez volvió a casa desvaneciéndose, ahora reaparece.
    let _ = app.emit_to(LABEL, "buddy://flight", "pickup");
    true
}

/// La página vio que lo apretaste: desde aquí lo lleva el sondeo.
#[tauri::command]
pub async fn buddy_drag_begin() {
    let Some(c) = cursor() else { return };
    with(|i| {
        if i.landed && i.carry.is_none() {
            FLIGHT.fetch_add(1, Ordering::SeqCst);
            i.carry = Some(Carry { grab: (c.0 - i.pos.0, c.1 - i.pos.1), from: Source::Desktop });
        }
    });
}

/// De la isla a su lugar (al arrancar, al activarlo en Ajustes o después de una alerta).
#[tauri::command]
pub async fn buddy_fly_out(app: AppHandle) -> bool {
    if HWND_RAW.load(Ordering::Relaxed) == 0 || with(|i| i.landed || i.carry.is_some()) {
        return false;
    }
    let all = displays(&app);
    let Some((cx, top, scale)) = island_anchor(&app) else { return false };
    let target = match load().spot {
        Some(spot) => restore(spot, &all),
        None => None,
    }
    .or_else(|| display_near((cx, top + 1.0), &all).map(|d| default_spot(&d)));
    let Some(target) = target else { return false };
    with(|i| {
        i.landed = false;
        i.carry = None;
    });
    show(&app, (cx - SIZE * scale / 2.0, top));
    let _ = app.emit_to(LABEL, "buddy://flight", "out");
    let app2 = app.clone();
    let done = tauri::async_runtime::spawn_blocking(move || fly(target, FLIGHT_MS, ease_in_out)).await.unwrap_or(false);
    if done {
        with(|i| i.landed = true);
        save(|s| {
            s.on_desktop = true;
            s.spot = Some(target);
        });
        let _ = app2.emit_to(LABEL, "buddy://landed", ());
    }
    done
}

/// A la isla y estacionado. `forget`: lo trajiste tú (doble clic, Ajustes); sin
/// él, solo viene por una alerta y vuelve a salir después.
#[tauri::command]
pub async fn buddy_fly_home(app: AppHandle, forget: bool) {
    let _ = tauri::async_runtime::spawn_blocking(move || fly_home_now(&app, forget)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two() -> Vec<Display> {
        let a = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 };
        let b = Rect { x: 1920.0, y: -200.0, w: 3840.0, h: 2160.0 };
        vec![
            Display { frame: a, work: Rect { h: 1032.0, ..a }, scale: 1.0 },
            Display { frame: b, work: Rect { h: 2064.0, ..b }, scale: 2.0 },
        ]
    }

    #[test]
    fn queda_dentro_del_area_de_trabajo() {
        let d = two();
        assert_eq!(settle((1800.0, 500.0), &d), (1920.0 - SIZE - MARGIN, 500.0));
        assert_eq!(settle((400.0, 2000.0), &d[..1]).1, 1032.0 - SIZE - MARGIN);
    }

    #[test]
    fn lugar_de_un_monitor_desconectado() {
        assert_eq!(restore((-1500.0, 300.0), &two()), None);
        assert!(restore((800.0, 600.0), &two()).is_some());
    }

    #[test]
    fn cuerpo() {
        assert!(over_body((65.0, 88.0)));
        assert!(!over_body((2.0, 2.0)));
    }
}
