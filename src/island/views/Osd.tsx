import { motion } from "motion/react";
import type { Osd as OsdData } from "../../store/islandStore";
import { BoltIcon, HeadphonesIcon, VolumeIcon, VolumeOffIcon } from "../icons";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 30 };

/** Batería dibujada, con relleno animado y rayo si está cargando. */
function Battery({ percent, charging }: { percent: number; charging: boolean }) {
  const color = charging ? "#30d158" : percent <= 20 ? "#ff453a" : "var(--text)";
  return (
    <span className="battery">
      <span className="battery-body">
        <motion.span
          className="battery-fill"
          style={{ background: color }}
          initial={{ width: "0%" }}
          animate={{ width: `${Math.max(6, percent)}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.1 }}
        />
        {charging && (
          <motion.span
            className="battery-bolt"
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: [0, 1.4, 1], rotate: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <BoltIcon size={11} />
          </motion.span>
        )}
      </span>
      <span className="battery-cap" />
    </span>
  );
}

/** Aviso breve del sistema: volumen, salida de audio, cargador, batería baja. */
export function Osd({ osd }: { osd: OsdData }) {
  if (osd.kind === "volume") {
    const { level, muted } = osd.volume;
    return (
      <div className="osd">
        <motion.span className="osd-icon" key={String(muted)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={SPRING}>
          {muted ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />}
        </motion.span>
        <div className="osd-track">
          <motion.div
            className="osd-fill"
            animate={{ width: `${muted ? 0 : level}%`, opacity: muted ? 0.35 : 1 }}
            transition={SPRING}
          />
        </div>
        <span className="osd-value">{muted ? "Silencio" : level}</span>
      </div>
    );
  }
  if (osd.kind === "device") {
    return (
      <div className="osd">
        <motion.span
          className="osd-icon"
          style={{ color: "#64d2ff" }}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={SPRING}
        >
          <HeadphonesIcon size={17} />
        </motion.span>
        <div className="col grow min-w-0">
          <span className="caption">Ahora suena en</span>
          <span className="text-sm truncate">{osd.name}</span>
        </div>
      </div>
    );
  }
  const { percent, charging } = osd.power;
  const low = osd.kind === "battery-low";
  return (
    <div className="osd">
      <Battery percent={percent} charging={charging} />
      <div className="col grow min-w-0">
        <span className="text-sm" style={{ color: low ? "#ff453a" : charging ? "#30d158" : undefined }}>
          {low ? "Batería baja" : charging ? "Cargando" : "Sin cargador"}
        </span>
        {low && <span className="caption">Conecta el cargador pronto</span>}
      </div>
      <span className="osd-value">{percent}%</span>
    </div>
  );
}
