import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/editor.css";
import { App } from "./App";

// Collect runtime errors so end-to-end tests can assert a clean console.
const w = window as unknown as { __aetherErrors: string[] };
w.__aetherErrors = [];
window.addEventListener("error", (e) => w.__aetherErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => w.__aetherErrors.push(String(e.reason)));
const origError = console.error;
console.error = (...args: unknown[]) => {
  w.__aetherErrors.push(args.map(String).join(" "));
  origError(...args);
};

// Follow the OS theme until settings are loaded.
document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
// Windows 11: the window has a Mica backdrop that the chrome lets show through.
import("@tauri-apps/api/core")
  .then(({ invoke }) => invoke<boolean>("window_backdrop"))
  .then((mica) => mica && document.documentElement.classList.add("os-windows"))
  .catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
