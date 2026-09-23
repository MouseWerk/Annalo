// Bridge to the Rust core. In the native shell every call goes over Tauri IPC;
// opened in a plain browser the UI falls back to an in-memory preview backend.

const tauri = window.__TAURI__;
export const native = Boolean(tauri?.core?.invoke);

let mock = null;
async function preview() {
  if (!mock) mock = await import("./mock.js");
  return mock;
}

export async function invoke(cmd, args = {}) {
  if (native) return tauri.core.invoke(cmd, args);
  return (await preview()).invoke(cmd, args);
}

export async function listen(event, handler) {
  if (native) return tauri.event.listen(event, (e) => handler(e.payload));
  return (await preview()).listen(event, handler);
}
