import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Barras de ecualizador que "bailan" mientras suena algo. */
export function Bars({ playing, color, height = 14 }: { playing: boolean; color: string; height?: number }) {
  const patterns = [
    [0.35, 1, 0.5, 0.85, 0.35],
    [0.8, 0.4, 1, 0.3, 0.8],
    [0.5, 0.9, 0.35, 1, 0.5],
    [0.9, 0.3, 0.75, 0.45, 0.9],
  ];
  return (
    <div className="bars" style={{ height }}>
      {patterns.map((p, i) => (
        <motion.span
          key={i}
          style={{ background: `rgb(${color})` }}
          animate={{ scaleY: playing ? p : 0.22 }}
          transition={
            playing
              ? { duration: 0.9 + i * 0.13, repeat: Infinity, ease: "easeInOut" }
              : { type: "spring", stiffness: 300, damping: 20 }
          }
        />
      ))}
    </div>
  );
}

/** Anillo de progreso (1 = lleno). */
export function Ring({
  progress,
  size,
  stroke = 3,
  color = "#ff9f0a",
  children,
}: {
  progress: number;
  size: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size, color }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity={0.22} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, progress))) }}
          transition={{ duration: 0.5, ease: "linear" }}
          style={{ rotate: -90, transformOrigin: "50% 50%" }}
        />
      </svg>
      {children && <div className="ring-inner">{children}</div>}
    </div>
  );
}

/** Botón redondo con rebote al presionar. */
export function IconButton({
  onClick,
  children,
  size = 32,
  className = "",
  title,
  active = false,
}: {
  onClick: () => void;
  children: ReactNode;
  size?: number;
  className?: string;
  title?: string;
  active?: boolean;
}) {
  return (
    <motion.button
      className={`icon-btn ${active ? "active" : ""} ${className}`}
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.82 }}
      transition={{ type: "spring", stiffness: 500, damping: 18 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </motion.button>
  );
}

/** Tecla de atajo dibujada como chip. */
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

/** Contenedor de tarjeta del panel, con entrada escalonada. */
export function Card({
  children,
  className = "",
  index = 0,
  onClick,
  style,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      className={`card ${onClick ? "clickable" : ""} ${className}`}
      style={style}
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.04 + index * 0.05 }}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

/** Estado vacío con invitación. */
export function Empty({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="title">{title}</div>
      <div className="subtitle">{body}</div>
      {children}
    </div>
  );
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return "ahora";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(at).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

/** Selector segmentado con indicador deslizante. */
export function Segmented<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: Record<T, { label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {(Object.keys(options) as T[]).map((key) => (
        <button key={key} className={`seg ${key === value ? "active" : ""}`} onClick={() => onChange(key)}>
          {key === value && <motion.span layoutId={`seg-${id}`} className="seg-bg" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          <span className="rel">{options[key].label}</span>
        </button>
      ))}
    </div>
  );
}
