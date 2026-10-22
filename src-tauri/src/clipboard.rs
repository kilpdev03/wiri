//! Historial del portapapeles: solo texto y solo en memoria (se borra al cerrar Wiri).
//!
//! Un hilo mira `GetClipboardSequenceNumber` cada 400 ms; si cambió, lee el texto y
//! lo pone arriba de la lista (sin repetir). Respeta las marcas con las que los
//! gestores de contraseñas piden que su contenido no quede en historiales.
//! Emite `clipboard://changed` con la lista completa.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::core::w;

const MAX_ITEMS: usize = 30;
/// Textos más largos se ignoran (un archivo entero copiado no es un "recorte").
const MAX_CHARS: usize = 20_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    id: u64,
    text: String,
    copied_ms: i64,
}

static HISTORY: Mutex<Vec<ClipItem>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
/// Apagado hasta que la isla lo active según tus ajustes: nada se guarda antes.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Otra app puede tener el portapapeles abierto un instante: reintenta un poco.
fn open() -> bool {
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(30));
    }
    false
}

/// El contenido pidió no quedar en historiales (gestores de contraseñas, Win+V).
unsafe fn excluded() -> bool {
    unsafe {
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        if IsClipboardFormatAvailable(exclude).is_ok() {
            return true;
        }
        // "CanIncludeInClipboardHistory" = 0 → no va al historial.
        let allow = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if IsClipboardFormatAvailable(allow).is_ok() {
            if let Ok(h) = GetClipboardData(allow) {
                let g = HGLOBAL(h.0);
                let ptr = GlobalLock(g) as *const u32;
                let deny = !ptr.is_null() && GlobalSize(g) >= 4 && *ptr == 0;
                let _ = GlobalUnlock(g);
                return deny;
            }
        }
        false
    }
}

/// Texto del portapapeles (con el portapapeles ya abierto).
unsafe fn read_text() -> Option<String> {
    unsafe {
        let h = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
        let g = HGLOBAL(h.0);
        let ptr = GlobalLock(g) as *const u16;
        if ptr.is_null() {
            return None;
        }
        let max = GlobalSize(g) / 2;
        let slice = std::slice::from_raw_parts(ptr, max);
        let len = slice.iter().position(|&c| c == 0).unwrap_or(max);
        let text = String::from_utf16_lossy(&slice[..len]);
        let _ = GlobalUnlock(g);
        Some(text)
    }
}

fn read_clipboard() -> Option<String> {
    if !open() {
        return None;
    }
    let text = unsafe { if excluded() { None } else { read_text() } };
    let _ = unsafe { CloseClipboard() };
    text.filter(|t| !t.trim().is_empty() && t.chars().count() <= MAX_CHARS)
}

fn write_clipboard(text: &str) -> Result<(), String> {
    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    if !open() {
        return Err("Otra app está usando el portapapeles.".into());
    }
    let result = unsafe {
        (|| {
            EmptyClipboard()?;
            let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2)?;
            let dst = GlobalLock(mem) as *mut u16;
            if dst.is_null() {
                return Err(windows::core::Error::from_win32());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
            let _ = GlobalUnlock(mem);
            // Desde aquí la memoria es del portapapeles.
            SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(mem.0)))?;
            Ok(())
        })()
    };
    let _ = unsafe { CloseClipboard() };
    result.map_err(|e: windows::core::Error| format!("No se pudo copiar: {e}"))
}

/// Pone el texto arriba (si ya estaba, lo mueve en vez de repetirlo).
fn push(text: String) {
    let mut history = HISTORY.lock().unwrap();
    history.retain(|i| i.text != text);
    history.insert(0, ClipItem { id: NEXT_ID.fetch_add(1, Ordering::Relaxed), text, copied_ms: crate::reminders::now_ms() });
    history.truncate(MAX_ITEMS);
}

fn emit(app: &AppHandle) {
    let _ = app.emit("clipboard://changed", HISTORY.lock().unwrap().clone());
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut last_seq = unsafe { GetClipboardSequenceNumber() };
        loop {
            thread::sleep(Duration::from_millis(400));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last_seq {
                continue;
            }
            last_seq = seq;
            if !ENABLED.load(Ordering::Relaxed) {
                continue;
            }
            if let Some(text) = read_clipboard() {
                push(text);
                emit(&app);
            }
        }
    });
}

#[tauri::command]
pub fn clipboard_history() -> Vec<ClipItem> {
    HISTORY.lock().unwrap().clone()
}

/// Vuelve a copiar un recorte (queda arriba de la lista).
#[tauri::command]
pub fn clipboard_copy(app: AppHandle, id: u64) -> Result<(), String> {
    let text = HISTORY.lock().unwrap().iter().find(|i| i.id == id).map(|i| i.text.clone()).ok_or("Ese recorte ya no está.")?;
    write_clipboard(&text)?;
    push(text);
    emit(&app);
    Ok(())
}

#[tauri::command]
pub fn clipboard_remove(app: AppHandle, id: u64) {
    HISTORY.lock().unwrap().retain(|i| i.id != id);
    emit(&app);
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle) {
    HISTORY.lock().unwrap().clear();
    emit(&app);
}

/// Pausar también borra lo guardado: apagado significa que no queda nada.
#[tauri::command]
pub fn clipboard_set_enabled(app: AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled {
        clipboard_clear(app);
    }
}
