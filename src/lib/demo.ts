/**
 * Modo demo: un recorrido guionado con datos de ejemplo (sesión de Claude, permiso,
 * pregunta, plan, avisos). Todo vive en la isla: no se guarda nada ni se llama a
 * Claude Code, y al terminar se borra la sesión de ejemplo.
 */
import { useIsland } from "../store/islandStore";
import { applyHook, type HookPayload } from "./claude";
import { sounds } from "./sounds";

const SESSION = "wiri-demo";
let running = false;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a que respondas la tarjeta (o pasa sola después de `max` ms). */
async function untilAnswered(id: string, max: number) {
  const end = Date.now() + max;
  while (Date.now() < end && useIsland.getState().alerts.some((a) => a.id === id)) await wait(250);
  useIsland.getState().dismissAlert(id);
}

function hook(event: Record<string, any>) {
  const s = useIsland.getState();
  const payload: HookPayload = { event: { session_id: SESSION, cwd: "C:\\Proyectos\\tienda-online", ...event }, ancestors: [] };
  const { sessions } = applyHook(s.claude, payload);
  s.setClaude(sessions);
}

export const demoRunning = () => running;

export async function runDemo() {
  if (running) return;
  running = true;
  const s = useIsland.getState();
  try {
    s.closePanel();
    s.react("hello");
    s.flash(3000);
    hook({ hook_event_name: "UserPromptSubmit", prompt: "Agrega validación al formulario de pago" });
    await wait(1500);
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "src/checkout/Form.tsx" } });
    await wait(900);
    hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "src/checkout/Form.tsx" } });
    hook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/checkout/Form.tsx" } });
    await wait(1200);
    hook({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: {
        file_path: "C:\\Proyectos\\tienda-online\\src\\checkout\\Form.tsx",
        old_string: "  if (!email) return;\n  submit(data);",
        new_string: "  if (!email || !isValidEmail(email)) {\n    setError(\"Correo inválido\");\n    return;\n  }\n  submit(data);",
      },
    });

    // Permiso.
    await wait(800);
    sounds.chime();
    s.pushAlert({
      id: "demo-perm",
      kind: "claude",
      app: "Claude Code · tienda-online (demo)",
      title: "Claude quiere ejecutar un comando",
      body: "pnpm test checkout",
      permission: { id: "demo-perm", sessionId: SESSION, tool: "Bash", detail: "pnpm test checkout", canAlways: true },
    });
    await untilAnswered("demo-perm", 12_000);

    // Pregunta.
    await wait(700);
    sounds.chime();
    s.pushAlert({
      id: "demo-question",
      kind: "claude",
      app: "Claude Code · tienda-online (demo)",
      title: "Claude te pregunta",
      body: "¿Dónde muestro el error?",
      permission: {
        id: "demo-question",
        sessionId: SESSION,
        tool: "AskUserQuestion",
        detail: "",
        canAlways: false,
        questions: [
          {
            question: "¿Dónde muestro el error de validación?",
            header: "Diseño",
            options: [
              { label: "Bajo el campo", description: "Texto rojo debajo del correo" },
              { label: "Arriba del formulario", description: "Un aviso general" },
              { label: "Como toast", description: "Mensaje flotante que se va solo" },
            ],
          },
        ],
      },
    });
    await untilAnswered("demo-question", 15_000);

    // Plan.
    await wait(700);
    sounds.chime();
    s.pushAlert({
      id: "demo-plan",
      kind: "claude",
      app: "Claude Code · tienda-online (demo)",
      title: "Plan listo para revisar",
      body: "Validación del formulario de pago",
      permission: {
        id: "demo-plan",
        sessionId: SESSION,
        tool: "ExitPlanMode",
        detail: "",
        canAlways: true,
        plan: "# Validación del formulario de pago\n\n1. Agregar `isValidEmail` en `lib/validate.ts`\n2. Mostrar el error bajo el campo de correo\n3. Deshabilitar \"Pagar\" mientras haya errores\n4. Tests para correos válidos e inválidos",
      },
    });
    await untilAnswered("demo-plan", 20_000);

    // Termina.
    await wait(900);
    hook({ hook_event_name: "Stop", last_assistant_message: "Listo: el formulario valida el correo y muestra el error bajo el campo." });
    sounds.done();
    s.react("happy");
    s.pushAlert({ id: "demo-done", kind: "claude", app: "Claude Code (demo)", title: "Claude terminó", body: "tienda-online · 42 s · 1 archivo +5 −2" });
    await untilAnswered("demo-done", 5000);

    // Otros avisos.
    await wait(600);
    s.showOsd({ kind: "bt-low", device: { name: "Audífonos (demo)", percent: 18 } }, 3000);
    await wait(3400);
    s.showOsd({ kind: "mic", muted: true }, 1800);
    await wait(2200);
    s.pushAlert({ id: "demo-mail", kind: "mail", app: "Gmail (demo)", title: "Camila Rojas", body: "¿Revisamos la propuesta el jueves?" });
    await untilAnswered("demo-mail", 6000);

    // Para ver los pasos y la diferencia del ejemplo.
    s.openPanel("claude");
    await wait(10_000);
  } finally {
    const st = useIsland.getState();
    const { [SESSION]: _demo, ...rest } = st.claude;
    st.setClaude(rest);
    running = false;
  }
}
