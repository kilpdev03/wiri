/**
 * Resumen semanal de Claude Code. Guarda solo números y nombres de proyecto por día
 * (nada de código ni prompts) en localStorage, los últimos 60 días.
 */
import type { ClaudeSession } from "./claude";

type Day = {
  turns: number;
  ms: number;
  added: number;
  removed: number;
  files: number;
  commands: number;
  permissions: number;
  longestMs: number;
  sessions: string[];
  /** Proyecto → ms trabajando. */
  projects: Record<string, number>;
};

const KEY = "win-island:recap";
const SEEN_KEY = "win-island:recap-seen";
const KEEP_DAYS = 60;

const empty = (): Day => ({ turns: 0, ms: 0, added: 0, removed: 0, files: 0, commands: 0, permissions: 0, longestMs: 0, sessions: [], projects: {} });

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function load(): Record<string, Day> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function update(at: number, fn: (d: Day) => void) {
  const all = load();
  const key = dayKey(at);
  const day = { ...empty(), ...all[key] };
  fn(day);
  all[key] = day;
  // Fuera lo de hace más de 60 días.
  const cutoff = dayKey(at - KEEP_DAYS * 86_400_000);
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* sin espacio: el resumen es opcional */
  }
}

/** Registra un evento de hook, con la sesión tal como estaba antes de aplicarlo. */
export function recordHook(prev: ClaudeSession | undefined, event: Record<string, any>, now = Date.now()) {
  const name = String(event.hook_event_name ?? "");
  if (name === "PostToolUse" && (event.tool_name === "Bash" || event.tool_name === "PowerShell")) {
    update(now, (d) => d.commands++);
  }
  if (name === "Stop" && prev && prev.status === "working") {
    const took = Math.max(0, now - prev.turnStartedMs);
    update(now, (d) => {
      d.turns++;
      d.ms += took;
      d.added += prev.added;
      d.removed += prev.removed;
      d.files += prev.files.length;
      d.longestMs = Math.max(d.longestMs, took);
      if (!d.sessions.includes(prev.id)) d.sessions.push(prev.id);
      d.projects[prev.project] = (d.projects[prev.project] ?? 0) + took;
    });
  }
}

export function recordPermission(now = Date.now()) {
  update(now, (d) => d.permissions++);
}

export type Recap = {
  from: number;
  to: number;
  turns: number;
  ms: number;
  added: number;
  removed: number;
  files: number;
  commands: number;
  permissions: number;
  sessions: number;
  longestMs: number;
  topProject: string | null;
  busiestDay: { label: string; ms: number } | null;
  /** ms por día, lunes a domingo. */
  perDay: number[];
};

/** Lunes 00:00 de la semana de `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Resumen de la semana que empieza el lunes `from`. */
export function weekRecap(from: number): Recap {
  const all = load();
  const projects: Record<string, number> = {};
  const sessions = new Set<string>();
  const r: Recap = { from, to: from + 7 * 86_400_000, turns: 0, ms: 0, added: 0, removed: 0, files: 0, commands: 0, permissions: 0, sessions: 0, longestMs: 0, topProject: null, busiestDay: null, perDay: [] };
  for (let i = 0; i < 7; i++) {
    // Mediodía: evita saltos de horario de verano.
    const d = all[dayKey(from + i * 86_400_000 + 43_200_000)];
    r.perDay.push(d?.ms ?? 0);
    if (!d) continue;
    r.turns += d.turns;
    r.ms += d.ms;
    r.added += d.added;
    r.removed += d.removed;
    r.files += d.files;
    r.commands += d.commands;
    r.permissions += d.permissions;
    r.longestMs = Math.max(r.longestMs, d.longestMs);
    d.sessions.forEach((s) => sessions.add(s));
    for (const [p, ms] of Object.entries(d.projects)) projects[p] = (projects[p] ?? 0) + ms;
    if (d.ms > (r.busiestDay?.ms ?? 0)) r.busiestDay = { label: DAY_NAMES[i], ms: d.ms };
  }
  r.sessions = sessions.size;
  r.topProject = Object.entries(projects).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return r;
}

/**
 * Los lunes, una vez: el resumen de la semana pasada si hubo actividad.
 * Devuelve null si no toca mostrarlo.
 */
export function mondayRecapDue(now = Date.now()): Recap | null {
  if (new Date(now).getDay() !== 1) return null;
  const lastWeek = weekStart(now) - 7 * 86_400_000;
  try {
    if (localStorage.getItem(SEEN_KEY) === String(lastWeek)) return null;
  } catch {
    return null;
  }
  const recap = weekRecap(lastWeek);
  if (!recap.turns) return null;
  try {
    localStorage.setItem(SEEN_KEY, String(lastWeek));
  } catch {
    /* se mostraría de nuevo; no pasa nada */
  }
  return recap;
}
