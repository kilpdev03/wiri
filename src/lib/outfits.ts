/** Ropa de la mascota. "auto" se viste según la temporada. */

export type Outfit = "none" | "beanie" | "glasses" | "crown" | "headphones" | "bow" | "witch" | "santa";
export type OutfitPref = Outfit | "auto";

export const OUTFITS: Record<OutfitPref, { label: string }> = {
  auto: { label: "Según la fecha" },
  none: { label: "Sin nada" },
  beanie: { label: "Gorro" },
  glasses: { label: "Lentes de sol" },
  crown: { label: "Corona" },
  headphones: { label: "Audífonos" },
  bow: { label: "Moño" },
  witch: { label: "Bruja" },
  santa: { label: "Navidad" },
};

/** Orden al cambiar con clic derecho. */
export const OUTFIT_CYCLE: OutfitPref[] = ["auto", "none", "beanie", "glasses", "crown", "headphones", "bow", "witch", "santa"];

/** Halloween la segunda mitad de octubre, Navidad en diciembre, invierno con gorro. */
export function seasonalOutfit(date = new Date()): Outfit {
  const m = date.getMonth();
  const d = date.getDate();
  if (m === 9 && d >= 15) return "witch";
  if (m === 10 && d <= 2) return "witch";
  if (m === 11) return "santa";
  return "none";
}

export const resolveOutfit = (pref: OutfitPref): Outfit => (pref === "auto" ? seasonalOutfit() : pref);

/**
 * Dibuja la ropa. El origen es el centro de la base del cuerpo; el cuerpo ocupa
 * x ∈ [-w/2, w/2], y ∈ [-h, 0]. `u` es el tamaño del lienzo; `eyeY`/`eyeDX`/`lookOff`
 * ubican los ojos (para los lentes).
 */
export function drawOutfit(
  ctx: CanvasRenderingContext2D,
  outfit: Outfit,
  g: { u: number; w: number; h: number; eyeY: number; eyeDX: number; lookOff: number; t: number },
) {
  const { u, w, h, eyeY, eyeDX, lookOff } = g;
  ctx.save();
  switch (outfit) {
    case "beanie": {
      ctx.fillStyle = "#ff6b5e";
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.82, w * 0.4, h * 0.36, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.roundRect(-w * 0.43, -h * 0.86, w * 0.86, h * 0.14, h * 0.07);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, -h * 1.2, u * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "glasses": {
      ctx.fillStyle = "#111";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(side * eyeDX + lookOff - u * 0.07, eyeY - u * 0.045, u * 0.14, u * 0.085, u * 0.03);
        ctx.fill();
      }
      ctx.strokeStyle = "#111";
      ctx.lineWidth = Math.max(1, u * 0.018);
      ctx.beginPath();
      ctx.moveTo(-eyeDX + lookOff + u * 0.07, eyeY - u * 0.02);
      ctx.lineTo(eyeDX + lookOff - u * 0.07, eyeY - u * 0.02);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(-eyeDX + lookOff - u * 0.05, eyeY - u * 0.035, u * 0.03, u * 0.015);
      break;
    }
    case "crown": {
      const y = -h * 0.96;
      const cw = w * 0.5;
      ctx.fillStyle = "#ffd60a";
      ctx.beginPath();
      ctx.moveTo(-cw / 2, y);
      ctx.lineTo(-cw / 2, y - u * 0.1);
      ctx.lineTo(-cw / 4, y - u * 0.05);
      ctx.lineTo(0, y - u * 0.13);
      ctx.lineTo(cw / 4, y - u * 0.05);
      ctx.lineTo(cw / 2, y - u * 0.1);
      ctx.lineTo(cw / 2, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ff453a";
      ctx.beginPath();
      ctx.arc(0, y - u * 0.035, u * 0.018, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "headphones": {
      ctx.strokeStyle = "#2c2c2e";
      ctx.lineWidth = Math.max(1.5, u * 0.04);
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.55, w * 0.52, h * 0.62, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.fillStyle = "#3a3a3c";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(side * w * 0.5 - u * 0.045, -h * 0.62, u * 0.09, h * 0.36, u * 0.035);
        ctx.fill();
      }
      break;
    }
    case "bow": {
      ctx.fillStyle = "#ff6fae";
      const bx = w * 0.26;
      const by = -h * 0.92;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + side * u * 0.1, by - u * 0.06);
        ctx.lineTo(bx + side * u * 0.1, by + u * 0.06);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#e0559a";
      ctx.beginPath();
      ctx.arc(bx, by, u * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "witch": {
      const y = -h * 0.86;
      ctx.fillStyle = "#2b1d3a";
      ctx.beginPath();
      ctx.ellipse(0, y, w * 0.55, h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, y);
      ctx.quadraticCurveTo(-w * 0.05, y - u * 0.2, w * 0.18, y - u * 0.34);
      ctx.quadraticCurveTo(w * 0.1, y - u * 0.15, w * 0.28, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ff9f0a";
      ctx.fillRect(-w * 0.27, y - u * 0.05, w * 0.54, u * 0.03);
      break;
    }
    case "santa": {
      const y = -h * 0.86;
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.moveTo(-w * 0.36, y);
      ctx.quadraticCurveTo(-w * 0.1, y - u * 0.3, w * 0.3, y - u * 0.22);
      ctx.lineTo(w * 0.36, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(-w * 0.42, y - u * 0.03, w * 0.84, u * 0.07, u * 0.035);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w * 0.32, y - u * 0.22, u * 0.045, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
