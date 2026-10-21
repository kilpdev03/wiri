import { demo } from "./mock";

/** Botonera para disparar estados de la isla en modo navegador. */
export function DevBar() {
  const btn = (label: string, fn: () => void) => (
    <button key={label} onClick={fn} className="devbar-btn">
      {label}
    </button>
  );
  return (
    <div className="devbar">
      {btn("Hover", () => demo.hover(true))}
      {btn("Salir", () => demo.hover(false))}
      {btn("Ventana arriba", () => demo.occluded(true))}
      {btn("Escritorio libre", () => demo.occluded(false))}
      {btn("Abrir/cerrar panel", demo.toggle)}
      {btn("Notificación", () => demo.alert("notification"))}
      {btn("Correo", () => demo.alert("mail"))}
      {btn("Correo promo", demo.promoMail)}
      {btn("Recordatorio", demo.reminderDue)}
      {btn("Quick-add", demo.quickAdd)}
      {btn("Volumen", demo.volume)}
      {btn("Silencio", demo.mute)}
      {btn("Audífonos", demo.device)}
      {btn("Cargador", demo.power)}
      {btn("Micrófono", demo.mic)}
      {btn("Actualización", demo.update)}
      {btn("Sin música", demo.noMedia)}
      {btn("Con música", demo.media)}
    </div>
  );
}
