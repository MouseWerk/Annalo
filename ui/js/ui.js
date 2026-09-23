// Shared UI helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function toast(msg, { kind = "info", detail = "", ms = 4200 } = {}) {
  const t = h("div", { class: `toast ${kind}` }, msg, detail ? h("small", {}, detail) : null);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

export const errorText = (e) => (typeof e === "string" ? e : e?.message ?? JSON.stringify(e));

export const hours = (minutes) => (minutes / 60).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (x, d = 1) => Number(x).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export function alertText(a) {
  const pct = Math.round(a.consumed * 100);
  const lvl = { warning: "Warnung", critical: "Kritisch", exceeded: "Überschritten" }[a.level] ?? a.level;
  return `${lvl}: ${a.label} ${num(a.booked_hours)}h / ${num(a.planned_hours)}h (${pct} %), ETC ${num(a.etc_hours)}h`;
}

/// Budget alerts raised this session, for the notification bell.
export const alertLog = [];

export function showAlerts(alerts) {
  for (const a of alerts ?? []) {
    toast(alertText(a), { kind: a.level === "warning" ? "warn" : "error", ms: 7000 });
    alertLog.unshift({ ...a, at: new Date() });
  }
  if (alerts?.length) emit("alerts", alertLog);
}

/// Simple pub/sub for cross-component refreshes ("entries", "pages", "timer").
const subs = new Map();
export function on(topic, fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
}
export function emit(topic, data) {
  for (const fn of subs.get(topic) ?? []) fn(data);
}
