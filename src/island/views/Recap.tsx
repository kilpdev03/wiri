import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { formatDuration } from "../../lib/claude";
import { weekRecap, weekStart, type Recap } from "../../lib/recap";
import { sounds } from "../../lib/sounds";
import { CloseIcon, SparkIcon } from "../icons";
import { IconButton, Segmented } from "../parts";

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const WEEK_MS = 7 * 86_400_000;

const range = (r: Recap) => {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
  return `${fmt(r.from)} – ${fmt(r.to - 86_400_000)}`;
};

function stats(r: Recap): [string, string][] {
  return [
    ["Sesiones", String(r.sessions)],
    ["Turnos", String(r.turns)],
    ["Archivos", String(r.files)],
    ["Líneas", `+${r.added} −${r.removed}`],
    ["Comandos", String(r.commands)],
    ["Permisos", String(r.permissions)],
    ["Día más activo", r.busiestDay ? r.busiestDay.label : "—"],
    ["Turno más largo", r.longestMs ? formatDuration(r.longestMs) : "—"],
  ];
}

/** Imagen vertical 1080×1920 para compartir (sin nombres de proyecto si así lo eliges). */
async function recapImage(r: Recap, withProject: boolean): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 1920);
  grad.addColorStop(0, "#1c1c1e");
  grad.addColorStop(1, "#2a1a14");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = "#d97757";
  g.font = "600 44px 'Segoe UI', sans-serif";
  g.fillText("Mi semana con Claude Code", 90, 200);
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.font = "36px 'Segoe UI', sans-serif";
  g.fillText(range(r), 90, 260);
  g.fillStyle = "#fff";
  g.font = "700 150px 'Segoe UI', sans-serif";
  g.fillText(formatDuration(r.ms), 90, 470);
  // Barras por día.
  const max = Math.max(...r.perDay, 1);
  r.perDay.forEach((ms, i) => {
    const h = Math.max(8, (ms / max) * 320);
    g.fillStyle = ms === max && ms > 0 ? "#d97757" : "rgba(255,255,255,0.18)";
    g.beginPath();
    g.roundRect(90 + i * 132, 900 - h, 96, h, 18);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = "32px 'Segoe UI', sans-serif";
    g.fillText(DAYS[i], 126 + i * 132, 950);
  });
  const rows = stats(r);
  if (withProject && r.topProject) rows.unshift(["Proyecto principal", r.topProject]);
  rows.forEach(([k, v], i) => {
    const y = 1080 + i * 88;
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = "36px 'Segoe UI', sans-serif";
    g.fillText(k, 90, y);
    g.fillStyle = "#fff";
    g.font = "600 40px 'Segoe UI', sans-serif";
    const w = g.measureText(v).width;
    g.fillText(v, 990 - w, y);
  });
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.font = "30px 'Segoe UI', sans-serif";
  g.fillText("Wiri · isla dinámica para Windows", 90, 1840);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}

/** Resumen de esta semana o la anterior, sobre la pestaña Claude. */
export function RecapSheet({ onClose }: { onClose: () => void }) {
  const [which, setWhich] = useState<"this" | "last">("this");
  const [note, setNote] = useState<string | null>(null);
  const [withProject, setWithProject] = useState(false);
  const r = useMemo(() => weekRecap(weekStart(Date.now()) - (which === "last" ? WEEK_MS : 0)), [which]);
  const max = Math.max(...r.perDay, 1);

  const share = async () => {
    try {
      const blob = await recapImage(r, withProject);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      sounds.done();
      setNote("Imagen copiada: pégala donde quieras");
    } catch {
      setNote("No se pudo copiar la imagen");
    }
  };

  return (
    <motion.div
      className="resolve-sheet recap-sheet"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="row gap-8">
        <span className="resolve-icon"><SparkIcon size={13} /></span>
        <div className="col grow min-w-0">
          <span className="text-sm">Tu semana con Claude</span>
          <span className="caption">{range(r)}</span>
        </div>
        <Segmented id="recap-week" value={which} options={{ this: { label: "Esta" }, last: { label: "Anterior" } }} onChange={setWhich} />
        <IconButton onClick={onClose} title="Cerrar (Esc)" size={26}>
          <CloseIcon size={13} />
        </IconButton>
      </div>

      {r.turns ? (
        <div className="recap-body">
          <div className="col gap-4 recap-hero">
            <span className="recap-total">{formatDuration(r.ms)}</span>
            <span className="caption">{r.topProject ? `trabajando sobre todo en ${r.topProject}` : "con Claude trabajando"}</span>
            <div className="recap-bars">
              {r.perDay.map((ms, i) => (
                <div key={i} className="col gap-4 recap-bar-col" title={ms ? formatDuration(ms) : "Sin actividad"}>
                  <motion.span
                    className="recap-bar"
                    style={{ background: ms === max ? "#d97757" : undefined }}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(6, (ms / max) * 100)}%` }}
                    transition={{ type: "spring", stiffness: 200, damping: 22, delay: i * 0.04 }}
                  />
                  <span className="caption">{DAYS[i]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="recap-grid">
            {stats(r).map(([k, v]) => (
              <div key={k} className="col recap-stat">
                <span className="caption">{k}</span>
                <span className="text-sm tabular">{v}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="caption recap-empty">Sin turnos de Claude Code registrados esa semana.</div>
      )}

      <div className="row gap-8">
        {note && <span className="caption truncate">{note}</span>}
        <span className="grow" />
        <label className="caption row gap-4 recap-check">
          <input type="checkbox" checked={withProject} onChange={(e) => setWithProject(e.target.checked)} />
          Incluir proyecto
        </label>
        <button className="pill-btn" onClick={share} disabled={!r.turns}>Copiar como imagen</button>
      </div>
    </motion.div>
  );
}
