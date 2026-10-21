/** Opciones de apariencia de la isla y su aplicación como variables CSS. */

export type IslandColor = "black" | "graphite" | "midnight" | "purple" | "forest" | "wine" | "white";
export type Accent = "lilac" | "mint" | "coral" | "sky" | "amber" | "pink";
export type IslandSize = "small" | "normal" | "large";
export type IslandShape = "round" | "soft" | "square";
export type Anchor = "left" | "center" | "right";

/** `light`: fondo claro → texto e íconos oscuros. */
export const ISLAND_COLORS: Record<IslandColor, { label: string; rgb: string; light?: boolean }> = {
  black: { label: "Negro", rgb: "0, 0, 0" },
  graphite: { label: "Grafito", rgb: "52, 52, 60" },
  midnight: { label: "Azul noche", rgb: "22, 40, 96" },
  purple: { label: "Morado", rgb: "74, 30, 128" },
  forest: { label: "Bosque", rgb: "18, 72, 52" },
  wine: { label: "Vino", rgb: "108, 22, 48" },
  white: { label: "Blanco", rgb: "246, 246, 248", light: true },
};

export const ACCENTS: Record<Accent, { label: string; rgb: string }> = {
  lilac: { label: "Lila", rgb: "185, 167, 255" },
  mint: { label: "Menta", rgb: "120, 230, 190" },
  coral: { label: "Coral", rgb: "255, 145, 125" },
  sky: { label: "Celeste", rgb: "110, 190, 255" },
  amber: { label: "Ámbar", rgb: "255, 200, 95" },
  pink: { label: "Rosa", rgb: "255, 145, 205" },
};

export const SIZES: Record<IslandSize, { label: string; scale: number }> = {
  small: { label: "Compacta", scale: 0.9 },
  normal: { label: "Normal", scale: 1 },
  large: { label: "Grande", scale: 1.15 },
};

/** Multiplicador de los radios de las esquinas. */
export const SHAPES: Record<IslandShape, { label: string; radius: number }> = {
  round: { label: "Redondeada", radius: 1 },
  soft: { label: "Suave", radius: 0.6 },
  square: { label: "Recta", radius: 0.3 },
};

/** Posición horizontal del centro de la isla, como fracción del ancho de la pantalla. */
export const ANCHORS: Record<Anchor, { label: string; fraction: number }> = {
  left: { label: "Izquierda", fraction: 0.22 },
  center: { label: "Centro", fraction: 0.5 },
  right: { label: "Derecha", fraction: 0.78 },
};

export type Appearance = {
  islandColor: IslandColor;
  accent: Accent;
  size: IslandSize;
  shape: IslandShape;
  /** 0.7 – 1 */
  opacity: number;
  anchor: Anchor;
  /** Halo de color de la carátula mientras suena música. */
  glow: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = {
  islandColor: "black",
  accent: "lilac",
  size: "normal",
  shape: "round",
  opacity: 1,
  anchor: "center",
  glow: true,
};

/** Vuelca la apariencia en variables CSS (`--island`, `--accent-rgb`...). */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement.style;
  const island = ISLAND_COLORS[a.islandColor] ?? ISLAND_COLORS.black;
  root.setProperty("--island-rgb", island.rgb);
  root.setProperty("--fg-rgb", island.light ? "22, 22, 30" : "255, 255, 255");
  root.setProperty("--island-alpha", String(a.opacity));
  root.setProperty("--accent-rgb", ACCENTS[a.accent].rgb);
}
