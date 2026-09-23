// App-level actions shared by the palette, settings and menus.

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { useApp } from "../store/app";

export function applyTheme(theme: "system" | "light" | "dark") {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export async function toggleTheme() {
  const s = useApp.getState();
  const view = s.settings ?? (await api.settings());
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = { ...view.settings, theme: current === "dark" ? ("light" as const) : ("dark" as const) };
  const saved = await api.saveSettings(next);
  s.set({ settings: saved });
  applyTheme(next.theme);
}

export async function pickFolder(title: string): Promise<string | null> {
  const r = await openDialog({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

export async function importVault(path?: string) {
  const s = useApp.getState();
  try {
    const dir = path ?? (await pickFolder("Obsidian-Vault auswählen"));
    if (!dir) return;
    const r = await api.importVault(dir);
    await s.refreshTree();
    s.openPage(r.root_page_id);
    s.toast({ tone: "success", title: "Vault importiert", detail: `${r.pages} Seiten, ${r.folders} Ordner${r.skipped ? `, ${r.skipped} Anhänge übersprungen` : ""}` });
  } catch (e) {
    s.error("Import fehlgeschlagen", e);
  }
}

export async function exportVault(path?: string) {
  const s = useApp.getState();
  try {
    const dir = path ?? (await pickFolder("Zielordner für den Export"));
    if (!dir) return;
    const n = await api.exportVault(dir);
    s.toast({ tone: "success", title: "Export abgeschlossen", detail: `${n} Markdown-Dateien geschrieben` });
  } catch (e) {
    s.error("Export fehlgeschlagen", e);
  }
}
