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
  /** Lo que hizo en el turno actual, del más antiguo al más reciente. */
  steps: ClaudeStep[];
  /** claude | codex | gemini */
  agent: string;
  /** De la línea de estado (solo sesiones de terminal). */
  model?: string;
  contextPct?: number;
  costUsd?: number;
};

/** Texto antes/después de una edición (Write: antes vacío). */
export type ClaudeEdit = { before: string; after: string };

/** Un paso terminado: leyó, editó, ejecutó, buscó… */
export type ClaudeStep = {
  at: number;
  tool: string;
  label: string;
  /** Ruta completa del archivo, si la herramienta tocó uno. */
  path?: string;
  added: number;
  removed: number;
  edits?: ClaudeEdit[];
};

const MAX_STEPS = 60;
/** Una edición enorme (p. ej. un archivo generado) no se guarda entera en memoria. */
const MAX_EDIT_CHARS = 20_000;

export type HookPayload = { event: Record<string, any>; ancestors: number[]; agent?: string };

/** Agentes que Wiri sigue, con su nombre y color (también el de la mascota en sus alertas). */
export const AGENTS: Record<string, { name: string; short: string; color: string }> = {
  claude: { name: "Claude Code", short: "Claude", color: "#d97757" },
  codex: { name: "Codex", short: "Codex", color: "#10a37f" },
  gemini: { name: "Gemini CLI", short: "Gemini", color: "#4285f4" },
};
export const agentMeta = (id?: string) => AGENTS[id ?? "claude"] ?? { name: id ?? "Agente", short: id ?? "Agente", color: "#8e8e93" };

const GEMINI_EVENTS: Record<string, string> = {
  BeforeAgent: "UserPromptSubmit",
  AfterAgent: "Stop",
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse",
};
const GEMINI_TOOLS: Record<string, string> = {
  run_shell_command: "Bash",
  write_file: "Write",
  replace: "Edit",
  read_file: "Read",
  read_many_files: "Read",
  glob: "Glob",
  search_file_content: "Grep",
  web_fetch: "WebFetch",
  google_web_search: "WebSearch",
};

/**
 * Lleva los eventos de Gemini CLI al formato de Claude Code (Codex ya usa el mismo),
 * para que sesiones, pasos y diferencias funcionen igual con todos los agentes.
 */
export function normalizeHook(payload: HookPayload): HookPayload {
  if (payload.agent !== "gemini") return payload;
  const e = { ...payload.event };
  const name = String(e.hook_event_name ?? "");
  if (GEMINI_EVENTS[name]) e.hook_event_name = GEMINI_EVENTS[name];
  if (name === "AfterAgent") e.last_assistant_message = e.prompt_response;
  if (name === "Notification" && e.notification_type === "ToolPermission") e.notification_type = "permission_prompt";
  if (e.tool_name && GEMINI_TOOLS[e.tool_name]) {
    e.tool_name = GEMINI_TOOLS[e.tool_name];
    const input = { ...(e.tool_input ?? {}) };
    if (input.absolute_path && !input.file_path) input.file_path = input.absolute_path;
    e.tool_input = input;
  }
  return { ...payload, event: e };
}

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

/** El paso ya hecho, en pasado ("Editó Island.tsx"). */
export function stepLabel(tool: string, input: Record<string, any> = {}): string {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return `Ejecutó ${clip(input.description || input.command, 60)}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editó ${basename(input.file_path ?? input.notebook_path)}`;
    case "Write":
      return `Escribió ${basename(input.file_path)}`;
    case "Read":
      return `Leyó ${basename(input.file_path)}`;
    case "Grep":
    case "Glob":
      return `Buscó ${clip(input.pattern, 40)}`;
    case "WebFetch":
      return `Abrió ${clip(input.url, 50)}`;
    case "WebSearch":
      return `Buscó en la web ${clip(input.query, 40)}`;
    case "Task":
    case "Agent":
      return `Delegó: ${clip(input.description, 44) || "subagente"}`;
    case "TodoWrite":
      return "Actualizó sus tareas";
    default:
      return tool.startsWith("mcp__") ? `Usó ${tool.split("__").pop()}` : `Usó ${tool}`;
  }
}

const cut = (s: unknown) => String(s ?? "").slice(0, MAX_EDIT_CHARS);

/** Antes/después de cada cambio, para mostrar la diferencia completa. */
export function editsOf(tool: string, input: Record<string, any> = {}): ClaudeEdit[] | undefined {
  if (tool === "Edit") return [{ before: cut(input.old_string), after: cut(input.new_string) }];
  if (tool === "MultiEdit" && Array.isArray(input.edits)) return input.edits.map((e: any) => ({ before: cut(e.old_string), after: cut(e.new_string) }));
  if (tool === "Write") return [{ before: "", after: cut(input.content) }];
  return undefined;
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

/** Primera línea con texto del plan, sin marcas de markdown. */
export function planTitle(plan: string): string {
  const line = plan.split("\n").find((l) => l.trim()) ?? "";
  return clip(line.replace(/^[#>*\-\s]+/, "").replace(/\*\*/g, ""), 120);
}

/** Qué pide Claude, en una frase, y el detalle exacto a mostrar. */
export function describePermission(tool: string, input: Record<string, any> = {}, agent?: string): { title: string; detail: string } {
  const d = describeClaudePermission(tool, input);
  // Mismos textos para todos los agentes, con su nombre.
  return agent && agent !== "claude" ? { ...d, title: d.title.replace(/^Claude/, agentMeta(agent).short) } : d;
}

function describeClaudePermission(tool: string, input: Record<string, any> = {}): { title: string; detail: string } {
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
    case "AskUserQuestion":
      return { title: "Claude te pregunta", detail: String(input.questions?.[0]?.question ?? "") };
    case "ExitPlanMode":
      return { title: "Plan listo para revisar", detail: planTitle(String(input.plan ?? "")) };
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
  { event, ancestors, agent = "claude" }: HookPayload,
  now = Date.now(),
): { sessions: Record<string, ClaudeSession>; alert?: ClaudeAlert; sessionId?: string } {
  const who = agentMeta(agent).short;
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
    project: basename(cwd) || agentMeta(agent).name,
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
    steps: [],
    agent,
  };
  let s: ClaudeSession = { ...prev, cwd, project: basename(cwd) || prev.project, lastEventMs: now, ancestors: ancestors.length ? ancestors : prev.ancestors };
  let alert: ClaudeAlert | undefined;

  switch (name) {
    case "SessionStart":
      break;
    case "UserPromptSubmit":
      // Turno nuevo: reinicia actividad y contadores.
      s = { ...s, status: "working", prompt: clip(event.prompt, 90), message: null, activity: "Pensando…", turnStartedMs: now, added: 0, removed: 0, files: [], steps: [] };
      break;
    case "PreToolUse":
      s = { ...s, status: "working", activity: describeTool(event.tool_name, event.tool_input) };
      break;
    case "PostToolUse": {
      const diff = countDiff(event.tool_name, event.tool_input);
      const file = basename(event.tool_input?.file_path);
      const tool = String(event.tool_name ?? "");
      const step: ClaudeStep = {
        at: now,
        tool,
        label: stepLabel(tool, event.tool_input),
        path: event.tool_input?.file_path ? String(event.tool_input.file_path) : undefined,
        added: diff.added,
        removed: diff.removed,
        edits: editsOf(tool, event.tool_input),
      };
      s = {
        ...s,
        status: "working",
        added: s.added + diff.added,
        removed: s.removed + diff.removed,
        files: diff.added + diff.removed > 0 && file && !s.files.includes(file) ? [...s.files, file] : s.files,
        steps: [...(s.steps ?? []), step].slice(-MAX_STEPS),
      };
      break;
    }
    case "Notification": {
      const type = String(event.notification_type ?? "");
      if (type === "permission_prompt" || type === "idle_prompt" || type === "elicitation_dialog" || type === "agent_needs_input") {
        s = { ...s, status: "waiting", message: clip(event.message, 120) };
        alert = {
          kind: "needs",
          title: type === "permission_prompt" ? `${who} necesita tu permiso` : `${who} te espera`,
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
        title: `${who} terminó`,
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
