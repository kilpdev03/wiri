import { create } from "zustand";
import type { Alert, AlertKind, BtBattery, CalendarStatus, ClipItem, GithubStatus, GmailStatus, MailItem, Media, Power, Privacy, Reminder, UpdateInfo, Volume } from "../lib/ipc";
import { DEFAULT_APPEARANCE, type Appearance } from "../lib/appearance";
import type { MailAlertMode, MailFilter } from "../lib/mailFilters";
import type { OutfitPref } from "../lib/outfits";
import type { ClaudeSession, ClaudeUsage } from "../lib/claude";

/** Menor número = más urgente. La música no compite: es actividad de fondo. */
const PRIORITY: Record<AlertKind, number> = { reminder: 0, claude: 1, notification: 1, mail: 2, calendar: 3, update: 4 };

export type Tab = "home" | "music" | "mail" | "reminders" | "notifications" | "claude" | "chat" | "clipboard" | "settings";
export const TABS: Tab[] = ["home", "music", "mail", "reminders", "notifications", "claude", "chat", "clipboard", "settings"];

export type ChatMsg = { role: "user" | "claude" | "error"; text: string; files?: string[] };
/** Charla con Claude desde la isla; `sessionId` la continúa en Claude Code. */
export type ChatState = { messages: ChatMsg[]; sessionId: string | null; pending: boolean; files: string[] };

/** Aviso breve del sistema (como el flyout de Windows, pero en la isla). */
export type Osd =
  | { kind: "volume"; volume: Volume }
  | { kind: "device"; name: string }
  | { kind: "power"; power: Power }
  | { kind: "battery-low"; power: Power }
  | { kind: "bt-low"; device: BtBattery }
  | { kind: "mic"; muted: boolean };

/** Reacciones puntuales de la mascota (las consume en su loop de animación). */
export type Reaction = "hello" | "jump" | "happy" | "nope";

type Prefs = Appearance & {
  sounds: boolean;
  hoverOpen: boolean;
  mascot: boolean;
  /** En reposo la isla se esconde en el borde superior (como Coucou) y solo se asoma. */
  autoHide: boolean;
  mailFilter: MailFilter;
  mailAlerts: MailAlertMode;
  /** Aprobar permisos de Claude Code desde la isla (si no, siguen en la terminal). */
  claudeApprove: boolean;
  /** Dónde abre "Resolver con Claude": la app de escritorio o la terminal. */
  claudeTarget: "app" | "terminal";
  /** No molestar: las notificaciones van al historial sin alerta. */
  dnd: boolean;
  /** Apps cuyas notificaciones se ignoran por completo. */
  mutedApps: string[];
  /** Guardar lo que copias (solo texto, en memoria). */
  clipboard: boolean;
  /** Ropa de la mascota ("auto": según la temporada). */
  outfit: OutfitPref;
};

const PREFS_KEY = "win-island:prefs";
const DEFAULT_PREFS: Prefs = {
  ...DEFAULT_APPEARANCE,
  sounds: true,
  hoverOpen: false,
  mascot: true,
  autoHide: true,
  mailFilter: "primary",
  mailAlerts: "primary",
  claudeApprove: true,
  claudeTarget: "app",
  dnd: false,
  mutedApps: [],
  clipboard: true,
  outfit: "auto",
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

type IslandStore = {
  media: Media | null;
  reminders: Reminder[];
  /** Cola de alertas; la primera es la que se muestra. */
  alerts: Alert[];
  /** Notificaciones y correos recibidos (más reciente primero). */
  history: Alert[];
  unseen: { mail: number; notification: number };
  shortcuts: Record<string, string>;
  gmail: GmailStatus;
  calendar: CalendarStatus | null;
  /** Sesiones de Claude Code por session_id. */
  claude: Record<string, ClaudeSession>;
  claudeHooks: boolean;
  /** Límites del plan de Claude (5 h y semana). */
  claudeUsage: ClaudeUsage | null;
  /** Versión nueva publicada; `progress` mientras se descarga (0–100). */
  update: (UpdateInfo & { progress: number | null; error: string | null }) | null;
  /** Correo abierto en "Resolver con Claude". */
  resolveMail: MailItem | null;
  osd: (Osd & { until: number }) | null;
  power: Power | null;
  bluetooth: BtBattery[];
  clipboard: ClipItem[];
  /** Resumen semanal de Claude abierto en la pestaña Claude. */
  recapOpen: boolean;
  chat: ChatState;
  github: GithubStatus | null;
  /** Bolo está en el escritorio (su ventana fuera de la isla). */
  buddyAway: boolean;
  /** Arrastrando archivos sobre la isla. */
  dropHover: boolean;
  privacy: Privacy;
  /** Acceso a las notificaciones de Windows: "allowed" | "denied" | "unspecified" | "error" | "unknown". */
  notifAccess: string;

  hovered: boolean;
  /** Una ventana usa el borde superior detrás de la isla (navegador maximizado...). */
  occluded: boolean;
  open: boolean;
  tab: Tab;
  pinned: boolean;
  quickAdd: boolean;
  reaction: { kind: Reaction; at: number } | null;
  /** Hasta cuándo (ms Unix) la isla se asoma aunque esté en auto-ocultar. */
  peekUntil: number;
  prefs: Prefs;

  setMedia: (m: Media | null) => void;
  setReminders: (r: Reminder[]) => void;
  setShortcuts: (s: Record<string, string>) => void;
  setGmail: (g: GmailStatus) => void;
  setCalendar: (c: CalendarStatus | null) => void;
  setClaude: (s: Record<string, ClaudeSession>) => void;
  setClaudeHooks: (installed: boolean) => void;
  setClaudeUsage: (u: ClaudeUsage) => void;
  setUpdate: (u: IslandStore["update"]) => void;
  setResolveMail: (m: MailItem | null) => void;
  showOsd: (osd: Osd, ms: number) => void;
  setPower: (p: Power) => void;
  setBluetooth: (list: BtBattery[]) => void;
  setClipboard: (items: ClipItem[]) => void;
  setRecapOpen: (open: boolean) => void;
  setChat: (patch: Partial<ChatState>) => void;
  setGithub: (g: GithubStatus) => void;
  setBuddyAway: (away: boolean) => void;
  setDropHover: (on: boolean) => void;
  setPrivacy: (p: Privacy) => void;
  setNotifAccess: (a: string) => void;
  /** Guarda en el historial sin mostrar alerta (No molestar). */
  logSilently: (a: Alert) => void;
  pushAlert: (a: Alert) => void;
  dismissAlert: (id: string) => void;
  /** La atendiste (Enter/Abrir): sale de la cola, del historial y del contador de no vistos. */
  resolveAlert: (alert: Alert) => void;
  removeFromHistory: (id: string) => void;
  clearHistory: (kind: AlertKind) => void;
  setHovered: (h: boolean) => void;
  setOccluded: (o: boolean) => void;
  openPanel: (tab?: Tab) => void;
  closePanel: () => void;
  setTab: (tab: Tab) => void;
  togglePin: () => void;
  setQuickAdd: (open: boolean) => void;
  react: (kind: Reaction) => void;
  flash: (ms: number) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

function markSeen(unseen: IslandStore["unseen"], tab: Tab): IslandStore["unseen"] {
  if (tab === "mail") return { ...unseen, mail: 0 };
  if (tab === "notifications") return { ...unseen, notification: 0 };
  return unseen;
}

export const useIsland = create<IslandStore>((set) => ({
  media: null,
  reminders: [],
  alerts: [],
  history: [],
  unseen: { mail: 0, notification: 0 },
  shortcuts: {},
  notifAccess: "unknown",
  calendar: null,
  claude: {},
  claudeHooks: false,
  claudeUsage: null,
  update: null,
  resolveMail: null,
  osd: null,
  power: null,
  bluetooth: [],
  clipboard: [],
  recapOpen: false,
  chat: { messages: [], sessionId: null, pending: false, files: [] },
  github: null,
  buddyAway: false,
  dropHover: false,
  privacy: { mic: [], cam: [], micMuted: false },
  gmail: { configured: false, connected: false, email: null, unreadCount: 0, messages: [], error: null, lastSyncMs: 0 },

  hovered: false,
  occluded: false,
  open: false,
  tab: "home",
  pinned: false,
  quickAdd: false,
  reaction: null,
  peekUntil: 0,
  prefs: loadPrefs(),

  setMedia: (media) => set({ media }),
  setReminders: (reminders) => set({ reminders }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
  setGmail: (gmail) => set({ gmail }),
  setCalendar: (calendar) => set({ calendar }),
  setClaude: (claude) => set({ claude }),
  setClaudeHooks: (claudeHooks) => set({ claudeHooks }),
  setClaudeUsage: (claudeUsage) => set({ claudeUsage }),
  setUpdate: (update) => set({ update }),
  setResolveMail: (resolveMail) => set({ resolveMail }),
  showOsd: (osd, ms) => set({ osd: { ...osd, until: Date.now() + ms } }),
  setPower: (power) => set({ power }),
  setBluetooth: (bluetooth) => set({ bluetooth }),
  setClipboard: (clipboard) => set({ clipboard }),
  setRecapOpen: (recapOpen) => set({ recapOpen }),
  setChat: (patch) => set(({ chat }) => ({ chat: { ...chat, ...patch } })),
  setGithub: (github) => set({ github }),
  setBuddyAway: (buddyAway) => set({ buddyAway }),
  setDropHover: (dropHover) => set({ dropHover }),
  setPrivacy: (privacy) => set({ privacy }),
  setNotifAccess: (notifAccess) => set({ notifAccess }),
  logSilently: (incoming) =>
    set(({ history, unseen }) => {
      if (history.some((a) => a.id === incoming.id)) return {};
      const alert = { ...incoming, at: incoming.at ?? Date.now() };
      const kind = alert.kind as "mail" | "notification";
      return { history: [alert, ...history].slice(0, 60), unseen: { ...unseen, [kind]: unseen[kind] + 1 } };
    }),

  pushAlert: (incoming) =>
    set(({ alerts, history, unseen }) => {
      if (alerts.some((a) => a.id === incoming.id)) return {};
      const alert = { ...incoming, at: incoming.at ?? Date.now() };
      const logged = alert.kind === "mail" || alert.kind === "notification";
      const next = {
        history: logged ? [alert, ...history].slice(0, 60) : history,
        unseen: logged ? { ...unseen, [alert.kind]: unseen[alert.kind as "mail" | "notification"] + 1 } : unseen,
        reaction: { kind: "jump" as Reaction, at: Date.now() },
      };
      // La alerta visible no se interrumpe; las demás se ordenan por prioridad.
      const [current, ...rest] = alerts;
      if (!current) return { ...next, alerts: [alert] };
      const idx = rest.findIndex((a) => PRIORITY[a.kind] > PRIORITY[alert.kind]);
      const queue = idx === -1 ? [...rest, alert] : [...rest.slice(0, idx), alert, ...rest.slice(idx)];
      return { ...next, alerts: [current, ...queue] };
    }),
  dismissAlert: (id) => set(({ alerts }) => ({ alerts: alerts.filter((a) => a.id !== id) })),
  resolveAlert: (alert) =>
    set(({ alerts, history, unseen }) => {
      const logged = history.some((a) => a.id === alert.id);
      const kind = alert.kind === "mail" || alert.kind === "notification" ? alert.kind : null;
      return {
        alerts: alerts.filter((a) => a.id !== alert.id),
        history: history.filter((a) => a.id !== alert.id),
        unseen: logged && kind ? { ...unseen, [kind]: Math.max(0, unseen[kind] - 1) } : unseen,
      };
    }),
  removeFromHistory: (id) => set(({ history }) => ({ history: history.filter((a) => a.id !== id) })),
  clearHistory: (kind) => set(({ history }) => ({ history: history.filter((a) => a.kind !== kind) })),

  setHovered: (hovered) => set({ hovered }),
  setOccluded: (occluded) => set({ occluded }),
  openPanel: (tab) =>
    set((s) => {
      const t = tab ?? s.tab;
      return { open: true, tab: t, unseen: markSeen(s.unseen, t) };
    }),
  closePanel: () => set({ open: false }),
  setTab: (tab) => set((s) => ({ tab, unseen: markSeen(s.unseen, tab) })),
  togglePin: () => set((s) => ({ pinned: !s.pinned })),
  setQuickAdd: (quickAdd) => set({ quickAdd }),
  react: (kind) => set({ reaction: { kind, at: Date.now() } }),
  flash: (ms) => set((s) => ({ peekUntil: Math.max(s.peekUntil, Date.now() + ms) })),
  setPref: (key, value) =>
    set((s) => {
      const prefs = { ...s.prefs, [key]: value };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        /* almacenamiento no disponible */
      }
      return { prefs };
    }),
}));

// La isla y la mascota del escritorio son ventanas distintas con la misma página:
// un ajuste cambiado en una (ropa, acento…) llega a la otra por el evento `storage`.
window.addEventListener("storage", (e) => {
  if (e.key !== PREFS_KEY || !e.newValue) return;
  try {
    useIsland.setState({ prefs: { ...DEFAULT_PREFS, ...JSON.parse(e.newValue) } });
  } catch {
    /* JSON roto: se queda con lo que tenía */
  }
});
