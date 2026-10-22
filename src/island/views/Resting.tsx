import { motion } from "motion/react";
import type { Media, Privacy, Reminder } from "../../lib/ipc";
import { CameraIcon, MicIcon, MicOffIcon } from "../icons";
import { useIsland } from "../../store/islandStore";
import { Mascot, type Mood } from "../Mascot";
import { Bars } from "../parts";

const Dot = ({ color }: { color: string }) => (
  <motion.span
    className="rest-dot"
    style={{ background: color }}
    initial={{ scale: 0 }}
    animate={{ scale: [1, 1.35, 1] }}
    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
  />
);

/**
 * Reposo: la mascota se asoma desde el borde superior (solo se ven sus ojos)
 * con indicadores mínimos a los lados. Ocupa ~18 px de alto.
 */
export function Resting({
  media,
  timer,
  meeting,
  mood,
  color,
}: {
  media: Media | null;
  timer: Reminder | undefined;
  meeting: boolean;
  mood: Mood;
  color: string;
}) {
  const unseen = useIsland((s) => s.unseen);
  const privacy = useIsland((s) => s.privacy);
  const claudeState = useIsland((s) => {
    const all = Object.values(s.claude);
    return all.some((c) => c.status === "waiting") ? "waiting" : all.some((c) => c.status === "working") ? "working" : null;
  });
  return (
    <div className="resting">
      <span className="rest-side left">{media?.playing && <Bars playing color={color} height={8} />}</span>
      <div className="rest-mascot">
        <Mascot size={34} mood={mood} color={mood === "dance" ? color : undefined} />
      </div>
      <span className="rest-side right">
        {privacy.cam.length > 0 && <span className="privacy-dot cam" />}
        {privacy.mic.length > 0 && <span className="privacy-dot mic" />}
        {claudeState && <Dot color={claudeState === "waiting" ? "#ff9f0a" : "#d97757"} />}
        {meeting && <Dot color="#8ab4f8" />}
        {timer && <Dot color="#ff9f0a" />}
        {unseen.mail > 0 && <Dot color="#ff6b5e" />}
        {unseen.notification > 0 && <Dot color="#5ac8fa" />}
      </span>
    </div>
  );
}

/** Indicador mínimo de micrófono/cámara en uso cuando la isla está tapada. */
export function PrivacyPip({ privacy }: { privacy: Privacy }) {
  const cam = privacy.cam.length > 0;
  const mic = privacy.mic.length > 0;
  const apps = [...privacy.cam, ...privacy.mic].filter((a, i, all) => all.indexOf(a) === i).join(", ");
  return (
    <div className="privacy-pip" title={`En uso por ${apps}`}>
      {cam && (
        <span className="pip cam">
          <span className="privacy-dot cam" />
          <CameraIcon size={10} />
        </span>
      )}
      {mic && (
        <span className={`pip mic ${privacy.micMuted ? "muted" : ""}`}>
          <span className="privacy-dot mic" />
          {privacy.micMuted ? <MicOffIcon size={10} /> : <MicIcon size={10} />}
        </span>
      )}
    </div>
  );
}
