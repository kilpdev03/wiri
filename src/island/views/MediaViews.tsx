import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useNow } from "../../lib/hooks";
import { ipc, type Media } from "../../lib/ipc";
import { IconButton } from "../parts";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, RepeatOnceIcon, ShuffleIcon } from "../icons";

const KNOWN_APPS: [string, string][] = [
  ["spotify", "Spotify"],
  ["msedge", "Edge"],
  ["chrome", "Chrome"],
  ["firefox", "Firefox"],
  ["brave", "Brave"],
  ["helium", "Helium"],
  ["opera", "Opera"],
  ["vivaldi", "Vivaldi"],
  ["zen", "Zen"],
  ["arc", "Arc"],
  ["applemusic", "Apple Music"],
  ["tidal", "Tidal"],
  ["deezer", "Deezer"],
  ["vlc", "VLC"],
  ["zunemusic", "Reproductor"],
  ["media.player", "Reproductor"],
];

/**
 * Nombre legible de la app que reproduce, a partir de su AUMID o ejecutable:
 * "Spotify.exe" → "Spotify", "Helium.LXEKAZAIEYJ5..." → "Helium",
 * "C:\...\foobar2000.exe" → "foobar2000".
 */
export function appName(appId: string): string {
  const id = appId.toLowerCase();
  const known = KNOWN_APPS.find(([needle]) => id.includes(needle));
  if (known) return known[1];
  // Lo que va antes de "!" es el paquete; de una ruta, el ejecutable.
  const file = (appId.split("!")[0].split("\\").filter(Boolean).pop() ?? appId).replace(/\.exe$/i, "");
  // Descarta hashes ("LXEKAZAIEYJ5", "8wekyb3d8bbwe", "5319275A") y se queda con la última parte legible.
  const parts = file
    .split(/[._]/)
    .filter((p) => p && !/^[A-Z0-9]{8,}$/.test(p) && !/^[a-z0-9]{12,}$/.test(p) && !/^[0-9A-F]{6,}$/.test(p));
  const name = (parts.pop() ?? file).replace(/Desktop$/, "");
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

export function Artwork({ media, size, radius }: { media: Media; size: number; radius: number }) {
  return (
    <motion.div
      className="artwork"
      style={{ width: size, height: size, borderRadius: radius }}
      animate={{ scale: media.playing ? 1 : 0.9 }}
      transition={{ type: "spring", stiffness: 300, damping: 18 }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {media.artwork ? (
          <motion.img
            key={media.artwork.slice(-40)}
            src={media.artwork}
            initial={{ opacity: 0, scale: 1.25, rotate: -4 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          />
        ) : (
          <motion.div key="placeholder" className="artwork-placeholder">♪</motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Posición actual extrapolada desde la última lectura de Windows. */
export function usePosition(media: Media) {
  const now = useNow(250, media.playing);
  const elapsed = media.playing && media.updatedAtMs > 0 ? now - media.updatedAtMs : 0;
  return Math.min(media.durationMs, media.positionMs + elapsed);
}

/** Barra de progreso: clic o arrastre para buscar. */
export function Progress({ media, color }: { media: Media; color: string }) {
  const pos = usePosition(media);
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const ratio = drag ?? (media.durationMs > 0 ? pos / media.durationMs : 0);

  const ratioAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  return (
    <div className="progress">
      <span className="time">{fmt(drag !== null ? drag * media.durationMs : pos)}</span>
      <div
        ref={track}
        className={`track ${drag !== null ? "dragging" : ""}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(ratioAt(e.clientX));
        }}
        onPointerMove={(e) => drag !== null && setDrag(ratioAt(e.clientX))}
        onPointerUp={(e) => {
          const r = ratioAt(e.clientX);
          setDrag(null);
          ipc.mediaControl("seek", Math.round(r * media.durationMs));
        }}
      >
        <div className="track-bg" />
        <motion.div
          className="fill"
          style={{ background: `rgb(${color})` }}
          animate={{ scaleX: ratio }}
          transition={drag !== null ? { duration: 0 } : { duration: 0.25, ease: "linear" }}
        />
        <motion.div className="knob" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="time right">-{fmt(media.durationMs - (drag !== null ? drag * media.durationMs : pos))}</span>
    </div>
  );
}

export function PlayPause({ media, size = 40 }: { media: Media; size?: number }) {
  return (
    <IconButton onClick={() => ipc.mediaControl("toggle")} size={size} title="Reproducir o pausar (Espacio)" className="primary">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={media.playing ? "pause" : "play"}
          className="center"
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0, rotate: 30 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
        >
          {media.playing ? <PauseIcon size={size * 0.5} /> : <PlayIcon size={size * 0.5} />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

export function Controls({ media, extended = false }: { media: Media; extended?: boolean }) {
  return (
    <div className="controls">
      {extended && media.shuffle !== null && (
        <IconButton onClick={() => ipc.mediaControl("shuffle")} active={media.shuffle} title="Aleatorio" size={30}>
          <ShuffleIcon size={15} />
        </IconButton>
      )}
      <IconButton onClick={() => ipc.mediaControl("previous")} title="Anterior (←)">
        <PrevIcon size={17} />
      </IconButton>
      <PlayPause media={media} />
      <IconButton onClick={() => ipc.mediaControl("next")} title="Siguiente (→)">
        <NextIcon size={17} />
      </IconButton>
      {extended && media.repeat !== null && (
        <IconButton onClick={() => ipc.mediaControl("repeat")} active={media.repeat !== "none"} title="Repetir" size={30}>
          {media.repeat === "track" ? <RepeatOnceIcon size={15} /> : <RepeatIcon size={15} />}
        </IconButton>
      )}
    </div>
  );
}

/** Título y artista con transición al cambiar de canción. */
export function TrackInfo({ media, big = false }: { media: Media; big?: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={media.title + media.artist}
        className="min-w-0"
        initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className={`truncate ${big ? "title-lg" : "title"}`}>{media.title}</div>
        <div className="subtitle truncate">
          {[media.artist, big ? media.album : null].filter(Boolean).join(" · ") || appName(media.appId)}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
