/**
 * Bolo en el escritorio, lado de la isla: lo saca, lo trae y lo manda a casa
 * mientras hay una alerta. La ventana y su movimiento viven en src-tauri/src/buddy.rs.
 */
import { invoke } from "@tauri-apps/api/core";
import { useIsland } from "../store/islandStore";

export const buddyFlyOut = () => invoke<boolean>("buddy_fly_out").catch(() => false);
/** `forget`: lo guardas tú; sin él, solo viene a la isla por una alerta. */
export const buddyFlyHome = (forget: boolean) => invoke("buddy_fly_home", { forget }).catch(() => {});
/** Arrastrándolo fuera de la isla: aparece bajo el cursor y lo sigue. */
export const buddyPickUp = () => invoke<boolean>("buddy_pick_up").catch(() => false);

/** Al arrancar: si quedó en el escritorio, vuela a su lugar. Y vuelve a la isla durante las alertas. */
export function startBuddy() {
  invoke<boolean>("buddy_info")
    .then((onDesktop) => onDesktop && setTimeout(buddyFlyOut, 1500))
    .catch(() => {});

  let homeForAlert = false;
  return useIsland.subscribe((st, prev) => {
    const had = prev.alerts.length > 0;
    const has = st.alerts.length > 0;
    if (!had && has && st.buddyAway) {
      homeForAlert = true;
      buddyFlyHome(false);
    } else if (had && !has && homeForAlert) {
      homeForAlert = false;
      setTimeout(buddyFlyOut, 400);
    }
  });
}
