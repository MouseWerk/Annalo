// "Today's Focus": project plan tree, Vorgang property card and active Vorgänge.

import { invoke } from "./api.js";
import { h, toast, errorText, emit, num } from "./ui.js";
import { renderInline } from "./views.js";

let selection = null; // { netzplanId, vorgangNr }
let projectId = null;
const openNodes = new Set();

export function statusPill(node) {
  if (!node) return h("span", { class: "pill" }, "–");
  if (node.critical) return h("span", { class: "pill red" }, "Kritischer Pfad");
  return h("span", { class: "pill teal" }, `Puffer ${num(node.gp, 0)} T`);
}

export function budgetPill(b) {
  if (!b) return h("span", { class: "pill" }, "–");
  const label = { ok: "im Plan", warning: "Warnung", critical: "Kritisch", exceeded: "Überschritten" }[b.level];
  return h("span", { class: `pill ${b.level}`, title: `ETC ${num(b.etc_hours)}h · EAC ${num(b.eac_hours)}h` },
    `${num(b.booked_hours)} / ${num(b.planned_hours, 0)}h · ${label}`);
}

function section(title, dbLabel, ...content) {
  const sec = h("section", { class: "focus-section" });
  const twisty = h("span", { class: "twisty", role: "button", "aria-label": "Ein-/ausklappen" }, "▼");
  twisty.addEventListener("click", () => sec.classList.toggle("collapsed"));
  sec.append(h("h2", {}, twisty, title), h("div", { class: "section-content" }, dbLabel ? h("div", { class: "db-label" }, "▤ ", dbLabel) : null, ...content));
  return sec;
}

export async function renderFocus(root, { navigate }) {
  const [wbs, tree, running] = await Promise.all([invoke("wbs_tree"), invoke("workspace_tree"), invoke("timer_status")]);
  const inner = h("div", { class: "canvas-inner" });
  root.replaceChildren(inner);
  if (!wbs.length) {
    inner.append(h("h1", { class: "focus-title" }, "Today's Focus"), h("p", { class: "empty" }, "Noch kein Projekt angelegt."));
    return;
  }
  const project = wbs.find((p) => p.id === projectId) ?? wbs.find((p) => p.netzplaene.some((n) => n.id === running?.entry.netzplan_id)) ?? wbs[0];
  projectId = project.id;

  // Schedules and budgets for every Netzplan of the project.
  const data = new Map();
  await Promise.all(project.netzplaene.map(async (n) => {
    const [sched, budget] = await Promise.all([invoke("schedule", { netzplanId: n.id }), invoke("budget", { netzplanId: n.id })]);
    data.set(n.id, { sched, budget });
  }));
  const nodeOf = (nid, nr) => data.get(nid)?.sched.nodes.find((x) => x.vorgang_nr === nr);
  const budgetOf = (nid, nr) => data.get(nid)?.budget.find((b) => (b.vorgang_nr ?? null) === (nr ?? null));

  if (running) selection = { netzplanId: running.entry.netzplan_id, vorgangNr: running.entry.vorgang_nr };
  if (!selection || !project.netzplaene.some((n) => n.id === selection.netzplanId)) {
    // Default: first critical Vorgang that still has plan hours left.
    const first = project.netzplaene[0];
    const d = data.get(first?.id);
    const open = d?.sched.nodes.find((x) => x.critical && (budgetOf(first.id, x.vorgang_nr)?.consumed ?? 0) < 1) ?? d?.sched.nodes[0];
    selection = { netzplanId: first?.id, vorgangNr: open?.vorgang_nr ?? null };
  }
  if (!openNodes.size) project.netzplaene.forEach((n) => openNodes.add(n.id));

  const select = (netzplanId, vorgangNr) => {
    selection = { netzplanId, vorgangNr };
    emit("wbs:select", selection);
    paint();
  };

  const projectSelect = wbs.length > 1
    ? h("select", { "aria-label": "Projekt", onchange: (e) => { projectId = +e.target.value; selection = null; renderFocus(root, { navigate }); } },
      ...wbs.map((p) => h("option", { value: p.id, selected: p.id === project.id }, p.project_code)))
    : null;
  const head = h("div", { class: "view-head" }, h("h1", { class: "focus-title" }, `Today's Focus: ${project.name}`), projectSelect);
  const grid = h("div", { class: "focus-grid" });
  const bottom = h("div");
  inner.append(head, grid, bottom);

  // Pages whose title mentions the project or one of its Netzpläne.
  const flat = [];
  const walk = (list) => list.forEach((p) => { flat.push(p); walk(p.children); });
  walk(tree);
  const keys = [project.project_code, ...project.netzplaene.map((n) => n.netzplan_nr)].map((k) => k.toLowerCase());
  const linked = flat.filter((p) => keys.some((k) => p.title.toLowerCase().includes(k))).flatMap((p) => [p, ...p.children]);

  function paint() {
    // ---- project plan tree
    const list = h("ul", { class: "wbs-tree" });
    for (const n of project.netzplaene) {
      const d = data.get(n.id);
      const isOpen = openNodes.has(n.id);
      const li = h("li", { class: isOpen ? "" : "collapsed" });
      const twisty = h("span", { class: `twisty ${isOpen ? "open" : ""}` }, "▶");
      const row = h("div", { class: `row-item${selection.netzplanId === n.id && !selection.vorgangNr ? " sel" : ""}` },
        twisty, h("b", {}, n.netzplan_nr), h("span", {}, n.description), h("span", { class: "muted" }, `${Math.round((d.budget[0]?.consumed ?? 0) * 100)} %`));
      row.addEventListener("click", (e) => {
        if (e.target === twisty) {
          isOpen ? openNodes.delete(n.id) : openNodes.add(n.id);
          return paint();
        }
        select(n.id, null);
      });
      const kids = h("ul", {}, ...d.sched.nodes.map((v) => {
        const b = budgetOf(n.id, v.vorgang_nr);
        const r = h("div", { class: `row-item${selection.netzplanId === n.id && selection.vorgangNr === v.vorgang_nr ? " sel" : ""}` },
          v.critical ? h("span", { class: "crit-dot", title: "kritischer Pfad" }) : h("span", { style: { width: "6px" } }),
          "📄", h("span", {}, `${v.vorgang_nr} ${v.description}`), h("span", { class: "muted" }, b ? `${Math.round(b.consumed * 100)} %` : ""));
        r.addEventListener("click", () => select(n.id, v.vorgang_nr));
        return h("li", {}, r);
      }));
      li.append(row, kids);
      list.append(li);
    }
    if (linked.length) {
      const pagesList = h("ul", {}, ...linked.map((p) => h("li", {}, h("div", { class: "row-item", onclick: () => navigate(`#/page/${p.id}`) }, h("span", { style: { width: "6px" } }), `${p.icon ?? "📄"} ${p.title}`))));
      list.append(h("li", {}, h("div", { class: "row-item" }, h("span", { class: "twisty open" }, "▶"), h("span", { style: { color: "var(--text-2)" } }, "Verknüpfte Seiten")), pagesList));
    }

    // ---- property card
    const np = project.netzplaene.find((n) => n.id === selection.netzplanId);
    const node = selection.vorgangNr ? nodeOf(np.id, selection.vorgangNr) : null;
    const b = budgetOf(np.id, selection.vorgangNr);
    const sched = data.get(np.id).sched;
    const title = node ? `${node.vorgang_nr} ${node.description}` : `${np.netzplan_nr} ${np.description}`;
    const props = h("dl", { class: "props" },
      h("dt", {}, "Status"), h("dd", {}, node ? statusPill(node) : h("span", { class: "pill violet" }, `${sched.nodes.length} Vorgänge`)),
      h("dt", {}, "Netzplan"), h("dd", {}, h("span", { class: "pill violet" }, np.netzplan_nr)),
      h("dt", {}, "PSP-Element"), h("dd", {}, h("span", { class: "pill orange" }, np.wbs_element)),
      h("dt", {}, "Termin"), h("dd", {}, node
        ? h("span", { class: "pill blue", title: `SAZ ${node.saz} · SEZ ${node.sez}` }, `T${num(node.faz, 0)} – T${num(node.fez, 0)}`)
        : h("span", { class: "pill blue" }, `${num(sched.duration, 0)} Tage gesamt`)),
      h("dt", {}, "Budget"), h("dd", {}, budgetPill(b)),
      h("dt", {}, "ETC"), h("dd", {}, b ? `${num(b.etc_hours)} h · EAC ${num(b.eac_hours)} h` : "–"));
    const actions = h("div", { class: "row", style: { padding: "12px 0 0 18px" } },
      h("button", { class: "btn primary", onclick: () => { emit("wbs:select", selection); emit("timer:toggle"); } }, "▶ Timer"),
      h("button", { class: "btn", onclick: () => emit("palette:open", `/zeit ${np.netzplan_nr}${node ? "/" + node.vorgang_nr : ""} `) }, "/zeit buchen"),
      h("button", { class: "btn", onclick: () => navigate("#/view/netzplan") }, "⬡ Netzplan"));

    grid.replaceChildren(
      section("Projektplan", `PSP-Struktur · ${project.project_code}`, list),
      section(node ? "Vorgang" : "Netzplan", "Relationale Datenbank", h("div", { class: "prop-title" }, "📄 ", title), props, actions));

    // ---- active Vorgänge table
    const rows = project.netzplaene.flatMap((n) => data.get(n.id).sched.nodes.map((v) => ({ n, v, b: budgetOf(n.id, v.vorgang_nr) })))
      .filter(({ b }) => !b || b.consumed < 1 || b.level === "exceeded");
    const table = h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", {}, "Vorgang"), h("th", {}, "Netzplan"), h("th", {}, "Status"), h("th", {}, "Budget"), h("th", {}, "Termin"), h("th", { class: "num" }, "ETC"))),
      h("tbody", {}, ...rows.map(({ n, v, b: bb }) => {
        const tr = h("tr", { style: { cursor: "pointer" } },
          h("td", {}, h("b", {}, `${v.vorgang_nr} ${v.description}`)),
          h("td", { class: "mono" }, n.netzplan_nr),
          h("td", {}, statusPill(v)),
          h("td", {}, budgetPill(bb)),
          h("td", { class: "mono nowrap" }, `T${v.faz}–T${v.fez}`),
          h("td", { class: "num" }, bb ? num(bb.etc_hours) : "–"));
        tr.addEventListener("click", () => select(n.id, v.vorgang_nr));
        return tr;
      })));
    const form = newVorgangForm(np, () => renderFocus(root, { navigate }));
    const recent = h("div");
    bottom.replaceChildren(
      section("Aktive Vorgänge", "Relationale Datenbank · Vorgänge", table, form),
      h("div", { style: { height: "18px" } }),
      section("Letzte Buchungen", "Relationale Datenbank · Zeiteinträge", recent));
    renderInline(recent, "table").catch((e) => recent.append(errorText(e)));
  }
  paint();
}

function newVorgangForm(np, done) {
  const wrap = h("div");
  const open = () => {
    const nr = h("input", { class: "field", placeholder: "Nr., z. B. 1070", style: { width: "110px" } });
    const desc = h("input", { class: "field grow", placeholder: "Beschreibung" });
    const days = h("input", { class: "field", type: "number", min: "0", step: "0.5", value: "1", title: "Dauer (Tage)", style: { width: "80px" } });
    const hrs = h("input", { class: "field", type: "number", min: "0", step: "1", value: "8", title: "Planstunden", style: { width: "80px" } });
    const after = h("input", { class: "field", placeholder: "nach (1040,1050)", style: { width: "140px" } });
    const save = h("button", { class: "btn primary" }, "Anlegen");
    save.addEventListener("click", async () => {
      try {
        await invoke("create_vorgang", {
          netzplanId: np.id, vorgangNr: nr.value.trim(), description: desc.value.trim(),
          durationDays: +days.value || 0, plannedHours: +hrs.value || 0,
          predecessors: after.value.split(",").map((x) => x.trim()).filter(Boolean),
        });
        toast(`Vorgang ${np.netzplan_nr}/${nr.value.trim()} angelegt`);
        done();
      } catch (e) {
        toast("Vorgang nicht angelegt", { kind: "error", detail: errorText(e) });
      }
    });
    wrap.replaceChildren(h("div", { class: "row", style: { padding: "10px 0 0 18px", flexWrap: "wrap" } }, nr, desc, days, hrs, after, save,
      h("button", { class: "btn", onclick: () => wrap.replaceChildren(addBtn) }, "Abbrechen")));
    nr.focus();
  };
  const addBtn = h("button", { class: "add-row", onclick: open }, `＋ Neuer Vorgang in ${np.netzplan_nr}`);
  wrap.append(addBtn);
  return wrap;
}
