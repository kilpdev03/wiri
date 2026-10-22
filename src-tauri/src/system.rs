//! Indicadores del sistema: volumen y salida de audio (Core Audio), batería
//! (GetSystemPowerStatus) y micrófono/cámara en uso (registro de
//! CapabilityAccessManager + sesiones de captura activas de Core Audio) y batería de
//! aparatos Bluetooth (propiedad PnP que también lee Configuración de Windows). Un solo
//! hilo sondea cada 100 ms y emite solo cambios: `system://volume`, `system://device`,
//! `system://power`, `system://privacy`, `system://bluetooth`.

use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    DIGCF_ALLCLASSES, DIGCF_PRESENT, HDEVINFO, SP_DEVINFO_DATA, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo,
    SetupDiGetClassDevsW, SetupDiGetDevicePropertyW,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Devices::Properties::DEVPROPTYPE;
use windows::Win32::Foundation::DEVPROPKEY;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionManager2, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eCommunications, eConsole, eRender,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows::core::{GUID, Interface, PCWSTR, PWSTR};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

const CONSENT_STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

#[derive(Clone, Serialize, PartialEq)]
struct Volume {
    level: u32,
    muted: bool,
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Power {
    has_battery: bool,
    charging: bool,
    percent: u32,
}

/// Aparato Bluetooth que informa su batería (audífonos, mouse, teclado…).
#[derive(Clone, Serialize, PartialEq)]
struct BtBattery {
    name: String,
    percent: u32,
}

/// Nivel de batería de un aparato Bluetooth (un byte, 0–100).
const DEVPKEY_BLUETOOTH_BATTERY: DEVPROPKEY =
    DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };
/// Nombre visible y descripción del nodo (devpkey.h).
const DEVPKEY_FRIENDLY_NAME: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
const DEVPKEY_DEVICE_DESC: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 2 };

#[derive(Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
struct Privacy {
    mic: Vec<String>,
    cam: Vec<String>,
    /// El micrófono de llamadas está silenciado en Windows.
    mic_muted: bool,
}

struct Audio {
    enumerator: IMMDeviceEnumerator,
    device_id: String,
    volume: Option<IAudioEndpointVolume>,
}

fn device_id(device: &IMMDevice) -> Option<String> {
    unsafe {
        let id = device.GetId().ok()?;
        let s = id.to_string().ok();
        CoTaskMemFree(Some(id.0 as _));
        s
    }
}

pub(crate) fn friendly_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let text = PropVariantToStringAlloc(&value).ok()?;
        let s = text.to_string().ok();
        CoTaskMemFree(Some(text.0 as _));
        s
    }
}

impl Audio {
    fn new() -> Option<Self> {
        let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()? };
        Some(Self { enumerator, device_id: String::new(), volume: None })
    }

    /// Revisa si cambió la salida por defecto. Devuelve el nombre nuevo si cambió.
    fn refresh_device(&mut self) -> Option<String> {
        let device = unsafe { self.enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()? };
        let id = device_id(&device)?;
        if id == self.device_id {
            return None;
        }
        self.device_id = id;
        self.volume = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok() };
        Some(friendly_name(&device).unwrap_or_else(|| "Altavoces".into()))
    }

    /// El micrófono de llamadas (el que usan Teams, Meet, Zoom…) está silenciado.
    fn mic_muted(&self) -> bool {
        unsafe {
            self.enumerator
                .GetDefaultAudioEndpoint(eCapture, eCommunications)
                .ok()
                .and_then(|d| d.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok())
                .and_then(|v| v.GetMute().ok())
                .is_some_and(|m| m.as_bool())
        }
    }

    fn read_volume(&self) -> Option<Volume> {
        let v = self.volume.as_ref()?;
        unsafe {
            Some(Volume {
                level: (v.GetMasterVolumeLevelScalar().ok()? * 100.0).round() as u32,
                muted: v.GetMute().ok()?.as_bool(),
            })
        }
    }
}

fn read_power() -> Option<Power> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s).ok()? };
    // 128 = sin batería; 255 = desconocido.
    let has_battery = s.BatteryFlag != 128 && s.BatteryFlag != 255;
    Some(Power {
        has_battery,
        charging: s.ACLineStatus == 1,
        percent: if s.BatteryLifePercent <= 100 { s.BatteryLifePercent as u32 } else { 0 },
    })
}

/// "WH-1000XM4 Hands-Free AG" → "WH-1000XM4": cada perfil Bluetooth es un nodo aparte.
fn bt_name(raw: &str) -> String {
    let mut name = raw.trim();
    for suffix in [" Hands-Free AG Audio", " Hands-Free AG", " Hands-Free", " Avrcp Transport", " Stereo"] {
        name = name.strip_suffix(suffix).unwrap_or(name);
    }
    name.trim().to_string()
}

/// Texto UTF-16 de una propiedad PnP (FriendlyName o DeviceDesc).
unsafe fn device_text(set: HDEVINFO, info: &SP_DEVINFO_DATA, key: &DEVPROPKEY) -> Option<String> {
    let mut kind = DEVPROPTYPE::default();
    let mut buf = [0u8; 512];
    unsafe { SetupDiGetDevicePropertyW(set, info, key, &mut kind, Some(&mut buf), None, 0).ok()? };
    let wide: Vec<u16> = buf.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
    let text = String::from_utf16_lossy(&wide);
    (!text.trim().is_empty()).then_some(text)
}

/// Aparatos presentes con nivel de batería, sin repetir (un nodo por perfil).
fn bluetooth_batteries() -> Vec<BtBattery> {
    let mut out: Vec<BtBattery> = Vec::new();
    unsafe {
        let Ok(set) = SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_ALLCLASSES) else { return out };
        let mut info = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
        let mut index = 0;
        while SetupDiEnumDeviceInfo(set, index, &mut info).is_ok() {
            index += 1;
            let mut kind = DEVPROPTYPE::default();
            // Es un byte, pero sobra espacio por si un controlador lo guarda como entero.
            let mut level = [0u8; 4];
            if SetupDiGetDevicePropertyW(set, &info, &DEVPKEY_BLUETOOTH_BATTERY, &mut kind, Some(&mut level), None, 0).is_err() {
                continue;
            }
            let Some(raw) = device_text(set, &info, &DEVPKEY_FRIENDLY_NAME).or_else(|| device_text(set, &info, &DEVPKEY_DEVICE_DESC))
            else {
                continue;
            };
            let name = bt_name(&raw);
            if !out.iter().any(|b| b.name == name) {
                out.push(BtBattery { name, percent: (level[0] as u32).min(100) });
            }
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// "C:#Program Files#Microsoft#Teams#ms-teams.exe" → "ms-teams";
/// "Microsoft.WindowsCamera_8wekyb3d8bbwe" → "WindowsCamera".
fn app_label(key: &str) -> String {
    let last = key.rsplit(['#', '\\']).next().unwrap_or(key);
    let last = last.strip_suffix(".exe").or_else(|| last.strip_suffix(".EXE")).unwrap_or(last);
    let last = last.split('_').next().unwrap_or(last);
    let last = last.rsplit('.').next().unwrap_or(last);
    let lower = last.to_lowercase();
    for (needle, name) in [
        ("teams", "Teams"),
        ("discord", "Discord"),
        ("zoom", "Zoom"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("slack", "Slack"),
        ("obs", "OBS"),
        ("whatsapp", "WhatsApp"),
        ("windowscamera", "Cámara"),
    ] {
        if lower.contains(needle) {
            return name.to_string();
        }
    }
    last.to_string()
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Procesos con una sesión de captura activa en cualquier micrófono. Detecta apps
/// (p. ej. Discord en llamada) que Windows no anota en el registro de privacidad.
fn capture_sessions(enumerator: &IMMDeviceEnumerator) -> Vec<String> {
    let mut apps = Vec::new();
    unsafe {
        let Ok(devices) = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) else {
            return apps;
        };
        for i in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(i) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(session) = sessions.GetSession(j) else { continue };
                if session.GetState().ok() != Some(AudioSessionStateActive) {
                    continue;
                }
                let Ok(session) = session.cast::<IAudioSessionControl2>() else { continue };
                if session.IsSystemSoundsSession().0 == 0 {
                    continue;
                }
                let pid = session.GetProcessId().unwrap_or(0);
                if pid == 0 || pid == std::process::id() {
                    continue;
                }
                if let Some(path) = process_name(pid) {
                    apps.push(app_label(&path));
                }
            }
        }
    }
    apps
}

/// Apps que usan ahora mismo una capacidad ("microphone" | "webcam").
fn apps_in_use(capability: &str) -> Vec<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(root) = hkcu.open_subkey(format!(r"{CONSENT_STORE}\{capability}")) else {
        return Vec::new();
    };
    let in_use = |key: &RegKey| key.get_value::<u64, _>("LastUsedTimeStop").is_ok_and(|v| v == 0)
        && key.get_value::<u64, _>("LastUsedTimeStart").is_ok_and(|v| v > 0);

    let mut apps = Vec::new();
    for name in root.enum_keys().flatten() {
        let Ok(key) = root.open_subkey(&name) else { continue };
        if name == "NonPackaged" {
            for sub in key.enum_keys().flatten() {
                if sub.to_lowercase().contains("win-island") || sub.to_lowercase().contains("wiri") {
                    continue;
                }
                if key.open_subkey(&sub).is_ok_and(|k| in_use(&k)) {
                    apps.push(app_label(&sub));
                }
            }
        } else if in_use(&key) {
            apps.push(app_label(&name));
        }
    }
    apps.sort();
    apps.dedup();
    apps
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut audio = Audio::new();
        let mut last_volume: Option<Volume> = None;
        let mut last_power: Option<Power> = None;
        let mut last_bluetooth: Option<Vec<BtBattery>> = None;
        let mut last_privacy = Privacy::default();
        let mut first_device = true;
        let mut tick: u32 = 0;

        loop {
            // Salida de audio: cada ~1 s.
            if tick % 10 == 0 {
                if let Some(a) = audio.as_mut() {
                    if let Some(name) = a.refresh_device() {
                        // El volumen del dispositivo nuevo no es un "cambio de volumen":
                        // si se emitiera, su aviso taparía al de "Ahora suena en…".
                        last_volume = None;
                        println!("[system] salida de audio: {name}");
                        // El primer dispositivo al arrancar no se anuncia.
                        if !first_device {
                            let _ = app.emit("system://device", name);
                        }
                        first_device = false;
                    }
                }
            }

            // Volumen: cada 100 ms (lo que tarda en sentirse instantáneo).
            if let Some(v) = audio.as_ref().and_then(|a| a.read_volume()) {
                if last_volume.as_ref() != Some(&v) {
                    if last_volume.is_some() {
                        let _ = app.emit("system://volume", &v);
                    }
                    last_volume = Some(v);
                }
            }

            // Batería: cada ~2 s.
            if tick % 20 == 0 {
                if let Some(p) = read_power() {
                    if last_power.as_ref() != Some(&p) {
                        let _ = app.emit("system://power", &p);
                        last_power = Some(p);
                    }
                }
            }

            // Batería Bluetooth: cada ~30 s (los aparatos la informan cada pocos minutos).
            // La primera lectura, a los 5 s: cuando la isla ya escucha.
            if tick % 300 == 50 {
                let bt = bluetooth_batteries();
                if last_bluetooth.as_ref() != Some(&bt) {
                    let _ = app.emit("system://bluetooth", &bt);
                    last_bluetooth = Some(bt);
                }
            }

            // Micrófono / cámara: cada ~1 s.
            if tick % 10 == 5 {
                let mut mic = apps_in_use("microphone");
                if let Some(a) = audio.as_ref() {
                    mic.extend(capture_sessions(&a.enumerator));
                }
                mic.sort();
                mic.dedup();
                let mic_muted = audio.as_ref().is_some_and(|a| a.mic_muted());
                let privacy = Privacy { mic, cam: apps_in_use("webcam"), mic_muted };
                if privacy != last_privacy {
                    println!("[system] micrófono: {:?} · cámara: {:?}", privacy.mic, privacy.cam);
                    let _ = app.emit("system://privacy", &privacy);
                    last_privacy = privacy;
                }
            }

            // Si el servicio de audio no estaba listo al arrancar, reintenta.
            if audio.is_none() && tick % 50 == 0 {
                audio = Audio::new();
            }

            tick = tick.wrapping_add(1);
            thread::sleep(Duration::from_millis(100));
        }
    });
}
