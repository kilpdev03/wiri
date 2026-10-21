/** Sesiones de Claude Code a partir de los eventos de hooks que reenvía wiri-hook.exe. */

export type ClaudeStatus = "working" | "waiting" | "done";

export type ClaudeSession = {
  id: string;
  cwd: string;
  /** Carpeta del proyecto (último segmento de cwd). */
  project: string;
  status: ClaudeStatus;
  /** "Editando Island.tsx", "Ejecutando pnpm build"... */
  activity: string | null;
  /** Último prompt del usuario (recortado). */
  prompt: string | null;
  /** Mensaje de Claude al terminar o al pedir algo. */
  message: string | null;
  turnStartedMs: number;
  lastEventMs: number;
  added: number;
  removed: number;
  files: string[];
  /** PID de los procesos que lanzaron el hook, para traer su ventana al frente. */
  ancestors: number[];
  /** De la línea de estado (solo sesiones de terminal). */
  model?: string;
  contextPct?: number;
  costUsd?: number;
};

export type HookPayload = { event: Record<string, any>; ancestors: number[] };

const basename = (p: unknown) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const lines = (s: unknown) => (typeof s === "string" && s.length ? s.split("\n").length : 0);

/** Descripción breve de lo que está haciendo Claude con una herramienta. */
export function describeTool(tool: string, input: Record<string, any> = {}): string {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return `Ejecutando ${clip(input.description || input.command, 48)}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return `Editando ${basename(input.file_path ?? input.notebook_path)}`;
    case "Read":
      return `Leyendo ${basename(input.file_path)}`;
    case "Grep":
    case "Glob":
      return `Buscando ${clip(input.pattern, 30)}`;
    case "WebFetch":
    case "WebSearch":
      return "Buscando en la web";
    case "Task":
    case "Agent":
      return `Delegando: ${clip(input.description, 36) || "subagente"}`;
    case "TodoWrite":
      return "Planificando";
    default:
      if (tool.startsWith("mcp__")) return `Usando ${tool.split("__").pop()}`;
      return `Usando ${tool}`;
  }
}

/** Líneas agregadas/quitadas por una edición (a partir de tool_input). */
export function countDiff(tool: string, input: Record<string, any> = {}): { added: number; removed: number } {
  if (tool === "Edit") return { added: lines(input.new_string), removed: lines(input.old_string) };
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.reduce(
      (acc: { added: number; removed: number }, e: any) => ({ added: acc.added + lines(e.new_string), removed: acc.removed + lines(e.old_string) }),
      { added: 0, removed: 0 },
    );
  }
  if (tool === "Write") return { added: lines(input.content), removed: 0 };
  return { added: 0, removed: 0 };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim();
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Qué pide Claude, en una frase, y el detalle exacto a mostrar. */
export function describePermission(tool: string, input: Record<string, any> = {}): { title: string; detail: string } {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return { title: "Claude quiere ejecutar un comando", detail: String(input.command ?? "") };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return { title: "Claude quiere editar un archivo", detail: String(input.file_path ?? input.notebook_path ?? "") };
    case "WebFetch":
      return { title: "Claude quiere abrir una página", detail: String(input.url ?? "") };
    case "WebSearch":
      return { title: "Claude quiere buscar en la web", detail: String(input.query ?? "") };
    default:
      return { title: `Claude quiere usar ${tool.startsWith("mcp__") ? tool.split("__").pop() : tool}`, detail: clip(JSON.stringify(input), 200) };
  }
}

export type ClaudeAlert = { kind: "done" | "needs"; title: string; body: string };

/**
 * Aplica un evento a las sesiones. Devuelve las sesiones nuevas y, si corresponde,
 * la alerta a mostrar ("terminó" o "te necesita").
 */
export function applyHook(
  sessions: Record<string, ClaudeSession>,
  { event, ancestors }: HookPayload,
  now = Date.now(),
): { sessions: Record<string, ClaudeSession>; alert?: ClaudeAlert; sessionId?: string } {
  const id = String(event.session_id ?? "");
  if (!id) return { sessions };
  const name = String(event.hook_event_name ?? "");

  if (name === "SessionEnd") {
    const { [id]: _gone, ...rest } = sessions;
    return { sessions: rest };
  }

  const cwd = String(event.cwd ?? sessions[id]?.cwd ?? "");
  const prev: ClaudeSession = sessions[id] ?? {
    id,
    cwd,
    project: basename(cwd) || "Claude Code",
    status: "done",
    activity: null,
    prompt: null,
    message: null,
    turnStartedMs: now,
    lastEventMs: now,
    added: 0,
    removed: 0,
    files: [],
    ancestors,
  };
  let s: ClaudeSession = { ...prev, cwd, project: basename(cwd) || prev.project, lastEventMs: now, ancestors: ancestors.length ? ancestors : prev.ancestors };
  let alert: ClaudeAlert | undefined;

  switch (name) {
    case "SessionStart":
      break;
    case "UserPromptSubmit":
      // Turno nuevo: reinicia actividad y contadores.
      s = { ...s, status: "working", prompt: clip(event.prompt, 90), message: null, activity: "Pensando…", turnStartedMs: now, added: 0, removed: 0, files: [] };
      break;
    case "PreToolUse":
      s = { ...s, status: "working", activity: describeTool(event.tool_name, event.tool_input) };
      break;
    case "PostToolUse": {
      const diff = countDiff(event.tool_name, event.tool_input);
      const file = basename(event.tool_input?.file_path);
      s = {
        ...s,
        status: "working",
        added: s.added + diff.added,
        removed: s.removed + diff.removed,
        files: diff.added + diff.removed > 0 && file && !s.files.includes(file) ? [...s.files, file] : s.files,
      };
      break;
    }
    case "Notification": {
      const type = String(event.notification_type ?? "");
      if (type === "permission_prompt" || type === "idle_prompt" || type === "elicitation_dialog" || type === "agent_needs_input") {
        s = { ...s, status: "waiting", message: clip(event.message, 120) };
        alert = {
          kind: "needs",
          title: type === "permission_prompt" ? "Claude necesita tu permiso" : "Claude te espera",
          body: `${s.project} · ${clip(event.message, 90)}`,
        };
      }
      break;
    }
    case "Stop": {
      const took = now - s.turnStartedMs;
      const edits = s.files.length ? ` · ${s.files.length} archivo${s.files.length > 1 ? "s" : ""} +${s.added} −${s.removed}` : "";
      s = { ...s, status: "done", activity: null, message: clip(event.last_assistant_message, 160) };
      alert = {
        kind: "done",
        title: "Claude terminó",
        body: `${s.project} · ${formatDuration(took)}${edits}`,
      };
      break;
    }
  }
  return { sessions: { ...sessions, [id]: s }, alert, sessionId: id };
}

/** Uso de los límites del plan (solo Pro/Max), de la línea de estado de Claude Code. */
export type UsageWindow = { pct: number; resetsAtMs: number };
export type ClaudeUsage = { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; updatedMs: number };

const usageWindow = (w: any): UsageWindow | null =>
  w && typeof w.used_percentage === "number" ? { pct: w.used_percentage, resetsAtMs: Number(w.resets_at ?? 0) * 1000 } : null;

export function usageFromStatus(status: Record<string, any>, now = Date.now()): ClaudeUsage | null {
  const limits = status.rate_limits;
  if (!limits) return null;
  return { fiveHour: usageWindow(limits.five_hour), sevenDay: usageWindow(limits.seven_day), updatedMs: now };
}

/** Datos de contexto, modelo y costo para la sesión de la línea de estado. */
export function applyStatus(sessions: Record<string, ClaudeSession>, status: Record<string, any>): Record<string, ClaudeSession> {
  const id = String(status.session_id ?? "");
  const s = sessions[id];
  if (!s) return sessions;
  const ctx = status.context_window?.used_percentage;
  return {
    ...sessions,
    [id]: {
      ...s,
      model: status.model?.display_name ?? s.model,
      contextPct: typeof ctx === "number" ? ctx : s.contextPct,
      costUsd: typeof status.cost?.total_cost_usd === "number" ? status.cost.total_cost_usd : s.costUsd,
    },
  };
}

/** "18:40" hoy, "jue 09:00" otro día. */
export function resetLabel(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString("es-CL", { weekday: "short" })} ${time}`;
}
