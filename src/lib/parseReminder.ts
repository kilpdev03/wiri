import type { Reminder } from "./ipc";

export type ParsedReminder = { text: string; kind: Reminder["kind"]; dueMs: number };

const UNIT = "(s|seg|segs|segundos?|m|min|mins|minutos?|h|hr|hrs|horas?)";
const NUM = "(\\d+(?:[.,]\\d+)?)";

function unitMs(unit: string | undefined): number {
  const u = (unit ?? "m").toLowerCase();
  if (u.startsWith("s")) return 1_000;
  if (u.startsWith("h")) return 3_600_000;
  return 60_000;
}

const amount = (n: string, unit?: string) => parseFloat(n.replace(",", ".")) * unitMs(unit);

function atClock(now: Date, hour: number, minute: number, ampm: string | undefined, tomorrow: boolean): number | null {
  let h = hour;
  if (ampm?.toLowerCase() === "pm" && h < 12) h += 12;
  if (ampm?.toLowerCase() === "am" && h === 12) h = 0;
  if (h > 23 || minute > 59) return null;
  const d = new Date(now);
  d.setHours(h, minute, 0, 0);
  if (tomorrow || d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Entiende frases cortas en español:
 * "pomodoro", "timer 10", "en 20 min sacar la ropa", "sacar la ropa en 20 min",
 * "a las 18:30 llamar a Juan", "mañana a las 9 pagar luz", "18:30 llamar".
 */
export function parseReminder(input: string, now = new Date()): ParsedReminder | null {
  const s = input.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const t = now.getTime();
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^pomodoro(?:\s+(\d+))?$/i))) {
    return { text: "Pomodoro", kind: "timer", dueMs: t + (m[1] ? +m[1] : 25) * 60_000 };
  }

  if ((m = s.match(new RegExp(`^(?:timer|temporizador)\\s+${NUM}\\s*${UNIT}?\\b\\s*(.*)$`, "i")))) {
    return { text: m[3] || "Temporizador", kind: "timer", dueMs: t + amount(m[1], m[2]) };
  }

  if ((m = s.match(new RegExp(`^(?:en\\s+)?${NUM}\\s*${UNIT}\\b\\s*(.*)$`, "i")))) {
    return { text: m[3] || "Recordatorio", kind: "reminder", dueMs: t + amount(m[1], m[2]) };
  }

  if ((m = s.match(new RegExp(`^(.+?)\\s+en\\s+${NUM}\\s*${UNIT}$`, "i")))) {
    return { text: m[1], kind: "reminder", dueMs: t + amount(m[2], m[3]) };
  }

  const clock = "(?:a\\s+las?\\s+(\\d{1,2})(?:[:.](\\d{2}))?|(\\d{1,2})[:.](\\d{2}))\\s*(am|pm)?";

  if ((m = s.match(new RegExp(`^(mañana\\s+)?${clock}\\s*(.*)$`, "i")))) {
    const due = atClock(now, +(m[2] ?? m[4]), +(m[3] ?? m[5] ?? 0), m[6], !!m[1]);
    return due ? { text: m[7] || "Recordatorio", kind: "reminder", dueMs: due } : null;
  }

  if ((m = s.match(new RegExp(`^(.+?)\\s+(mañana\\s+)?${clock}$`, "i")))) {
    const due = atClock(now, +(m[3] ?? m[5]), +(m[4] ?? m[6] ?? 0), m[7], !!m[2]);
    return due ? { text: m[1], kind: "reminder", dueMs: due } : null;
  }

  return null;
}

export const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
