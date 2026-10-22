//! Listar y cambiar los dispositivos de audio por defecto (salida y entrada).
//!
//! Windows no tiene API pública para cambiar el dispositivo por defecto; se usa
//! `IPolicyConfig`, la interfaz interna que usan el panel de sonido y apps como
//! EarTrumpet. Existe sin cambios desde Windows 7.

// Los métodos COM conservan sus nombres originales en PascalCase.
#![allow(non_snake_case)]

// Varios de estos tipos solo aparecen dentro de la macro `#[interface]`.
#[allow(unused_imports)]
use std::ffi::c_void;

use serde::Serialize;
#[allow(unused_imports)]
use windows::Win32::Media::Audio::{
    DEVICE_STATE_ACTIVE, EDataFlow, ERole, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eCommunications,
    eConsole, eMultimedia, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree};
#[allow(unused_imports)]
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::core::{GUID, HRESULT, IUnknown, IUnknown_Vtbl, PCWSTR, interface};

use crate::system::friendly_name;

const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// Solo se usa `SetDefaultEndpoint`; los métodos previos existen para respetar el orden de la vtable.
#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    fn GetMixFormat(&self, id: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, id: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
    fn ResetDeviceFormat(&self, id: PCWSTR) -> HRESULT;
    fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, def: *mut i64, min: *mut i64) -> HRESULT;
    fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut i64) -> HRESULT;
    fn GetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
    fn SetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *const c_void) -> HRESULT;
    fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Serialize)]
pub struct AudioDevices {
    outputs: Vec<AudioDevice>,
    inputs: Vec<AudioDevice>,
}

fn com_init() {
    // Los comandos corren en hilos de Tauri; inicializar dos veces es inofensivo.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn list(e: &IMMDeviceEnumerator, flow: EDataFlow) -> Vec<AudioDevice> {
    unsafe {
        let default_id = e
            .GetDefaultAudioEndpoint(flow, eConsole)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|p| {
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as _));
                s
            })
            .unwrap_or_default();
        let Ok(collection) = e.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) else {
            return Vec::new();
        };
        let mut devices = Vec::new();
        for i in 0..collection.GetCount().unwrap_or(0) {
            let Ok(device) = collection.Item(i) else { continue };
            let Ok(id_ptr) = device.GetId() else { continue };
            let id = id_ptr.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id_ptr.0 as _));
            let name = friendly_name(&device).unwrap_or_else(|| "Dispositivo".into());
            devices.push(AudioDevice { is_default: id == default_id, id, name });
        }
        devices
    }
}

#[tauri::command]
pub fn audio_devices() -> Result<AudioDevices, String> {
    com_init();
    let e = enumerator().map_err(|e| e.to_string())?;
    Ok(AudioDevices { outputs: list(&e, eRender), inputs: list(&e, eCapture) })
}

fn capture_volume(e: &IMMDeviceEnumerator, role: ERole) -> Option<IAudioEndpointVolume> {
    unsafe { e.GetDefaultAudioEndpoint(eCapture, role).ok()?.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok() }
}

/// Silencia o reactiva el micrófono: el de llamadas (Teams, Meet, Zoom…) y el
/// general, por si son distintos. Devuelve si quedó silenciado.
#[tauri::command]
pub fn mic_toggle_mute() -> Result<bool, String> {
    com_init();
    let e = enumerator().map_err(|e| e.to_string())?;
    let comms = capture_volume(&e, eCommunications).ok_or("No hay micrófono conectado.")?;
    let muted = !unsafe { comms.GetMute() }.map_err(|e| e.to_string())?.as_bool();
    for role in [eCommunications, eConsole] {
        if let Some(v) = capture_volume(&e, role) {
            unsafe { v.SetMute(muted, std::ptr::null()) }.map_err(|e| format!("Windows no permitió silenciar el micrófono: {e}"))?;
        }
    }
    Ok(muted)
}

/// Convierte el dispositivo en predeterminado para todo (apps, multimedia y llamadas).
#[tauri::command]
pub fn audio_set_default(id: String) -> Result<(), String> {
    com_init();
    let policy: IPolicyConfig = unsafe { CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL) }.map_err(|e| e.to_string())?;
    let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
    for role in [eConsole, eMultimedia, eCommunications] {
        unsafe { policy.SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role) }
            .ok()
            .map_err(|e| format!("Windows no permitió cambiar el dispositivo: {e}"))?;
    }
    Ok(())
}
