import type { CalEvent } from "./ipc";
import { formatClock } from "./parseReminder";

/** Inicio en ms. Los eventos de día completo ("2026-10-21") se toman a medianoche local. */
export function startMs(e: CalEvent): number {
  if (e.allDay) {
    const [y, m, d] = e.start.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(e.start).getTime();
}

export function endMs(e: CalEvent): number {
  if (e.allDay) {
    const [y, m, d] = e.end.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(e.end).getTime();
}

/** Próxima reunión con hora (en curso o futura). */
export function nextMeeting(events: CalEvent[], now = Date.now()): CalEvent | undefined {
  return events.find((e) => !e.allDay && endMs(e) > now);
}

export function isLive(e: CalEvent, now = Date.now()) {
  return startMs(e) <= now && endMs(e) > now;
}

export function timeRange(e: CalEvent): string {
  return e.allDay ? "Todo el día" : `${formatClock(startMs(e))}–${formatClock(endMs(e))}`;
}

/** "en 12 min", "en 2 h", "ahora", "hace 5 min". */
export function untilLabel(e: CalEvent, now = Date.now()): string {
  if (isLive(e, now)) return "ahora";
  const mins = Math.round((startMs(e) - now) / 60_000);
  if (mins <= 0) return "ahora";
  if (mins < 60) return `en ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `en ${h} h ${m} min` : `en ${h} h`;
}

/** Nombre del servicio de videollamada para el botón. */
export function joinLabel(url: string | null): string {
  if (!url) return "";
  if (url.includes("meet.google")) return "Meet";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("teams.")) return "Teams";
  return "Unirse";
}
