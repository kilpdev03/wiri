import { motion } from "motion/react";
import { useMemo } from "react";
import type { ClaudeStep } from "../../lib/claude";
import { lineDiff } from "../../lib/diff";
import { relativeTime, IconButton } from "../parts";
import { CloseIcon, SearchIcon, SparkIcon } from "../icons";

const KIND_COLOR: Record<string, string> = {
  Edit: "#ffd60a",
  MultiEdit: "#ffd60a",
  Write: "#ffd60a",
  Bash: "#64d2ff",
  PowerShell: "#64d2ff",
  Read: "var(--text-faint)",
  Grep: "var(--text-faint)",
  Glob: "var(--text-faint)",
};

/** Lo que hizo la sesión en este turno, del más reciente al más antiguo. */
export function StepList({ steps, onOpen }: { steps: ClaudeStep[]; onOpen: (step: ClaudeStep) => void }) {
  if (!steps.length) return <div className="caption steps-empty">Todavía no terminó ningún paso en este turno.</div>;
  return (
    <motion.div className="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
      {[...steps].reverse().map((step, i) => {
        const hasDiff = !!step.edits?.length;
        return (
          <div
            key={`${step.at}-${i}`}
            className={`step-row ${hasDiff ? "clickable" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasDiff) onOpen(step);
            }}
            title={hasDiff ? `Ver cambios en ${step.path ?? ""}` : step.path}
          >
            <span className="step-dot" style={{ background: KIND_COLOR[step.tool] ?? "#d97757" }} />
            <span className="text-xs truncate grow">{step.label}</span>
            {step.added + step.removed > 0 && (
              <span className="diff nowrap">
                <span className="add">+{step.added}</span> <span className="del">−{step.removed}</span>
              </span>
            )}
            <span className="caption nowrap tabular">{relativeTime(step.at)}</span>
          </div>
        );
      })}
    </motion.div>
  );
}

/** Diferencia completa de una edición, sobre el panel. */
export function DiffSheet({ step, onClose }: { step: ClaudeStep; onClose: () => void }) {
  const blocks = useMemo(() => (step.edits ?? []).map((e) => lineDiff(e.before, e.after)), [step]);
  return (
    <motion.div
      className="resolve-sheet diff-sheet"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="row gap-8">
        <span className="resolve-icon"><SparkIcon size={13} /></span>
        <div className="col grow min-w-0">
          <span className="text-sm truncate">{step.label}</span>
          <span className="caption truncate">{step.path}</span>
        </div>
        <span className="diff nowrap">
          <span className="add">+{step.added}</span> <span className="del">−{step.removed}</span>
        </span>
        <IconButton onClick={onClose} title="Cerrar (Esc)" size={26}>
          <CloseIcon size={13} />
        </IconButton>
      </div>
      <div className="diff-body">
        {blocks.map((lines, b) => (
          <div key={b} className="diff-block">
            {blocks.length > 1 && <div className="caption diff-hunk">Cambio {b + 1} de {blocks.length}</div>}
            {lines.map((l, i) => (
              <div key={i} className={`diff-line ${l.kind}`}>
                <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                <span>{l.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
        {!blocks.length && (
          <div className="caption row gap-6"><SearchIcon size={12} /> Sin cambios que mostrar.</div>
        )}
      </div>
    </motion.div>
  );
}
