import { AnimatePresence, motion } from "motion/react";
import { useRef, type ComponentType } from "react";
import { ipc } from "../../lib/ipc";
import { useIsland, TABS, type Tab } from "../../store/islandStore";
import { Mascot, type Mood } from "../Mascot";
import { IconButton } from "../parts";
import {
  CalendarIcon,
  ChatIcon,
  ChevronUpIcon,
  HomeIcon,
  MailIcon,
  MusicIcon,
  PinIcon,
  SlidersIcon,
  SparkIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "../icons";
import { ClaudeTab, HomeTab, MailTab, MusicTab, NotificationsTab, RemindersTab, SettingsTab } from "./Tabs";

/** Alto total del panel por pestaña (barra de pestañas incluida). */
export const PANEL_H: Record<Tab, number> = {
  home: 222,
  music: 246,
  mail: 340,
  reminders: 292,
  notifications: 262,
  claude: 262,
  settings: 326,
};

const TAB_META: Record<Tab, { label: string; Icon: ComponentType<{ size?: number }> }> = {
  home: { label: "Inicio", Icon: HomeIcon },
  music: { label: "Música", Icon: MusicIcon },
  mail: { label: "Correo", Icon: MailIcon },
  reminders: { label: "Agenda", Icon: CalendarIcon },
  notifications: { label: "Avisos", Icon: ChatIcon },
  claude: { label: "Claude", Icon: SparkIcon },
  settings: { label: "Ajustes", Icon: SlidersIcon },
};

export function Panel({ mood, color, onClose }: { mood: Mood; color: string; onClose: () => void }) {
  const { tab, setTab, pinned, togglePin, unseen, reminders, prefs, setPref } = useIsland();
  const prevIndex = useRef(TABS.indexOf(tab));
  const index = TABS.indexOf(tab);
  const direction = index >= prevIndex.current ? 1 : -1;
  prevIndex.current = index;

  const badge: Partial<Record<Tab, number>> = {
    mail: unseen.mail,
    notifications: unseen.notification,
    reminders: reminders.length,
  };

  return (
    <div className="panel" onPointerDown={() => ipc.grabFocus()}>
      <div className="toolbar">
        {prefs.mascot && <Mascot size={34} mood={mood} color={mood === "dance" ? color : undefined} pokeable />}
        <div className="tabs" role="tablist">
          {TABS.filter((t) => t !== "settings").map((t, i) => {
            const { label, Icon } = TAB_META[t];
            const active = t === tab;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                className={`tab ${active ? "active" : ""}`}
                onClick={() => setTab(t)}
                title={`${label} (${i + 1})`}
              >
                {active && (
                  <motion.span
                    layoutId="tab-highlight"
                    className="tab-highlight"
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                  />
                )}
                <span className="tab-content">
                  <Icon size={15} />
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.span
                        className="tab-label"
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: "auto", opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 38 }}
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {!!badge[t] && !active && (
                    <motion.span className="tab-badge" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      {badge[t]}
                    </motion.span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="row gap-2">
          <IconButton onClick={togglePin} active={pinned} title="Fijar abierta (P)" size={30}>
            <PinIcon size={15} />
          </IconButton>
          <IconButton onClick={() => setPref("sounds", !prefs.sounds)} title="Sonidos" size={30}>
            {prefs.sounds ? <VolumeIcon size={15} /> : <VolumeOffIcon size={15} />}
          </IconButton>
          <IconButton onClick={() => setTab("settings")} active={tab === "settings"} title="Ajustes" size={30}>
            <SlidersIcon size={15} />
          </IconButton>
          <IconButton onClick={onClose} title="Cerrar (Esc)" size={30}>
            <ChevronUpIcon size={16} />
          </IconButton>
        </div>
      </div>

      <div className="panel-body">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={tab}
            className="tab-page"
            custom={direction}
            initial={{ opacity: 0, x: 28 * direction, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -28 * direction, filter: "blur(6px)" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            {tab === "home" && <HomeTab color={color} />}
            {tab === "music" && <MusicTab color={color} />}
            {tab === "mail" && <MailTab />}
            {tab === "reminders" && <RemindersTab />}
            {tab === "notifications" && <NotificationsTab />}
            {tab === "claude" && <ClaudeTab />}
            {tab === "settings" && <SettingsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
