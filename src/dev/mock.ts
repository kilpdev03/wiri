// Modo navegador (`pnpm dev`): simula el backend de Tauri para diseñar la isla
// sin compilar Rust. Nunca se carga dentro de la app real.
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Alert, CalEvent, CalendarStatus, GmailStatus, MailItem, Media, Reminder } from "../lib/ipc";

const now = Date.now();

const media: Media = {
  title: "Tití Me Preguntó",
  artist: "Bad Bunny",
  album: "Un Verano Sin Ti",
  appId: "Spotify.exe",
  playing: true,
  positionMs: 92_000,
  durationMs: 243_000,
  updatedAtMs: now,
  shuffle: false,
  repeat: "none",
  artwork:
    "data:image/svg+xml;base64," +
    btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cc7ff"/><stop offset="1" stop-color="#ff7eb3"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="62" cy="40" r="18" fill="#ffe17a"/></svg>`,
    ),
};

let reminders: Reminder[] = [
  { id: "r1", text: "Pomodoro", kind: "timer", createdMs: now - 600_000, dueMs: now + 900_000 },
  { id: "r2", text: "Llamar a Juan", kind: "reminder", createdMs: now, dueMs: now + 42 * 60_000 },
];

const mail = (id: string, fromName: string, fromEmail: string, subject: string, snippet: string, minsAgo: number, labels: string[]): MailItem => ({
  id,
  threadId: id,
  fromName,
  fromEmail,
  subject,
  snippet,
  dateMs: now - minsAgo * 60_000,
  url: "https://mail.google.com/",
  labels: ["UNREAD", "INBOX", ...labels],
});

const demoMails: MailItem[] = [
  mail("m1", "Camila Rojas", "camila@estudio.cl", "Re: Propuesta landing", "¡Nos encantó! ¿Podemos agendar una llamada el jueves?", 4, ["CATEGORY_PERSONAL", "IMPORTANT"]),
  mail("m2", "GitHub", "noreply@github.com", "[tienda-online] PR #42 aprobado", "fran aprobó tus cambios en feat/checkout", 38, ["CATEGORY_UPDATES"]),
  mail("m3", "Mercado Pago", "info@mercadopago.cl", "Recibiste un pago", "Recibiste $45.000 de Juan Pérez", 95, ["CATEGORY_UPDATES", "IMPORTANT"]),
  mail("m4", "Municipalidad de Ejemplo", "contacto@municipio.cl", "Reunión de seguimiento", "Confirmamos la reunión para revisar el dashboard", 260, ["CATEGORY_PERSONAL", "STARRED", "IMPORTANT"]),
  mail("m5", "LinkedIn", "news@linkedin.com", "Tienes 3 nuevas invitaciones", "Personas que quizá conozcas en Santiago", 300, ["CATEGORY_SOCIAL"]),
  mail("m6", "Falabella", "ofertas@falabella.cl", "CyberDay: hasta 60% dcto.", "Solo por hoy en tecnología y hogar", 420, ["CATEGORY_PROMOTIONS"]),
  mail("m7", "Mamá", "mama@ejemplo.cl", "Fotos del asado", "Te mando las fotos del domingo", 600, ["CATEGORY_PERSONAL"]),
];

let gmail: GmailStatus = { configured: false, connected: false, email: null, unreadCount: 0, messages: [], error: null, lastSyncMs: 0 };

function setGmail(patch: Partial<GmailStatus>) {
  gmail = { ...gmail, ...patch };
  emit("gmail://status", gmail);
  return null;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ev = (id: string, summary: string, inMin: number, durMin: number, joinUrl: string | null, location: string | null = null): CalEvent => ({
  id,
  summary,
  start: iso(now + inMin * 60_000),
  end: iso(now + (inMin + durMin) * 60_000),
  allDay: false,
  joinUrl,
  htmlLink: "https://calendar.google.com/",
  location,
});
const today = new Date(now);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const calendar: CalendarStatus = {
  status: "ok",
  error: null,
  lastSyncMs: now,
  events: [
    { id: "allday", summary: "Entrega landing Sushi La Reina", start: ymd(today), end: ymd(new Date(now + 86_400_000)), allDay: true, joinUrl: null, htmlLink: "https://calendar.google.com/", location: null },
    ev("c1", "Daily Simple Soluciones", 7, 15, "https://meet.google.com/abc-defg-hij"),
    ev("c2", "Revisión dashboard municipal", 120, 60, "https://zoom.us/j/123456789", "Zoom"),
    ev("c3", "Gimnasio", 300, 60, null, "Smart Fit Providencia"),
  ],
};

const audioOut = ["2D HD LG TV (NVIDIA High Definition Audio)", "Auriculares (2- BLIK-SOUL900)", "Altavoces (Realtek(R) Audio)"];
const audioIn = ["Micrófono (2- BLIK-SOUL900)", "Micrófono (Realtek(R) Audio)"];
let defaultOut = 0;
let defaultIn = 0;

export const demoAlerts: Record<string, Alert> = {
  notification: { id: "", kind: "notification", app: "WhatsApp", title: "Mamá", body: "¿Vienes a almorzar el domingo? 🍲" },
  mail: { id: "", kind: "mail", app: "Gmail", title: "Camila Rojas", body: "Re: Propuesta landing — ¡Nos encantó! ¿Podemos agendar una llamada?" },
  reminder: {
    id: "",
    kind: "reminder",
    title: "Sacar la ropa",
    body: "Programado para las 18:30",
    reminder: { id: "rx", text: "Sacar la ropa", kind: "reminder", createdMs: now, dueMs: now },
  },
};

export function installMock() {
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "current_media":
          return { ...media };
        case "list_reminders":
          return reminders;
        case "shortcuts":
          return { toggle: "ctrl+alt+i", "quick-add": "ctrl+shift+space" };
        case "gmail_list": {
          // Búsqueda simulada: no leídos + algunos leídos, filtrados por texto.
          const read = (m: MailItem): MailItem => ({ ...m, labels: m.labels.filter((l) => l !== "UNREAD") });
          const all = [
            ...gmail.messages,
            read(mail("r1", "Fran Soto", "fran@ejemplo.cl", "Deploy del portal listo", "Ya quedó en producción la versión 2.3", 1500, ["CATEGORY_PERSONAL"])),
            read(mail("r2", "Google Cloud", "noreply@google.com", "Tu factura de octubre", "El monto de este mes es USD 4,12", 3000, ["CATEGORY_UPDATES"])),
          ];
          const q = String(a.query ?? "").toLowerCase().replace("in:inbox", "").replace("is:unread", "").trim();
          const unreadOnly = String(a.query ?? "").includes("is:unread");
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  all.filter(
                    (m) =>
                      (!unreadOnly || m.labels.includes("UNREAD")) &&
                      (!q || `${m.fromName} ${m.subject} ${m.snippet}`.toLowerCase().includes(q)),
                  ),
                ),
              350,
            ),
          );
        }
        case "gmail_reply_info":
          return { to: "camila@estudio.cl", subject: "Re: Propuesta landing" };
        case "gmail_reply":
          return new Promise((resolve) => setTimeout(() => resolve(null), 500));
        case "claude_draft_reply":
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  [
                    "Hola Camila:",
                    "",
                    "Gracias por escribir. El jueves me acomoda para revisar la propuesta; ¿te parece a las [hora]?",
                    "",
                    "Saludos,",
                    "Kevin",
                  ].join("\n"),
                ),
              1200,
            ),
          );
        case "gmail_message_text":
          return [
            "Hola Kevin,",
            "",
            "En el portal municipal el gráfico de asistencia no carga desde ayer y aparece un error 500 al filtrar por mes.",
            "",
            "¿Lo pueden revisar?",
            "",
            "Saludos,",
            "Equipo Municipalidad",
          ].join("\n");
        case "claude_projects":
          return [
            { path: "C:/Users/demo/Proyectos/wiri", name: "wiri", lastUsedMs: Date.now() },
            { path: "C:/Users/demo/Proyectos/portal-municipal", name: "portal-municipal", lastUsedMs: Date.now() - 86_400_000 },
            { path: "C:/Users/demo/Proyectos/tienda-online", name: "tienda-online", lastUsedMs: Date.now() - 2 * 86_400_000 },
          ];
        case "claude_launch":
          return new Promise((resolve) => setTimeout(() => resolve("C:/encargo.md"), 600));
        case "audio_devices":
          return {
            outputs: audioOut.map((name, i) => ({ id: `out${i}`, name, isDefault: i === defaultOut })),
            inputs: audioIn.map((name, i) => ({ id: `in${i}`, name, isDefault: i === defaultIn })),
          };
        case "audio_set_default": {
          const id = String(a.id);
          if (id.startsWith("out")) {
            defaultOut = Number(id.slice(3));
            emit("system://device", audioOut[defaultOut]);
          } else defaultIn = Number(id.slice(2));
          return null;
        }
        case "calendar_status":
          return calendar;
        case "calendar_refresh":
          return null;
        case "gmail_status":
          return gmail;
        case "gmail_set_client":
          if (!String(a.clientId).endsWith(".apps.googleusercontent.com")) {
            throw "El Client ID debe terminar en .apps.googleusercontent.com";
          }
          return setGmail({ configured: true });
        case "gmail_connect":
          return new Promise((resolve) =>
            setTimeout(() => {
              setGmail({ connected: true, email: "kevin@ejemplo.cl", unreadCount: demoMails.length, messages: demoMails, lastSyncMs: Date.now() });
              resolve("kevin@ejemplo.cl");
            }, 1800),
          );
        case "gmail_disconnect":
          return setGmail({ connected: false, email: null, messages: [], unreadCount: 0 });
        case "gmail_forget_client":
          return setGmail({ configured: false, connected: false, email: null, messages: [], unreadCount: 0 });
        case "gmail_refresh":
          return setGmail({ lastSyncMs: Date.now() });
        case "gmail_mark_read": {
          const messages = gmail.messages.filter((m) => m.id !== a.id);
          return setGmail({ messages, unreadCount: messages.length });
        }
        case "media_control":
          if (a.action === "toggle") media.playing = !media.playing;
          if (a.action === "shuffle") media.shuffle = !media.shuffle;
          if (a.action === "repeat") media.repeat = media.repeat === "none" ? "list" : media.repeat === "list" ? "track" : "none";
          if (a.action === "seek") media.positionMs = a.positionMs as number;
          media.updatedAtMs = Date.now();
          emit("media://update", { ...media });
          return null;
        case "add_reminder": {
          const r: Reminder = { id: String(Math.random()), text: a.text as string, kind: a.kind as Reminder["kind"], createdMs: Date.now(), dueMs: a.dueMs as number };
          reminders = [...reminders, r].sort((x, y) => x.dueMs - y.dueMs);
          emit("reminder://changed", reminders);
          return r;
        }
        case "remove_reminder":
          reminders = reminders.filter((r) => r.id !== a.id);
          emit("reminder://changed", reminders);
          return null;
        case "plugin:app|version":
          return "0.2.0";
        case "update_install":
          // Simula la descarga; en la app real el instalador cierra y reabre Wiri.
          return new Promise<void>((resolve) => {
            let pct = 0;
            const id = setInterval(() => {
              pct = Math.min(100, pct + 20);
              emit("update://progress", pct);
              if (pct === 100) {
                clearInterval(id);
                resolve();
              }
            }, 300);
          });
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}

/** Dispara eventos como lo haría Rust (para la barra de pruebas). */
export const demo = {
  alert: (kind: keyof typeof demoAlerts) => emit("island://alert", { ...demoAlerts[kind], id: `demo-${Date.now()}` }),
  promoMail: () =>
    emit("island://alert", { id: `demo-${Date.now()}`, kind: "mail", app: "Gmail", title: "Falabella", body: "CyberDay: hasta 60% dcto.", labels: ["CATEGORY_PROMOTIONS"] }),
  reminderDue: () => emit("reminder://due", demoAlerts.reminder.reminder),
  hover: (inside: boolean) => emit("island://pointer", inside),
  occluded: (on: boolean) => emit("island://occluded", on),
  volume: () => emit("system://volume", { level: Math.round(Math.random() * 100), muted: false }),
  mute: () => emit("system://volume", { level: 40, muted: true }),
  device: () => emit("system://device", "Audífonos Bluetooth"),
  power: (() => {
    let charging = false;
    let first = true;
    return () => {
      if (first) emit("system://power", { hasBattery: true, charging, percent: 64 });
      first = false;
      charging = !charging;
      setTimeout(() => emit("system://power", { hasBattery: true, charging, percent: 64 }), 50);
    };
  })(),
  mic: (() => {
    let on = false;
    return () => {
      on = !on;
      emit("system://privacy", { mic: on ? ["Teams"] : [], cam: [] });
    };
  })(),
  update: () => emit("update://available", { version: "0.3.0", current: "0.2.0", notes: "Responder correos con Claude\nArreglos varios" }),
  toggle: () => emit("island://toggle", null),
  quickAdd: () => emit("island://quick-add", null),
  noMedia: () => emit("media://update", null),
  media: () => emit("media://update", { ...media, updatedAtMs: Date.now() }),
};
