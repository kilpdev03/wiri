import { useIsland } from "../store/islandStore";
import { ipc } from "./ipc";
import { sounds } from "./sounds";

/** Silencia o reactiva el micrófono (atajo global o clic en la isla) y lo confirma en la isla. */
export async function toggleMic() {
  try {
    const muted = await ipc.micToggleMute();
    const s = useIsland.getState();
    // El sondeo de Rust lo confirmaría en ~1 s; así se ve al instante.
    s.setPrivacy({ ...s.privacy, micMuted: muted });
    s.showOsd({ kind: "mic", muted }, 1800);
    if (muted) sounds.nope();
    else sounds.done();
  } catch (e) {
    console.warn("[mic]", e);
  }
}
