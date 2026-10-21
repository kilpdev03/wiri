import { useIsland } from "../store/islandStore";

let ctx: AudioContext | null = null;

type Note = { freq: number; at: number; dur: number; gain?: number; type?: OscillatorType };

function play(notes: Note[]) {
  if (!useIsland.getState().prefs.sounds) return;
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + n.at;
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(n.gain ?? 0.14, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + n.dur + 0.05);
    }
  } catch {
    /* sin audio disponible */
  }
}

export const sounds = {
  /** Llega una notificación o correo. */
  pop: () => play([{ freq: 660, at: 0, dur: 0.12, gain: 0.1 }, { freq: 990, at: 0.06, dur: 0.18, gain: 0.08 }]),
  /** Vence un recordatorio. */
  chime: () =>
    play([
      { freq: 880, at: 0, dur: 0.6, gain: 0.16 },
      { freq: 1318.5, at: 0.12, dur: 0.7, gain: 0.14 },
      { freq: 1760, at: 0.24, dur: 0.8, gain: 0.08 },
    ]),
  /** Abrir el panel. */
  open: () => play([{ freq: 520, at: 0, dur: 0.09, gain: 0.05, type: "triangle" }, { freq: 780, at: 0.04, dur: 0.1, gain: 0.04, type: "triangle" }]),
  /** Algo guardado. */
  done: () => play([{ freq: 700, at: 0, dur: 0.1, gain: 0.08 }, { freq: 1050, at: 0.08, dur: 0.2, gain: 0.08 }]),
  /** Error / rebote. */
  nope: () => play([{ freq: 220, at: 0, dur: 0.12, gain: 0.08, type: "triangle" }, { freq: 180, at: 0.08, dur: 0.14, gain: 0.08, type: "triangle" }]),
  /** Mascota pinchada. */
  boop: () => play([{ freq: 400, at: 0, dur: 0.08, gain: 0.07, type: "triangle" }, { freq: 300, at: 0.05, dur: 0.1, gain: 0.05, type: "triangle" }]),
};
