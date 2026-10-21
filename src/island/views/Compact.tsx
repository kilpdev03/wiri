import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useNow } from "../../lib/hooks";
import { prettyShortcut, type CalEvent, type Media, type Reminder } from "../../lib/ipc";
import { formatClock, formatCountdown } from "../../lib/parseReminder";
import { useIsland } from "../../store/islandStore";
import { Mascot, type Mood } from "../Mascot";
import { Bars } from "../parts";
import { BellIcon, CalendarIcon, CameraIcon, ChatIcon, MailIcon, MicIcon, SparkIcon, TimerIcon } from "../icons";
import { untilLabel } from "../../lib/calendar";
import { Artwork } from "./MediaViews";

/** Indicador pequeño a la derecha de la barra compacta. */
function Chip({ children, color }: { children: ReactNode; color: string }) {
  return (
    <motion.span
      layout
      className="chip"
      style={{ color }}
      initial={{ opacity: 0, scale: 0.4, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.4 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
    >
      {children}
    </motion.span>
  );
}

/**
 * Barra compacta pegada al borde: mascota (y canción) a la izquierda,
 * indicadores de actividad a la derecha. Con `peek` muestra además reloj y atajo.
 */
export function Compact({
  media,
  timer,
  next,
  meeting,
  mood,
  color,
  peek,
}: {
  media: Media | null;
  timer: Reminder | undefined;
  next: Reminder | undefined;
  meeting: CalEvent | undefined;
  mood: Mood;
  color: string;
  peek: boolean;
}) {
  const unseen = useIsland((s) => s.unseen);
  // Solo correos nuevos desde la última vez que abriste Correo (no el total de la bandeja).
  const mailCount = unseen.mail;
  const privacy = useIsland((s) => s.privacy);
  const privacyApp = privacy.cam[0] ?? privacy.mic[0];
  const fiveHour = useIsland((s) => s.claudeUsage?.fiveHour);
  // La sesión de Claude más urgente: primero la que te necesita, luego la que trabaja.
  const claude = useIsland((s) => {
    const all = Object.values(s.claude);
    return all.find((c) => c.status === "waiting") ?? all.find((c) => c.status === "working");
  });
  const shortcut = useIsland((s) => s.shortcuts.toggle);
  const showMascot = useIsland((s) => s.prefs.mascot);
  const now = useNow(1000);

  return (
    <div className="compact">
      <div className="row gap-8 min-w-0">
        {showMascot && <Mascot size={34} mood={mood} color={mood === "dance" ? color : undefined} />}
        {media && (
          <div className="row gap-8 min-w-0">
            <Artwork media={media} size={20} radius={6} />
            <Bars playing={media.playing} color={color} height={12} />
            {peek && <span className="caption truncate" style={{ maxWidth: 120 }}>{media.title}</span>}
          </div>
        )}
        {!media && peek && <span className="title tabular">{formatClock(now)}</span>}
      </div>

      <div className="row gap-6">
        <AnimatePresence>
          {timer && (
            <Chip key="timer" color="#ff9f0a">
              <TimerIcon size={12} /> {formatCountdown(timer.dueMs - now)}
            </Chip>
          )}
          {fiveHour && fiveHour.pct >= 80 && (
            <Chip key="usage" color={fiveHour.pct >= 95 ? "#ff453a" : "#ff9f0a"}>
              <SparkIcon size={12} /> 5 h {Math.round(fiveHour.pct)} %
            </Chip>
          )}
          {claude && (
            <Chip key="claude" color={claude.status === "waiting" ? "#ff9f0a" : "#d97757"}>
              <SparkIcon size={12} />
              <span className="truncate" style={{ maxWidth: 130 }}>
                {claude.status === "waiting" ? "Te necesita" : claude.activity ?? claude.project}
              </span>
            </Chip>
          )}
          {privacyApp && (
            <Chip key="privacy" color={privacy.cam.length ? "#30d158" : "#ff9f0a"}>
              {privacy.cam.length ? <CameraIcon size={12} /> : <MicIcon size={12} />} {privacyApp}
            </Chip>
          )}
          {meeting && (
            <Chip key="meeting" color="#8ab4f8">
              <CalendarIcon size={12} /> {untilLabel(meeting, now).replace("en ", "")}
            </Chip>
          )}
          {next && !timer && !meeting && (
            <Chip key="next" color="#ffd60a">
              <BellIcon size={12} /> {formatClock(next.dueMs)}
            </Chip>
          )}
          {mailCount > 0 && (
            <Chip key="mail" color="#ff6b5e">
              <MailIcon size={12} /> {mailCount}
            </Chip>
          )}
          {unseen.notification > 0 && (
            <Chip key="notif" color="#5ac8fa">
              <ChatIcon size={12} /> {unseen.notification}
            </Chip>
          )}
          {peek && (
            <Chip key="hint" color="var(--text-faint)">
              {shortcut ? prettyShortcut(shortcut) : "clic"}
            </Chip>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
