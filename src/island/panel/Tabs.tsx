import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNow } from "../../lib/hooks";
import { ACCENTS, ANCHORS, DEFAULT_APPEARANCE, ISLAND_COLORS, SHAPES, SIZES } from "../../lib/appearance";
import { endMs, isLive, joinLabel, nextMeeting, startMs, timeRange, untilLabel } from "../../lib/calendar";
import { formatDuration, resetLabel, type ClaudeSession, type ClaudeStatus, type UsageWindow } from "../../lib/claude";
import { ipc, prettyShortcut, type Alert, type CalEvent, type ClaudeHooksStatus, type MailItem, type Reminder } from "../../lib/ipc";
import { MAIL_ALERT_MODES, MAIL_FILTERS, matchesFilter, type MailAlertMode } from "../../lib/mailFilters";
import { formatClock, formatCountdown, parseReminder } from "../../lib/parseReminder";
import { sounds } from "../../lib/sounds";
import { useShallow } from "zustand/react/shallow";
import { useIsland } from "../../store/islandStore";
import { Mascot } from "../Mascot";
import { Card, Empty, IconButton, Kbd, relativeTime, Ring, Segmented } from "../parts";
import {
  BellIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,

  ExternalIcon,
  MailIcon,

  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
  TimerIcon,
  TrashIcon,
  VideoIcon,
  VolumeOffIcon,
} from "../icons";
import { AudioDevicesCard } from "../views/DevicePicker";
import { MailDetail } from "../views/MailDetail";
import { ResolveSheet } from "../views/ResolveSheet";
import { appName, Artwork, Controls, Progress, TrackInfo } from "../views/MediaViews";

const GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox";

export function appAccent(alert: Pick<Alert, "kind" | "app">): string {
  if (alert.kind === "reminder") return "#ff9f0a";
  if (alert.kind === "mail") return "#ea4335";
  if (alert.kind === "calendar") return "#4285f4";
  if (alert.kind === "claude") return "#d97757";
  const app = alert.app?.toLowerCase() ?? "";
  if (app.includes("whatsapp")) return "#25d366";
  if (app.includes("discord")) return "#5865f2";
  if (app.includes("teams")) return "#6264a7";
  if (app.includes("slack")) return "#e01e5a";
  if (app.includes("telegram")) return "#2aabee";
  return "#0a84ff";
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function remindLater(alert: Alert, minutes: number) {
  const text = alert.kind === "mail" ? `Responder a ${alert.title}` : `${alert.app ?? ""}: ${alert.title}`.trim();
  ipc.addReminder(text, "reminder", Date.now() + minutes * 60_000);
  useIsland.getState().react("happy");
  sounds.done();
}

/* ---------------------------------------------------------------- Inicio */

export function HomeTab({ color }: { color: string }) {
  const { media, reminders, history, gmail, calendar, unseen, setTab } = useIsland();
  const now = useNow(1000);
  const next = reminders[0];
  const meeting = nextMeeting(calendar?.events ?? [], now);
  const showMeeting = meeting && (!next || startMs(meeting) < next.dueMs);
  const lastMail = history.find((a) => a.kind === "mail");
  const lastNotif = history.find((a) => a.kind === "notification");

  return (
    <div className="home-grid">
      <Card className="now-playing" index={0} onClick={() => setTab("music")}>
        {media ? (
          <>
            <div className="row gap-12">
              <div className="art-glow" style={{ boxShadow: `0 6px 26px rgba(${color}, 0.4)` }}>
                <Artwork media={media} size={58} radius={13} />
              </div>
              <div className="col grow min-w-0 gap-2">
                <TrackInfo media={media} />
                <span className="badge self-start">{appName(media.appId)}</span>
              </div>
            </div>
            {media.durationMs > 0 && <Progress media={media} color={color} />}
            <Controls media={media} />
          </>
        ) : (
          <Empty icon={<Mascot size={56} mood="sleep" />} title="Nada sonando" body="Pon algo en Spotify o YouTube y aparecerá aquí." />
        )}
      </Card>

      <div className="col gap-8 min-w-0">
        <Card index={1} className="mini-card" onClick={() => setTab("reminders")}>
          {showMeeting ? (
            <>
              <span className="mini-icon" style={{ color: "#8ab4f8" }}><CalendarIcon size={15} /></span>
              <div className="col grow min-w-0">
                <span className="text-sm truncate">{meeting.summary}</span>
                <span className={`caption ${isLive(meeting, now) ? "live-label" : ""}`}>{timeRange(meeting)} · {untilLabel(meeting, now)}</span>
              </div>
              {meeting.joinUrl && (
                <motion.button
                  className="join-btn"
                  whileTap={{ scale: 0.9 }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openUrl(meeting.joinUrl!);
                  }}
                >
                  <VideoIcon size={12} /> {joinLabel(meeting.joinUrl)}
                </motion.button>
              )}
            </>
          ) : next ? (
            <>
              <span className="mini-icon" style={{ color: next.kind === "timer" ? "#ff9f0a" : "#ffd60a" }}>
                {next.kind === "timer" ? <TimerIcon size={15} /> : <BellIcon size={15} />}
              </span>
              <div className="col grow min-w-0">
                <span className="text-sm truncate">{next.text}</span>
                <span className="caption">
                  {next.kind === "timer" ? formatCountdown(next.dueMs - now) : `${formatClock(next.dueMs)} · en ${formatCountdown(next.dueMs - now)}`}
                </span>
              </div>
              {reminders.length > 1 && <span className="badge">+{reminders.length - 1}</span>}
            </>
          ) : (
            <>
              <span className="mini-icon" style={{ color: "#ffd60a" }}><PlusIcon size={15} /></span>
              <div className="col grow min-w-0">
                <span className="text-sm">Sin recordatorios</span>
                <span className="caption">Pulsa para crear uno</span>
              </div>
            </>
          )}
        </Card>

        <Card index={2} className="mini-card" onClick={() => setTab("mail")}>
          <span className="mini-icon" style={{ color: "#ff6b5e" }}><MailIcon size={15} /></span>
          {gmail.connected ? (
            <>
              <div className="col grow min-w-0">
                <span className="text-sm truncate">{gmail.messages[0] ? gmail.messages[0].fromName : "Bandeja al día"}</span>
                <span className="caption truncate">{gmail.messages[0] ? gmail.messages[0].subject : gmail.email}</span>
              </div>
              {unseen.mail > 0 && <span className="badge mail-badge">{unseen.mail}</span>}
            </>
          ) : (
            <div className="col grow min-w-0">
              <span className="text-sm truncate">{lastMail ? lastMail.title : "Correo"}</span>
              <span className="caption truncate">{lastMail ? lastMail.body : "Conecta Gmail"}</span>
            </div>
          )}
        </Card>

        <Card index={3} className="mini-card" onClick={() => setTab("notifications")}>
          <span className="mini-icon" style={{ color: "#5ac8fa" }}><ChatIcon size={15} /></span>
          <div className="col grow min-w-0">
            <span className="text-sm truncate">{lastNotif ? `${lastNotif.app} · ${lastNotif.title}` : "Avisos"}</span>
            <span className="caption truncate">{lastNotif ? lastNotif.body : "Nada nuevo por ahora"}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Música */

export function MusicTab({ color }: { color: string }) {
  const media = useIsland((s) => s.media);
  const isSpotify = media && appName(media.appId) === "Spotify";

  return (
    <div className="music-grid">
      {/* Izquierda: lo que se reproduce. */}
      {media ? (
        <Card className="fill-card music-card" index={0}>
          <div
            className="music-backdrop"
            style={{ background: `radial-gradient(120% 140% at 0% 50%, rgba(${color}, 0.22), transparent 60%)` }}
          />
          <div className="col gap-10 rel fill">
            <div className="row gap-12 min-w-0">
              <div className="art-glow" style={{ boxShadow: `0 8px 28px rgba(${color}, 0.45)` }}>
                <Artwork media={media} size={72} radius={15} />
              </div>
              <div className="col grow min-w-0 gap-4">
                <TrackInfo media={media} big />
                <div className="row gap-6">
                  <span className="badge">{appName(media.appId)}</span>
                  {isSpotify && (
                    <IconButton onClick={() => openUrl("spotify:")} title="Abrir Spotify" size={24}>
                      <ExternalIcon size={12} />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
            {media.durationMs > 0 && <Progress media={media} color={color} />}
            <Controls media={media} extended />
          </div>
        </Card>
      ) : (
        <Card className="fill-card" index={0}>
          <Empty icon={<Mascot size={56} mood="sleep" />} title="Nada sonando" body="Pon algo en Spotify, el navegador o cualquier app con controles multimedia." />
        </Card>
      )}

      {/* Derecha: salida y entrada de audio. */}
      <Card className="fill-card audio-card" index={1}>
        <AudioDevicesCard />
        <span className="caption row gap-6 audio-keys">
          <Kbd>Espacio</Kbd><Kbd>←</Kbd><Kbd>→</Kbd>
        </span>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Correo */

/** Ícono real de la app (si Windows lo entrega) o inicial sobre su color. */
export function AppAvatar({ alert, size = 30 }: { alert: Alert; size?: number }) {
  if (alert.icon) {
    return (
      <span className="avatar app-icon" style={{ width: size, height: size }}>
        <img src={alert.icon} alt="" />
      </span>
    );
  }
  return (
    <span className="avatar" style={{ background: appAccent(alert), width: size, height: size }}>
      {alert.kind === "mail" ? initials(alert.title) : (alert.app ?? "?")[0]}
    </span>
  );
}

/** Abre la app que mandó la notificación (o Gmail para correos). */
export function openSource(alert: Alert) {
  if (alert.kind === "mail") return openUrl(alert.url ?? GMAIL_URL);
  if (alert.aumid) ipc.notifOpenApp(alert.aumid).catch(() => {});
}

function AlertRow({ alert, index }: { alert: Alert; index: number }) {
  const remove = useIsland((s) => s.removeFromHistory);
  const setPref = useIsland((s) => s.setPref);
  const muted = useIsland((s) => s.prefs.mutedApps);
  const done = () => {
    remove(alert.id);
    if (alert.winId !== undefined) ipc.notifDismiss(alert.winId).catch(() => {});
  };
  return (
    <motion.div
      layout="position"
      className="list-row"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.03 }}
      onClick={() => openSource(alert)}
      title={alert.aumid || alert.kind === "mail" ? `Abrir ${alert.app ?? ""}` : undefined}
    >
      <AppAvatar alert={alert} />
      <div className="col grow min-w-0">
        <div className="row gap-6 min-w-0">
          <span className="text-sm truncate">{alert.title}</span>
          {alert.kind === "notification" && <span className="caption nowrap">{alert.app}</span>}
        </div>
        <span className="caption truncate">{alert.body}</span>
      </div>
      <span className="caption nowrap">{relativeTime(alert.at ?? Date.now())}</span>
      <div className="row-actions">
        <IconButton onClick={() => remindLater(alert, 60)} title="Recordármelo en 1 h" size={26}>
          <ClockIcon size={13} />
        </IconButton>
        {alert.kind === "notification" && alert.app && (
          <IconButton
            onClick={() => {
              setPref("mutedApps", [...new Set([...muted, alert.app!])]);
              sounds.done();
            }}
            title={`Silenciar ${alert.app}`}
            size={26}
          >
            <VolumeOffIcon size={13} />
          </IconButton>
        )}
        <IconButton onClick={done} title="Listo (también lo quita de Windows)" size={26}>
          <CheckIcon size={13} />
        </IconButton>
      </div>
    </motion.div>
  );
}

const AVATAR_COLORS = ["#ea4335", "#a142f4", "#1a73e8", "#e37400", "#188038", "#d01884", "#12a4af", "#5f6368"];

function avatarColor(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function MailRow({ mail, index, onOpen, onRead }: { mail: MailItem; index: number; onOpen: (m: MailItem) => void; onRead: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const unread = mail.labels.includes("UNREAD");
  return (
    <motion.div
      layout="position"
      className={`list-row mail-row ${unread ? "unread" : "read"}`}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: busy ? 0.4 : 1, x: 0 }}
      exit={{ opacity: 0, x: 60, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.025 }}
      onClick={() => onOpen(mail)}
      title="Ver correo"
    >
      <span className="unread-dot" />
      <span className="avatar" style={{ background: avatarColor(mail.fromEmail) }}>{initials(mail.fromName)}</span>
      <div className="col grow min-w-0">
        <div className="row gap-6 min-w-0">
          <span className="text-sm truncate from" style={{ maxWidth: 170, flexShrink: 0 }}>{mail.fromName}</span>
          <span className="text-sm truncate subject">{mail.subject}</span>
        </div>
        <span className="caption truncate">{mail.snippet}</span>
      </div>
      <span className="caption nowrap">{relativeTime(mail.dateMs)}</span>
      <div className="row-actions">
        <IconButton onClick={() => useIsland.getState().setResolveMail(mail)} title="Resolver con Claude" size={26}>
          <SparkIcon size={13} />
        </IconButton>
        <IconButton
          onClick={() => remindLater({ id: mail.id, kind: "mail", title: mail.fromName, body: mail.subject }, 60)}
          title="Recordármelo en 1 h"
          size={26}
        >
          <ClockIcon size={13} />
        </IconButton>
        {unread && (
          <IconButton
            onClick={async () => {
              setBusy(true);
              try {
                await ipc.gmailMarkRead(mail.id);
                onRead(mail.id);
                sounds.done();
              } catch {
                sounds.nope();
              } finally {
                setBusy(false);
              }
            }}
            title="Marcar como leído"
            size={26}
          >
            <CheckIcon size={13} />
          </IconButton>
        )}
      </div>
    </motion.div>
  );
}

const SETUP_STEPS: { text: string; url: string }[] = [
  { text: "Crea un proyecto y activa la Gmail API", url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
  { text: "Pantalla de consentimiento: tipo Externo, agrégate como usuario de prueba", url: "https://console.cloud.google.com/auth/overview" },
  { text: "Credenciales → ID de cliente OAuth → «App de escritorio»", url: "https://console.cloud.google.com/apis/credentials" },
];

/** Paso 1: guardar el cliente OAuth propio (queda en el Administrador de credenciales). */
function GmailSetup() {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shake = useAnimationControls();

  const save = async () => {
    try {
      await ipc.gmailSetClient(clientId, secret);
      sounds.done();
    } catch (e) {
      setError(String(e));
      sounds.nope();
      shake.start({ x: [0, -8, 7, -5, 3, 0], transition: { duration: 0.4 } });
    }
  };

  return (
    <div className="setup-grid">
      <div className="col gap-6 min-w-0">
        <span className="section-title">Conecta tu Gmail · 1 vez</span>
        {SETUP_STEPS.map((step, i) => (
          <button key={step.url} className="setup-step" onClick={() => openUrl(step.url)}>
            <span className="step-num">{i + 1}</span>
            <span className="grow">{step.text}</span>
            <ExternalIcon size={12} />
          </button>
        ))}
        <span className="caption">Usa tu propio proyecto: los datos nunca pasan por un servidor ajeno.</span>
      </div>
      <motion.div className="col gap-6" animate={shake}>
        <span className="section-title">4 · Pega las credenciales</span>
        <input
          className="field"
          placeholder="Client ID (….apps.googleusercontent.com)"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setError(null);
          }}
          spellCheck={false}
        />
        <input
          className="field"
          type="password"
          placeholder="Client secret"
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          spellCheck={false}
        />
        {error ? <span className="field-error">{error}</span> : <span className="caption">Se guardan en el Administrador de credenciales de Windows.</span>}
        <motion.button className="pill-btn primary self-end" style={{ background: "var(--mascot)" }} whileTap={{ scale: 0.92 }} onClick={save}>
          Guardar
        </motion.button>
      </motion.div>
    </div>
  );
}

/** Paso 2: autorizar en el navegador. */
function GmailConnect() {
  const error = useIsland((s) => s.gmail.error);
  const [waiting, setWaiting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const connect = async () => {
    setWaiting(true);
    setLocalError(null);
    try {
      await ipc.gmailConnect();
      useIsland.getState().react("happy");
      sounds.done();
    } catch (e) {
      setLocalError(String(e));
      useIsland.getState().react("nope");
    } finally {
      setWaiting(false);
    }
  };

  return (
    <Empty
      icon={<Mascot size={60} mood={waiting ? "idle" : "sleep"} />}
      title={waiting ? "Autoriza en el navegador…" : "Conecta tu cuenta"}
      body={
        waiting
          ? "Se abrió Google en tu navegador. Si ves «Google no verificó esta app», es tu propio proyecto: Avanzado → Ir a la app."
          : "La isla leerá tus no leídos y podrá marcarlos como leídos. Nada más."
      }
    >
      {(localError || error) && <span className="field-error">{localError ?? error}</span>}
      <div className="row gap-8" style={{ marginTop: 8 }}>
        {!waiting && (
          <motion.button className="pill-btn primary" style={{ background: "var(--mascot)" }} whileTap={{ scale: 0.92 }} onClick={connect}>
            <MailIcon size={13} /> Conectar con Google
          </motion.button>
        )}
        <button className="link-btn" onClick={() => ipc.gmailForgetClient()}>Cambiar credenciales</button>
      </div>
    </Empty>
  );
}

type MailView = "unread" | "all";
const MAIL_VIEWS: Record<MailView, { label: string }> = { unread: { label: "No leídos" }, all: { label: "Todos" } };

export function MailTab() {
  const gmail = useIsland((s) => s.gmail);
  const resolveMail = useIsland((s) => s.resolveMail);
  const setResolveMail = useIsland((s) => s.setResolveMail);
  const filter = useIsland((s) => s.prefs.mailFilter);
  const [view, setView] = useState<MailView>("unread");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MailItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MailItem | null>(null);
  const now = useNow(15_000);

  // "No leídos" sin búsqueda = la lista en vivo del sondeo. Lo demás se pide a Gmail
  // (con una espera breve para no consultar en cada tecla).
  const live = view === "unread" && !search.trim();
  useEffect(() => {
    if (live || !gmail.connected) {
      setResults(null);
      return;
    }
    const q = search.trim() ? `${search.trim()}${view === "unread" ? " is:unread" : ""}` : "in:inbox";
    setLoading(true);
    const id = setTimeout(() => {
      ipc
        .gmailList(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, search.trim() ? 400 : 0);
    return () => clearTimeout(id);
  }, [live, view, search, gmail.connected, gmail.lastSyncMs]);

  const source = live ? gmail.messages : (results ?? []);
  const visible = source.filter((m) => matchesFilter(m.labels, filter));
  // Al leer un correo (detalle o botón) la lista lo muestra leído al instante.
  const markReadLocally = (id: string) =>
    setResults((list) => list?.map((m) => (m.id === id ? { ...m, labels: m.labels.filter((l) => l !== "UNREAD") } : m)) ?? null);

  if (!gmail.configured) {
    return <Card className="fill-card"><GmailSetup /></Card>;
  }
  if (!gmail.connected) {
    return <Card className="fill-card"><GmailConnect /></Card>;
  }

  return (
    <Card className="fill-card list-card">
      <div className="list-header">
        <div className="mail-search">
          <SearchIcon size={13} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setSearch("");
            }}
            placeholder="Buscar en Gmail (from:, asunto, has:attachment…)"
            spellCheck={false}
          />
          {loading && <span className="search-spinner" />}
          {search && (
            <button className="link-btn" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
              <CloseIcon size={11} />
            </button>
          )}
        </div>
        <Segmented id="mail-view" value={view} options={MAIL_VIEWS} onChange={setView} />
        {gmail.lastSyncMs > 0 && <span className="caption nowrap">{relativeTime(gmail.lastSyncMs, now)}</span>}
        <IconButton onClick={() => ipc.gmailRefresh()} title="Actualizar" size={26}>
          <RefreshIcon size={13} />
        </IconButton>
        <IconButton onClick={() => openUrl(`https://mail.google.com/mail/?authuser=${gmail.email ?? ""}`)} title={`Abrir Gmail (${gmail.email ?? ""})`} size={26}>
          <ExternalIcon size={13} />
        </IconButton>
      </div>
      <MailFilters messages={source} />
      {visible.length ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${filter}-${view}`}
            className="list"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <AnimatePresence initial={false}>
              {visible.map((m, i) => (
                <MailRow key={m.id} mail={m} index={i} onOpen={setDetail} onRead={markReadLocally} />
              ))}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      ) : (
        <Empty
          icon={search ? <SearchIcon size={22} /> : <CheckIcon size={22} />}
          title={search ? "Sin resultados" : "Nada pendiente"}
          body={
            loading || (!live && results === null)
              ? "Buscando…"
              : search
                ? `Gmail no encontró correos para «${search}».`
                : !gmail.lastSyncMs
                  ? "Sincronizando…"
                  : source.length
                    ? `Nada en «${MAIL_FILTERS.find((f) => f.id === filter)?.label}».`
                    : view === "unread"
                      ? "No tienes correos sin leer en la bandeja de entrada."
                      : "La bandeja de entrada está vacía."
          }
        />
      )}
      <AnimatePresence>
        {detail && (
          <MailDetail
            key={detail.id}
            mail={detail}
            onClose={() => setDetail(null)}
            onRead={markReadLocally}
            onRemind={(m) => remindLater({ id: m.id, kind: "mail", title: m.fromName, body: m.subject }, 60)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{resolveMail && <ResolveSheet mail={resolveMail} onClose={() => setResolveMail(null)} />}</AnimatePresence>
    </Card>
  );
}

/** Chips de categoría con contador + qué correos generan alerta. */
function MailFilters({ messages }: { messages: MailItem[] }) {
  const filter = useIsland((s) => s.prefs.mailFilter);
  const alerts = useIsland((s) => s.prefs.mailAlerts);
  const setPref = useIsland((s) => s.setPref);

  return (
    <div className="filter-row">
      <div className="filter-chips">
        {MAIL_FILTERS.map((f) => {
          const count = messages.filter((m) => f.test(m.labels)).length;
          if (!count && f.id !== "all" && f.id !== filter && f.id !== "primary") return null;
          const active = f.id === filter;
          return (
            <button key={f.id} className={`filter-chip ${active ? "active" : ""}`} onClick={() => setPref("mailFilter", f.id)}>
              {active && <motion.span layoutId="mail-filter" className="filter-chip-bg" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className="rel">{f.label}</span>
              {count > 0 && <span className="rel filter-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <label className="alert-select" title="Qué correos nuevos hacen saltar la isla">
        <BellIcon size={12} />
        <select value={alerts} onChange={(e) => setPref("mailAlerts", e.target.value as MailAlertMode)}>
          {MAIL_ALERT_MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/* --------------------------------------------------------- Recordatorios */

const PRESETS: { label: string; value: string; submit: boolean }[] = [
  { label: "Pomodoro", value: "pomodoro", submit: true },
  { label: "Timer 5 min", value: "timer 5 min", submit: true },
  { label: "Timer 15 min", value: "timer 15 min", submit: true },
  { label: "En 1 h…", value: "en 1 h ", submit: false },
  { label: "Mañana 9:00…", value: "mañana a las 9 ", submit: false },
];

function ReminderRow({ r, index }: { r: Reminder; index: number }) {
  const now = useNow(1000);
  const left = r.dueMs - now;
  const isTimer = r.kind === "timer";
  return (
    <motion.div
      layout="position"
      className="list-row"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.03 }}
    >
      {isTimer ? (
        <Ring progress={left / Math.max(1, r.dueMs - r.createdMs)} size={26} stroke={3}>
          <TimerIcon size={11} />
        </Ring>
      ) : (
        <span className="mini-icon" style={{ color: "#ffd60a" }}><BellIcon size={15} /></span>
      )}
      <span className="text-sm grow truncate">{r.text}</span>
      <span className="caption nowrap tabular" style={{ color: isTimer ? "#ff9f0a" : undefined }}>
        {isTimer ? formatCountdown(left) : `${formatClock(r.dueMs)} · ${formatCountdown(left)}`}
      </span>
      <div className="row-actions">
        <IconButton onClick={() => ipc.removeReminder(r.id)} title="Eliminar" size={26} className="danger">
          <TrashIcon size={13} />
        </IconButton>
      </div>
    </motion.div>
  );
}

export function RemindersTab() {
  const timeline = useTimeline();
  const react = useIsland((s) => s.react);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();
  const preview = parseReminder(value);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (text = value) => {
    const parsed = parseReminder(text);
    if (!parsed) {
      shake.start({ x: [0, -10, 9, -7, 5, -2, 0], transition: { duration: 0.45 } });
      react("nope");
      sounds.nope();
      return;
    }
    await ipc.addReminder(parsed.text, parsed.kind, parsed.dueMs);
    setValue("");
    react("happy");
    sounds.done();
  };

  return (
    <div className="col gap-8 fill">
      <motion.div className="input-row" animate={shake}>
        <PlusIcon size={16} />
        <input
          ref={input}
          value={value}
          placeholder="en 20 min sacar la ropa · a las 18:30 llamar a Juan · pomodoro"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            e.stopPropagation();
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
          spellCheck={false}
        />
        <AnimatePresence>
          {preview && (
            <motion.span className="badge" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
              {preview.kind === "timer" ? `timer ${formatCountdown(preview.dueMs - Date.now())}` : formatClock(preview.dueMs)}
            </motion.span>
          )}
        </AnimatePresence>
        <Kbd>Enter</Kbd>
      </motion.div>

      <div className="row gap-6 wrap">
        {PRESETS.map((p) => (
          <motion.button
            key={p.label}
            className="preset"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              if (p.submit) submit(p.value);
              else {
                setValue(p.value);
                input.current?.focus();
              }
            }}
          >
            {p.label}
          </motion.button>
        ))}
      </div>

      <Card className="list-card grow">
        <CalendarBanner />
        {timeline.length ? (
          <div className="list">
            <AnimatePresence initial={false}>
              {timeline.map((item, i) =>
                item.type === "event" ? (
                  <EventRow key={`e-${item.event.id}`} e={item.event} index={i} />
                ) : (
                  <ReminderRow key={item.reminder.id} r={item.reminder} index={i} />
                ),
              )}
            </AnimatePresence>
          </div>
        ) : (
          <Empty icon={<ClockIcon size={22} />} title="Nada pendiente" body="Escribe arriba en lenguaje natural o usa un atajo. Tus reuniones de hoy aparecen aquí." />
        )}
      </Card>
    </div>
  );
}

type TimelineItem = { type: "event"; at: number; event: CalEvent } | { type: "reminder"; at: number; reminder: Reminder };

/** Eventos de Calendar (no terminados) y recordatorios, ordenados por hora. */
function useTimeline(): TimelineItem[] {
  const reminders = useIsland((s) => s.reminders);
  const events = useIsland((s) => s.calendar?.events);
  const now = useNow(60_000);
  return [
    ...(events ?? []).filter((e) => endMs(e) > now).map((event) => ({ type: "event" as const, at: startMs(event), event })),
    ...reminders.map((reminder) => ({ type: "reminder" as const, at: reminder.dueMs, reminder })),
  ].sort((a, b) => a.at - b.at);
}

function EventRow({ e, index }: { e: CalEvent; index: number }) {
  const now = useNow(30_000);
  const live = !e.allDay && isLive(e, now);
  return (
    <motion.div
      layout="position"
      className={`list-row event-row ${live ? "live" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.03 }}
      onClick={() => openUrl(e.htmlLink)}
      title="Abrir en Google Calendar"
    >
      <span className="event-bar" />
      <div className="col grow min-w-0">
        <span className="text-sm truncate">{e.summary}</span>
        <span className="caption truncate">
          {timeRange(e)}
          {e.location && !e.joinUrl ? ` · ${e.location}` : ""}
        </span>
      </div>
      {!e.allDay && <span className={`caption nowrap ${live ? "live-label" : ""}`}>{untilLabel(e, now)}</span>}
      {e.joinUrl ? (
        <motion.button
          className="join-btn"
          whileTap={{ scale: 0.9 }}
          onClick={(ev) => {
            ev.stopPropagation();
            openUrl(e.joinUrl!);
          }}
        >
          <VideoIcon size={12} /> {joinLabel(e.joinUrl)}
        </motion.button>
      ) : (
        <span className="mini-icon" style={{ color: "#8ab4f8" }}><CalendarIcon size={14} /></span>
      )}
    </motion.div>
  );
}

/** Estado de la conexión con Calendar cuando falta algo por hacer. */
function CalendarBanner() {
  const cal = useIsland((s) => s.calendar);
  const gmail = useIsland((s) => s.gmail);
  const [busy, setBusy] = useState(false);
  if (!gmail.connected || !cal || cal.status === "ok" || cal.status === "disconnected") return null;

  const reconnect = async () => {
    setBusy(true);
    try {
      await ipc.gmailConnect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cal-banner">
      <CalendarIcon size={14} />
      {cal.status === "needs_scope" && (
        <>
          <span className="grow">Para ver tus reuniones, autoriza Google Calendar.</span>
          <button className="link-btn" onClick={reconnect}>{busy ? "Esperando al navegador…" : "Autorizar"}</button>
        </>
      )}
      {cal.status === "api_disabled" && (
        <>
          <span className="grow">Activa la Google Calendar API en tu proyecto y vuelve a intentar.</span>
          <button className="link-btn" onClick={() => openUrl("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com")}>
            Activar <ExternalIcon size={12} />
          </button>
          <button className="link-btn" onClick={() => ipc.calendarRefresh()}>Reintentar</button>
        </>
      )}
      {cal.status === "error" && (
        <>
          <span className="grow truncate">{cal.error ?? "No se pudo leer el calendario."}</span>
          <button className="link-btn" onClick={() => ipc.calendarRefresh()}>Reintentar</button>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Avisos */

const ACCESS_LABEL: Record<string, { text: string; color: string }> = {
  allowed: { text: "Conectado a Windows", color: "#30d158" },
  denied: { text: "Windows bloqueó el acceso", color: "#ff453a" },
  unspecified: { text: "Esperando permiso de Windows", color: "#ff9f0a" },
  error: { text: "No se pudo leer el centro de notificaciones", color: "#ff453a" },
  unknown: { text: "Conectando…", color: "#8e8e93" },
};

export function NotificationsTab() {
  const notifs = useIsland(useShallow((s) => s.history.filter((a) => a.kind === "notification")));
  const clear = useIsland((s) => s.clearHistory);
  const access = useIsland((s) => s.notifAccess);
  const { dnd, mutedApps } = useIsland((s) => s.prefs);
  const setPref = useIsland((s) => s.setPref);
  const status = ACCESS_LABEL[access] ?? ACCESS_LABEL.unknown;

  return (
    <Card className="fill-card list-card">
      <div className="list-header">
        <span className="title">Avisos</span>
        <span className="status-pill"><span className="dot" style={{ background: status.color }} />{status.text}</span>
        {(access === "denied" || access === "unspecified") && (
          <button className="link-btn" onClick={() => ipc.notifOpenSettings()}>Dar acceso <ExternalIcon size={12} /></button>
        )}
        <span className="grow" />
        <button
          className={`dnd-btn ${dnd ? "on" : ""}`}
          onClick={() => setPref("dnd", !dnd)}
          title="No molestar: se guardan aquí sin hacer saltar la isla"
        >
          <motion.span className="dnd-dot" animate={{ scale: dnd ? 1 : 0.6 }} />
          No molestar
        </button>
        {notifs.length > 0 && <button className="link-btn" onClick={() => clear("notification")}>Limpiar</button>}
      </div>

      {mutedApps.length > 0 && (
        <div className="muted-row">
          <span className="caption">Silenciadas:</span>
          <AnimatePresence initial={false}>
            {mutedApps.map((app) => (
              <motion.button
                key={app}
                className="muted-chip"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setPref("mutedApps", mutedApps.filter((a) => a !== app))}
                title={`Volver a avisar de ${app}`}
              >
                {app} <CloseIcon size={10} />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {notifs.length ? (
        <div className="list">
          <AnimatePresence initial={false}>
            {notifs.map((n, i) => <AlertRow key={n.id} alert={n} index={i} />)}
          </AnimatePresence>
        </div>
      ) : (
        <Empty
          icon={<ChatIcon size={22} />}
          title="Sin avisos nuevos"
          body={
            access === "allowed"
              ? "Cuando WhatsApp, Discord, Slack o Teams te escriban, aparecerá aquí y en la isla."
              : "Dale acceso en Configuración → Privacidad → Notificaciones para leer los avisos de tus apps."
          }
        />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Ajustes */

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!value)}>
      <div className="col grow min-w-0">
        <span className="text-sm">{label}</span>
        <span className="caption">{hint}</span>
      </div>
      <span className={`switch ${value ? "on" : ""}`}>
        <motion.span className="switch-knob" layout transition={{ type: "spring", stiffness: 600, damping: 32 }} />
      </span>
    </button>
  );
}


/** Muestras de color redondas. */
function Swatches<T extends string>({ value, options, onChange }: { value: T; options: Record<T, { label: string; rgb: string; light?: boolean }>; onChange: (v: T) => void }) {
  return (
    <div className="swatches">
      {(Object.keys(options) as T[]).map((key) => (
        <motion.button
          key={key}
          className={`swatch ${key === value ? "active" : ""}`}
          style={{ background: `rgb(${options[key].rgb})` }}
          title={options[key].label}
          aria-label={options[key].label}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.88 }}
          onClick={() => onChange(key)}
        >
          {key === value && (
            <motion.span className="swatch-check" style={options[key].light ? { color: "#222", filter: "none" } : undefined} initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <CheckIcon size={11} />
            </motion.span>
          )}
        </motion.button>
      ))}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      {children}
    </div>
  );
}

type SettingsSection = "appearance" | "general" | "shortcuts";
const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Apariencia" },
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Atajos" },
];

function AppearanceSettings() {
  const { prefs, setPref } = useIsland();
  return (
    <div className="col gap-8">
      <SettingRow label="Color de la isla">
        <Swatches value={prefs.islandColor} options={ISLAND_COLORS} onChange={(v) => setPref("islandColor", v)} />
      </SettingRow>
      <SettingRow label="Acento y Bolo">
        <Swatches value={prefs.accent} options={ACCENTS} onChange={(v) => setPref("accent", v)} />
      </SettingRow>
      <SettingRow label="Tamaño">
        <Segmented id="size" value={prefs.size} options={SIZES} onChange={(v) => setPref("size", v)} />
      </SettingRow>
      <SettingRow label="Forma">
        <Segmented id="shape" value={prefs.shape} options={SHAPES} onChange={(v) => setPref("shape", v)} />
      </SettingRow>
      <SettingRow label="Posición">
        <Segmented id="anchor" value={prefs.anchor} options={ANCHORS} onChange={(v) => setPref("anchor", v)} />
      </SettingRow>
      <SettingRow label="Opacidad">
        <div className="row gap-8 slider-wrap">
          <input
            type="range"
            className="slider"
            min={70}
            max={100}
            step={5}
            value={Math.round(prefs.opacity * 100)}
            onChange={(e) => setPref("opacity", Number(e.target.value) / 100)}
          />
          <span className="caption tabular" style={{ width: 32, textAlign: "right" }}>{Math.round(prefs.opacity * 100)}%</span>
        </div>
      </SettingRow>
      <SettingRow label="Brillo de la música">
        <button className={`switch ${prefs.glow ? "on" : ""}`} onClick={() => setPref("glow", !prefs.glow)} aria-label="Brillo de la música">
          <motion.span className="switch-knob" layout transition={{ type: "spring", stiffness: 600, damping: 32 }} />
        </button>
      </SettingRow>
    </div>
  );
}

export function SettingsTab() {
  const { prefs, setPref, shortcuts } = useIsland();
  const [section, setSection] = useState<SettingsSection>("appearance");
  return (
    <div className="settings-layout">
      <div className="settings-nav">
        {SETTINGS_SECTIONS.map((s) => (
          <button key={s.id} className={`settings-nav-item ${s.id === section ? "active" : ""}`} onClick={() => setSection(s.id)}>
            {s.id === section && <motion.span layoutId="settings-nav" className="settings-nav-bg" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            <span className="rel">{s.label}</span>
          </button>
        ))}
        <span className="grow" />
        <button
          className="link-btn"
          onClick={() => (Object.keys(DEFAULT_APPEARANCE) as (keyof typeof DEFAULT_APPEARANCE)[]).forEach((k) => setPref(k, DEFAULT_APPEARANCE[k]))}
          title="Volver a la apariencia original"
        >
          Restablecer
        </button>
      </div>
      <Card className="settings-body" index={0} key={section}>
        {section === "appearance" && <AppearanceSettings />}
        {section === "general" && (
          <div className="col gap-4">
            <Toggle label="Ocultar en reposo" hint="Se esconde en el borde; se asoma con el mouse arriba o cuando pasa algo" value={prefs.autoHide} onChange={(v) => setPref("autoHide", v)} />
            <Toggle label="Abrir al pasar el mouse" hint="Si no, se abre con clic o atajo" value={prefs.hoverOpen} onChange={(v) => setPref("hoverOpen", v)} />
            <Toggle label="Sonidos" hint="Avisos, recordatorios y clics" value={prefs.sounds} onChange={(v) => setPref("sounds", v)} />
            <Toggle label="Bolo" hint="La mascota que vive en la isla" value={prefs.mascot} onChange={(v) => setPref("mascot", v)} />
            <Toggle label="Aprobar permisos de Claude" hint="Permitir o denegar desde la isla; si no, siguen en la terminal" value={prefs.claudeApprove} onChange={(v) => setPref("claudeApprove", v)} />
          </div>
        )}
        {section === "shortcuts" && (
      <div className="col gap-6">
        <span className="section-title">Atajos</span>
        <div className="shortcut-row"><span>Abrir o cerrar la isla</span><Kbd>{prettyShortcut(shortcuts.toggle) || "—"}</Kbd></div>
        <div className="shortcut-row"><span>Nuevo recordatorio</span><Kbd>{prettyShortcut(shortcuts["quick-add"]) || "—"}</Kbd></div>
        <div className="shortcut-row"><span>Cambiar pestaña</span><Kbd>1–5</Kbd></div>
        <div className="shortcut-row"><span>Reproducir · anterior · siguiente</span><span className="row gap-4"><Kbd>Espacio</Kbd><Kbd>←</Kbd><Kbd>→</Kbd></span></div>
        <div className="shortcut-row"><span>Fijar · cerrar</span><span className="row gap-4"><Kbd>P</Kbd><Kbd>Esc</Kbd></span></div>
        <span className="caption" style={{ marginTop: 2 }}>«Iniciar con Windows» está en el ícono de la bandeja.</span>
      </div>
        )}
      </Card>
    </div>
  );
}


/* ----------------------------------------------------------------- Claude */

const CLAUDE_STATUS: Record<ClaudeStatus, { label: string; color: string }> = {
  waiting: { label: "Te necesita", color: "#ff9f0a" },
  working: { label: "Trabajando", color: "#d97757" },
  done: { label: "Terminó", color: "#30d158" },
};
const STATUS_ORDER: Record<ClaudeStatus, number> = { waiting: 0, working: 1, done: 2 };

const usageColor = (pct: number) => (pct >= 95 ? "#ff453a" : pct >= 80 ? "#ff9f0a" : "#d97757");

/** Límites del plan (5 h y semana) con su hora de reinicio. */
function UsageBars() {
  const usage = useIsland((s) => s.claudeUsage);
  const now = useNow(60_000);
  const windows = [
    { label: "5 horas", w: usage?.fiveHour },
    { label: "Semana", w: usage?.sevenDay },
  ].filter((x): x is { label: string; w: UsageWindow } => !!x.w);
  if (!windows.length) return null;
  return (
    <div className="usage-bars">
      {windows.map(({ label, w }) => (
        <div key={label} className="usage-bar" title={`Se reinicia: ${resetLabel(w.resetsAtMs, now)}`}>
          <div className="row spread">
            <span className="caption">{label}</span>
            <span className="caption tabular" style={{ color: usageColor(w.pct) }}>
              {Math.round(w.pct)} %{w.resetsAtMs ? ` · ${resetLabel(w.resetsAtMs, now)}` : ""}
            </span>
          </div>
          <div className="usage-track">
            <motion.div
              className="usage-fill"
              style={{ background: usageColor(w.pct) }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, w.pct)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionRow({ s, index }: { s: ClaudeSession; index: number }) {
  const now = useNow(1000, s.status === "working");
  const meta = CLAUDE_STATUS[s.status];
  return (
    <motion.div
      layout="position"
      className="list-row session-row"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.03 }}
      onClick={() => ipc.claudeFocus(s.ancestors).catch(() => {})}
      title="Ir a la sesión"
    >
      <span className={`session-dot ${s.status}`} style={{ background: meta.color }} />
      <div className="col grow min-w-0">
        <div className="row gap-6 min-w-0">
          <span className="text-sm truncate" style={{ flexShrink: 0, maxWidth: 200 }}>{s.project}</span>
          <span className="caption nowrap" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <span className="caption truncate">
          {s.status === "working" ? s.activity : s.status === "waiting" ? s.message : s.message || s.prompt}
        </span>
      </div>
      {s.contextPct !== undefined && (
        <span className="caption nowrap tabular ctx-pill" title={`${s.model ?? "Claude"} · contexto usado`}>
          {s.model ? `${s.model} · ` : ""}ctx {Math.round(s.contextPct)} %
        </span>
      )}
      {s.added + s.removed > 0 && (
        <span className="diff nowrap">
          <span className="add">+{s.added}</span> <span className="del">−{s.removed}</span>
        </span>
      )}
      <span className="caption nowrap tabular">
        {s.status === "working" ? formatDuration(now - s.turnStartedMs) : relativeTime(s.lastEventMs)}
      </span>
    </motion.div>
  );
}

function ClaudeSetup({ status, onDone }: { status: ClaudeHooksStatus | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await ipc.claudeHooksInstall();
      useIsland.getState().setClaudeHooks(true);
      useIsland.getState().react("happy");
      sounds.done();
      onDone();
    } catch (e) {
      setError(String(e));
      sounds.nope();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="claude-setup">
      <Mascot size={58} mood="idle" />
      <div className="col gap-6 grow min-w-0">
        <span className="title">Conecta Claude Code</span>
        <span className="subtitle">
          Wiri agrega hooks a <code>{status?.settingsPath ?? "~/.claude/settings.json"}</code> para ver tus sesiones en vivo y avisarte cuando Claude termina o te necesita. Antes guarda un respaldo y no toca nada más.
        </span>
        <span className="caption truncate">Eventos: {(status?.events ?? []).join(", ")}</span>
        {(error || status?.error) && <span className="field-error">{error ?? status?.error}</span>}
        <div className="row gap-8">
          <motion.button className="pill-btn primary" style={{ background: "#d97757", color: "#fff" }} whileTap={{ scale: 0.92 }} onClick={install} disabled={busy}>
            <SparkIcon size={12} /> {busy ? "Instalando…" : "Instalar hooks"}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

export function ClaudeTab() {
  const sessions = useIsland((s) => s.claude);
  const installed = useIsland((s) => s.claudeHooks);
  const [status, setStatus] = useState<ClaudeHooksStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () =>
    ipc.claudeHooksStatus().then((st) => {
      setStatus(st);
      useIsland.getState().setClaudeHooks(st.installed);
    });
  useEffect(() => {
    refresh();
  }, []);

  if (!installed) {
    return (
      <Card className="fill-card">
        <ClaudeSetup status={status} onDone={refresh} />
      </Card>
    );
  }

  const list = Object.values(sessions).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lastEventMs - a.lastEventMs,
  );

  return (
    <Card className="fill-card list-card">
      <div className="list-header">
        <span className="title">Claude Code</span>
        <span className="status-pill"><span className="dot" style={{ background: "#30d158" }} />Hooks conectados</span>
        <span className="grow" />
        {note && <span className="caption truncate" style={{ maxWidth: 220 }}>{note}</span>}
        {status?.otherStatusLine && <span className="caption" title="Tienes otra línea de estado en Claude Code; Wiri no la reemplazó, así que no recibe el contexto ni los límites del plan.">Sin datos de uso</span>}
        <button
          className="link-btn"
          onClick={async () => {
            const backup = await ipc.claudeHooksUninstall();
            setNote(backup ? "Hooks quitados (respaldo guardado)" : "Hooks quitados");
            refresh();
          }}
        >
          Desinstalar
        </button>
      </div>
      <UsageBars />
      {list.length ? (
        <div className="list">
          <AnimatePresence initial={false}>
            {list.map((s, i) => <SessionRow key={s.id} s={s} index={i} />)}
          </AnimatePresence>
        </div>
      ) : (
        <Empty
          icon={<SparkIcon size={22} />}
          title="Sin sesiones activas"
          body="Escríbele algo a Claude Code (terminal, VS Code o la app) y la sesión aparecerá aquí en vivo."
        />
      )}
    </Card>
  );
}
