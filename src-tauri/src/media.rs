//! Lo que se está reproduciendo en Windows (Spotify, navegadores, etc.) vía
//! Global System Media Transport Controls. Se consulta cada 500 ms y solo se
//! emite `media://update` cuando algo cambia.

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Media::MediaPlaybackAutoRepeatMode as Repeat;
use windows::Storage::Streams::DataReader;

/// Diferencia entre la época de Windows (1601) y la de Unix, en ticks de 100 ns.
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

/// Último estado emitido, para que el frontend lo pida al montar.
static LAST: Mutex<Option<MediaState>> = Mutex::new(None);

#[derive(Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    title: String,
    artist: String,
    album: String,
    app_id: String,
    playing: bool,
    position_ms: i64,
    duration_ms: i64,
    /// Momento (ms Unix) en que se midió `position_ms`; el frontend extrapola desde aquí.
    updated_at_ms: i64,
    /// `None` cuando la app no expone aleatorio/repetición.
    shuffle: Option<bool>,
    /// "none" | "track" | "list"
    repeat: Option<String>,
    artwork: Option<String>,
}

fn repeat_name(mode: Repeat) -> String {
    match mode {
        Repeat::Track => "track",
        Repeat::List => "list",
        _ => "none",
    }
    .to_string()
}

fn manager() -> windows::core::Result<Manager> {
    Manager::RequestAsync()?.get()
}

fn read_artwork(session: &Session) -> windows::core::Result<Option<String>> {
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let Ok(thumb) = props.Thumbnail() else {
        return Ok(None);
    };
    let stream = thumb.OpenReadAsync()?.get()?;
    let size = stream.Size()? as u32;
    if size == 0 {
        return Ok(None);
    }
    let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if mime.is_empty() { "image/png".into() } else { mime };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(Some(format!("data:{mime};base64,{b64}")))
}

fn snapshot(session: &Session) -> windows::core::Result<MediaState> {
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let playback = session.GetPlaybackInfo()?;
    let timeline = session.GetTimelineProperties()?;
    let updated = timeline.LastUpdatedTime()?.UniversalTime;

    Ok(MediaState {
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        album: props.AlbumTitle()?.to_string(),
        app_id: session.SourceAppUserModelId()?.to_string(),
        playing: playback.PlaybackStatus()? == Status::Playing,
        position_ms: timeline.Position()?.Duration / 10_000,
        duration_ms: timeline.EndTime()?.Duration / 10_000,
        updated_at_ms: if updated > 0 { (updated - EPOCH_DIFF_TICKS) / 10_000 } else { 0 },
        shuffle: playback.IsShuffleActive().and_then(|v| v.Value()).ok(),
        repeat: playback.AutoRepeatMode().and_then(|v| v.Value()).ok().map(repeat_name),
        artwork: None,
    })
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mgr = loop {
            match manager() {
                Ok(m) => break m,
                Err(_) => thread::sleep(Duration::from_secs(5)),
            }
        };
        let mut last: Option<MediaState> = None;
        let mut last_track = String::new();
        let mut artwork: Option<String> = None;

        loop {
            let current = mgr.GetCurrentSession().ok().and_then(|session| {
                let mut state = snapshot(&session).ok()?;
                if state.title.is_empty() {
                    return None;
                }
                // La carátula solo se relee al cambiar de canción.
                let track = format!("{}|{}|{}", state.app_id, state.title, state.artist);
                if track != last_track {
                    last_track = track;
                    artwork = read_artwork(&session).ok().flatten();
                }
                state.artwork = artwork.clone();
                Some(state)
            });

            if current != last {
                let _ = app.emit("media://update", &current);
                *LAST.lock().unwrap() = current.clone();
                last = current;
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}

#[tauri::command]
pub fn current_media() -> Option<MediaState> {
    LAST.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_control(action: String, position_ms: Option<i64>) -> Result<(), String> {
    let run = || -> windows::core::Result<()> {
        let session = manager()?.GetCurrentSession()?;
        match action.as_str() {
            "toggle" => session.TryTogglePlayPauseAsync()?.get()?,
            "next" => session.TrySkipNextAsync()?.get()?,
            "previous" => session.TrySkipPreviousAsync()?.get()?,
            "seek" => session
                .TryChangePlaybackPositionAsync(position_ms.unwrap_or(0) * 10_000)?
                .get()?,
            "shuffle" => {
                let active = session.GetPlaybackInfo()?.IsShuffleActive()?.Value()?;
                session.TryChangeShuffleActiveAsync(!active)?.get()?
            }
            "repeat" => {
                let next = match session.GetPlaybackInfo()?.AutoRepeatMode()?.Value()? {
                    Repeat::None => Repeat::List,
                    Repeat::List => Repeat::Track,
                    _ => Repeat::None,
                };
                session.TryChangeAutoRepeatModeAsync(next)?.get()?
            }
            _ => false,
        };
        Ok(())
    };
    run().map_err(|e| e.to_string())
}
