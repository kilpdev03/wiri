import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ipc, type Alert, type ClaudeQuestion } from "../../lib/ipc";
import { Kbd } from "../parts";
import { CheckIcon, SparkIcon } from "../icons";
import { ActionButton, respondPermission } from "./AlertView";

const COLOR = "#d97757";
const OPTION_H = 36;

/** Alto de la tarjeta: una fila por opción de la pregunta más larga. */
export function questionCardHeight(questions: ClaudeQuestion[]): number {
  const most = Math.max(1, ...questions.map((q) => q.options.length));
  return Math.min(340, 124 + most * OPTION_H);
}

export const PLAN_CARD_H = 340;

const isTyping = (e: KeyboardEvent) => ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName);

function Header({ alert, queued, extra }: { alert: Alert; queued: number; extra?: string }) {
  return (
    <div className="row gap-6">
      <span className="ask-icon"><SparkIcon size={12} /></span>
      <span className="caption truncate" style={{ color: COLOR }}>{alert.app}</span>
      {extra && <span className="badge">{extra}</span>}
      {queued > 0 && <span className="badge">+{queued} más</span>}
    </div>
  );
}

/**
 * AskUserQuestion: contesta desde la isla. Una pregunta a la vez; las respuestas
 * se mandan juntas al final (pregunta → etiqueta elegida, o tu texto en "Otra").
 */
export function QuestionCard({ alert, queued }: { alert: Alert; queued: number }) {
  const questions = alert.permission!.questions!;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const q = questions[step];

  const answer = (value: string) => {
    if (!value.trim()) return;
    const next = { ...answers, [q.question]: value.trim() };
    if (step + 1 < questions.length) {
      setAnswers(next);
      setStep(step + 1);
      setPicked([]);
      setOther("");
    } else respondPermission(alert, "allow", { answers: next });
  };

  const choose = (label: string) => {
    if (!q.multiSelect) return answer(label);
    setPicked((p) => (p.includes(label) ? p.filter((l) => l !== label) : [...p, label]));
  };

  const submitMulti = () => answer([...picked, ...(other.trim() ? [other.trim()] : [])].join(", "));

  // El estado cambia en cada paso: el listener se renueva con él.
  const latest = useRef({ choose, submitMulti, q });
  latest.current = { choose, submitMulti, q };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const { q, choose, submitMulti } = latest.current;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) choose(q.options[n - 1].label);
      else if (e.key === "Enter" && q.multiSelect) submitMulti();
      else if (e.key === "Escape") respondPermission(alert, "ask");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alert]);

  return (
    <div className="alert permission ask" onClick={(e) => e.stopPropagation()}>
      <div className="alert-glow" style={{ background: `radial-gradient(90% 120% at 0% 0%, ${COLOR}30, transparent 65%)` }} />
      <motion.div key={step} className="col gap-6 rel min-h-0" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }}>
        <Header alert={alert} queued={queued} extra={[q.header, questions.length > 1 ? `${step + 1} de ${questions.length}` : ""].filter(Boolean).join(" · ")} />
        <div className="title ask-question">{q.question}</div>
        <div className="ask-options">
          {q.options.map((o, i) => {
            const on = picked.includes(o.label);
            return (
              <motion.button
                key={o.label}
                className={`ask-option ${on ? "on" : ""}`}
                whileTap={{ scale: 0.98 }}
                onClick={() => choose(o.label)}
                title={o.description}
              >
                <Kbd>{q.multiSelect && on ? <CheckIcon size={10} /> : i + 1}</Kbd>
                <span className="ask-label">{o.label}</span>
                {o.description && <span className="ask-desc truncate">{o.description}</span>}
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      <div className="row gap-6 rel perm-actions">
        <input
          className="ask-input grow"
          placeholder={q.multiSelect ? "Agregar otra respuesta…" : "Otra respuesta…"}
          value={other}
          spellCheck={false}
          onPointerDown={() => ipc.grabFocus()}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") q.multiSelect ? submitMulti() : answer(other);
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
        <button className="link-btn" onClick={() => respondPermission(alert, "ask")} title="Responder en la terminal o en la app">
          En la terminal
        </button>
        {q.multiSelect && (
          <ActionButton label={step + 1 < questions.length ? "Siguiente" : "Enviar"} kbd="Enter" primary color="#30d158" onClick={submitMulti} />
        )}
      </div>
    </div>
  );
}

/** Markdown mínimo: títulos en negrita, el resto tal cual (sin **). */
function PlanText({ plan }: { plan: string }) {
  return (
    <div className="plan-text">
      {plan.split("\n").map((line, i) => {
        const heading = /^#{1,6}\s+/.test(line);
        const text = line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
        return (
          <div key={i} className={heading ? "plan-h" : undefined}>
            {text || " "}
          </div>
        );
      })}
    </div>
  );
}

/**
 * ExitPlanMode: lee el plan y decide. Aprobar, aprobar aceptando las ediciones
 * (la sesión pasa a acceptEdits) o pedir cambios: tu texto le llega a Claude.
 */
export function PlanCard({ alert, queued }: { alert: Alert; queued: number }) {
  const plan = alert.permission!.plan ?? "";
  const [feedback, setFeedback] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const keepPlanning = () => {
    if (!feedback.trim()) {
      // Sin indicaciones no hay qué cambiar: primero las pide.
      ipc.grabFocus();
      setTimeout(() => input.current?.focus(), 60);
      return;
    }
    respondPermission(alert, "deny", { message: `El usuario revisó el plan desde Wiri y pide cambios: ${feedback.trim()}` });
  };

  const latest = useRef(keepPlanning);
  latest.current = keepPlanning;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (key === "y") respondPermission(alert, "allow");
      else if (key === "a") respondPermission(alert, "always");
      else if (key === "n") latest.current();
      else if (e.key === "Escape") respondPermission(alert, "ask");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alert]);

  return (
    <div className="alert permission ask" onClick={(e) => e.stopPropagation()}>
      <div className="alert-glow" style={{ background: `radial-gradient(90% 120% at 0% 0%, ${COLOR}30, transparent 65%)` }} />
      <motion.div className="col gap-6 rel grow min-h-0" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }}>
        <Header alert={alert} queued={queued} />
        <div className="title truncate">{alert.title}</div>
        <PlanText plan={plan} />
      </motion.div>

      <input
        ref={input}
        className="ask-input rel"
        placeholder="¿Qué cambiarías? (Enter para pedirlo)"
        value={feedback}
        spellCheck={false}
        onPointerDown={() => ipc.grabFocus()}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") keepPlanning();
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />

      <div className="row gap-6 perm-actions rel">
        <button className="link-btn" onClick={() => respondPermission(alert, "ask")} title="Responder en la terminal o en la app">
          En la terminal
        </button>
        <span className="grow" />
        <ActionButton label="Pedir cambios" kbd="N" onClick={keepPlanning} />
        <ActionButton label="Aprobar" kbd="Y" onClick={() => respondPermission(alert, "allow")} />
        <ActionButton label="Aprobar y editar" kbd="A" primary color="#30d158" onClick={() => respondPermission(alert, "always")} />
      </div>
    </div>
  );
}
