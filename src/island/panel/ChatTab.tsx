import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { resetChat, sendChat } from "../../lib/chat";
import { ipc } from "../../lib/ipc";
import { sounds } from "../../lib/sounds";
import { useIsland } from "../../store/islandStore";
import { Mascot } from "../Mascot";
import { CloseIcon, CopyIcon, SparkIcon } from "../icons";
import { Card, Empty, IconButton } from "../parts";

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Charla con Claude (tu suscripción de Claude Code, sin herramientas). Suelta archivos en la isla para preguntar por ellos. */
export function ChatTab() {
  const chat = useIsland((s) => s.chat);
  const setChat = useIsland((s) => s.setChat);
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);
  // Siempre al último mensaje.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.pending]);

  const send = () => {
    if (chat.pending) return;
    sendChat(text);
    setText("");
  };

  return (
    <Card className="fill-card list-card chat-card">
      <div className="list-header">
        <span className="title">Chat</span>
        <span className="caption">Claude · con tu suscripción de Claude Code</span>
        <span className="grow" />
        {chat.messages.length > 0 && (
          <button className="link-btn" onClick={resetChat} disabled={chat.pending}>
            Nueva charla
          </button>
        )}
      </div>

      <div className="chat-list" ref={list}>
        {chat.messages.length === 0 && !chat.pending ? (
          <Empty
            icon={<SparkIcon size={22} />}
            title="Pregúntale lo que quieras"
            body="Escribe abajo, o suelta un archivo de texto o código sobre la isla para preguntar por él."
          />
        ) : (
          <AnimatePresence initial={false}>
            {chat.messages.map((m, i) => (
              <motion.div
                key={i}
                className={`chat-msg ${m.role}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                {m.files && m.files.length > 0 && <div className="caption chat-files">📎 {m.files.join(", ")}</div>}
                <div className="chat-text">{m.text}</div>
                {m.role === "claude" && (
                  <IconButton
                    onClick={() => {
                      navigator.clipboard.writeText(m.text).then(() => sounds.done(), () => sounds.nope());
                    }}
                    title="Copiar respuesta"
                    size={22}
                  >
                    <CopyIcon size={11} />
                  </IconButton>
                )}
              </motion.div>
            ))}
            {chat.pending && (
              <motion.div key="pending" className="chat-msg claude pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Mascot size={26} mood="idle" />
                <span className="caption">Pensando…</span>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {chat.files.length > 0 && (
        <div className="row gap-6 chat-attach">
          {chat.files.map((f) => (
            <button key={f} className="muted-chip" title={f} onClick={() => setChat({ files: chat.files.filter((x) => x !== f) })}>
              📎 {base(f)} <CloseIcon size={10} />
            </button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={chat.files.length ? "¿Qué quieres saber de estos archivos?" : "Escribe y presiona Enter (Shift+Enter: nueva línea)"}
          spellCheck={false}
          onPointerDown={() => ipc.grabFocus()}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="pill-btn primary" style={{ background: "#d97757" }} onClick={send} disabled={chat.pending}>
          Enviar
        </button>
      </div>
    </Card>
  );
}
