/**
 * Moverse por el panel con ↑/↓: marca filas y tarjetas de la pestaña actual y Enter
 * las abre (hace clic). Trabaja sobre el DOM para servir en todas las pestañas sin
 * que cada una lleve su propio estado.
 */

/** Lo que se puede elegir con las flechas, en orden de aparición. */
const SELECTOR = [".list-row", ".card.clickable", ".step-row.clickable", ".ask-option", ".chat-msg.claude"].join(", ");
const CLASS = "nav-focus";

const items = () => Array.from(document.querySelectorAll<HTMLElement>(`.panel-body ${SELECTOR}`)).filter((el) => el.offsetParent !== null);
const current = () => document.querySelector<HTMLElement>(`.panel-body .${CLASS}`);

export function moveNav(step: 1 | -1) {
  const list = items();
  if (!list.length) return;
  const now = current();
  const at = now ? list.indexOf(now) : -1;
  // Sin selección: ↓ empieza arriba y ↑ abajo.
  const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + step));
  now?.classList.remove(CLASS);
  list[next].classList.add(CLASS);
  list[next].scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Enter: abre lo marcado. Devuelve si había algo marcado. */
export function activateNav(): boolean {
  const el = current();
  if (!el) return false;
  el.click();
  return true;
}

/** Quita la marca. Devuelve si había algo marcado. */
export function clearNav(): boolean {
  const el = current();
  el?.classList.remove(CLASS);
  return !!el;
}
