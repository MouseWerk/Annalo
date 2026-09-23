// Database views: Table, Kanban, Timeline/Gantt, Netzplan, Graph and Export.

import { invoke } from "./api.js";
import { h, toast, errorText, emit, on, hours, num, fmtDate, fmtTime } from "./ui.js";

export const VIEW_TITLES = {
  table: "Zeiteinträge",
  kanban: "Kanban",
  timeline: "Timeline / Gantt",
  netzplan: "Netzplan",
  graph: "Graph",
  export: "Export",
};

const STATUS = { draft: "Entwurf", released: "Freigegeben", exported: "Exportiert", running: "Läuft" };
const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
};

let selectedNetzplan = null;
async function netzplaene() {
  const tree = await invoke("wbs_tree");
  return tree.flatMap((p) => p.netzplaene.map((n) => ({ ...n, project_code: p.project_code })));
}

function netzplanSelect(list, onChange) {
  if (!list.some((n) => n.id === selectedNetzplan)) selectedNetzplan = list[0]?.id ?? null;
  const sel = h("select", { "aria-label": "Netzplan" },
    ...list.map((n) => h("option", { value: n.id, selected: n.id === selectedNetzplan }, `${n.netzplan_nr} · ${n.description}`)));
  sel.addEventListener("change", () => { selectedNetzplan = +sel.value; onChange(); });
  return sel;
}

// Re-render live views when data changes elsewhere (timer widget, slash commands).
const live = new Set();
on("entries", () => { for (const fn of live) fn(); });
function keepLive(root, fn) {
  const wrapped = () => (root.isConnected ? fn() : live.delete(wrapped));
  live.add(wrapped);
}

export async function renderView(root, name) {
  const inner = h("div", { class: `canvas-inner${["kanban", "netzplan", "timeline", "graph", "table"].includes(name) ? " wide" : ""}` });
  root.replaceChildren(inner);
  const head = h("div", { class: "view-head" }, h("h1", {}, VIEW_TITLES[name] ?? name));
  const body = h("div");
  inner.append(head, body);
  const renderer = { table, kanban, timeline, netzplan, graph, export: exportView }[name];
  if (!renderer) return body.append(h("p", { class: "empty" }, "Unbekannte Ansicht."));
  await renderer(body, { head, inline: false });
}

export async function renderInline(el, name) {
  const renderer = { table, kanban, timeline, netzplan, graph }[name];
  if (!renderer) return el.append(h("p", { class: "empty" }, `Ansicht „${name}“ ist inline nicht verfügbar.`));
  await renderer(el, { head: null, inline: true });
}

// ------------------------------------------------------------------- table

async function table(el, { head, inline }) {
  let range = "all";
  const selected = new Set();

  const paint = async () => {
    const all = await invoke("time_entries", {});
    const cutoff = { week: Date.now() - 7 * 864e5, month: Date.now() - 31 * 864e5, all: 0 }[range];
    let rows = all.filter((r) => new Date(r.start_time) >= cutoff).reverse();
    if (inline) rows = rows.slice(0, 6);
    const total = rows.reduce((a, r) => a + (r.duration_minutes ?? 0), 0);

    const t = h("table", { class: "grid" },
      h("thead", {}, h("tr", {},
        inline ? null : h("th", {}, ""),
        h("th", {}, "Datum"), h("th", {}, "Zeit"), h("th", {}, "Netzplan / Vorgang"), h("th", {}, "LA"),
        h("th", {}, "Beschreibung"), h("th", { class: "num" }, "Std"), h("th", {}, "Status"))),
      h("tbody", {}, ...rows.map((r) => h("tr", {},
        inline ? null : h("td", {}, h("input", {
          type: "checkbox", checked: selected.has(r.id), disabled: r.status_flag === "running", "aria-label": "Auswählen",
          onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); actions(); },
        })),
        h("td", { class: "nowrap" }, fmtDate(r.start_time)),
        h("td", { class: "mono nowrap" }, `${fmtTime(r.start_time)}–${r.end_time ? fmtTime(r.end_time) : "…"}`),
        h("td", { class: "mono nowrap" }, `${r.netzplan_nr}${r.vorgang_nr ? "/" + r.vorgang_nr : ""}`),
        h("td", {}, r.leistungsart ?? ""),
        h("td", {}, r.description),
        h("td", { class: "num" }, r.duration_minutes != null ? hours(r.duration_minutes) : "–"),
        h("td", {}, h("span", { class: `chip ${r.status_flag}` }, STATUS[r.status_flag]))))),
      h("tfoot", {}, h("tr", {}, inline ? null : h("td"), h("td", { colspan: 5 }, `${rows.length} Einträge`),
        h("td", { class: "num" }, hours(total)), h("td"))));
    el.replaceChildren(rows.length ? t : h("p", { class: "empty" }, "Keine Einträge im Zeitraum."));
  };

  const bar = h("div", { class: "row" });
  const actions = () => {
    bar.replaceChildren(
      h("span", { class: "hint" }, selected.size ? `${selected.size} ausgewählt` : ""),
      h("button", { class: "btn", disabled: !selected.size, onclick: () => setStatus("released") }, "Freigeben"),
      h("button", { class: "btn", disabled: !selected.size, onclick: () => setStatus("draft") }, "Als Entwurf"),
      h("button", { class: "btn danger", disabled: !selected.size, onclick: remove }, "Löschen"));
  };
  const setStatus = async (status) => {
    const n = await invoke("set_entry_status", { ids: [...selected], status });
    toast(`${n} Einträge: ${STATUS[status]}`);
    selected.clear();
    actions();
    emit("entries");
  };
  const remove = async () => {
    if (!confirm(`${selected.size} Einträge löschen?`)) return;
    for (const id of selected) await invoke("delete_time_entry", { id });
    selected.clear();
    actions();
    emit("entries");
  };

  if (head) {
    const seg = h("div", { class: "segmented" },
      ...[["week", "7 Tage"], ["month", "31 Tage"], ["all", "Alle"]].map(([k, label]) =>
        h("button", { class: k === range ? "on" : "", onclick: (e) => {
          range = k;
          seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
          paint();
        } }, label)));
    actions();
    head.append(bar, seg);
  }
  keepLive(el, paint);
  await paint();
}

// ------------------------------------------------------------------ kanban

async function kanban(el) {
  const paint = async () => {
    const rows = (await invoke("time_entries", {})).filter((r) => r.status_flag !== "running").reverse();
    const lanes = ["draft", "released", "exported"].map((status) => {
      const items = rows.filter((r) => r.status_flag === status);
      const lane = h("div", { class: "lane", "data-status": status },
        h("h3", {}, h("span", {}, STATUS[status]), h("span", {}, `${items.length} · ${hours(items.reduce((a, r) => a + r.duration_minutes, 0))}h`)),
        ...items.slice(0, 30).map((r) => {
          const card = h("div", { class: "card", draggable: "true", "data-id": r.id },
            h("div", { class: "wbs" }, `${r.netzplan_nr}${r.vorgang_nr ? "/" + r.vorgang_nr : ""} · ${r.leistungsart ?? "–"}`),
            h("div", { class: "desc" }, r.description || "ohne Beschreibung"),
            h("div", { class: "meta" }, h("span", {}, fmtDate(r.start_time)), h("b", {}, `${hours(r.duration_minutes)}h`)));
          card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", r.id); card.classList.add("dragging"); });
          card.addEventListener("dragend", () => card.classList.remove("dragging"));
          return card;
        }));
      lane.addEventListener("dragover", (e) => { e.preventDefault(); lane.classList.add("over"); });
      lane.addEventListener("dragleave", () => lane.classList.remove("over"));
      lane.addEventListener("drop", async (e) => {
        e.preventDefault();
        lane.classList.remove("over");
        const id = +e.dataTransfer.getData("text/plain");
        try {
          await invoke("set_entry_status", { ids: [id], status });
          emit("entries");
        } catch (err) {
          toast("Status nicht geändert", { kind: "error", detail: errorText(err) });
        }
      });
      return lane;
    });
    el.replaceChildren(h("div", { class: "kanban" }, ...lanes));
  };
  keepLive(el, paint);
  await paint();
}

// ---------------------------------------------------------------- timeline

async function timeline(el, { head }) {
  const list = await netzplaene();
  const body = h("div");
  const paint = async () => {
    if (selectedNetzplan == null) return body.replaceChildren(h("p", { class: "empty" }, "Kein Netzplan vorhanden."));
    const [sched, budget] = await Promise.all([
      invoke("schedule", { netzplanId: selectedNetzplan }),
      invoke("budget", { netzplanId: selectedNetzplan }),
    ]);
    const span = Math.max(sched.duration, 1);
    const pct = (x) => `${(x / span) * 100}%`;
    const ticks = h("div", { class: "ticks" });
    const gantt = h("div", { class: "gantt" }, h("div", { class: "gantt-scale" }, h("span", {}, "Vorgang"), ticks));
    const step = span > 30 ? 5 : 1;
    for (let d = 0; d <= span; d += step) {
      ticks.append(h("span", { class: "tick", style: { left: pct(d) } }, `T${d}`));
    }
    for (const n of sched.nodes) {
      const b = budget.find((x) => x.vorgang_nr === n.vorgang_nr);
      const progress = b && b.planned_hours ? Math.min(b.booked_hours / b.planned_hours, 1) : 0;
      const track = h("div", { class: "gantt-track" },
        n.gp > 0 ? h("div", { class: "gantt-float", title: `Gesamtpuffer ${n.gp} Tage`, style: { left: pct(n.fez), width: pct(n.gp) } }) : null,
        h("div", { class: `gantt-bar${n.critical ? " critical" : ""}`, title: `FAZ ${n.faz} · FEZ ${n.fez} · GP ${n.gp}`,
          style: { left: pct(n.faz), width: pct(n.duration) } }, `${n.duration} T`),
        h("div", { class: "gantt-progress", title: `${Math.round(progress * 100)} % der Planstunden gebucht`,
          style: { left: pct(n.faz), width: `calc(${pct(n.duration)} * ${progress})` } }));
      gantt.append(h("div", { class: "gantt-row" },
        h("div", { class: "label" }, h("b", {}, n.vorgang_nr), n.description), track));
    }
    body.replaceChildren(
      h("p", { class: "hint" }, `Projektdauer ${sched.duration} Tage · rot = kritischer Pfad · grau = Puffer · grün = gebuchter Anteil der Planstunden`),
      gantt);
  };
  const sel = netzplanSelect(list, paint);
  head ? head.append(sel) : el.append(h("div", { class: "row", style: { marginBottom: "8px" } }, sel));
  el.append(body);
  keepLive(el, paint);
  await paint();
}

// ---------------------------------------------------------------- netzplan

async function netzplan(el, { head, inline }) {
  const list = await netzplaene();
  const body = h("div");
  const paint = async () => {
    if (selectedNetzplan == null) return body.replaceChildren(h("p", { class: "empty" }, "Kein Netzplan vorhanden."));
    const [sched, budget] = await Promise.all([
      invoke("schedule", { netzplanId: selectedNetzplan }),
      invoke("budget", { netzplanId: selectedNetzplan }),
    ]);
    const W = 168, HGT = 78, GX = 64, GY = 30, PAD = 20;
    const cols = new Map();
    const pos = new Map();
    for (const n of sched.nodes) {
      const row = cols.get(n.rank) ?? 0;
      cols.set(n.rank, row + 1);
      pos.set(n.vorgang_id, { x: PAD + n.rank * (W + GX), y: PAD + row * (HGT + GY) });
    }
    const width = PAD * 2 + Math.max(1, cols.size) * (W + GX) - GX;
    const height = PAD * 2 + Math.max(1, ...cols.values()) * (HGT + GY) - GY;
    // Scale down to the available width; never scale up.
    const svg = s("svg", { width: "100%", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Netzplan", style: `max-width:${width}px;min-width:${Math.round(width * 0.75)}px` });
    const defs = s("defs");
    for (const [id, cls] of [["arr", "arrow"], ["arr-c", "arrow critical"]])
      defs.append(s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, s("path", { d: "M0,0 L10,5 L0,10 z", class: cls })));
    svg.append(defs);

    const byId = new Map(sched.nodes.map((n) => [n.vorgang_id, n]));
    for (const n of sched.nodes) {
      for (const p of n.predecessors) {
        const a = pos.get(p), b = pos.get(n.vorgang_id), pn = byId.get(p);
        const crit = pn.critical && n.critical && Math.abs(n.faz - pn.fez) < 1e-9;
        const x1 = a.x + W, y1 = a.y + HGT / 2, x2 = b.x - 2, y2 = b.y + HGT / 2, mx = (x1 + x2) / 2;
        svg.append(s("path", { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: `np-edge${crit ? " critical" : ""}`, "marker-end": `url(#${crit ? "arr-c" : "arr"})` }));
      }
    }
    for (const n of sched.nodes) {
      const { x, y } = pos.get(n.vorgang_id);
      const c = W / 3, r = HGT / 3;
      const cell = (col, row, text, cls) => s("text", { x: x + col * c + c / 2, y: y + row * r + r / 2 + 4, "text-anchor": "middle", class: cls }, String(text));
      const maxChars = 19 - n.vorgang_nr.length;
      const title = n.description.length > maxChars ? n.description.slice(0, maxChars - 1) + "…" : n.description;
      svg.append(s("g", { class: `np-node${n.critical ? " critical" : ""}` },
        s("title", {}, `${n.vorgang_nr} ${n.description}\nFAZ ${n.faz} FEZ ${n.fez} · SAZ ${n.saz} SEZ ${n.sez} · GP ${n.gp} FP ${n.fp}`),
        s("rect", { x, y, width: W, height: HGT, rx: 6, class: "frame" }),
        s("line", { x1: x, y1: y + r, x2: x + W, y2: y + r }),
        s("line", { x1: x, y1: y + 2 * r, x2: x + W, y2: y + 2 * r }),
        s("line", { x1: x + c, y1: y, x2: x + c, y2: y + r }), s("line", { x1: x + 2 * c, y1: y, x2: x + 2 * c, y2: y + r }),
        s("line", { x1: x + c, y1: y + 2 * r, x2: x + c, y2: y + HGT }), s("line", { x1: x + 2 * c, y1: y + 2 * r, x2: x + 2 * c, y2: y + HGT }),
        cell(0, 0, n.faz), cell(1, 0, n.duration), cell(2, 0, n.fez),
        s("text", { x: x + 8, y: y + r + r / 2 + 4, class: "title" }, `${n.vorgang_nr} ${title}`),
        cell(0, 2, n.saz), cell(1, 2, `GP ${n.gp}`, "small"), cell(2, 2, n.sez)));
    }
    const legend = h("p", { class: "hint" }, "Knoten: FAZ | Dauer | FEZ — Vorgang — SAZ | Gesamtpuffer | SEZ. Rot: kritischer Pfad (",
      sched.critical_path.map((id) => byId.get(id)?.vorgang_nr).join(" → "), `), Projektdauer ${sched.duration} Tage.`);

    const budgetPanel = inline ? null : h("div", { class: "panel" }, h("h2", {}, "Budget & ETC"),
      h("div", { class: "budget-list" }, ...budget.map((b) => h("div", { class: "budget-row" },
        h("span", { class: "mono" }, b.vorgang_nr ?? b.label),
        h("div", { class: "bar", title: `EAC ${num(b.eac_hours)}h` },
          h("i", { class: b.level, style: { width: `${Math.min(b.consumed, 1) * 100}%` } }),
          b.planned_hours ? h("s", { style: { left: `${Math.min(b.eac_hours / b.planned_hours, 1) * 100}%` } }) : null),
        h("span", {}, `${num(b.booked_hours)} / ${num(b.planned_hours)}h `, h("span", { class: `chip ${b.level}` }, `ETC ${num(b.etc_hours)}h`))))));
    body.replaceChildren(h("div", { class: "np-canvas" }, svg), legend, budgetPanel ?? "");
  };
  const sel = netzplanSelect(list, paint);
  head ? head.append(sel) : el.append(h("div", { class: "row", style: { marginBottom: "8px" } }, sel));
  el.append(body);
  keepLive(el, paint);
  await paint();
}

// ------------------------------------------------------------------- graph

async function graph(el, { inline }) {
  const g = await invoke("page_graph");
  const box = h("div", { class: "graph-canvas", style: inline ? { height: "320px", minHeight: "0" } : {} });
  el.replaceChildren(box);
  const svg = s("svg", { role: "img", "aria-label": "Seitengraph" });
  box.append(svg);
  const { width, height } = box.getBoundingClientRect();
  const nodes = g.nodes.map((n, i) => ({
    ...n,
    x: width / 2 + Math.cos(i * 2.4) * 120,
    y: height / 2 + Math.sin(i * 2.4) * 120,
    vx: 0, vy: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const lines = edges.map((e) => { const l = s("line", { class: `g-edge ${e.kind}` }); svg.append(l); return l; });
  let dragging = null;
  const circles = nodes.map((n) => {
    const r = 6 + Math.sqrt(n.degree) * 3;
    const grp = s("g", { class: "g-node", tabindex: 0 }, s("circle", { r }), s("text", { x: r + 4, y: 4 }, `${n.icon ?? ""} ${n.title}`));
    grp.addEventListener("pointerdown", (e) => { dragging = n; grp.setPointerCapture(e.pointerId); });
    grp.addEventListener("dblclick", () => (location.hash = `#/page/${n.id}`));
    grp.addEventListener("keydown", (e) => e.key === "Enter" && (location.hash = `#/page/${n.id}`));
    svg.append(grp);
    return grp;
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    dragging.x = e.clientX - rect.left;
    dragging.y = e.clientY - rect.top;
    heat = 1;
  });
  svg.addEventListener("pointerup", () => (dragging = null));

  let heat = 1;
  const tick = () => {
    if (!svg.isConnected) return;
    const { width: w, height: hh } = box.getBoundingClientRect();
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 25);
        a.vx += (dx / d2) * 900; a.vy += (dy / d2) * 900;
      }
      a.vx += (w / 2 - a.x) * 0.004; a.vy += (hh / 2 - a.y) * 0.004;
    }
    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - (e.kind === "link" ? 150 : 110)) * 0.02;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n === dragging) { n.vx = n.vy = 0; continue; }
      n.x = Math.min(w - 20, Math.max(20, n.x + n.vx * heat)); n.y = Math.min(hh - 20, Math.max(20, n.y + n.vy * heat));
      n.vx *= 0.6; n.vy *= 0.6;
    }
    edges.forEach((e, i) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      lines[i].setAttribute("x1", a.x); lines[i].setAttribute("y1", a.y); lines[i].setAttribute("x2", b.x); lines[i].setAttribute("y2", b.y);
    });
    nodes.forEach((n, i) => circles[i].setAttribute("transform", `translate(${n.x},${n.y})`));
    heat = Math.max(0.02, heat * 0.985);
    requestAnimationFrame(tick);
  };
  tick();
  if (!inline) el.append(h("p", { class: "hint" }, "Durchgezogen: Unterseite · gestrichelt: [[Wiki-Link]] · Doppelklick öffnet die Seite · Knoten ziehbar."));
}

// ------------------------------------------------------------------ export

async function exportView(el) {
  const all = await invoke("time_entries", {});
  const done = all.filter((r) => r.status_flag !== "running");
  const sum = (f) => hours(done.filter(f).reduce((a, r) => a + r.duration_minutes, 0));
  const weekAgo = Date.now() - 7 * 864e5;
  el.append(h("div", { class: "cards" },
    h("div", { class: "stat" }, h("small", {}, "Letzte 7 Tage"), h("b", {}, `${sum((r) => new Date(r.start_time) >= weekAgo)} h`)),
    h("div", { class: "stat" }, h("small", {}, "Entwurf"), h("b", {}, `${sum((r) => r.status_flag === "draft")} h`)),
    h("div", { class: "stat" }, h("small", {}, "Freigegeben"), h("b", {}, `${sum((r) => r.status_flag === "released")} h`)),
    h("div", { class: "stat" }, h("small", {}, "Exportiert"), h("b", {}, `${sum((r) => r.status_flag === "exported")} h`))));

  const iso = (d) => d.toISOString().slice(0, 10);
  const format = h("select", {},
    h("option", { value: "sap_cats" }, "SAP PS (CATS)"), h("option", { value: "jira_worklog" }, "Jira Worklogs"),
    h("option", { value: "csv" }, "CSV"), h("option", { value: "json" }, "JSON"));
  const from = h("input", { class: "field", type: "date", value: iso(new Date(Date.now() - 31 * 864e5)) });
  const to = h("input", { class: "field", type: "date", value: iso(new Date()) });
  const pernr = h("input", { class: "field", placeholder: "00012345" });
  const jira = h("textarea", { class: "field mono", rows: 3 }, '{\n  "NP-8801/1020": "AET-12",\n  "NP-8801": "AET-1"\n}');
  const mark = h("input", { type: "checkbox" });
  const preview = h("pre", { class: "preview" }, "Vorschau erscheint hier.");
  let last = null;

  const run = async (download) => {
    let jiraMap = {};
    try { jiraMap = JSON.parse(jira.value || "{}"); } catch { return toast("Jira-Zuordnung ist kein gültiges JSON", { kind: "error" }); }
    const day = (v, add = 0) => (v ? new Date(new Date(v + "T00:00:00").getTime() + add * 864e5).toISOString() : null);
    try {
      last = await invoke("export_entries", {
        format: format.value,
        from: day(from.value),
        to: day(to.value, 1),
        options: { pernr: pernr.value || null, jira_issue_map: jiraMap, utc_offset_minutes: 0 },
        markExported: download && mark.checked,
      });
    } catch (e) {
      return toast("Export fehlgeschlagen", { kind: "error", detail: errorText(e) });
    }
    preview.textContent = last.content;
    if (last.skipped.length) toast(`${last.skipped.length} Einträge übersprungen`, { kind: "warn", detail: last.skipped.map(([id, why]) => `#${id}: ${why}`).join("\n") });
    if (download) {
      const ext = ["sap_cats", "csv"].includes(format.value) ? "csv" : "json";
      const a = h("a", { href: URL.createObjectURL(new Blob([last.content], { type: "text/plain" })), download: `aether-${format.value}-${iso(new Date())}.${ext}` });
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${last.exported_ids.length} Einträge exportiert`);
      if (mark.checked) emit("entries");
    }
  };

  el.append(
    h("div", { class: "panel" }, h("h2", {}, "Zeitraum & Format"),
      h("div", { class: "form-grid" },
        h("label", {}, "Format", format), h("label", {}, "Von", from), h("label", {}, "Bis", to),
        h("label", {}, "Personalnummer (PERNR)", pernr)),
      h("label", { style: { display: "grid", gap: "4px", marginTop: "12px", fontSize: "12px" } }, "Jira-Zuordnung (Netzplan/Vorgang → Issue)", jira),
      h("div", { class: "row", style: { marginTop: "12px" } },
        h("label", { class: "row grow" }, mark, "Exportierte Einträge als „Exportiert“ markieren"),
        h("button", { class: "btn", onclick: () => run(false) }, "Vorschau"),
        h("button", { class: "btn primary", onclick: () => run(true) }, "⇩ Exportieren"))),
    h("div", { class: "panel" }, h("h2", {}, "Vorschau"), preview));
}
