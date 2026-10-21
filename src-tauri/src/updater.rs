//! Actualizaciones automáticas: `latest.json` firmado en GitHub Releases
//! (kilpdev03/wiri). Se revisa al arrancar y cada 6 h; instalar es manual,
//! desde el aviso de la isla o Ajustes.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const EVERY: Duration = Duration::from_secs(6 * 3600);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

pub fn start(app: &AppHandle) {
    // En desarrollo no hay instalador que reemplazar.
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Que el arranque termine antes de salir a la red.
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            match check(&app).await {
                Ok(Some(info)) => {
                    eprintln!("[update] disponible {}", info.version);
                    let _ = app.emit("update://available", info);
                }
                Ok(None) => {}
                Err(e) => eprintln!("[update] {e}"),
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version, current: u.current_version, notes: u.body }))
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    check(&app).await
}

/// Descarga, verifica la firma y lanza el instalador (modo pasivo), que cierra
/// Wiri y la vuelve a abrir. Emite `update://progress` con el porcentaje.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Ya tienes la última versión")?;
    let progress = app.clone();
    let mut got = 0u64;
    update
        .download_and_install(
            move |chunk, total| {
                got += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let _ = progress.emit("update://progress", (got * 100 / total).min(100));
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo actualizar: {e}"))?;
    app.restart()
}
