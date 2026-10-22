//! Relé de hooks de Claude Code → Wiri.
//!
//! Claude Code lo ejecuta en cada evento (forma exec, sin shell) con el JSON del
//! evento en stdin. Lo reenvía al servidor local de Wiri junto con los PID de los
//! procesos que lo lanzaron (para poder traer al frente la terminal o el editor).
//!
//! Nunca debe molestar a Claude Code: sale SIEMPRE con código 0 y se rinde a los
//! ~300 ms si Wiri está cerrada. Solo escribe en stdout para `PermissionRequest`,
//! cuando el usuario decidió en la isla (permitir, denegar o "siempre"); si no hay
//! decisión (tiempo agotado, "en la terminal"), no escribe nada y el permiso sigue
//! el flujo normal de Claude Code.

#![windows_subsystem = "windows"]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{Value, json};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};

const BUDGET: Duration = Duration::from_millis(300);
/// Cuánto espera la decisión de un permiso (el hook se instala con timeout 300 s;
/// Wiri contesta antes: ~1 min para comandos, ~5 min para preguntas y planes).
const PERMISSION_WAIT: Duration = Duration::from_secs(295);

/// PID propio y de sus ancestros (hasta 12 niveles), del más cercano al más lejano.
fn ancestors() -> Vec<u32> {
    let mut parents = std::collections::HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return Vec::new();
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    let mut chain = Vec::new();
    let mut pid = std::process::id();
    while let Some(&parent) = parents.get(&pid) {
        if parent == 0 || chain.contains(&parent) || chain.len() >= 12 {
            break;
        }
        chain.push(parent);
        pid = parent;
    }
    chain
}

/// Convierte la respuesta de Wiri (`{"decision", "answers"?, "message"?}`) en la salida que entiende Claude Code.
fn permission_output(reply: &str, event: &Value) -> Option<String> {
    let body = &reply[reply.find("\r\n\r\n")? + 4..];
    let answer: Value = serde_json::from_str(body).ok()?;
    let decision = match answer["decision"].as_str()? {
        // AskUserQuestion: las respuestas viajan dentro del input de la herramienta.
        "allow" => match answer["answers"].as_object().filter(|a| !a.is_empty()) {
            Some(answers) => {
                let mut input = event["tool_input"].clone();
                input["answers"] = Value::Object(answers.clone());
                json!({ "behavior": "allow", "updatedInput": input })
            }
            None => json!({ "behavior": "allow" }),
        },
        // Plan aprobado "aceptando ediciones": la sesión sale del modo plan a acceptEdits.
        "always" if event["tool_name"] == "ExitPlanMode" => json!({
            "behavior": "allow",
            "updatedPermissions": [{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }]
        }),
        // "Siempre": se devuelve la primera sugerencia de Claude Code como regla nueva.
        "always" => match event["permission_suggestions"].get(0).cloned() {
            Some(rule) => json!({ "behavior": "allow", "updatedPermissions": [rule] }),
            None => json!({ "behavior": "allow" }),
        },
        "deny" => {
            let message = answer["message"].as_str().filter(|m| !m.trim().is_empty()).unwrap_or("Denegado desde Wiri.");
            json!({ "behavior": "deny", "message": message })
        }
        // "ask" u otro: sin decisión → Claude Code muestra su diálogo normal.
        _ => return None,
    };
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string())
}

/// Línea de estado para la terminal: modelo · contexto · límites del plan.
fn status_text(status: &Value) -> String {
    let mut parts = vec![status["model"]["display_name"].as_str().unwrap_or("Claude").to_string()];
    if let Some(pct) = status["context_window"]["used_percentage"].as_f64() {
        parts.push(format!("contexto {pct:.0}%"));
    }
    if let Some(pct) = status["rate_limits"]["five_hour"]["used_percentage"].as_f64() {
        parts.push(format!("5 h {pct:.0}%"));
    }
    if let Some(pct) = status["rate_limits"]["seven_day"]["used_percentage"].as_f64() {
        parts.push(format!("semana {pct:.0}%"));
    }
    format!("◆ {}", parts.join(" · "))
}

/// Envía `body` a Wiri. Devuelve la respuesta (vacía si Wiri no está).
fn post(path: &str, body: &str, wait: Duration) -> Option<Vec<u8>> {
    let dir = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join("Wiri");
    let config: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("hook.json")).ok()?).ok()?;
    let port = config["port"].as_u64()? as u16;
    let token = config["token"].as_str()?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, BUDGET).ok()?;
    stream.set_write_timeout(Some(BUDGET)).ok()?;
    stream.set_read_timeout(Some(wait)).ok()?;
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Wiri-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut reply = Vec::new();
    let _ = stream.read_to_end(&mut reply);
    Some(reply)
}

/// Modo `--statusline`: imprime la línea primero (se ve aunque Wiri esté cerrada)
/// y después pasa los datos de contexto y límites a Wiri.
fn statusline() -> Option<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).ok()?;
    let status: Value = serde_json::from_str(&input).ok()?;
    let mut stdout = std::io::stdout();
    stdout.write_all(status_text(&status).as_bytes()).ok()?;
    stdout.flush().ok()?;
    post("/status", &json!({ "status": status }).to_string(), BUDGET);
    Some(())
}

/// `--agent codex` / `--agent gemini`: de qué agente viene el evento (sin flag, Claude Code).
fn agent_arg() -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == "--agent").and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| "claude".into())
}

fn relay() -> Option<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).ok()?;
    let event: Value = serde_json::from_str(&input).ok()?;

    // Codex usa el mismo PermissionRequest que Claude Code; Gemini CLI no tiene (solo avisa).
    let is_permission = event["hook_event_name"] == "PermissionRequest";
    let body = json!({ "event": event, "ancestors": ancestors(), "agent": agent_arg() }).to_string();
    let (path, wait) = if is_permission { ("/permission", PERMISSION_WAIT) } else { ("/hook", BUDGET) };
    let reply = post(path, &body, wait)?;

    if is_permission {
        if let Some(out) = permission_output(&String::from_utf8_lossy(&reply), &event) {
            let mut stdout = std::io::stdout();
            stdout.write_all(out.as_bytes()).ok()?;
            stdout.flush().ok()?;
        }
    }
    Some(())
}

fn main() {
    if std::env::args().any(|a| a == "--statusline") {
        let _ = statusline();
        std::process::exit(0);
    }
    let _ = relay();
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(decision: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{{\"decision\":\"{decision}\"}}")
    }

    fn event() -> Value {
        json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "permission_suggestions": [{ "type": "addRules", "rules": [{ "toolName": "Bash", "ruleContent": "pnpm build" }], "behavior": "allow", "destination": "localSettings" }]
        })
    }

    fn decision(out: &str) -> Value {
        serde_json::from_str::<Value>(out).unwrap()["hookSpecificOutput"]["decision"].clone()
    }

    #[test]
    fn allow_y_deny() {
        assert_eq!(decision(&permission_output(&reply("allow"), &event()).unwrap())["behavior"], "allow");
        let deny = decision(&permission_output(&reply("deny"), &event()).unwrap());
        assert_eq!(deny["behavior"], "deny");
        assert!(deny["message"].is_string());
    }

    #[test]
    fn siempre_usa_la_sugerencia() {
        let d = decision(&permission_output(&reply("always"), &event()).unwrap());
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedPermissions"][0]["rules"][0]["ruleContent"], "pnpm build");
    }

    #[test]
    fn sin_decision_no_escribe_nada() {
        assert!(permission_output(&reply("ask"), &event()).is_none());
        assert!(permission_output(&reply("cancelled"), &event()).is_none());
        assert!(permission_output("", &event()).is_none());
    }

    #[test]
    fn respuestas_a_preguntas_van_en_updated_input() {
        let ev = json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "¿Qué base de datos?", "options": [] }] }
        });
        let r = "HTTP/1.1 200 OK\r\n\r\n{\"decision\":\"allow\",\"answers\":{\"¿Qué base de datos?\":\"Postgres\"}}";
        let d = decision(&permission_output(r, &ev).unwrap());
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedInput"]["answers"]["¿Qué base de datos?"], "Postgres");
        assert_eq!(d["updatedInput"]["questions"][0]["question"], "¿Qué base de datos?");
    }

    #[test]
    fn plan_aceptando_ediciones_y_con_cambios() {
        let ev = json!({ "hook_event_name": "PermissionRequest", "tool_name": "ExitPlanMode", "tool_input": { "plan": "# Plan" } });
        let d = decision(&permission_output(&reply("always"), &ev).unwrap());
        assert_eq!(d["updatedPermissions"][0]["mode"], "acceptEdits");
        let r = "HTTP/1.1 200 OK\r\n\r\n{\"decision\":\"deny\",\"message\":\"Agrega tests\"}";
        assert_eq!(decision(&permission_output(r, &ev).unwrap())["message"], "Agrega tests");
    }

    #[test]
    fn hook_event_name_correcto() {
        let out: Value = serde_json::from_str(&permission_output(&reply("allow"), &event()).unwrap()).unwrap();
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
    }
}

#[cfg(test)]
mod statusline_tests {
    use super::*;

    #[test]
    fn linea_completa_con_limites() {
        let s = json!({
            "model": { "display_name": "Opus" },
            "context_window": { "used_percentage": 8 },
            "rate_limits": { "five_hour": { "used_percentage": 23.5 }, "seven_day": { "used_percentage": 41.2 } }
        });
        assert_eq!(status_text(&s), "◆ Opus · contexto 8% · 5 h 24% · semana 41%");
    }

    #[test]
    fn sin_limites_ni_contexto() {
        assert_eq!(status_text(&json!({ "model": { "display_name": "Sonnet" } })), "◆ Sonnet");
    }
}
