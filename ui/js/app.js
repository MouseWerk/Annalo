// AETHER OS shell: rail + panels, routing, command palette, top bar and token metrics.

import { invoke, listen, native } from "./api.js";
import { snippet } from "./markdown.js";
import { $, $$, h, toast, errorText, on, emit, showAlerts, hours, alertLog, alertText } from "./ui.js";
import { renderPage } from "./editor.js";
import { renderView, VIEW_TITLES } from "./views.js";
import { renderFocus } from "./focus.js";
import { mountTimeTracker, mountAssistant, setActiveContext } from "./widgets.js";

const shell = $("#app");
const canvas = $("#canvas");
let pages = [];
let flat = new Map();

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
const collapsed = new Set(JSON.parse(safeGet("aether.collapsed") ?? "[]"));

if (native) document.body.classList.add("native");

// ------------------------------------------------------------------ theme

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  safeSet("aether.theme", t);
}
setTheme(safeGet("aether.theme") ?? "dark");
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

// ----------------------------------------------------------- rail & panel

let panel = safeGet("aether.panel") ?? "ai";
function showPanel(name) {
  panel = name;
  safeSet("aether.panel", name);
  $$(".panel-body").forEach((p) => (p.hidden = p.dataset.panel !== name));
  shell.classList.remove("no-panel");
  paintRail();
}
function paintRail() {
  const hash = location.hash || "#/";
  const view = hash.match(/#\/view\/(\w+)/)?.[1];
  const active = view && ["timeline", "netzplan", "export"].includes(view) ? view : hash === "#/" ? "focus" : null;
  $$(".rail-btn[data-rail]").forEach((b) => {
    const r = b.dataset.rail;
    b.classList.toggle("active", r === active || (!shell.classList.contains("no-panel") && r === panel && (r === "ai" || r === "pages")));
  });
}
$$(".rail-btn[data-rail]").forEach((b) => b.addEventListener("click", () => {
  const r = b.dataset.rail;
  if (r === "pages" || r === "ai") {
    panel === r && !shell.classList.contains("no-panel") ? toggle("no-panel") : showPanel(r);
  } else navigate(r === "focus" ? "#/" : `#/view/${r}`);
  paintRail();
}));
function toggle(cls, force) {
  shell.classList.toggle(cls, force);
  safeSet(`aether.${cls}`, shell.classList.contains(cls) ? "1" : "0");
  paintRail();
}
for (const cls of ["no-panel", "no-widgets"]) if (safeGet(`aether.${cls}`) === "1") shell.classList.add(cls);
$("#toggle-panel").addEventListener("click", () => toggle("no-panel"));
$("#collapse-panel").addEventListener("click", () => toggle("no-panel", true));
showPanel(panel);

// ------------------------------------------------------------------ pages

function findPage(id, title) {
  if (title != null) return [...flat.values()].find((p) => p.title.toLowerCase() === title.toLowerCase()) ?? null;
  return id == null ? null : flat.get(id) ?? null;
}

async function loadPages() {
  pages = await invoke("workspace_tree");
  flat = new Map();
  const walk = (list) => list.forEach((p) => { flat.set(p.id, p); walk(p.children); });
  walk(pages);
  paintTree();
}

function paintTree() {
  const current = location.hash.match(/#\/page\/(\d+)/)?.[1];
  const branch = (list) => h("ul", { role: "group" }, ...list.map((p) => {
    const hasKids = p.children.length > 0;
    const li = h("li", { class: collapsed.has(p.id) ? "collapsed" : "", role: "treeitem" });
    const twisty = h("span", { class: `twisty ${hasKids ? (collapsed.has(p.id) ? "" : "open") : "leaf"}` }, "▶");
    twisty.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      collapsed.has(p.id) ? collapsed.delete(p.id) : collapsed.add(p.id);
      safeSet("aether.collapsed", JSON.stringify([...collapsed]));
      paintTree();
    });
    li.append(h("a", { href: `#/page/${p.id}`, class: `node-row${String(p.id) === current ? " active" : ""}` },
      twisty, h("span", { class: "ico" }, p.icon ?? "📄"), p.title));
    if (hasKids) li.append(branch(p.children));
    return li;
  }));
  $("#page-tree").replaceChildren(branch(pages));
  const hash = location.hash || "#/";
  const view = hash === "#/" ? "focus" : hash.match(/#\/view\/(\w+)/)?.[1];
  $$("#view-nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
}

// ---------------------------------------------------------------- routing

async function route() {
  const hash = location.hash || "#/";
  paintTree();
  paintRail();
  const [left, right] = hash.slice(2).split("|");
  try {
    if (right) {
      const a = h("div", { class: "pane" }), b = h("div", { class: "pane" });
      canvas.replaceChildren(h("div", { class: "split" }, a, b));
      await Promise.all([show(a, left), show(b, right)]);
    } else {
      await show(canvas, left);
    }
  } catch (e) {
    canvas.replaceChildren(h("div", { class: "canvas-inner" }, h("p", { class: "empty" }, `Fehler: ${errorText(e)}`)));
  }
  canvas.scrollTop = 0;
}

async function show(el, part = "") {
  const [kind, arg] = part.split("/");
  if (kind === "view") {
    setActiveContext(null);
    return renderView(el, arg);
  }
  if (kind !== "page") {
    setActiveContext(null);
    return renderFocus(el, { navigate });
  }
  const id = +arg;
  await renderPage(el, id, { findPage, navigate, openSplit });
  const blocks = await invoke("page_blocks", { pageId: id });
  setActiveContext({ title: findPage(id)?.title ?? "", text: blocks.map((b) => b.content_markdown).join("\n\n") });
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function openSplit(pageId) {
  navigate(`#/page/${pageId}|view/netzplan`);
}

window.addEventListener("hashchange", route);
on("pages", loadPages);
on("entries", () => { if ((location.hash || "#/") === "#/") route(); });
$("#nav-back").addEventListener("click", () => history.back());
$("#nav-fwd").addEventListener("click", () => history.forward());
$("#new-page").addEventListener("click", async () => {
  const p = await invoke("create_page", { parentId: null, title: "Neue Seite", icon: "📄" });
  await loadPages();
  navigate(`#/page/${p.id}`);
});

// ------------------------------------------------------- metrics & model

const tc = { tps: $("#tc-tps"), total: $("#tc-total"), cost: $("#tc-cost"), last: $("#tc-cost-last"), ttft: $("#tc-ttft"), req: $("#tc-req") };
const pillTps = $("#tm-tps");
let lastCost = 0;
let liveTimer;
function onMeter(m) {
  if (!m) return;
  tc.total.textContent = (m.prompt_tokens + m.completion_tokens).toLocaleString("de-DE");
  tc.cost.textContent = `$${m.cost_usd.toFixed(m.cost_usd < 1 ? 3 : 2)}`;
  tc.last.textContent = `$${Math.max(0, m.cost_usd - lastCost).toFixed(4)}`;
  if (m.requests) lastCost = m.cost_usd;
  tc.req.textContent = m.requests;
  if (m.last_tokens_per_second != null) tc.tps.textContent = pillTps.textContent = m.last_tokens_per_second.toFixed(1);
  if (m.last_ttft_ms != null) tc.ttft.textContent = `${Math.round(m.last_ttft_ms)} ms`;
}
function onLiveSpeed({ tps, ttft }) {
  $("#tc-live").classList.add("on");
  $("#tps-pill").classList.add("live");
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { $("#tc-live").classList.remove("on"); $("#tps-pill").classList.remove("live"); }, 1200);
  if (tps != null) tc.tps.textContent = pillTps.textContent = tps.toFixed(1);
  if (ttft != null) tc.ttft.textContent = `${Math.round(ttft)} ms`;
}

const modelSelect = $("#model-select");
async function loadModels() {
  const cfg = await invoke("ai_models");
  modelSelect.replaceChildren(
    h("option", { value: "" }, "Auto – Dynamic Router"),
    h("option", { value: "local" }, `${cfg.local_model} (lokal)`),
    h("option", { value: "standard" }, `${cfg.standard_model} (Standard)`),
    h("option", { value: "reasoning" }, `${cfg.reasoning_model} (Reasoning)`));
  modelSelect.value = safeGet("aether.model") ?? "";
  modelSelect.addEventListener("change", () => safeSet("aether.model", modelSelect.value));
}

// ----------------------------------------------------------- tool tiles

const TILES = [
  { icon: "🗄", label: "Database Query Tool", sub: "Budget & ETC per KI abfragen", run: () => ask("Wie steht das Budget von NP-8801 und welche Vorgänge sind kritisch?") },
  { icon: "⎇", label: "Git Commit Sync", sub: "git status & log (mit Freigabe)", run: () => ask("Zeige mir per git den Status und die letzten 5 Commits im Repository C:/src/aether.") },
  { icon: "✉", label: "REST / Webhook", sub: "Statusmeldung senden (mit Freigabe)", run: () => ask("Sende per http_request eine kurze Statusmeldung zu NP-8801 an unseren Team-Webhook.") },
  { icon: "⟲", label: "RAG-Index aktualisieren", sub: "Notizen lokal einbetten", run: indexPending },
  { icon: "⇪", label: "SAP CATS Export", sub: "Zeitblatt exportieren", run: () => navigate("#/view/export") },
];
function ask(q) {
  showPanel("ai");
  emit("assistant:ask", q);
}
async function indexPending() {
  try {
    const n = await invoke("ai_index_pending");
    toast(`${n} Blöcke eingebettet`, { detail: "Lokaler Vektorindex aktualisiert" });
  } catch (err) {
    toast("Indexierung nicht möglich", { kind: "warn", detail: errorText(err) });
  }
}
$("#tool-tiles").replaceChildren(...TILES.map((t) =>
  h("button", { class: "tile", onclick: t.run }, h("span", { class: "ico" }, t.icon), h("span", {}, t.label, h("small", {}, t.sub)))));

// ------------------------------------------------------- focus & bell

const focusBtn = $("#focus-toggle");
function setFocus(on) {
  shell.classList.toggle("focus", on);
  focusBtn.setAttribute("aria-pressed", String(on));
}
focusBtn.addEventListener("click", () => setFocus(!shell.classList.contains("focus")));

on("alerts", () => ($("#bell-dot").hidden = false));
$("#bell").addEventListener("click", () => {
  $("#bell-dot").hidden = true;
  if (!alertLog.length) return toast("Keine Budget-Warnungen in dieser Sitzung");
  for (const a of alertLog.slice(0, 4)) toast(alertText(a), { kind: a.level === "warning" ? "warn" : "error", ms: 6000 });
});

// ---------------------------------------------------------------- palette

const palette = $("#palette");
const pInput = $("#palette-input");
const pList = $("#palette-list");
let items = [];
let sel = 0;

const COMMANDS = [
  { icon: "⏱", label: "Timer starten / stoppen", hint: "Ctrl+Shift+T", run: () => emit("timer:toggle") },
  { icon: "✎", label: "Zeit manuell buchen", run: () => emit("timer:focus") },
  { icon: "✦", label: "KI-Assistent fragen", hint: "Ctrl+Shift+A", run: () => { showPanel("ai"); emit("assistant:focus"); } },
  { icon: "⊞", label: "Today's Focus", run: () => navigate("#/") },
  { icon: "＋", label: "Neue Seite", run: () => $("#new-page").click() },
  { icon: "◎", label: "Focus Mode umschalten", hint: "Ctrl+.", run: () => focusBtn.click() },
  { icon: "☰", label: "Seitenleiste umschalten", hint: "Ctrl+\\", run: () => toggle("no-panel") },
  { icon: "▤", label: "Time-Tracking-Karte umschalten", hint: "Ctrl+J", run: () => toggle("no-widgets") },
  { icon: "◐", label: "Hell / Dunkel", run: () => $("#theme-toggle").click() },
  ...TILES.map((t) => ({ icon: t.icon, label: `Tool: ${t.label}`, run: t.run })),
  ...Object.entries(VIEW_TITLES).map(([k, v]) => ({ icon: "▦", label: `Öffnen: ${v}`, run: () => navigate(`#/view/${k}`) })),
];

function openPalette(initial = "") {
  palette.hidden = false;
  pInput.value = initial;
  sel = 0;
  updatePalette();
  pInput.focus();
}
function closePalette() {
  palette.hidden = true;
}

let searchSeq = 0;
async function updatePalette() {
  const q = pInput.value.trim();
  const lower = q.toLowerCase();
  const seq = ++searchSeq;
  items = [];
  if (/^\/(zeit|time)\b/i.test(q)) {
    items.push({ icon: "⏱", label: `Buchen: ${q}`, hint: "Enter", run: () => logFromPalette(q) });
  } else if (q.startsWith("?")) {
    const question = q.slice(1).trim();
    if (question) items.push({ icon: "✦", label: `KI fragen: ${question}`, run: () => ask(question) });
  }
  items.push(...COMMANDS.filter((c) => !lower || c.label.toLowerCase().includes(lower)).slice(0, lower ? 6 : 14));
  items.push(...[...flat.values()].filter((p) => lower && p.title.toLowerCase().includes(lower)).slice(0, 6)
    .map((p) => ({ icon: p.icon ?? "📄", label: p.title, hint: "Seite", run: () => navigate(`#/page/${p.id}`) })));
  paintPalette();
  if (q.length >= 2 && !q.startsWith("/") && !q.startsWith("?")) {
    const hits = await invoke("search_workspace", { query: q });
    if (seq !== searchSeq) return;
    items.push(...hits.slice(0, 8).map((hit) => hit.kind === "block"
      ? { icon: "¶", label: hit.page_title, snippet: hit.snippet, hint: "Notiz", run: () => navigate(`#/page/${hit.page_id}`) }
      : { icon: "⏱", label: `${hit.netzplan_nr}${hit.vorgang_nr ? "/" + hit.vorgang_nr : ""}`, snippet: hit.snippet, hint: "Zeiteintrag", run: () => navigate("#/view/table") }));
    paintPalette();
  }
}

function paintPalette() {
  sel = Math.min(sel, Math.max(0, items.length - 1));
  pList.replaceChildren(...items.map((it, i) => {
    const li = h("li", { class: i === sel ? "sel" : "", role: "option", "aria-selected": String(i === sel) },
      h("span", { class: "ico" }, it.icon), h("span", {}, it.label),
      it.snippet ? h("span", { class: "snippet", html: snippet(it.snippet) }) : null,
      it.hint ? h("small", {}, it.hint) : null);
    li.addEventListener("mousemove", () => { if (sel !== i) { sel = i; paintPalette(); } });
    li.addEventListener("click", () => runItem(i));
    return li;
  }));
  pList.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
}

function runItem(i) {
  const it = items[i];
  if (!it) return;
  closePalette();
  it.run();
}

async function logFromPalette(line) {
  try {
    const out = await invoke("log_time", { line });
    toast(`Gebucht: ${hours(out.entry.duration_minutes)}h`, { detail: out.entry.description });
    showAlerts(out.alerts);
    emit("entries");
  } catch (e) {
    toast("Buchung fehlgeschlagen", { kind: "error", detail: errorText(e) });
  }
}

pInput.addEventListener("input", () => { sel = 0; updatePalette(); });
pInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % Math.max(items.length, 1); paintPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(items.length, 1); paintPalette(); }
  else if (e.key === "Enter") { e.preventDefault(); runItem(sel); }
  else if (e.key === "Escape") closePalette();
});
palette.addEventListener("mousedown", (e) => { if (e.target === palette) closePalette(); });
on("palette:open", (text) => openPalette(text));

const globalSearch = $("#global-search");
globalSearch.addEventListener("focus", () => { openPalette(globalSearch.value); globalSearch.blur(); });
$("#quick-action").addEventListener("click", () => openPalette());
$("#rail-search").addEventListener("click", () => openPalette());
$("#slash-btn").addEventListener("click", () => openPalette("/zeit "));
$("#help-fab").addEventListener("click", () => openPalette());

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if ((mod && e.key.toLowerCase() === "k") || (e.altKey && e.code === "Space")) {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
  } else if (mod && e.key === ".") { e.preventDefault(); focusBtn.click(); }
  else if (mod && e.key === "\\") { e.preventDefault(); toggle("no-panel"); }
  else if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); toggle("no-widgets"); }
  else if (mod && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); emit("timer:toggle"); }
  else if (mod && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); showPanel("ai"); emit("assistant:focus"); }
  else if (e.altKey && e.key === "ArrowLeft") history.back();
  else if (e.altKey && e.key === "ArrowRight") history.forward();
  else if (e.key === "Escape" && shell.classList.contains("focus") && palette.hidden) setFocus(false);
});

// Global Alt+Space from the native shell (works while the app is in the background).
listen("palette://toggle", () => (palette.hidden ? openPalette() : closePalette()));

// ------------------------------------------------------------------ start

$("#backend-status").textContent = native ? "Nativ · SQLite lokal" : "Vorschau-Modus · In-Memory-Daten";
await loadPages();
await loadModels();
await Promise.all([
  mountTimeTracker($("#time-widget")),
  mountAssistant($("#ai-widget"), { onMeter, onLiveSpeed, modelOverride: () => modelSelect.value }),
  route(),
]);
onMeter(await invoke("ai_meter"));
