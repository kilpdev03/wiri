import { useIsland } from "../store/islandStore";
import { ipc } from "./ipc";
import { sounds } from "./sounds";

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Manda un mensaje (con los archivos adjuntos) y agrega la respuesta a la charla. */
export async function sendChat(text: string) {
  const { chat, setChat } = useIsland.getState();
  const message = text.trim() || (chat.files.length ? "Resume estos archivos." : "");
  if (!message || chat.pending) return;
  const files = chat.files;
  setChat({ messages: [...chat.messages, { role: "user", text: message, files: files.map(base) }], pending: true, files: [] });
  try {
    const reply = await ipc.claudeChat(message, chat.sessionId, files);
    const { chat: now } = useIsland.getState();
    const note = reply.skipped.length ? `\n\n(No pude leer ${reply.skipped.join(", ")}: solo leo archivos de texto.)` : "";
    setChat({
      messages: [...now.messages, { role: "claude", text: (reply.text || "(sin respuesta)") + note }],
      sessionId: reply.sessionId ?? now.sessionId,
      pending: false,
    });
    sounds.done();
  } catch (e) {
    const { chat: now } = useIsland.getState();
    setChat({ messages: [...now.messages, { role: "error", text: String(e) }], pending: false });
    sounds.nope();
  }
}

/** Archivos soltados en la isla: se adjuntan y se abre el chat. */
export function attachFiles(paths: string[]) {
  const s = useIsland.getState();
  s.setChat({ files: [...new Set([...s.chat.files, ...paths])].slice(0, 5) });
  s.openPanel("chat");
  s.react("happy");
  ipc.grabFocus();
}

export function resetChat() {
  useIsland.getState().setChat({ messages: [], sessionId: null, files: [] });
}
