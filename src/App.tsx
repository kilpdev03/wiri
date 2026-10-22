import { useEffect } from "react";
import { Island } from "./island/Island";
import { cursor } from "./lib/hooks";
import { events, ipc } from "./lib/ipc";
import { ANCHORS, applyAppearance } from "./lib/appearance";
import { startMs, timeRange, untilLabel } from "./lib/calendar";
import { agentMeta, applyHook, applyStatus, describePermission, formatDuration, normalizeHook, resetLabel, usageFromStatus, type ClaudeUsage } from "./lib/claude";
import { shouldAlert } from "./lib/mailFilters";
import { toggleMic } from "./lib/mic";
import { mondayRecapDue, recordHook, recordPermission } from "./lib/recap";
import { attachFiles } from "./lib/chat";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { startBuddy } from "./lib/buddy";
import { formatClock } from "./lib/parseReminder";
import { sounds } from "./lib/sounds";
import { onUpdateAvailable, onUpdateProgress } from "./lib/update";
import { useIsland } from "./store/islandStore";

/** Avisos de límite ya mostrados: "<reinicio>@80" y "<reinicio>@95". */
const usageAlerted = new Set<string>();

/** Avisa una vez al cruzar el 80 % y el 95 % del límite de 5 horas. */
function checkUsageAlerts(usage: ClaudeUsage) {
  const w = usage.fiveHour;
  if (!w) return;
  const threshold = w.pct >= 95 ? 95 : w.pct >= 80 ? 80 : 0;
  const key = `${w.resetsAtMs}@${threshold}`;
  if (!threshold || usageAlerted.has(key)) return;
  usageAlerted.add(key);
  usageAlerted.add(`${w.resetsAtMs}@80`);
  sounds.chime();
  useIsland.getState().pushAlert({
    id: `usage-${key}`,
    kind: "claude",
    app: "Claude · plan",
    title: `Llevas el ${Math.round(w.pct)} % de tu límite de 5 horas`,
    body: w.resetsAtMs ? `Se reinicia a las ${resetLabel(w.resetsAtMs)}` : "Modera el uso por un rato",
  });
}

/** Ya avisados: "<id>@10" (10 min antes) y "<id>@0" (al empezar). */
const meetingAlerts = new Set<string>();

/** Revisa cada 15 s si toca avisar de una reunión. */
function startMeetingAlerts() {
  const check = () => {
    const s = useIsland.getState();
    const now = Date.now();
    for (const e of s.calendar?.events ?? []) {
      if (e.allDay) continue;
      const start = startMs(e);
      const left = start - now;
      const stage = left <= 60_000 && left > -5 * 60_000 ? "0" : left <= 10 * 60_000 && left > 60_000 ? "10" : null;
      if (!stage || meetingAlerts.has(`${e.id}@${stage}`)) continue;
      meetingAlerts.add(`${e.id}@${stage}`);
      if (stage === "0") meetingAlerts.add(`${e.id}@10`);
      sounds.chime();
      s.pushAlert({
        id: `cal-${e.id}-${stage}`,
        kind: "calendar",
        app: "Calendario",
        title: e.summary,
        body: stage === "0" ? `Empieza ahora · ${timeRange(e)}` : `${untilLabel(e, now)[0].toUpperCase()}${untilLabel(e, now).slice(1)} · ${timeRange(e)}`,
        url: e.joinUrl ?? e.htmlLink,
        joinUrl: e.joinUrl,
      });
    }
  };
  check();
  // También al llegar eventos nuevos, para no esperar al siguiente intervalo.
  const unsub = useIsland.subscribe((st, prev) => st.calendar !== prev.calendar && check());
  const id = setInterval(check, 15_000);
  return () => {
    clearInterval(id);
    unsub();
  };
}

export default function App() {
  useEffect(() => {
    const s = useIsland.getState();

    // Apariencia: variables CSS y posición en el borde, en vivo al cambiar en Ajustes.
    const applyPrefs = (p: typeof s.prefs) => {
      applyAppearance(p);
      ipc.setAnchor(ANCHORS[p.anchor].fraction).catch(() => {});
      // Rust no guarda nada del portapapeles hasta que esto lo active.
      ipc.clipboardSetEnabled(p.clipboard).catch(() => {});
    };
    applyPrefs(s.prefs);
    const unsubPrefs = useIsland.subscribe((st, prev) => st.prefs !== prev.prefs && applyPrefs(st.prefs));

    ipc.currentMedia().then((m) => m && s.setMedia(m));
    ipc.listReminders().then(s.setReminders);
    ipc.shortcuts().then(s.setShortcuts);
    ipc.gmailStatus().then(s.setGmail);
    ipc.notifAccess().then(s.setNotifAccess);
    ipc.calendarStatus().then(s.setCalendar);
    ipc.claudeHooksStatus().then((h) => s.setClaudeHooks(h.installed));
    ipc.clipboardHistory().then(s.setClipboard);
    ipc.githubStatus().then((g) => g.updatedMs && s.setGithub(g));
    // Bolo del escritorio: vuelve a su lugar al arrancar y a la isla en las alertas.
    const unsubBuddy = startBuddy();

    const subs = [
      // Archivos arrastrados sobre la isla: se abre la "boca" y al soltar van al chat.
      getCurrentWebview().onDragDropEvent((e) => {
        const { type } = e.payload;
        if (type === "enter" || type === "over") useIsland.getState().dropHover || s.setDropHover(true);
        else if (type === "leave") s.setDropHover(false);
        else if (type === "drop") {
          s.setDropHover(false);
          if (e.payload.paths.length) attachFiles(e.payload.paths);
        }
      }),
      events.onMedia((m) => {
        // Se asoma unos segundos al cambiar de canción o al pausar/reanudar.
        const prev = useIsland.getState().media;
        if (m && (!prev || prev.title !== m.title || prev.playing !== m.playing)) s.flash(3500);
        s.setMedia(m);
      }),
      events.onPointer(s.setHovered),
      events.onOccluded(s.setOccluded),
      events.onCursor((p) => Object.assign(cursor, p)),
      events.onRemindersChanged((list) => {
        if (list.length > useIsland.getState().reminders.length) s.flash(3000);
        s.setReminders(list);
      }),
      events.onGmail(s.setGmail),
      events.onNotifStatus((st) => s.setNotifAccess(st.access)),
      events.onCalendar(s.setCalendar),
      events.onUpdateAvailable(onUpdateAvailable),
      events.onUpdateProgress(onUpdateProgress),
      events.onClaudePermission(({ id, event, ancestors, agent }) => {
        const st = useIsland.getState();
        // Desactivado en Ajustes: el permiso vuelve a la terminal al instante.
        recordPermission();
        if (!st.prefs.claudeApprove) return void ipc.claudePermissionRespond(id, "ask");
        const sessionId = String(event.session_id ?? "");
        const { sessions } = applyHook(st.claude, { event: { ...event, hook_event_name: "Notification", notification_type: "permission_prompt", message: `Permiso: ${event.tool_name}` }, ancestors, agent });
        s.setClaude(sessions);
        const { title, detail } = describePermission(event.tool_name, event.tool_input, agent);
        sounds.chime();
        s.pushAlert({
          id,
          kind: "claude",
          app: `${agentMeta(agent).name} · ${sessions[sessionId]?.project ?? ""}`,
          title,
          body: detail,
          ancestors,
          agent,
          permission: {
            id,
            sessionId,
            tool: String(event.tool_name ?? ""),
            detail,
            // En un plan, "Siempre" es aprobarlo aceptando las ediciones.
            canAlways: event.tool_name === "ExitPlanMode" || (Array.isArray(event.permission_suggestions) && event.permission_suggestions.length > 0),
            questions: event.tool_name === "AskUserQuestion" && Array.isArray(event.tool_input?.questions) ? event.tool_input.questions : undefined,
            plan: event.tool_name === "ExitPlanMode" ? String(event.tool_input?.plan ?? "") : undefined,
          },
        });
      }),
      // Decidido (aquí o en la terminal) o tiempo agotado: la tarjeta se va.
      events.onClaudePermissionDone(({ id }) => {
        const st = useIsland.getState();
        // Resuelto aquí o en la terminal: la sesión deja de "necesitarte" y sigue trabajando.
        const sessionId = st.alerts.find((a) => a.id === id)?.permission?.sessionId;
        const session = sessionId ? st.claude[sessionId] : undefined;
        if (session?.status === "waiting") {
          st.setClaude({ ...st.claude, [session.id]: { ...session, status: "working", activity: "Pensando…", message: null } });
        }
        st.dismissAlert(id);
      }),
      events.onClaudeStatus((status) => {
        const st = useIsland.getState();
        const next = applyStatus(st.claude, status);
        if (next !== st.claude) st.setClaude(next);
        const usage = usageFromStatus(status);
        if (usage) {
          st.setClaudeUsage(usage);
          checkUsageAlerts(usage);
        }
      }),
      events.onClaudeHook((payload) => {
        // Las redacciones de borradores (claude -p en la carpeta de Wiri) no son sesiones tuyas.
        // Igual el chat de la isla (claude -p en \Wiri\chat).
        const cwd = String(payload.event.cwd ?? "").toLowerCase();
        if (cwd.includes("\\wiri\\borradores") || cwd.includes("\\wiri\\chat")) return;
        const before = useIsland.getState().claude;
        const hook = normalizeHook(payload);
        recordHook(before[String(hook.event.session_id ?? "")], hook.event);
        const { sessions, alert, sessionId } = applyHook(before, hook);
        s.setClaude(sessions);
        if (!alert) return;
        // El aviso "necesita tu permiso" sobra si la tarjeta de permiso ya está en la isla.
        if (alert.kind === "needs" && useIsland.getState().alerts.some((a) => a.permission?.sessionId === sessionId)) return;
        if (alert.kind === "done") {
          sounds.done();
          s.react("happy");
        } else sounds.chime();
        s.pushAlert({
          id: `claude-${sessionId}-${Date.now()}`,
          kind: "claude",
          app: agentMeta(hook.agent).name,
          title: alert.title,
          body: alert.body,
          ancestors: sessions[sessionId!]?.ancestors,
          agent: hook.agent,
        });
      }),
      events.onVolume((volume) => {
        // No tapar el aviso de "Ahora suena en…" recién mostrado.
        const cur = useIsland.getState().osd;
        if (cur?.kind === "device" && cur.until - Date.now() > 1500) return;
        s.showOsd({ kind: "volume", volume }, 1600);
      }),
      events.onAudioDevice((name) => {
        s.showOsd({ kind: "device", name }, 2800);
        s.react("happy");
      }),
      events.onPower((power) => {
        const prev = useIsland.getState().power;
        s.setPower(power);
        if (!power.hasBattery || !prev) return;
        if (prev.charging !== power.charging) {
          s.showOsd({ kind: "power", power }, 2800);
          if (power.charging) s.react("happy");
        } else if (!power.charging && [20, 10].some((t) => prev.percent > t && power.percent <= t)) {
          sounds.chime();
          s.showOsd({ kind: "battery-low", power }, 6000);
          s.react("nope");
        }
      }),
      events.onBluetooth((list) => {
        const prev = useIsland.getState().bluetooth;
        s.setBluetooth(list);
        // Mismo umbral que la laptop: avisa al cruzar 20% y 10% (no al arrancar ni al reconectar).
        const low = list.find((d) => {
          const before = prev.find((p) => p.name === d.name);
          return before && [20, 10].some((t) => before.percent > t && d.percent <= t);
        });
        if (low) {
          sounds.chime();
          s.showOsd({ kind: "bt-low", device: low }, 6000);
          s.react("nope");
        }
      }),
      events.onPrivacy(s.setPrivacy),
      events.onAlert((a) => {
        const { prefs } = useIsland.getState();
        if (a.kind === "mail" && !shouldAlert(a.labels, prefs.mailAlerts)) return;
        if (a.kind === "notification") {
          if (a.app && prefs.mutedApps.includes(a.app)) return;
          // Con los hooks instalados, Wiri ya avisa de Claude Code con más detalle:
          // el aviso de Windows de la app de Claude sería un duplicado.
          if (useIsland.getState().claudeHooks && /^claude(\s|$)/i.test(a.app ?? "")) return s.logSilently(a);
          if (prefs.dnd) return s.logSilently(a);
        }
        sounds.pop();
        s.pushAlert(a);
      }),
      events.onReminderDue((r) => {
        sounds.chime();
        s.pushAlert({
          id: `reminder-${r.id}-${r.dueMs}`,
          kind: "reminder",
          title: r.kind === "timer" ? "¡Tiempo!" : r.text,
          body: r.kind === "timer" ? r.text : `Programado para las ${formatClock(r.dueMs)}`,
          reminder: r,
        });
      }),
      events.onToggle(() => {
        const st = useIsland.getState();
        if (st.open) {
          st.closePanel();
          ipc.releaseFocus();
        } else {
          st.openPanel();
          sounds.open();
          ipc.grabFocus();
        }
      }),
      events.onMicToggle(toggleMic),
      listen<boolean>("buddy://away", (e) => {
        const wasAway = useIsland.getState().buddyAway;
        s.setBuddyAway(e.payload);
        // Volvió a casa: la isla se asoma y Bolo aparece con un saltito.
        if (wasAway && !e.payload) {
          s.flash(2200);
          s.react("hello");
          sounds.boop();
        }
      }),
      events.onClipboard(s.setClipboard),
      events.onGithub(s.setGithub),
      events.onClipboardShortcut(() => {
        useIsland.getState().openPanel("clipboard");
        sounds.open();
        ipc.grabFocus();
      }),
      events.onQuickAdd(() => {
        useIsland.getState().setQuickAdd(true);
        ipc.grabFocus();
      }),
    ];
    const stopMeetings = startMeetingAlerts();
    // Sesiones de Claude sin eventos en la última hora (cerradas sin SessionEnd): fuera.
    // Los lunes: el resumen de la semana pasada, una sola vez.
    const checkRecap = () => {
      const recap = mondayRecapDue();
      if (!recap) return;
      s.pushAlert({
        id: `recap-${recap.from}`,
        kind: "claude",
        app: "Claude Code · tu semana",
        title: `${formatDuration(recap.ms)} con Claude la semana pasada`,
        body: `${recap.sessions} sesiones · ${recap.files} archivos · +${recap.added} −${recap.removed}${recap.topProject ? ` · más en ${recap.topProject}` : ""}`,
        recap: true,
      });
    };
    const recapTimer = setTimeout(checkRecap, 8_000);
    const recapInterval = setInterval(checkRecap, 3_600_000);
    const prune = setInterval(() => {
      const st = useIsland.getState();
      const cutoff = Date.now() - 3_600_000;
      const alive = Object.fromEntries(Object.entries(st.claude).filter(([, c]) => c.lastEventMs > cutoff));
      if (Object.keys(alive).length !== Object.keys(st.claude).length) st.setClaude(alive);
    }, 60_000);
    return () => {
      unsubPrefs();
      stopMeetings();
      clearInterval(prune);
      unsubBuddy();
      clearTimeout(recapTimer);
      clearInterval(recapInterval);
      subs.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);

  return <Island />;
}
