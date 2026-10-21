import { ipc, type UpdateInfo } from "./ipc";
import { sounds } from "./sounds";
import { useIsland } from "../store/islandStore";

/** Versiones ya avisadas en esta sesión (el chequeo se repite cada 6 h). */
const announced = new Set<string>();

/** Hay versión nueva: queda en Ajustes y se avisa una vez en la isla. */
export function onUpdateAvailable(info: UpdateInfo) {
  const st = useIsland.getState();
  if (st.update?.progress != null) return;
  st.setUpdate({ ...info, progress: null, error: null });
  if (announced.has(info.version)) return;
  announced.add(info.version);
  sounds.chime();
  st.pushAlert({
    id: `update-${info.version}`,
    kind: "update",
    app: "Wiri",
    title: `Wiri ${info.version} disponible`,
    body: info.notes?.split("\n").find((l) => l.trim())?.replace(/^[#*\-\s]+/, "") || `Tienes la ${info.current}`,
  });
}

/** Descarga e instala; el instalador cierra Wiri y la vuelve a abrir. */
export async function installUpdate() {
  const st = useIsland.getState();
  if (st.update?.progress != null) return;
  if (st.update) st.setUpdate({ ...st.update, progress: 0, error: null });
  try {
    await ipc.updateInstall();
  } catch (e) {
    const cur = useIsland.getState().update;
    if (cur) useIsland.getState().setUpdate({ ...cur, progress: null, error: String(e) });
  }
}

export function onUpdateProgress(progress: number) {
  const cur = useIsland.getState().update;
  if (cur) useIsland.getState().setUpdate({ ...cur, progress });
}
