/** "Resolver con Claude": sugerencia de proyecto y armado del encargo a partir de un correo. */
import type { ClaudeProject, MailItem } from "./ipc";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Palabras de nombres de carpeta que no identifican a un proyecto. */
const GENERIC = new Set(["app", "web", "api", "repo", "frontend", "backend", "front", "back", "proyecto", "proyectos", "projects", "desktop", "the", "del", "los", "las"]);

const tokens = (name: string) =>
  normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC.has(t));

/**
 * Proyecto más probable para un correo: cuenta cuántas palabras del nombre de cada
 * carpeta aparecen en el asunto (×3), el remitente (×2) y el cuerpo (×1).
 */
export function suggestProject(projects: ClaudeProject[], mail: MailItem, body: string): ClaudeProject | null {
  const subject = normalize(mail.subject);
  const from = normalize(`${mail.fromName} ${mail.fromEmail}`);
  const text = normalize(body);
  let best: { p: ClaudeProject; score: number } | null = null;
  for (const p of projects) {
    const score = tokens(p.name).reduce(
      (acc, t) => acc + (subject.includes(t) ? 3 : 0) + (from.includes(t) ? 2 : 0) + (text.includes(t) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

export const DEFAULT_INSTRUCTIONS =
  "Este correo describe un problema o un pedido. Ubícalo en este proyecto y propón una solución. " +
  "Primero resume lo que entendiste y el plan, y espera mi visto bueno antes de hacer cambios grandes.";

/** Contenido del archivo de encargo que leerá Claude Code. */
export function buildBrief(mail: MailItem, body: string, instructions: string): string {
  const date = mail.dateMs ? new Date(mail.dateMs).toLocaleString("es-CL") : "";
  return [
    "# Encargo desde Wiri",
    "",
    `**De:** ${mail.fromName} <${mail.fromEmail}>`,
    `**Asunto:** ${mail.subject}`,
    ...(date ? [`**Fecha:** ${date}`] : []),
    "",
    "## Qué hacer",
    "",
    instructions.trim(),
    "",
    "## Correo",
    "",
    body.trim() || mail.snippet,
    "",
  ].join("\n");
}
