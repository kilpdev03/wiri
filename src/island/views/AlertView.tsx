import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useEffect } from "react";
import { ipc, type Alert, type PermissionDecision } from "../../lib/ipc";
import { sounds } from "../../lib/sounds";
import { useIsland } from "../../store/islandStore";
import { Mascot } from "../Mascot";
import { Kbd } from "../parts";
import { BellIcon, CalendarIcon, ChatIcon, MailIcon, SparkIcon } from "../icons";
import { joinLabel } from "../../lib/calendar";
import { appAccent, openSource } from "../panel/Tabs";
import { installUpdate } from "../../lib/update";

/** Tiempo visible antes de cerrarse sola (se reinicia al quitar el mouse). */
const DURATION_MS: Record<Alert["kind"], number> = {
  reminder: 45_000,
  notification: 7_000,
  mail: 9_000,
  calendar: 12_000,
  claude: 15_000,
  update: 20_000,
};

function KindIcon({ alert }: { alert: Alert }) {
  if (alert.kind === "reminder") return <BellIcon size={14} />;
  if (alert.kind === "mail") return <MailIcon size={14} />;
  if (alert.kind === "calendar") return <CalendarIcon size={14} />;
  if (alert.kind === "claude" || alert.kind === "update") return <SparkIcon size={14} />;
  return <ChatIcon size={14} />;
}

/** Acción principal (Enter) de cada tipo de alerta. */
export function primaryAction(alert: Alert) {
  const { resolveAlert, dismissAlert, openPanel } = useIsland.getState();
  if (alert.kind === "update") {
    dismissAlert(alert.id);
    installUpdate();
    return;
  }
  // Sin app a la que ir, Enter abre Avisos para leerla: ahí debe seguir estando.
  if (alert.kind === "notification" && !alert.aumid) {
    dismissAlert(alert.id);
    openPanel("notifications");
    ipc.grabFocus();
    return;
  }
  // Atendida: sale de la cola, del historial y del centro de notificaciones de Windows.
  resolveAlert(alert);
  if (alert.winId !== undefined) ipc.notifDismiss(alert.winId).catch(() => {});
  if (alert.kind === "mail") openUrl(alert.url ?? "https://mail.google.com/mail/u/0/#inbox");
  if (alert.kind === "calendar") openUrl(alert.joinUrl ?? alert.url ?? "https://calendar.google.com");
  // Claude Code: trae al frente la terminal o el editor de esa sesión.
  if (alert.kind === "claude" && alert.ancestors?.length) ipc.claudeFocus(alert.ancestors).catch(() => {});
  if (alert.kind === "notification") openSource(alert);
}

function ActionButton({ label, kbd, onClick, primary, color }: { label: string; kbd?: string; onClick: () => void; primary?: boolean; color?: string }) {
  return (
    <motion.button
      className={`pill-btn ${primary ? "primary" : ""}`}
      style={primary ? { background: color } : undefined}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.9 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
      {kbd && <Kbd>{kbd}</Kbd>}
    </motion.button>
  );
}

export function AlertView({ alert, queued }: { alert: Alert; queued: number }) {
  const hovered = useIsland((s) => s.hovered);
  const dismiss = useIsland((s) => s.dismissAlert);
  const showMascot = useIsland((s) => s.prefs.mascot);
  const color = appAccent(alert);
  const duration = DURATION_MS[alert.kind];

  useEffect(() => {
    if (hovered) return;
    const id = setTimeout(() => dismiss(alert.id), duration);
    return () => clearTimeout(id);
  }, [alert.id, duration, hovered, dismiss]);

  const label = alert.app ?? (alert.kind === "reminder" ? (alert.reminder?.kind === "timer" ? "Temporizador" : "Recordatorio") : "");

  return (
    <div className="alert" onClick={() => primaryAction(alert)}>
      <div
        className="alert-glow"
        style={{ background: `radial-gradient(90% 160% at 0% 50%, ${color}38, transparent 65%)` }}
      />
      <div className="row gap-14 rel">
        <div className="alert-avatar">
          {showMascot ? (
            <Mascot size={58} mood="alert" />
          ) : (
            <div className="alert-tile" style={{ background: color }}><KindIcon alert={alert} /></div>
          )}
          <motion.span
            className={`app-badge ${alert.icon ? "has-icon" : ""}`}
            style={{ background: color }}
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 14, delay: 0.15 }}
          >
            {alert.icon ? <img src={alert.icon} alt="" /> : <KindIcon alert={alert} />}
          </motion.span>
        </div>

        <motion.div
          className="col grow min-w-0"
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.08 }}
        >
          <div className="row gap-6">
            <span className="caption" style={{ color }}>{label}</span>
            <span className="caption">· ahora</span>
            {queued > 0 && <span className="badge">+{queued} más</span>}
          </div>
          <div className="title truncate">{alert.title}</div>
          <div className="subtitle truncate">{alert.body}</div>
        </motion.div>

        <motion.div
          className="col gap-6 items-end"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.18 }}
        >
          {alert.reminder ? (
            <>
              <div className="row gap-6">
                {[5, 15].map((min) => (
                  <ActionButton
                    key={min}
                    label={`+${min} min`}
                    onClick={() => {
                      ipc.snoozeReminder(alert.reminder!, min);
                      dismiss(alert.id);
                      sounds.done();
                    }}
                  />
                ))}
              </div>
              <ActionButton label="Listo" kbd="Esc" primary color={color} onClick={() => dismiss(alert.id)} />
            </>
          ) : (
            <>
              <ActionButton label={alert.joinUrl ? `Unirse a ${joinLabel(alert.joinUrl)}` : alert.kind === "claude" ? "Ir a la sesión" : alert.kind === "update" ? "Actualizar" : alert.kind === "mail" || alert.aumid || alert.kind === "calendar" ? "Abrir" : "Ver"} kbd="Enter" primary color={color} onClick={() => primaryAction(alert)} />
              <div className="row gap-6">
                {alert.messageId && (
                  <ActionButton
                    label="Resolver"
                    onClick={() => {
                      // Abre Correo con la hoja "Resolver con Claude" para este mensaje.
                      const st = useIsland.getState();
                      const mail = st.gmail.messages.find((m) => m.id === alert.messageId) ?? {
                        id: alert.messageId!,
                        threadId: alert.messageId!,
                        fromName: alert.title,
                        fromEmail: "",
                        subject: alert.body,
                        snippet: alert.body,
                        dateMs: alert.at ?? Date.now(),
                        url: alert.url ?? "",
                        labels: alert.labels ?? [],
                      };
                      st.resolveAlert(alert);
                      st.openPanel("mail");
                      st.setResolveMail(mail);
                      ipc.grabFocus();
                    }}
                  />
                )}
                {alert.messageId && (
                  <ActionButton
                    label="Leído"
                    onClick={() => {
                      ipc.gmailMarkRead(alert.messageId!);
                      dismiss(alert.id);
                      sounds.done();
                    }}
                  />
                )}
                <ActionButton label="Cerrar" kbd="Esc" onClick={() => dismiss(alert.id)} />
              </div>
            </>
          )}
        </motion.div>
      </div>

      <motion.div
        key={`${alert.id}-${hovered}`}
        className="alert-timer"
        style={{ background: color }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: hovered ? 1 : 0 }}
        transition={{ duration: hovered ? 0.2 : duration / 1000, ease: "linear" }}
      />
    </div>
  );
}

/** Responde un permiso de Claude Code y saca la tarjeta. */
export function respondPermission(alert: Alert, decision: PermissionDecision) {
  if (!alert.permission) return;
  ipc.claudePermissionRespond(alert.permission.id, decision).catch(() => {});
  useIsland.getState().dismissAlert(alert.id);
  if (decision === "deny") sounds.nope();
  else if (decision !== "ask") sounds.done();
  // "En la terminal": te lleva a la ventana donde está el diálogo.
  if (decision === "ask" && alert.ancestors?.length) ipc.claudeFocus(alert.ancestors).catch(() => {});
}

/**
 * Permiso de Claude Code: no se cierra solo. Muestra el comando o archivo exacto
 * y responde a Claude. Sin respuesta (≈1 min), el permiso vuelve a la terminal.
 */
export function PermissionCard({ alert, queued }: { alert: Alert; queued: number }) {
  const showMascot = useIsland((s) => s.prefs.mascot);
  const perm = alert.permission!;
  const color = "#d97757";
  return (
    <div className="alert permission" onClick={(e) => e.stopPropagation()}>
      <div className="alert-glow" style={{ background: `radial-gradient(90% 160% at 0% 50%, ${color}38, transparent 65%)` }} />
      <div className="row gap-14 rel">
        <div className="alert-avatar">
          {showMascot ? <Mascot size={58} mood="alert" /> : <div className="alert-tile" style={{ background: color }}><SparkIcon size={14} /></div>}
          <motion.span
            className="app-badge"
            style={{ background: color }}
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 14, delay: 0.15 }}
          >
            <SparkIcon size={14} />
          </motion.span>
        </div>

        <motion.div
          className="col grow min-w-0 gap-4"
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.08 }}
        >
          <div className="row gap-6">
            <span className="caption truncate" style={{ color }}>{alert.app}</span>
            {queued > 0 && <span className="badge">+{queued} más</span>}
          </div>
          <div className="title truncate">{alert.title}</div>
          <code className="perm-detail" title={perm.detail}>{perm.detail || perm.tool}</code>
        </motion.div>
      </div>

      <motion.div
        className="row gap-6 perm-actions rel"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <button className="link-btn" onClick={() => respondPermission(alert, "ask")} title="Responder en la terminal o en la app">
          En la terminal
        </button>
        <span className="grow" />
        <ActionButton label="Denegar" kbd="N" onClick={() => respondPermission(alert, "deny")} />
        {perm.canAlways && <ActionButton label="Siempre" kbd="A" onClick={() => respondPermission(alert, "always")} />}
        <ActionButton label="Permitir" kbd="Y" primary color="#30d158" onClick={() => respondPermission(alert, "allow")} />
      </motion.div>
    </div>
  );
}
