// Recording a global shortcut from a key press (spec format of the Tauri global-shortcut plugin).

/**
 * A shortcut from a key press in the recorder field: `"Ctrl+Shift+Space"`, `""` (Entf/Backspace
 * clears), `null` (only modifiers so far: swallow) or `undefined` (let the key through: Tab, Esc).
 */
export function recordShortcut(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null | undefined {
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  if (e.key === "Tab" || e.key === "Escape") return undefined;
  if (!mods.length && (e.key === "Backspace" || e.key === "Delete")) return "";
  if (["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"].includes(e.key)) return null;
  const key = e.code.replace(/^Key([A-Z])$/, "$1").replace(/^Digit(\d)$/, "$1").replace(/^Arrow/, "");
  if (!key) return null;
  // A global shortcut without modifier would swallow the key everywhere (F-keys excepted).
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null;
  return [...mods, key].join("+");
}
