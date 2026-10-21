import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "../../lib/ipc";
import { formatClock, formatCountdown, parseReminder } from "../../lib/parseReminder";
import { useIsland } from "../../store/islandStore";
import { BellIcon, CheckIcon, TimerIcon } from "../icons";

export function QuickAdd() {
  const close = useIsland((s) => s.setQuickAdd);
  const [value, setValue] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();
  const preview = parseReminder(value);

  useEffect(() => {
    // El foco llega después de que Rust activa la ventana.
    const id = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(id);
  }, []);

  const finish = () => {
    close(false);
    ipc.releaseFocus();
  };

  const submit = async () => {
    if (!preview) {
      shake.start({ x: [0, -10, 9, -7, 5, -2, 0], transition: { duration: 0.45 } });
      return;
    }
    await ipc.addReminder(preview.text, preview.kind, preview.dueMs);
    setDone(
      preview.kind === "timer"
        ? `${preview.text} · ${formatCountdown(preview.dueMs - Date.now())}`
        : `${formatClock(preview.dueMs)} · ${preview.text}`,
    );
    setTimeout(finish, 1100);
  };

  return (
    <motion.div className="quick-add" animate={shake}>
      <AnimatePresence mode="popLayout" initial={false}>
        {done ? (
          <motion.div
            key="done"
            className="row gap-10 grow"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <motion.span
              className="ok-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 12 }}
            >
              <CheckIcon size={16} />
            </motion.span>
            <span className="title truncate">{done}</span>
          </motion.div>
        ) : (
          <motion.div key="input" className="row gap-10 grow" exit={{ opacity: 0, scale: 0.9 }}>
            <span className="quick-icon" style={{ color: preview?.kind === "timer" ? "#ff9f0a" : "#ffd60a" }}>
              {preview?.kind === "timer" ? <TimerIcon size={18} /> : <BellIcon size={18} />}
            </span>
            <input
              ref={input}
              value={value}
              placeholder="en 20 min sacar la ropa · a las 18:30 llamar · pomodoro"
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => !done && close(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") finish();
              }}
              spellCheck={false}
            />
            <AnimatePresence>
              {preview && (
                <motion.span
                  className="badge"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                >
                  {preview.kind === "timer" ? formatCountdown(preview.dueMs - Date.now()) : formatClock(preview.dueMs)}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
