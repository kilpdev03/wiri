import { AnimatePresence, motion, useAnimationControls, type Transition } from "motion/react";
import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { nextMeeting, startMs } from "../lib/calendar";
import { ACCENTS, SHAPES, SIZES } from "../lib/appearance";
import { useDominantColor, useNow } from "../lib/hooks";
import { ipc } from "../lib/ipc";
import { sounds } from "../lib/sounds";
import { TABS, useIsland } from "../store/islandStore";
import type { Mood } from "./Mascot";
import { Panel, PANEL_H } from "./panel/Panel";
import { AlertView, PermissionCard, primaryAction, respondPermission } from "./views/AlertView";
import { Compact } from "./views/Compact";
import { Osd } from "./views/Osd";
import { QuickAdd } from "./views/QuickAdd";
import { PrivacyPip, Resting } from "./views/Resting";

/** Debe coincidir con el ancho de la ventana en tauri.conf.json. */
const STAGE_W = 860;
/** Radio de las "orejas" cóncavas que unen la isla con el borde de la pantalla. */
const EAR = 12;
/** Sin actividad ni mouse durante este tiempo, la mascota se duerme. */
const SLEEP_AFTER_MS = 120_000;

const SPRING: Transition = { type: "spring", stiffness: 380, damping: 30, mass: 0.9 };
const SPRING_BOUNCY: Transition = { type: "spring", stiffness: 420, damping: 22, mass: 0.8 };

type Mode = "hidden" | "compact" | "peek" | "panel" | "alert" | "input" | "osd";
type Shape = { w: number; h: number; r: number };

export function Island() {
  const state = useIsland();
  const { media, reminders, alerts, hovered, open, tab, pinned, quickAdd, prefs } = state;
  const color = useDominantColor(media?.artwork, ACCENTS[prefs.accent].rgb);
  const squash = useAnimationControls();
  const lastActivity = useRef(Date.now());
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  // OSD del sistema (volumen, audio, cargador): visible hasta `until`.
  const osd = state.osd && state.osd.until > Date.now() ? state.osd : null;
  useEffect(() => {
    if (!state.osd) return;
    const id = setTimeout(rerender, Math.max(0, state.osd.until - Date.now()) + 20);
    return () => clearTimeout(id);
  }, [state.osd]);
  const privacyOn = state.privacy.mic.length > 0 || state.privacy.cam.length > 0;

  const alert = alerts[0];
  const timer = reminders.find((r) => r.kind === "timer");
  const next = reminders.find((r) => r.kind === "reminder");
  const soon = next && next.dueMs - Date.now() < 3 * 3_600_000 ? next : undefined;
  // Próxima reunión en la siguiente hora (o en curso).
  const upcoming = nextMeeting(state.calendar?.events ?? []);
  const meeting = upcoming && startMs(upcoming) - Date.now() < 3_600_000 ? upcoming : undefined;
  // Una sesión de Claude que te espera cuenta como actividad (la que solo trabaja, no).
  const claudeWaiting = Object.values(state.claude).some((c) => c.status === "waiting");
  const hasActivity = !!(media || timer || soon || meeting || claudeWaiting || state.unseen.mail || state.unseen.notification);

  // Auto-ocultar: en reposo la isla vive dentro del borde y solo se asoma
  // con el mouse en el borde, por un evento (flash) o en los últimos segundos de un timer.
  const now = useNow(1000, !!timer || !!meeting || state.peekUntil > Date.now());
  const flashing = state.peekUntil > now;
  // Últimos 10 s de un timer o reunión en los próximos 5 min / recién empezada: se asoma igual.
  const meetingUrgent = !!meeting && startMs(meeting) - now < 5 * 60_000 && now - startMs(meeting) < 5 * 60_000;
  const timerUrgent = (!!timer && timer.dueMs - now < 10_000) || meetingUrgent;
  // Si una ventana ocupa el borde (navegador maximizado), solo alertas, mouse o timer urgente la sacan.
  const occluded = state.occluded && prefs.autoHide;
  const showCompact = hasActivity && (!prefs.autoHide || (flashing && !occluded) || timerUrgent);
  const showMascotRest = prefs.mascot && !occluded;

  const mode: Mode = quickAdd
    ? "input"
    : alert
      ? "alert"
      : open
        ? "panel"
        : osd
          ? "osd"
          : hovered
          ? "peek"
          : showCompact
            ? "compact"
            : "hidden";

  if (hovered || alert || open || media?.playing) lastActivity.current = Date.now();
  const asleep = !hasActivity && !hovered && Date.now() - lastActivity.current > SLEEP_AFTER_MS;
  const mood: Mood = alert ? "alert" : media?.playing ? "dance" : asleep ? "sleep" : "idle";

  let shape: Shape;
  let content: ReactNode = null;
  let key: string = mode;
  switch (mode) {
    case "input":
      shape = { w: 520, h: 56, r: 24 };
      content = <QuickAdd />;
      break;
    case "alert":
      shape = { w: 600, h: alert.permission ? 132 : alert.reminder ? 104 : 96, r: 28 };
      content = alert.permission ? (
        <PermissionCard alert={alert} queued={alerts.length - 1} />
      ) : (
        <AlertView alert={alert} queued={alerts.length - 1} />
      );
      key = `alert-${alert.id}`;
      break;
    case "panel":
      shape = { w: 680, h: PANEL_H[tab], r: 28 };
      content = <Panel mood={mood} color={color} onClose={() => closePanel(true)} />;
      break;
    case "osd":
      shape = osd!.kind === "volume" ? { w: 300, h: 40, r: 18 } : osd!.kind === "device" ? { w: 330, h: 48, r: 20 } : { w: 320, h: 46, r: 20 };
      content = <Osd osd={osd!} />;
      key = `osd-${osd!.kind}`;
      break;
    case "peek":
    case "compact":
      shape = mode === "peek" ? { w: 360, h: 42, r: 18 } : { w: 320, h: 38, r: 16 };
      content = <Compact media={media} timer={timer} next={soon} meeting={meeting} mood={mood} color={color} peek={mode === "peek"} />;
      key = "compact";
      break;
    default:
      if (showMascotRest) {
        // Reposo: la mascota se asoma desde el borde con indicadores mínimos.
        shape = { w: 150, h: 18, r: 9 };
        content = <Resting media={media} timer={timer} meeting={!!meeting} mood={mood} color={color} />;
        key = "resting";
      } else {
        if (privacyOn) {
          // Micrófono/cámara en uso: siempre visible, aunque haya una ventana arriba.
          shape = { w: 64, h: 16, r: 8 };
          content = <PrivacyPip privacy={state.privacy} />;
          key = "privacy";
        } else {
          // Tapada o sin mascota: solo una ranura fina pegada al borde.
          shape = { w: 110, h: 4, r: 4 };
        }
      }
  }

  // Tamaño y forma elegidos en Apariencia: la caja escala y el contenido se dibuja
  // a su tamaño base con `zoom`, así todo (texto incluido) crece en proporción.
  const scale = SIZES[prefs.size].scale;
  const base = shape;
  shape = { w: base.w * scale, h: base.h * scale, r: base.r * scale * SHAPES[prefs.shape].radius };

  const left = (STAGE_W - shape.w) / 2;
  const ear = Math.min(EAR * scale, shape.h);

  function closePanel(restoreFocus: boolean) {
    useIsland.getState().closePanel();
    if (restoreFocus) ipc.releaseFocus();
  }

  function openPanel() {
    const s = useIsland.getState();
    if (s.open) return;
    s.openPanel();
    sounds.open();
    ipc.grabFocus();
  }

  // Solo el área de la isla captura el mouse; el resto de la ventana es click-through.
  // En reposo la zona se limita a lo visible (o a 3 px si solo hay ranura): no roba
  // clics a las pestañas del navegador y basta con "tirar" el mouse arriba.
  useEffect(() => {
    if (mode === "hidden") {
      ipc.setHitRect(left - 40, 0, shape.w + 80, Math.max(3, shape.h));
      return;
    }
    const pad = 6;
    ipc.setHitRect(left - ear - pad, 0, shape.w + (ear + pad) * 2, shape.h + pad);
  }, [left, ear, shape.w, shape.h, mode]);

  // Abrir al pasar el mouse (opcional).
  useEffect(() => {
    if (!prefs.hoverOpen || !hovered || open || alert) return;
    const id = setTimeout(openPanel, 260);
    return () => clearTimeout(id);
  }, [prefs.hoverOpen, hovered, open, alert]);

  // Plegar al salir el mouse, salvo fijada o escribiendo.
  useEffect(() => {
    if (!open || pinned || hovered) return;
    const id = setTimeout(() => {
      if (document.activeElement?.tagName !== "INPUT") closePanel(true);
    }, 700);
    return () => clearTimeout(id);
  }, [open, pinned, hovered]);

  // Clic fuera (la ventana pierde el foco) también pliega.
  useEffect(() => {
    const onBlur = () => {
      const s = useIsland.getState();
      if (s.open && !s.pinned) s.closePanel();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // Teclado mientras la isla tiene el foco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useIsland.getState();
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      const current = s.alerts[0];
      if (current && !s.quickAdd) {
        // Permiso de Claude: Y/N/A (solo con la isla enfocada; nunca roba el foco).
        if (current.permission) {
          const key = e.key.toLowerCase();
          if (key === "y") respondPermission(current, "allow");
          else if (key === "n") respondPermission(current, "deny");
          else if (key === "a" && current.permission.canAlways) respondPermission(current, "always");
          else if (e.key === "Escape") respondPermission(current, "ask");
          return;
        }
        if (e.key === "Enter") primaryAction(current);
        if (e.key === "Escape") s.dismissAlert(current.id);
        return;
      }
      if (!s.open || typing) return;
      if (e.key === "Escape") closePanel(true);
      else if (/^[1-6]$/.test(e.key)) s.setTab(TABS[Number(e.key) - 1]);
      else if (e.key === " " && s.media) {
        e.preventDefault();
        ipc.mediaControl("toggle");
      } else if (e.key === "ArrowLeft" && s.media) ipc.mediaControl("previous");
      else if (e.key === "ArrowRight" && s.media) ipc.mediaControl("next");
      else if (e.key.toLowerCase() === "p") s.togglePin();
      else if (e.key.toLowerCase() === "n") s.setTab("reminders");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Squash & stretch cada vez que llega algo nuevo.
  useEffect(() => {
    if (!alert && !quickAdd) return;
    squash.start({
      scaleX: [1, 1.06, 0.98, 1.01, 1],
      scaleY: [1, 0.86, 1.06, 0.99, 1],
      transition: { duration: 0.6, ease: "easeOut" },
    });
  }, [alert?.id, quickAdd, squash]);

  const glow = prefs.glow && media?.playing && (mode === "compact" || mode === "peek" || mode === "panel") ? 0.22 : 0;
  const transition = mode === "alert" || mode === "panel" ? SPRING_BOUNCY : SPRING;
  const geometry = {
    left,
    width: shape.w,
    height: shape.h,
    borderBottomLeftRadius: shape.r,
    borderBottomRightRadius: shape.r,
  };

  return (
    <div className="stage">
      <motion.div className="group" animate={squash} style={{ transformOrigin: "50% 0%" }}>
        <motion.div
          className="island"
          initial={false}
          animate={{
            ...geometry,
            boxShadow: `0 10px 34px rgba(0,0,0,${mode === "hidden" ? 0 : 0.5}), 0 0 30px rgba(${color}, ${glow})`,
          }}
          transition={transition}
          onClick={() => (mode === "compact" || mode === "peek" || mode === "hidden") && openPanel()}
        >
          {/* Orejas cóncavas: funden la isla con el borde superior. */}
          <motion.span className="ear left" initial={false} animate={{ width: ear, height: ear }} transition={transition} />
          <motion.span className="ear right" initial={false} animate={{ width: ear, height: ear }} transition={transition} />

          <div className="clip">
            {/* Escondida con actividad: una línea de color avisa que hay algo. */}
            <AnimatePresence>
              {mode === "hidden" && !showMascotRest && !privacyOn && hasActivity && (
                <motion.span
                  className="sliver-accent"
                  style={{
                    background: state.privacy.cam.length
                      ? "#30d158"
                      : state.privacy.mic.length
                        ? "#ff9f0a"
                        : state.unseen.mail || state.unseen.notification
                          ? "#ff6b5e"
                          : `rgb(${color})`,
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  exit={{ scaleX: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 24 }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence mode="popLayout" initial={false}>
              {content && (
                <motion.div
                  key={key}
                  className="content"
                  style={{ width: base.w, height: base.h, x: "-50%", zoom: scale }}
                  initial={{ opacity: 0, scale: 0.92, y: -8, filter: "blur(8px)" }}
                  animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.95, filter: "blur(8px)", transition: { duration: 0.14 } }}
                  transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1], delay: 0.04 }}
                >
                  {content}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
