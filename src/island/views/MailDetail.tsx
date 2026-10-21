import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ipc, type MailItem } from "../../lib/ipc";
import { useIsland } from "../../store/islandStore";
import { CheckIcon, ClockIcon, CloseIcon, ExternalIcon, ReplyIcon, SparkIcon } from "../icons";
import { sounds } from "../../lib/sounds";
import { IconButton } from "../parts";

/** Texto con los enlaces clicables (se abren en el navegador). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            onClick={(e) => {
              e.preventDefault();
              openUrl(part);
            }}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Detalle de un correo dentro de la isla. Al abrirlo se marca como leído
 * (como en Gmail) y avisa a la lista con `onRead`.
 */
export function MailDetail({
  mail,
  onClose,
  onRead,
  onRemind,
}: {
  mail: MailItem;
  onClose: () => void;
  onRead: (id: string) => void;
  onRemind: (mail: MailItem) => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    setBody(null);
    ipc
      .gmailMessageText(mail.id)
      .then(setBody)
      .catch((e) => setError(String(e)));
    if (mail.labels.includes("UNREAD")) {
      ipc.gmailMarkRead(mail.id).then(() => onRead(mail.id)).catch(() => {});
    }
  }, [mail.id]);

  // Esc cierra el detalle (antes de que el panel lo use para cerrarse).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const date = mail.dateMs ? new Date(mail.dateMs).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <motion.div
      className="mail-detail"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="row gap-10 min-w-0">
        <div className="col grow min-w-0">
          <span className="title truncate">{mail.subject}</span>
          <span className="caption truncate">
            {mail.fromName} {mail.fromEmail && `<${mail.fromEmail}>`} · {date}
          </span>
        </div>
        <IconButton onClick={() => setReplying((r) => !r)} title="Responder" size={28} active={replying}>
          <ReplyIcon size={14} />
        </IconButton>
        <IconButton onClick={() => onRemind(mail)} title="Recordármelo en 1 h" size={28}>
          <ClockIcon size={14} />
        </IconButton>
        <IconButton
          onClick={() => {
            onClose();
            useIsland.getState().setResolveMail(mail);
          }}
          title="Resolver con Claude"
          size={28}
        >
          <SparkIcon size={14} />
        </IconButton>
        <IconButton onClick={() => openUrl(mail.url)} title="Abrir en Gmail" size={28}>
          <ExternalIcon size={14} />
        </IconButton>
        <IconButton onClick={onClose} title="Cerrar (Esc)" size={28}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
      <div className={`mail-body ${replying ? "compact" : ""}`}>
        {error ? (
          <span className="field-error">{error}</span>
        ) : body === null ? (
          <span className="caption">Cargando correo…</span>
        ) : (
          <Linkified text={body || mail.snippet} />
        )}
      </div>
      {replying && <ReplyComposer mail={mail} original={body ?? mail.snippet} onDone={() => setReplying(false)} />}
    </motion.div>
  );
}

/**
 * Editor de respuesta: Claude puede redactar un borrador (sin enviar nada) y el
 * usuario decide guardarlo en Borradores de Gmail o enviarlo, con confirmación.
 */
function ReplyComposer({ mail, original, onDone }: { mail: MailItem; original: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [guidance, setGuidance] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState<"draft" | "send" | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    ipc.gmailReplyInfo(mail.id).then((info) => setTo(info.to)).catch(() => setTo(mail.fromEmail));
  }, [mail.id]);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const email = `De: ${mail.fromName} <${mail.fromEmail}>\nAsunto: ${mail.subject}\n\n${original}`;
      setText(await ipc.claudeDraftReply(email, guidance));
      useIsland.getState().react("happy");
    } catch (e) {
      setError(String(e));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (mode: "draft" | "send") => {
    if (mode === "send" && !confirmSend) return setConfirmSend(true);
    setSending(mode);
    setError(null);
    try {
      await ipc.gmailReply(mail.id, text, mode);
      sounds.done();
      setDone(mode === "send" ? `Enviado a ${to}` : "Guardado en Borradores de Gmail");
      setTimeout(onDone, 1800);
    } catch (e) {
      setError(String(e));
      sounds.nope();
    } finally {
      setSending(null);
      setConfirmSend(false);
    }
  };

  if (done) {
    return (
      <div className="reply-done">
        <span className="ok-dot"><CheckIcon size={14} /></span>
        <span className="text-sm">{done}</span>
      </div>
    );
  }

  return (
    <motion.div className="reply" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="row gap-6 min-w-0">
        <span className="caption nowrap">Para: {to ?? "…"}</span>
        <input
          className="reply-guidance"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") draft();
          }}
          placeholder="Indicaciones para Claude (opcional): acepta el jueves a las 10, tono formal…"
          spellCheck={false}
        />
        <motion.button className="pill-btn claude-btn" whileTap={{ scale: 0.92 }} onClick={draft} disabled={drafting}>
          <SparkIcon size={12} /> {drafting ? "Redactando…" : text ? "Rehacer" : "Redactar con Claude"}
        </motion.button>
      </div>
      <textarea
        className="reply-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setConfirmSend(false);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={drafting ? "Claude está redactando (unos 15 s)…" : "Escribe tu respuesta o pide un borrador a Claude."}
        spellCheck
      />
      <div className="row gap-8">
        {error ? <span className="field-error truncate grow">{error}</span> : <span className="caption grow">Revisa el texto antes de enviar: Claude deja [corchetes] donde falta información.</span>}
        <button className="link-btn" onClick={onDone}>Cancelar</button>
        <motion.button className="pill-btn" whileTap={{ scale: 0.92 }} onClick={() => submit("draft")} disabled={!text.trim() || !!sending}>
          {sending === "draft" ? "Guardando…" : "Guardar borrador"}
        </motion.button>
        <motion.button
          className={`pill-btn primary ${confirmSend ? "confirm" : ""}`}
          style={{ background: confirmSend ? "#ff9f0a" : "var(--mascot)" }}
          whileTap={{ scale: 0.92 }}
          onClick={() => submit("send")}
          disabled={!text.trim() || !!sending || !to}
        >
          {sending === "send" ? "Enviando…" : confirmSend ? `¿Enviar a ${to}?` : "Enviar"}
        </motion.button>
      </div>
    </motion.div>
  );
}
