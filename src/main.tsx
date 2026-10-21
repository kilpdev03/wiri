import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function start() {
  // Fuera de Tauri (pnpm dev en el navegador) se usa un backend simulado.
  if (!("__TAURI_INTERNALS__" in window)) {
    const { installMock } = await import("./dev/mock");
    installMock();
    // Acceso al store desde la consola para depurar en el navegador.
    const { useIsland } = await import("./store/islandStore");
    Object.assign(window, { island: useIsland });
    const { DevBar } = await import("./dev/DevBar");
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    document.body.classList.add("dev");
    ReactDOM.createRoot(bar).render(<DevBar />);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
