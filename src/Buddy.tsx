import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { applyAppearance } from "./lib/appearance";
import { sounds } from "./lib/sounds";
import { cursor } from "./lib/hooks";
import { Mascot, type Mood } from "./island/Mascot";
import { useIsland } from "./store/islandStore";

/**
 * Bolo en el escritorio: la página de su ventana. Rust la mueve (arrastre,
 * vuelos, acomodarse) y la hace atravesable salvo sobre su cuerpo; aquí solo
 * se dibuja, se le pasan el cursor y los clics, y reacciona.
 */
export function Buddy() {
  const [mood, setMood] = useState<Mood>("idle");
  const [fade, setFade] = useState<"in" | "out">("in");

  useEffect(() => {
    applyAppearance(useIsland.getState().prefs);
    const unsubPrefs = useIsland.subscribe((st, prev) => st.prefs !== prev.prefs && applyAppearance(st.prefs));
    const react = useIsland.getState().react;
    const subs = [
      // Ya relativo a esta ventana, en px lógicos.
      listen<{ x: number; y: number }>("buddy://cursor", ({ payload }) => {
        cursor.x = payload.x;
        cursor.y = payload.y;
      }),
      // Sale de la isla apareciendo; vuelve desvaneciéndose (como Coucou).
      listen<string>("buddy://flight", ({ payload }) => {
        react("jump");
        setFade(payload === "home" ? "out" : "in");
      }),
      listen("buddy://landed", () => {
        setFade("in");
        react("happy");
        sounds.boop();
      }),
      listen("island://alert", () => react("jump")),
      listen<{ event: Record<string, any> }>("claude://hook", ({ payload }) => {
        if (payload.event.hook_event_name === "Stop") react("happy");
      }),
      listen("claude://permission", () => setMood("alert")),
      listen("claude://permission-done", () => setMood("idle")),
      listen<{ playing: boolean } | null>("media://update", ({ payload }) => setMood((m) => (m === "alert" ? m : payload?.playing ? "dance" : "idle"))),
    ];
    return () => {
      unsubPrefs();
      subs.forEach((p) => p.then((off) => off()));
    };
  }, []);

  return (
    <div
      className="buddy"
      // Desde que lo aprietas, Rust lo lleva con el cursor hasta que sueltas.
      onMouseDown={(e) => {
        if (e.button === 0) invoke("buddy_drag_begin").catch(() => {});
      }}
      onDoubleClick={() => invoke("buddy_fly_home", { forget: true }).catch(() => {})}
      title="Arrástrame · suéltame en la isla o doble clic para volver · clic derecho cambia mi ropa"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={fade === "in" ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.55 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        style={{ transformOrigin: "50% 80%" }}
      >
        <Mascot size={110} mood={mood} pokeable />
      </motion.div>
    </div>
  );
}
