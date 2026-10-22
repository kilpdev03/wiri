import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HookPayload } from "./claude";

export type Media = {
  title: string;
  artist: string;
  album: string;
  appId: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  updatedAtMs: number;
  shuffle: boolean | null;
  repeat: "none" | "track" | "list" | null;
  artwork: string | null;
};

export type Reminder = {
  id: string;
  text: string;
  kind: "reminder" | "timer";
  createdMs: number;
  dueMs: number;
};

export type AlertKind = "reminder" | "notification" | "mail" | "calendar" | "claude" | "update";

export type Alert = {
  id: string;
  kind: AlertKind;
  app?: string;
  title: string;
  body: string;
  reminder?: Reminder;
  /** Enlace que abre la acción principal (p. ej. el hilo de Gmail). */
  url?: string;
  /** Id del mensaje de Gmail, para marcarlo leído desde la alerta. */
  messageId?: string;
  /** Etiquetas de Gmail del correo que generó la alerta. */
  labels?: string[];
  /** Notificaciones de Windows: ícono de la app (data URL), su AUMID e id en el centro. */
  icon?: string | null;
  aumid?: string;
  winId?: number;
  /** Claude Code: procesos que lanzaron el hook (para enfocar su ventana). */
  ancestors?: number[];
  /** Claude Code: solicitud de permiso esperando respuesta en la isla. */
  permission?: ClaudePermission;
  /** Agente de código que la generó (claude, codex, gemini): define su color. */
  agent?: string;
  /** Resumen semanal de Claude: Enter lo abre en el panel. */
  recap?: boolean;
  /** Reuniones: enlace de videollamada. */
  joinUrl?: string | null;
  /** ms Unix en que llegó (lo pone el frontend). */
  at?: number;
};

export type MailItem = {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  dateMs: number;
  url: string;
  labels: string[];
};

export type ClaudeProject = { path: string; name: string; lastUsedMs: number };

export type ClaudePermission = {
  id: string;
  sessionId: string;
  tool: string;
  /** Comando, archivo o URL a mostrar tal cual. */
  detail: string;
  /** Claude Code ofreció una regla para "permitir siempre". */
  canAlways: boolean;
  /** AskUserQuestion: preguntas con opciones para contestar desde la isla. */
  questions?: ClaudeQuestion[];
  /** ExitPlanMode: el plan a revisar (markdown). */
  plan?: string;
};

export type ClaudeQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

export type PermissionDecision = "allow" | "deny" | "always" | "ask";
/** Respuestas a AskUserQuestion (pregunta → respuesta) o motivo de un "deny". */
export type PermissionReply = { answers?: Record<string, string>; message?: string };

export type ClaudeHooksStatus = {
  installed: boolean;
  settingsPath: string;
  relayPath: string;
  events: string[];
  otherStatusLine: boolean;
  error: string | null;
};

export type AudioDevice = { id: string; name: string; isDefault: boolean };
export type AudioDevices = { outputs: AudioDevice[]; inputs: AudioDevice[] };

export type Volume = { level: number; muted: boolean };
export type Power = { hasBattery: boolean; charging: boolean; percent: number };
export type GhPr = {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string | null;
  updatedAt: string;
  draft: boolean;
  ci: string | null;
  review: string | null;
};
export type GithubStatus = { connected: boolean; login: string | null; mine: GhPr[]; reviews: GhPr[]; error: string | null; updatedMs: number };

/** Otro agente de código (Codex, Gemini CLI) y si tiene los hooks de Wiri. */
export type AgentStatus = { id: string; name: string; detected: boolean; installed: boolean; configPath: string; error: string | null };

/** Texto copiado (historial en memoria, se borra al cerrar Wiri). */
export type ClipItem = { id: number; text: string; copiedMs: number };
/** Aparato Bluetooth que informa su batería (audífonos, mouse, teclado…). */
export type BtBattery = { name: string; percent: number };
export type Privacy = { mic: string[]; cam: string[]; micMuted: boolean };

export type CalEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  joinUrl: string | null;
  htmlLink: string;
  location: string | null;
};

export type CalendarStatus = {
  status: "disconnected" | "needs_scope" | "api_disabled" | "ok" | "error";
  events: CalEvent[];
  error: string | null;
  lastSyncMs: number;
};

export type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  unreadCount: number;
  messages: MailItem[];
  error: string | null;
  lastSyncMs: number;
};

export type UpdateInfo = { version: string; current: string; notes: string | null };

export type MediaAction = "toggle" | "next" | "previous" | "seek" | "shuffle" | "repeat";

export const ipc = {
  shortcuts: () => invoke<Record<string, string>>("shortcuts"),
  claudeHooksStatus: () => invoke<ClaudeHooksStatus>("claude_hooks_status"),
  claudeHooksInstall: () => invoke<string>("claude_hooks_install"),
  claudeHooksUninstall: () => invoke<string>("claude_hooks_uninstall"),
  claudePermissionRespond: (id: string, decision: PermissionDecision, reply: PermissionReply = {}) =>
    invoke<boolean>("claude_permission_respond", { id, decision, answers: reply.answers ?? null, message: reply.message ?? null }),
  claudeProjects: () => invoke<ClaudeProject[]>("claude_projects"),
  claudeLaunch: (cwd: string, title: string, brief: string, target: "app" | "terminal") =>
    invoke<string>("claude_launch", { cwd, title, brief, target }),
  claudeFocus: (ancestors: number[]) => invoke<boolean>("claude_focus", { ancestors }),
  audioDevices: () => invoke<AudioDevices>("audio_devices"),
  audioSetDefault: (id: string) => invoke("audio_set_default", { id }),
  setShortcut: (name: string, accel: string) => invoke<Record<string, string>>("set_shortcut", { name, accel }),
  githubStatus: () => invoke<GithubStatus>("github_status"),
  githubRefresh: () => invoke<GithubStatus>("github_refresh"),
  agentsStatus: () => invoke<AgentStatus[]>("agents_status"),
  agentHooksInstall: (id: string) => invoke<string>("agent_hooks_install", { id }),
  agentHooksUninstall: (id: string) => invoke<string>("agent_hooks_uninstall", { id }),
  claudeChat: (message: string, sessionId: string | null, files: string[]) =>
    invoke<{ text: string; sessionId: string | null; skipped: string[] }>("claude_chat", { message, sessionId, files }),
  clipboardHistory: () => invoke<ClipItem[]>("clipboard_history"),
  clipboardCopy: (id: number) => invoke("clipboard_copy", { id }),
  clipboardRemove: (id: number) => invoke("clipboard_remove", { id }),
  clipboardClear: () => invoke("clipboard_clear"),
  clipboardSetEnabled: (enabled: boolean) => invoke("clipboard_set_enabled", { enabled }),
  /** Devuelve si el micrófono quedó silenciado. */
  micToggleMute: () => invoke<boolean>("mic_toggle_mute"),
  setAnchor: (fraction: number) => invoke("set_anchor", { fraction }),
  setHitRect: (x: number, y: number, w: number, h: number) => invoke("set_hit_rect", { x, y, w, h }),
  grabFocus: () => invoke("grab_focus"),
  releaseFocus: () => invoke("release_focus"),

  currentMedia: () => invoke<Media | null>("current_media"),
  mediaControl: (action: MediaAction, positionMs?: number) => invoke("media_control", { action, positionMs }),

  listReminders: () => invoke<Reminder[]>("list_reminders"),
  addReminder: (text: string, kind: Reminder["kind"], dueMs: number) =>
    invoke<Reminder>("add_reminder", { text, kind, dueMs }),
  removeReminder: (id: string) => invoke("remove_reminder", { id }),
  snoozeReminder: (reminder: Reminder, minutes: number) => invoke("snooze_reminder", { reminder, minutes }),

  gmailStatus: () => invoke<GmailStatus>("gmail_status"),
  gmailSetClient: (clientId: string, clientSecret: string) => invoke("gmail_set_client", { clientId, clientSecret }),
  gmailConnect: () => invoke<string>("gmail_connect"),
  gmailDisconnect: () => invoke("gmail_disconnect"),
  gmailForgetClient: () => invoke("gmail_forget_client"),
  gmailRefresh: () => invoke("gmail_refresh"),
  gmailMarkRead: (id: string) => invoke("gmail_mark_read", { id }),
  gmailList: (query: string) => invoke<MailItem[]>("gmail_list", { query }),
  gmailReplyInfo: (id: string) => invoke<{ to: string; subject: string }>("gmail_reply_info", { id }),
  gmailReply: (id: string, body: string, mode: "send" | "draft") => invoke("gmail_reply", { id, body, mode }),
  claudeDraftReply: (email: string, guidance: string) => invoke<string>("claude_draft_reply", { email, guidance }),
  gmailMessageText: (id: string) => invoke<string>("gmail_message_text", { id }),

  calendarStatus: () => invoke<CalendarStatus | null>("calendar_status"),
  calendarRefresh: () => invoke("calendar_refresh"),

  updateCheck: () => invoke<UpdateInfo | null>("update_check"),
  updateInstall: () => invoke("update_install"),

  notifAccess: () => invoke<string>("notif_access"),
  notifDismiss: (winId: number) => invoke("notif_dismiss", { winId }),
  notifOpenApp: (aumid: string) => invoke("notif_open_app", { aumid }),
  notifOpenSettings: () => invoke("notif_open_settings"),
};

export const events = {
  onMedia: (cb: (m: Media | null) => void) => listen<Media | null>("media://update", (e) => cb(e.payload)),
  onPointer: (cb: (inside: boolean) => void) => listen<boolean>("island://pointer", (e) => cb(e.payload)),
  onCursor: (cb: (p: { x: number; y: number }) => void) =>
    listen<{ x: number; y: number }>("island://cursor", (e) => cb(e.payload)),
  onOccluded: (cb: (occluded: boolean) => void) => listen<boolean>("island://occluded", (e) => cb(e.payload)),
  onToggle: (cb: () => void) => listen("island://toggle", () => cb()),
  onQuickAdd: (cb: () => void) => listen("island://quick-add", () => cb()),
  onMicToggle: (cb: () => void) => listen("island://mic-toggle", () => cb()),
  onGithub: (cb: (s: GithubStatus) => void) => listen<GithubStatus>("github://status", (e) => cb(e.payload)),
  onClipboardShortcut: (cb: () => void) => listen("island://clipboard", () => cb()),
  onClipboard: (cb: (items: ClipItem[]) => void) => listen<ClipItem[]>("clipboard://changed", (e) => cb(e.payload)),
  onAlert: (cb: (a: Alert) => void) => listen<Alert>("island://alert", (e) => cb(e.payload)),
  onRemindersChanged: (cb: (r: Reminder[]) => void) =>
    listen<Reminder[]>("reminder://changed", (e) => cb(e.payload)),
  onReminderDue: (cb: (r: Reminder) => void) => listen<Reminder>("reminder://due", (e) => cb(e.payload)),
  onNotifStatus: (cb: (s: { access: string; error: string | null }) => void) =>
    listen<{ access: string; error: string | null }>("notifs://status", (e) => cb(e.payload)),
  onVolume: (cb: (v: Volume) => void) => listen<Volume>("system://volume", (e) => cb(e.payload)),
  onAudioDevice: (cb: (name: string) => void) => listen<string>("system://device", (e) => cb(e.payload)),
  onPower: (cb: (p: Power) => void) => listen<Power>("system://power", (e) => cb(e.payload)),
  onBluetooth: (cb: (list: BtBattery[]) => void) => listen<BtBattery[]>("system://bluetooth", (e) => cb(e.payload)),
  onPrivacy: (cb: (p: Privacy) => void) => listen<Privacy>("system://privacy", (e) => cb(e.payload)),
  onClaudePermission: (cb: (p: HookPayload & { id: string }) => void) =>
    listen<HookPayload & { id: string }>("claude://permission", (e) => cb(e.payload)),
  onClaudePermissionDone: (cb: (p: { id: string; decision: string }) => void) =>
    listen<{ id: string; decision: string }>("claude://permission-done", (e) => cb(e.payload)),
  onClaudeStatus: (cb: (s: Record<string, any>) => void) => listen<Record<string, any>>("claude://status", (e) => cb(e.payload)),
  onClaudeHook: (cb: (p: HookPayload) => void) => listen<HookPayload>("claude://hook", (e) => cb(e.payload)),
  onUpdateAvailable: (cb: (u: UpdateInfo) => void) => listen<UpdateInfo>("update://available", (e) => cb(e.payload)),
  onUpdateProgress: (cb: (pct: number) => void) => listen<number>("update://progress", (e) => cb(e.payload)),
  onCalendar: (cb: (s: CalendarStatus) => void) => listen<CalendarStatus>("calendar://status", (e) => cb(e.payload)),
  onGmail: (cb: (s: GmailStatus) => void) => listen<GmailStatus>("gmail://status", (e) => cb(e.payload)),
};

/** "ctrl+alt+i" → "Ctrl+Alt+I" */
export const prettyShortcut = (s: string | undefined) =>
  s ? s.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Space", "Espacio") : "";
