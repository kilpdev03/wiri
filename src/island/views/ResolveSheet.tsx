import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ipc, type ClaudeProject, type MailItem } from "../../lib/ipc";
import { buildBrief, DEFAULT_INSTRUCTIONS, suggestProject } from "../../lib/resolve";
import { sounds } from "../../lib/sounds";
import { useIsland } from "../../store/islandStore";
import { CheckIcon, CloseIcon, SparkIcon } from "../icons";
import { IconButton, Segmented } from "../parts";

const TARGETS = { app: { label: "App de Claude" }, terminal: { label: "Terminal" } };

/**
 * Convierte un correo en una sesión de Claude Code: elige el proyecto (con
 * sugerencia automática), ajusta las instrucciones y abre la terminal.
 */
export function ResolveSheet({ mail, onClose }: { mail: MailItem; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [markRead, setMarkRead] = useState(true);
  const [state, setState] = useState<"idle" | "launching" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const target = useIsland((s) => s.prefs.claudeTarget);
  const setPref = useIsland((s) => s.setPref);

  useEffect(() => {
    Promise.all([ipc.gmailMessageText(mail.id).catch(() => mail.snippet), ipc.claudeProjects().catch(() => [])]).then(([text, list]) => {
      setBody(text);
      setProjects(list);
      const best = suggestProject(list, mail, text);
      setSuggested(best?.path ?? null);
      setCwd(best?.path ?? list[0]?.path ?? "");
    });
  }, [mail]);

  const launch = async () => {
    if (!cwd) return setError("Elige un proyecto.");
    setState("launching");
    setError(null);
    try {
      await ipc.claudeLaunch(cwd, mail.subject, buildBrief(mail, body ?? mail.snippet, instructions), target);
      if (markRead) ipc.gmailMarkRead(mail.id).catch(() => {});
      sounds.done();
      useIsland.getState().react("happy");
      setState("done");
      setTimeout(onClose, 3500);
    } catch (e) {
      setError(String(e));
      setState("idle");
      sounds.nope();
    }
  };

  const project = projects.find((p) => p.path === cwd);
  // El sugerido primero; el resto en orden de uso reciente.
  const ordered = suggested ? [...projects.filter((p) => p.path === suggested), ...projects.filter((p) => p.path !== suggested)] : projects;

  return (
    <motion.div
      className="resolve-sheet"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={(e) => e.stopPropagation()}
    >
      {state === "done" ? (
        <div className="resolve-done">
          <motion.span className="ok-dot" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 14 }}>
            <CheckIcon size={16} />
          </motion.span>
          <div className="col">
            <span className="title">Sesión lista en {project?.name}</span>
            <span className="caption">
              {target === "app"
                ? "En la app de Claude: confirma la carpeta, revisa el encargo y pulsa Enter."
                : "En la terminal: revisa el encargo y pulsa Enter."}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="row gap-8 min-w-0">
            <span className="resolve-icon"><SparkIcon size={14} /></span>
            <div className="col grow min-w-0">
              <span className="text-sm truncate">Resolver con Claude · {mail.subject}</span>
              <span className="caption truncate">
                {mail.fromName} · {body === null ? "leyendo el correo…" : `${body.length.toLocaleString("es-CL")} caracteres`}
              </span>
            </div>
            <IconButton onClick={onClose} title="Cancelar" size={26}>
              <CloseIcon size={13} />
            </IconButton>
          </div>

          <label className="resolve-field">
            <span className="caption">Proyecto</span>
            <span className="select-wrap">
              <select className="resolve-select" value={cwd} onChange={(e) => setCwd(e.target.value)} disabled={!projects.length}>
                {!projects.length && <option value="">Buscando proyectos…</option>}
                {ordered.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path === suggested ? `✦ ${p.name} (sugerido)` : p.name} — {p.path}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="resolve-field grow">
            <span className="caption">Instrucciones para Claude</span>
            <textarea className="resolve-text" value={instructions} onChange={(e) => setInstructions(e.target.value)} spellCheck={false} />
          </label>

          <div className="row gap-8">
            <label className="row gap-6 caption resolve-check">
              <input type="checkbox" checked={markRead} onChange={(e) => setMarkRead(e.target.checked)} />
              Marcar como leído
            </label>
            <Segmented id="claude-target" value={target} options={TARGETS} onChange={(v) => setPref("claudeTarget", v)} />
            {error && <span className="field-error truncate">{error}</span>}
            <span className="grow" />
            <motion.button
              className="pill-btn primary"
              style={{ background: "#d97757", color: "#fff" }}
              whileTap={{ scale: 0.92 }}
              onClick={launch}
              disabled={state === "launching" || body === null}
            >
              <SparkIcon size={12} /> {state === "launching" ? "Abriendo…" : "Crear sesión"}
            </motion.button>
          </div>
        </>
      )}
    </motion.div>
  );
}
