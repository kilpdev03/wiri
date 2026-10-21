import { useEffect, useState } from "react";

/** `Date.now()` que se refresca cada `intervalMs` mientras `active` sea true. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/** Posición del cursor en px CSS de la ventana (la actualiza Rust ~20 Hz). */
export const cursor = { x: -9999, y: -9999 };

const colorCache = new Map<string, string>();

/** Color dominante (saturado) de una imagen, como "r, g, b". */
export function useDominantColor(src: string | null | undefined, fallback = "185, 167, 255"): string {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    if (!src) return setColor(fallback);
    const cached = colorCache.get(src);
    if (cached) return setColor(cached);

    const img = new Image();
    img.onload = () => {
      const size = 16;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
        const max = Math.max(pr, pg, pb);
        const min = Math.min(pr, pg, pb);
        // Pesa más los píxeles saturados y luminosos para evitar grises/negros.
        const weight = ((max - min) / 255) * (max / 255) + 0.02;
        r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
      }
      // Aclara hacia pastel para que se lea sobre negro.
      const lift = (v: number) => Math.min(255, Math.round((v / total) * 0.75 + 70));
      const result = `${lift(r)}, ${lift(g)}, ${lift(b)}`;
      colorCache.set(src, result);
      setColor(result);
    };
    img.src = src;
  }, [src, fallback]);
  return color;
}
