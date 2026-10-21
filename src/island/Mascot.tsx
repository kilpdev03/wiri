import { useEffect, useRef } from "react";
import { cursor } from "../lib/hooks";
import { sounds } from "../lib/sounds";
import { ACCENTS } from "../lib/appearance";
import { useIsland, type Reaction } from "../store/islandStore";

export type Mood = "idle" | "dance" | "alert" | "sleep";


type Expression = "normal" | "happy" | "annoyed" | "dizzy";

type Sim = {
  t: number;
  squash: number;
  squashV: number;
  jump: number;
  jumpV: number;
  antenna: number;
  antennaV: number;
  blink: number;
  nextBlink: number;
  lookX: number;
  lookY: number;
  expression: Expression;
  expressionUntil: number;
  clicks: number[];
  lastReaction: number;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function parseRgb(c: string): [number, number, number] {
  const [r, g, b] = c.split(",").map((v) => parseFloat(v));
  return [r || 0, g || 0, b || 0];
}

const rgba = ([r, g, b]: [number, number, number], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;
const shade = ([r, g, b]: [number, number, number], k: number): [number, number, number] =>
  k >= 0
    ? [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k]
    : [r * (1 + k), g * (1 + k), b * (1 + k)];

/**
 * La mascota: un guijarro con antena dibujado en Canvas 2D. Respira, parpadea,
 * sigue el cursor con la mirada, baila con la música, salta con las alertas y
 * reacciona si la pinchas (3 clics rápidos = mareo).
 */
export function Mascot({
  size,
  mood = "idle",
  color,
  pokeable = false,
}: {
  size: number;
  mood?: Mood;
  color?: string;
  pokeable?: boolean;
}) {
  // Sin color explícito, Bolo usa el acento elegido en Apariencia.
  const accent = useIsland((s) => ACCENTS[s.prefs.accent].rgb);
  color ??= accent;
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef({ mood, color: parseRgb(color), size });
  props.current = { mood, color: parseRgb(color), size };

  const sim = useRef<Sim>({
    t: 0,
    squash: 0,
    squashV: 0,
    jump: 0,
    jumpV: 0,
    antenna: 0,
    antennaV: 0,
    blink: 0,
    nextBlink: 1.5,
    lookX: 0,
    lookY: 0,
    expression: "normal",
    expressionUntil: 0,
    clicks: [],
    lastReaction: Date.now(),
  });

  // Reacciones globales (alertas, recordatorio guardado, error...).
  useEffect(() => {
    const apply = (kind: Reaction) => {
      const s = sim.current;
      if (kind === "jump" || kind === "hello" || kind === "happy") s.jumpV = 2.6;
      if (kind === "hello" || kind === "happy") {
        s.expression = "happy";
        s.expressionUntil = s.t + 1.4;
      }
      if (kind === "nope") {
        s.expression = "annoyed";
        s.expressionUntil = s.t + 0.9;
        s.squashV += 5;
      }
    };
    apply("hello");
    return useIsland.subscribe((state, prev) => {
      if (state.reaction && state.reaction !== prev.reaction && state.reaction.at > sim.current.lastReaction) {
        sim.current.lastReaction = state.reaction.at;
        apply(state.reaction.kind);
      }
    });
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf = 0;
    let last = performance.now();

    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const { mood, color, size } = props.current;
      const s = sim.current;
      s.t += dt;

      // --- Física ---
      // Resorte de aplastamiento.
      s.squashV += (-220 * s.squash - 14 * s.squashV) * dt;
      s.squash += s.squashV * dt;
      // Salto (en unidades de "altura de cuerpo" por segundo).
      if (s.jump > 0 || s.jumpV > 0) {
        s.jump += s.jumpV * dt;
        s.jumpV -= 14 * dt;
        if (s.jump <= 0) {
          s.jump = 0;
          s.squashV += Math.min(6, Math.abs(s.jumpV) * 1.6);
          s.jumpV = 0;
        }
      }
      // Antena: resorte arrastrado por el movimiento vertical.
      s.antennaV += (-120 * s.antenna - 6 * s.antennaV - s.jumpV * 0.9 - s.squashV * 0.3) * dt;
      s.antenna += s.antennaV * dt;
      // Parpadeo.
      if (mood !== "sleep") {
        s.nextBlink -= dt;
        if (s.nextBlink <= 0) {
          s.blink = 1;
          s.nextBlink = 2 + Math.random() * 3.5;
        }
      }
      s.blink = Math.max(0, s.blink - dt * 7);
      if (s.expression !== "normal" && s.t > s.expressionUntil) s.expression = "normal";

      // Mirada hacia el cursor.
      const rect = el.getBoundingClientRect();
      const dx = cursor.x - (rect.left + rect.width / 2);
      const dy = cursor.y - (rect.top + rect.height / 2);
      const tx = clamp(dx / 260, -1, 1);
      const ty = clamp(dy / 160, -1, 1);
      s.lookX += (tx - s.lookX) * Math.min(1, dt * 10);
      s.lookY += (ty - s.lookY) * Math.min(1, dt * 10);

      // --- Dibujo ---
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(size * dpr)) {
        el.width = el.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const u = size;
      const beat = s.t * Math.PI * 2 * 1.9; // ~114 bpm
      const breathe = mood === "sleep" ? Math.sin(s.t * 1.4) * 0.04 : Math.sin(s.t * 2.3) * 0.022;
      const bounce = mood === "dance" ? Math.abs(Math.sin(beat / 2)) * 0.07 : 0;
      const tilt = mood === "dance" ? Math.sin(beat / 2) * 0.13 : mood === "sleep" ? -0.08 : s.lookX * 0.05;

      const bodyW = u * 0.66 * (1 + s.squash * 0.35 - breathe * 0.4);
      const bodyH = u * 0.5 * (1 - s.squash * 0.35 + breathe);
      const baseY = u * 0.95 - (s.jump * 0.22 + bounce) * u;

      ctx.save();
      ctx.translate(u / 2, baseY);
      ctx.rotate(tilt);

      // Sombra suave bajo el cuerpo.
      ctx.save();
      ctx.rotate(-tilt);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, (s.jump * 0.22 + bounce) * u, bodyW * 0.36 * (1 - s.jump * 0.25), u * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Antena.
      const antLean = s.antenna * 0.6 + tilt * -0.8 + (mood === "dance" ? Math.sin(beat) * 0.25 : 0);
      const antBaseY = -bodyH * 0.98;
      const tipX = Math.sin(antLean) * u * 0.14;
      const tipY = antBaseY - Math.cos(antLean) * u * 0.14;
      ctx.strokeStyle = rgba(shade(color, -0.25));
      ctx.lineWidth = Math.max(1.2, u * 0.028);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, antBaseY);
      ctx.quadraticCurveTo(tipX * 0.2, antBaseY - u * 0.08, tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = mood === "alert" ? "#ff9f0a" : rgba(shade(color, 0.35));
      ctx.beginPath();
      ctx.arc(tipX, tipY, u * 0.045, 0, Math.PI * 2);
      ctx.fill();

      // Cuerpo.
      const grad = ctx.createLinearGradient(0, -bodyH, 0, 0);
      grad.addColorStop(0, rgba(shade(color, 0.32)));
      grad.addColorStop(1, rgba(shade(color, -0.08)));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-bodyW / 2, -bodyH, bodyW, bodyH, [bodyH * 0.55, bodyH * 0.55, bodyH * 0.42, bodyH * 0.42]);
      ctx.fill();
      // Brillo.
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(-bodyW * 0.24, -bodyH * 0.78, bodyW * 0.1, bodyH * 0.07, -0.5, 0, Math.PI * 2);
      ctx.fill();

      // Cara.
      const ink = "#17161c";
      const eyeY = -bodyH * 0.5 + s.lookY * u * 0.025;
      const eyeDX = bodyW * 0.2;
      const lookOff = s.lookX * u * 0.035;
      const expr: Expression = s.expression;
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.2, u * 0.03);

      for (const side of [-1, 1]) {
        const ex = side * eyeDX + lookOff;
        ctx.beginPath();
        if (mood === "sleep") {
          ctx.moveTo(ex - u * 0.045, eyeY);
          ctx.quadraticCurveTo(ex, eyeY + u * 0.03, ex + u * 0.045, eyeY);
          ctx.stroke();
        } else if (expr === "happy" || (mood === "dance" && Math.sin(beat / 4) > 0.6)) {
          ctx.moveTo(ex - u * 0.045, eyeY + u * 0.015);
          ctx.quadraticCurveTo(ex, eyeY - u * 0.05, ex + u * 0.045, eyeY + u * 0.015);
          ctx.stroke();
        } else if (expr === "annoyed") {
          ctx.moveTo(ex - u * 0.045, eyeY - side * u * 0.02);
          ctx.lineTo(ex + u * 0.045, eyeY + side * u * 0.02);
          ctx.stroke();
        } else if (expr === "dizzy") {
          const rot = s.t * 8 * side;
          for (let a = 0; a < Math.PI * 3; a += 0.3) {
            const r = (a / (Math.PI * 3)) * u * 0.05;
            const px = ex + Math.cos(a + rot) * r;
            const py = eyeY + Math.sin(a + rot) * r;
            if (a === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else {
          const open = 1 - Math.sin(s.blink * Math.PI);
          const big = mood === "alert" ? 1.25 : 1;
          ctx.ellipse(ex, eyeY, u * 0.045 * big, Math.max(0.6, u * 0.062 * big * open), 0, 0, Math.PI * 2);
          ctx.fill();
          if (open > 0.5) {
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(ex + u * 0.015, eyeY - u * 0.022, u * 0.016, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = ink;
          }
        }
      }

      // Mejillas.
      if (expr === "happy" || mood === "dance" || mood === "alert") {
        ctx.fillStyle = "rgba(255, 120, 150, 0.45)";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(side * bodyW * 0.33 + lookOff * 0.5, eyeY + u * 0.07, u * 0.045, u * 0.025, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Boca.
      ctx.fillStyle = ink;
      ctx.beginPath();
      const my = eyeY + u * 0.085;
      const mx = lookOff * 0.8;
      if (mood === "alert" || expr === "dizzy") {
        ctx.ellipse(mx, my + u * 0.01, u * 0.025, u * 0.03, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (expr === "annoyed") {
        ctx.moveTo(mx - u * 0.03, my + u * 0.01);
        ctx.lineTo(mx + u * 0.03, my);
        ctx.stroke();
      } else if (mood !== "sleep") {
        const wide = expr === "happy" || mood === "dance" ? 1.5 : 1;
        ctx.moveTo(mx - u * 0.03 * wide, my);
        ctx.quadraticCurveTo(mx, my + u * 0.04 * wide, mx + u * 0.03 * wide, my);
        ctx.stroke();
      }

      // Insignia de alerta.
      if (mood === "alert") {
        const bx = bodyW * 0.48;
        const by = -bodyH * 0.95;
        const pulse = 1 + Math.sin(s.t * 8) * 0.08;
        ctx.fillStyle = "#ff9f0a";
        ctx.beginPath();
        ctx.arc(bx, by, u * 0.085 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${u * 0.12}px "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", bx, by + u * 0.005);
      }
      ctx.restore();

      // Zzz al dormir.
      if (mood === "sleep") {
        ctx.fillStyle = rgba(shade(color, 0.4), 1);
        ctx.font = `600 ${u * 0.16}px "Segoe UI", sans-serif`;
        for (let i = 0; i < 2; i++) {
          const p = (s.t * 0.45 + i * 0.5) % 1;
          ctx.globalAlpha = Math.sin(p * Math.PI);
          ctx.fillText("z", u * (0.72 + p * 0.12), u * (0.42 - p * 0.3));
        }
        ctx.globalAlpha = 1;
      }

      // Notas musicales al bailar.
      if (mood === "dance" && u >= 40) {
        ctx.fillStyle = rgba(shade(color, 0.3));
        ctx.font = `600 ${u * 0.16}px "Segoe UI Symbol", sans-serif`;
        const p = (s.t * 0.6) % 1;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
        ctx.fillText("♪", u * (0.82 + Math.sin(p * 6) * 0.03), u * (0.5 - p * 0.35));
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const poke = (e: React.MouseEvent) => {
    if (!pokeable) return;
    e.stopPropagation();
    const s = sim.current;
    const now = s.t;
    s.clicks = [...s.clicks.filter((c) => now - c < 1.2), now];
    s.squashV += 7;
    sounds.boop();
    if (s.clicks.length >= 3) {
      s.expression = "dizzy";
      s.expressionUntil = now + 2.2;
      s.clicks = [];
    } else {
      s.expression = "annoyed";
      s.expressionUntil = now + 0.8;
    }
  };

  return (
    <canvas
      ref={canvas}
      className="mascot"
      style={{ width: size, height: size, cursor: pokeable ? "pointer" : undefined }}
      onClick={poke}
    />
  );
}
