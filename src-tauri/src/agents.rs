//! Otros agentes de código con el mismo relé de Wiri (`wiri-hook.exe --agent <id>`).
//!
//! - **Codex**: `~/.codex/hooks.json`, mismos eventos y mismo `PermissionRequest`
//!   que Claude Code (aprobar desde la isla funciona igual). Codex pide confirmar
//!   los hooks nuevos una vez con `/hooks`.
//! - **Gemini CLI**: `~/.gemini/settings.json`, eventos propios (BeforeTool,
//!   AfterAgent…); la isla los traduce. Solo muestra actividad y avisos: Gemini no
//!   tiene un evento de permiso que Wiri pueda responder.
//!
//! Igual que con Claude: respaldo antes de escribir y solo se tocan las entradas de Wiri.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::claude::{install_relay, is_wiri_group, read_json, relay_command, strip_wiri_hooks, write_json};

struct Agent {
    id: &'static str,
    name: &'static str,
    dir: &'static str,
    file: &'static str,
    /// (evento, timeout en la unidad del agente)
    events: &'static [(&'static str, u64)],
}

const AGENTS: [Agent; 2] = [
    Agent {
        id: "codex",
        name: "Codex",
        dir: ".codex",
        file: "hooks.json",
        // Segundos. El permiso espera lo mismo que en Claude (preguntas y planes).
        events: &[
            ("SessionStart", 5),
            ("UserPromptSubmit", 5),
            ("PreToolUse", 5),
            ("PostToolUse", 5),
            ("PermissionRequest", 300),
            ("Stop", 5),
            ("SessionEnd", 5),
        ],
    },
    Agent {
        id: "gemini",
        name: "Gemini CLI",
        dir: ".gemini",
        file: "settings.json",
        // Milisegundos.
        events: &[
            ("SessionStart", 5000),
            ("BeforeAgent", 5000),
            ("BeforeTool", 5000),
            ("AfterTool", 5000),
            ("AfterAgent", 5000),
            ("Notification", 5000),
            ("SessionEnd", 5000),
        ],
    },
];

fn find(id: &str) -> Result<&'static Agent, String> {
    AGENTS.iter().find(|a| a.id == id).ok_or_else(|| format!("Agente desconocido: {id}"))
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default())
}

fn config_path(a: &Agent) -> PathBuf {
    home().join(a.dir).join(a.file)
}

fn installed(a: &Agent, settings: &Value) -> bool {
    a.events.iter().all(|(ev, _)| settings["hooks"][ev].as_array().is_some_and(|groups| groups.iter().any(is_wiri_group)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// La carpeta del agente existe (está instalado o se usó alguna vez).
    detected: bool,
    installed: bool,
    config_path: String,
    error: Option<String>,
}

#[tauri::command]
pub fn agents_status() -> Vec<AgentStatus> {
    AGENTS
        .iter()
        .map(|a| {
            let path = config_path(a);
            let (installed, error) = match read_json(&path) {
                Ok(s) => (installed(a, &s), None),
                Err(e) => (false, Some(e)),
            };
            AgentStatus {
                id: a.id,
                name: a.name,
                detected: home().join(a.dir).exists(),
                installed,
                config_path: path.to_string_lossy().into_owned(),
                error,
            }
        })
        .collect()
}

/// Agrega los hooks de Wiri al agente. Devuelve la ruta del respaldo.
#[tauri::command]
pub fn agent_hooks_install(id: String) -> Result<String, String> {
    let a = find(&id)?;
    install_relay()?;
    let path = config_path(a);
    let mut settings = read_json(&path)?;
    if !settings.is_object() {
        return Err(format!("{} no es un objeto JSON; no lo toqué.", a.file));
    }
    strip_wiri_hooks(&mut settings);
    // Con comillas: así sirve aunque la ruta del usuario tenga espacios.
    let command = format!("\"{}\" --agent {}", relay_command(), a.id);
    let hooks = settings.as_object_mut().unwrap().entry("hooks").or_insert_with(|| Value::Object(Map::new()));
    let hooks = hooks.as_object_mut().ok_or(format!("La clave \"hooks\" de {} no es un objeto.", a.file))?;
    for (ev, timeout) in a.events {
        let group = json!({ "hooks": [{ "type": "command", "name": "wiri", "command": command, "timeout": timeout }] });
        let groups = hooks.entry(*ev).or_insert_with(|| Value::Array(Vec::new()));
        groups.as_array_mut().ok_or(format!("hooks.{ev} no es una lista."))?.push(group);
    }
    write_json(&path, &settings)
}

#[tauri::command]
pub fn agent_hooks_uninstall(id: String) -> Result<String, String> {
    let a = find(&id)?;
    let path = config_path(a);
    let mut settings = read_json(&path)?;
    strip_wiri_hooks(&mut settings);
    write_json(&path, &settings)
}
