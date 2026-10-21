export type MailFilter = "all" | "primary" | "important" | "starred" | "social" | "promotions" | "updates";

/** Qué correos nuevos hacen saltar la isla. */
export type MailAlertMode = "all" | "primary" | "important" | "none";

const CATEGORIES = ["CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

/** Principal = categoría «Personal» o sin categoría (cuentas sin pestañas). */
const isPrimary = (labels: string[]) =>
  labels.includes("CATEGORY_PERSONAL") || !labels.some((l) => CATEGORIES.includes(l));

export const MAIL_FILTERS: { id: MailFilter; label: string; test: (labels: string[]) => boolean }[] = [
  { id: "all", label: "Todos", test: () => true },
  { id: "primary", label: "Principal", test: isPrimary },
  { id: "important", label: "Importantes", test: (l) => l.includes("IMPORTANT") },
  { id: "starred", label: "Destacados", test: (l) => l.includes("STARRED") },
  { id: "social", label: "Social", test: (l) => l.includes("CATEGORY_SOCIAL") },
  { id: "promotions", label: "Promociones", test: (l) => l.includes("CATEGORY_PROMOTIONS") },
  { id: "updates", label: "Novedades", test: (l) => l.includes("CATEGORY_UPDATES") || l.includes("CATEGORY_FORUMS") },
];

export const MAIL_ALERT_MODES: { id: MailAlertMode; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "primary", label: "Principal" },
  { id: "important", label: "Importantes" },
  { id: "none", label: "Ninguno" },
];

export function matchesFilter(labels: string[] | undefined, filter: MailFilter): boolean {
  return (MAIL_FILTERS.find((f) => f.id === filter) ?? MAIL_FILTERS[0]).test(labels ?? []);
}

/** ¿Este correo nuevo debe mostrar alerta? Sin etiquetas (alertas de prueba) siempre sí. */
export function shouldAlert(labels: string[] | undefined, mode: MailAlertMode): boolean {
  if (mode === "none") return false;
  if (!labels || mode === "all") return true;
  return mode === "primary" ? isPrimary(labels) : labels.includes("IMPORTANT");
}
