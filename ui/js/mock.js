// In-memory preview backend used when the UI runs outside the Tauri shell.
// It mirrors the IPC commands closely enough to click through every view;
// the authoritative logic lives in crates/aether-core.

const bus = new Map();
export function listen(event, handler) {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(handler);
  return () => bus.get(event).delete(handler);
}
function emit(event, payload) {
  for (const h of bus.get(event) ?? []) h(payload);
}

const now = Date.now();
const H = 3600e3, D = 24 * H;
let seq = 100;
const id = () => ++seq;

const db = {
  projects: [{ id: 1, project_code: "PRJ-2026-X", name: "Aether Rollout", created_at: new Date(now - 30 * D).toISOString() }],
  netzplaene: [
    { id: 1, project_id: 1, netzplan_nr: "NP-8801", wbs_element: "NP-8801-1020", description: "Systemintegration ERP", planned_hours: 120 },
    { id: 2, project_id: 1, netzplan_nr: "NP-8802", wbs_element: "NP-8802-2010", description: "Schulung & Go-Live", planned_hours: 40 },
  ],
  vorgaenge: [
    { id: 11, netzplan_id: 1, vorgang_nr: "1010", description: "Anforderungsanalyse", duration_days: 3, planned_hours: 16, remaining_hours: null, predecessors: [] },
    { id: 12, netzplan_id: 1, vorgang_nr: "1020", description: "Systemintegration", duration_days: 5, planned_hours: 40, remaining_hours: null, predecessors: [11] },
    { id: 13, netzplan_id: 1, vorgang_nr: "1030", description: "Schnittstellen-Design", duration_days: 4, planned_hours: 24, remaining_hours: null, predecessors: [11] },
    { id: 14, netzplan_id: 1, vorgang_nr: "1040", description: "Integrationstest", duration_days: 3, planned_hours: 24, remaining_hours: null, predecessors: [12, 13] },
    { id: 15, netzplan_id: 1, vorgang_nr: "1050", description: "Dokumentation", duration_days: 2, planned_hours: 8, remaining_hours: null, predecessors: [13] },
    { id: 16, netzplan_id: 1, vorgang_nr: "1060", description: "Abnahme", duration_days: 1, planned_hours: 8, remaining_hours: null, predecessors: [14, 15] },
    { id: 21, netzplan_id: 2, vorgang_nr: "2010", description: "Key-User-Schulung", duration_days: 2, planned_hours: 16, remaining_hours: null, predecessors: [] },
  ],
  entries: [],
  pages: [
    { id: 1, parent_id: null, title: "Workspace", icon: "🏠", position: 0 },
    { id: 2, parent_id: 1, title: "PRJ-2026-X Rollout", icon: "📁", position: 0 },
    { id: 3, parent_id: 2, title: "Architektur", icon: "🧩", position: 0 },
    { id: 4, parent_id: 2, title: "Meeting Notes", icon: "🗒️", position: 1 },
    { id: 5, parent_id: 1, title: "Wissensbasis", icon: "📚", position: 1 },
  ],
  blocks: [],
};

[
  [1, "1010", "CONSULTING", 9, 6, 240, "Workshop Anforderungen mit Fachbereich", "exported"],
  [1, "1010", "CONSULTING", 8, 6, 330, "Lastenheft finalisiert", "exported"],
  [1, "1010", "PM", 7, 7, 150, "Abstimmung Scope & Budget", "released"],
  [1, "1020", "DEV", 6, 6, 420, "Systemintegration Middleware", "released"],
  [1, "1020", "DEV", 5, 6, 450, "IDoc-Mapping Materialstamm", "draft"],
  [1, "1030", "DEV", 4, 6, 300, "REST-Schnittstelle Auftragsdaten", "draft"],
  [1, "1020", "DEV", 3, 6, 480, "Fehleranalyse Queue-Verarbeitung", "draft"],
  [1, "1030", "DEV", 2, 6, 360, "OpenAPI Spezifikation", "draft"],
  [1, "1020", "DEV", 1, 6, 390, "Systemintegration Delta-Load", "draft"],
  [2, "2010", "CONSULTING", 1, 2, 90, "Schulungsunterlagen Entwurf", "draft"],
].forEach(([np, v, la, d, h, m, desc, status]) => {
  const start = now - d * D - h * H;
  db.entries.push({
    id: id(), netzplan_id: np, vorgang_nr: v, leistungsart: la,
    start_time: new Date(start).toISOString(), end_time: new Date(start + m * 60e3).toISOString(),
    duration_minutes: m, description: desc, status_flag: status, source: "manual",
  });
});

[
  [3, "heading", "# Architektur der Systemintegration"],
  [3, "paragraph", "Die Middleware verbindet das ERP über IDocs mit dem Auftragsportal. Siehe [[Meeting Notes]]."],
  [3, "callout", "> **Risiko:** Vorgang 1020 liegt auf dem kritischen Pfad. Verzug verschiebt die Abnahme."],
  [3, "code", "```powershell\nGet-Service -Name 'Aether*' | Restart-Service\n```"],
  [3, "view", "netzplan"],
  [4, "heading", "# Jour fixe 22.09."],
  [4, "todo", "- [x] Budget NP-8801 prüfen\n- [ ] Testdaten für 1040 bereitstellen\n- [ ] Schulungstermine 2010 fixieren"],
  [4, "paragraph", "Delta-Load läuft stabil; nächster Schritt ist der Integrationstest. Zurück zur [[Architektur]]."],
  [4, "timelog", "⏱ 6,50h · NP-8801/1020 · Systemintegration Delta-Load"],
  [1, "heading", "# Willkommen in AETHER OS"],
  [1, "paragraph", "Lokaler Workspace mit **Notizen**, **Zeiterfassung auf Netzplan-Elementen** und einem integrierten KI-Assistenten. Drücke `Alt+Space` für die Befehlspalette."],
  [1, "paragraph", "Zeit direkt im Text buchen: tippe `/zeit NP-8801/1020 1.5h 'Review'` in einen Block und drücke Enter."],
  [1, "view", "kanban"],
].forEach(([page_id, block_type, content_markdown], i) =>
  db.blocks.push({ id: id(), page_id, position: i, block_type, content_markdown, has_embedding: false }));

let running = null;
const meter = { requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, last_ttft_ms: null, last_tokens_per_second: null };

const clone = (x) => structuredClone(x);
const fail = (msg) => { throw msg; };
const np = (nid) => db.netzplaene.find((n) => n.id === nid) ?? fail(`netzplan '${nid}' not found`);
const npByRef = (ref) =>
  db.netzplaene.find((n) => [n.netzplan_nr, n.wbs_element].some((x) => x.toLowerCase() === ref.toLowerCase())) ??
  fail(`netzplan '${ref}' not found`);

function row(e) {
  const n = np(e.netzplan_id);
  const p = db.projects.find((p) => p.id === n.project_id);
  return { ...clone(e), project_code: p.project_code, netzplan_nr: n.netzplan_nr, wbs_element: n.wbs_element };
}

function booked(nid, v) {
  return db.entries
    .filter((e) => e.netzplan_id === nid && e.status_flag !== "running" && (v == null || e.vorgang_nr === v))
    .reduce((s, e) => s + e.duration_minutes, 0) / 60;
}

function classify(planned, bookedH, eac) {
  if (planned <= 0) return [0, bookedH > 0 ? "exceeded" : "ok"];
  const c = bookedH / planned;
  if (bookedH > planned + 1e-9) return [c, "exceeded"];
  if (c >= 0.9 || eac > planned + 1e-9) return [c, "critical"];
  if (c >= 0.75) return [c, "warning"];
  return [c, "ok"];
}

function budget(nid) {
  const n = np(nid);
  const vs = db.vorgaenge.filter((v) => v.netzplan_id === nid);
  let etcSum = 0;
  const out = vs.map((v) => {
    const b = booked(nid, v.vorgang_nr);
    const etc = Math.max(v.remaining_hours ?? Math.max(v.planned_hours - b, 0), 0);
    etcSum += etc;
    const [consumed, level] = classify(v.planned_hours, b, b + etc);
    return { label: `${n.netzplan_nr}/${v.vorgang_nr}`, netzplan_id: nid, vorgang_nr: v.vorgang_nr, planned_hours: v.planned_hours, booked_hours: b, etc_hours: etc, eac_hours: b + etc, consumed, level };
  });
  const b = booked(nid);
  const etc = vs.length ? etcSum : Math.max(n.planned_hours - b, 0);
  const [consumed, level] = classify(n.planned_hours, b, b + etc);
  return [{ label: n.netzplan_nr, netzplan_id: nid, vorgang_nr: null, planned_hours: n.planned_hours, booked_hours: b, etc_hours: etc, eac_hours: b + etc, consumed, level }, ...out];
}

function schedule(nid) {
  const vs = db.vorgaenge.filter((v) => v.netzplan_id === nid);
  const byId = new Map(vs.map((v) => [v.id, v]));
  const succ = new Map(vs.map((v) => [v.id, []]));
  vs.forEach((v) => v.predecessors.forEach((p) => succ.get(p).push(v.id)));
  const indeg = new Map(vs.map((v) => [v.id, v.predecessors.length]));
  const order = [], ready = vs.filter((v) => !v.predecessors.length).map((v) => v.id);
  while (ready.length) {
    const i = ready.shift();
    order.push(i);
    for (const s of succ.get(i)) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) ready.push(s); }
  }
  const f = new Map();
  for (const i of order) {
    const v = byId.get(i);
    const faz = Math.max(0, ...v.predecessors.map((p) => f.get(p).fez));
    const rank = Math.max(-1, ...v.predecessors.map((p) => f.get(p).rank)) + 1;
    f.set(i, { faz, fez: faz + v.duration_days, rank });
  }
  const duration = Math.max(0, ...[...f.values()].map((x) => x.fez));
  for (const i of [...order].reverse()) {
    const x = f.get(i);
    x.sez = Math.min(duration, ...succ.get(i).map((s) => f.get(s).saz));
    x.saz = x.sez - byId.get(i).duration_days;
  }
  const nodes = order.map((i) => {
    const v = byId.get(i), x = f.get(i);
    const fp = Math.min(duration, ...succ.get(i).map((s) => f.get(s).faz)) - x.fez;
    return { vorgang_id: i, vorgang_nr: v.vorgang_nr, description: v.description, duration: v.duration_days, predecessors: v.predecessors, ...x, gp: x.saz - x.faz, fp, critical: Math.abs(x.saz - x.faz) < 1e-9 };
  });
  const critical_path = [];
  let cur = nodes.find((n) => !n.predecessors.length && n.critical);
  while (cur) {
    critical_path.push(cur.vorgang_id);
    cur = nodes.find((n) => n.critical && n.predecessors.includes(cur.vorgang_id) && Math.abs(n.faz - cur.fez) < 1e-9);
  }
  return { nodes, duration, critical_path };
}

function parseDuration(s) {
  s = s.toLowerCase().replace(",", ".");
  let m;
  if ((m = s.match(/^(\d+):(\d{2})$/))) return +m[1] * 60 + +m[2];
  let total = 0, ok = false;
  for (const part of s.matchAll(/(\d+(?:\.\d+)?)(h|std|m|min)/g)) { total += part[1] * (part[2].startsWith("m") ? 1 : 60); ok = true; }
  if (!ok || s.replace(/(\d+(?:\.\d+)?)(h|std|min|m)/g, "") !== "") fail(`invalid duration '${s}'`);
  return Math.round(total);
}

function logTime(line) {
  const m = line.trim().match(/^\/(?:zeit|time)\s+(\S+)\s+(\S+)\s*(.*)$/i) ?? fail("could not parse command: use /zeit NP-8801/1020 2.5h 'Text'");
  const [ref, vorgang] = m[1].split("/");
  const n = npByRef(ref);
  if (vorgang && !db.vorgaenge.some((v) => v.netzplan_id === n.id && v.vorgang_nr.toLowerCase() === vorgang.toLowerCase()))
    fail(`vorgang '${n.netzplan_nr}/${vorgang}' not found`);
  const minutes = parseDuration(m[2]);
  let rest = m[3];
  const la = rest.match(/#(\w+)/)?.[1]?.toUpperCase() ?? null;
  rest = rest.replace(/#\w+/, "").replace(/@\S+/g, "").trim();
  const desc = rest.replace(/^['"„“‘](.*)['"“”’]$/, "$1");
  const end = Date.now();
  const e = {
    id: id(), netzplan_id: n.id, vorgang_nr: vorgang ?? null, leistungsart: la,
    start_time: new Date(end - minutes * 60e3).toISOString(), end_time: new Date(end).toISOString(),
    duration_minutes: minutes, description: desc, status_flag: "draft", source: "slash",
  };
  db.entries.push(e);
  return { entry: clone(e), alerts: alerts(n.id, e.vorgang_nr) };
}

const alerts = (nid, v) => budget(nid).filter((s) => (s.vorgang_nr == null || s.vorgang_nr === v) && s.level !== "ok");

function tree(parent = null) {
  return db.pages.filter((p) => p.parent_id === parent).sort((a, b) => a.position - b.position)
    .map((p) => ({ ...clone(p), children: tree(p.id) }));
}

function exportRows(format, options) {
  const rows = db.entries.filter((e) => e.status_flag !== "running").map(row);
  const skipped = db.entries.filter((e) => e.status_flag === "running").map((e) => [e.id, "timer still running"]);
  const date = (t) => new Date(t).toISOString().slice(0, 10);
  let content;
  if (format === "sap_cats") {
    content = "PERNR;WORKDATE;RPROJ;RNPLNR;VORNR;LSTAR;CATSHOURS;MEINH;LTXA1\r\n" + rows.map((r) =>
      [options.pernr ?? "", date(r.start_time).replaceAll("-", ""), r.wbs_element, r.netzplan_nr, r.vorgang_nr ?? "", r.leistungsart ?? "",
        (r.duration_minutes / 60).toFixed(2).replace(".", ","), "H", r.description.slice(0, 40)].join(";")).join("\r\n") + "\r\n";
  } else if (format === "csv") {
    content = "id,project,netzplan,wbs_element,vorgang,leistungsart,start,end,duration_minutes,hours,description,status\r\n" + rows.map((r) =>
      [r.id, r.project_code, r.netzplan_nr, r.wbs_element, r.vorgang_nr ?? "", r.leistungsart ?? "", r.start_time, r.end_time, r.duration_minutes,
        (r.duration_minutes / 60).toFixed(2), `"${r.description.replaceAll('"', '""')}"`, r.status_flag].join(",")).join("\r\n") + "\r\n";
  } else if (format === "jira_worklog") {
    const map = options.jira_issue_map ?? {};
    const logs = [];
    for (const r of rows) {
      const key = map[`${r.netzplan_nr}/${r.vorgang_nr}`] ?? map[r.netzplan_nr];
      if (!key) { skipped.push([r.id, `no Jira issue mapped for ${r.netzplan_nr}/${r.vorgang_nr}`]); continue; }
      logs.push({ issueKey: key, started: r.start_time.replace("Z", "+0000"), timeSpentSeconds: r.duration_minutes * 60, comment: r.description });
    }
    return { content: JSON.stringify(logs, null, 2), exported_ids: [], skipped };
  } else {
    content = JSON.stringify(rows, null, 2);
  }
  return { content, exported_ids: rows.map((r) => r.id), skipped };
}

function route(prompt) {
  const lower = prompt.toLowerCase();
  if (/#(privat|private|vertraulich|confidential)/.test(lower))
    return { tier: "local", model: "ollama/llama3.2", score: 0, reasons: ["private marker found: kept on the local model"] };
  const forced = prompt.match(/^@(local|standard|reasoning)\b/)?.[1];
  if (forced) return { tier: forced, model: { local: "ollama/llama3.2", standard: "cloud-standard", reasoning: "cloud-reasoning" }[forced], score: 0, reasons: [`forced to ${forced} by user`] };
  const hints = ["analy", "architek", "architect", "plan", "warum", "why", "vergleich", "debug", "refactor", "strateg", "schritt für schritt", "bewerte"];
  const hits = hints.filter((h) => lower.includes(h)).length;
  let score = Math.min(25, Math.floor(prompt.length / 160)) + Math.min(60, hits * 15) + (prompt.includes("```") ? 20 : 0);
  const reasons = [];
  if (hits) reasons.push(`${hits} reasoning cue(s) (+${Math.min(60, hits * 15)})`);
  if (/übersetze|zusammenfass|translate|summari/.test(lower)) { score -= 15; reasons.push("simple transformation task (-15)"); }
  score = Math.max(0, score);
  const tier = score >= 60 ? "reasoning" : score >= 30 ? "standard" : "local";
  return { tier, model: { local: "ollama/llama3.2", standard: "cloud-standard", reasoning: "cloud-reasoning" }[tier], score, reasons };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat({ requestId, messages }) {
  const prompt = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const r = route(prompt);
  const text = prompt.replace(/^@\w+\s*/, "");
  const zeit = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden)\b.*?(NP-\d+(?:\/\w+)?)/i) ?? text.match(/(NP-\d+(?:\/\w+)?).*?(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden)\b/i);
  const context = db.blocks.filter((b) => text.split(/\s+/).some((w) => w.length > 4 && b.content_markdown.toLowerCase().includes(w.toLowerCase()))).slice(0, 3)
    .map((b) => ({ source: `Seite: ${db.pages.find((p) => p.id === b.page_id).title}`, text: b.content_markdown, score: 0.03, block_id: b.id, time_entry_id: null }));

  let answer, tool_calls = [];
  if (zeit && !messages.some((m) => m.role === "tool")) {
    const [ref, hours] = /^NP/i.test(zeit[1]) ? [zeit[1], zeit[2]] : [zeit[2], zeit[1]];
    answer = `Ich buche ${hours}h auf ${ref.toUpperCase()}.`;
    tool_calls = [{ id: "call_" + id(), type: "function", function: { name: "log_time", arguments: JSON.stringify({ command: `/zeit ${ref.toUpperCase()} ${hours.replace(",", ".")}h 'Gebucht per Assistent'` }) } }];
  } else if (messages.at(-1)?.role === "tool") {
    answer = "Erledigt. Die Buchung ist als **Entwurf** gespeichert und erscheint im Kanban unter *Entwurf*.";
  } else if (/git|powershell|dienst|service/i.test(text)) {
    answer = "Dafür brauche ich einen Systembefehl. Bitte bestätige die Ausführung.";
    tool_calls = [{ id: "call_" + id(), type: "function", function: { name: "run_powershell", arguments: JSON.stringify({ script: "Get-Service -Name 'Aether*' | Select-Object Name, Status" }) } }];
  } else {
    const b = budget(1)[0];
    answer = `**Vorschau-Modus** – ohne LiteLLM-Proxy antworte ich simuliert.\n\nNP-8801 steht bei **${b.booked_hours.toFixed(1)}h von ${b.planned_hours}h** (${Math.round(b.consumed * 100)} %), ETC ${b.etc_hours.toFixed(1)}h. Kritischer Pfad: 1010 → 1020 → 1040 → 1060.\n\nIm nativen Build geht diese Anfrage an \`${r.model}\` (${r.tier}).`;
  }

  const t0 = performance.now();
  await sleep(180 + Math.random() * 200);
  const ttft = performance.now() - t0;
  emit("ai://stream", { request_id: requestId, event: { type: "first_token", ttft_ms: ttft } });
  const tokens = answer.match(/\S+\s*/g) ?? [];
  const t1 = performance.now();
  for (let i = 0; i < tokens.length; i++) {
    await sleep(18 + Math.random() * 22);
    const tps = i > 0 ? i / ((performance.now() - t1) / 1000) : null;
    emit("ai://stream", { request_id: requestId, event: { type: "delta", text: tokens[i], tokens_per_second: tps } });
  }
  const secs = (performance.now() - t1) / 1000;
  const usage = {
    model: r.model,
    prompt_tokens: Math.ceil(messages.reduce((s, m) => s + (m.content?.length ?? 0), 0) / 4) + 180,
    completion_tokens: Math.ceil(answer.length / 4),
    cost_usd: r.tier === "local" ? 0 : r.tier === "standard" ? 0.0021 : 0.0114,
    ttft_ms: ttft,
    tokens_per_second: tokens.length > 1 ? (tokens.length - 1) / secs : null,
  };
  meter.requests++; meter.prompt_tokens += usage.prompt_tokens; meter.completion_tokens += usage.completion_tokens;
  meter.cost_usd += usage.cost_usd; meter.last_ttft_ms = usage.ttft_ms; meter.last_tokens_per_second = usage.tokens_per_second;
  emit("ai://meter", clone(meter));
  return { completion: { content: answer, tool_calls, finish_reason: tool_calls.length ? "tool_calls" : "stop", usage, exact_usage: false }, route: r, context, meter: clone(meter) };
}

const handlers = {
  workspace_tree: () => tree(),
  page_blocks: ({ pageId }) => clone(db.blocks.filter((b) => b.page_id === pageId).sort((a, b) => a.position - b.position)),
  create_page: ({ parentId, title, icon }) => {
    const p = { id: id(), parent_id: parentId ?? null, title, icon: icon ?? null, position: db.pages.filter((x) => x.parent_id === (parentId ?? null)).length };
    db.pages.push(p);
    return clone(p);
  },
  rename_page: ({ id: pid, title }) => { db.pages.find((p) => p.id === pid).title = title; },
  delete_page: ({ id: pid }) => {
    const doomed = new Set([pid]);
    let grew = true;
    while (grew) { grew = false; for (const p of db.pages) if (doomed.has(p.parent_id) && !doomed.has(p.id)) { doomed.add(p.id); grew = true; } }
    db.pages = db.pages.filter((p) => !doomed.has(p.id));
    db.blocks = db.blocks.filter((b) => !doomed.has(b.page_id));
  },
  add_block: ({ pageId, blockType, content }) => {
    const b = { id: id(), page_id: pageId, position: db.blocks.length, block_type: blockType, content_markdown: content, has_embedding: false };
    db.blocks.push(b);
    return clone(b);
  },
  update_block: ({ id: bid, blockType, content }) => {
    const b = db.blocks.find((x) => x.id === bid) ?? fail("block not found");
    Object.assign(b, { block_type: blockType, content_markdown: content, has_embedding: false });
    return clone(b);
  },
  delete_block: ({ id: bid }) => { db.blocks = db.blocks.filter((b) => b.id !== bid); },
  search_workspace: ({ query }) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const mark = (s) => { const i = s.toLowerCase().indexOf(q); return i < 0 ? s.slice(0, 80) : `…${s.slice(Math.max(0, i - 30), i)}[${s.slice(i, i + q.length)}]${s.slice(i + q.length, i + q.length + 40)}…`; };
    return [
      ...db.blocks.filter((b) => b.content_markdown.toLowerCase().includes(q)).map((b) => ({ kind: "block", id: b.id, page_id: b.page_id, page_title: db.pages.find((p) => p.id === b.page_id)?.title ?? "", snippet: mark(b.content_markdown), score: 1 })),
      ...db.entries.filter((e) => e.description.toLowerCase().includes(q)).map((e) => ({ kind: "time_entry", id: e.id, netzplan_nr: np(e.netzplan_id).netzplan_nr, vorgang_nr: e.vorgang_nr, snippet: mark(e.description), score: 0.5 })),
    ];
  },
  page_graph: () => {
    const edges = [];
    for (const p of db.pages) if (p.parent_id) edges.push({ from: p.parent_id, to: p.id, kind: "parent" });
    for (const b of db.blocks)
      for (const [, t] of b.content_markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        const to = db.pages.find((p) => p.title.toLowerCase() === t.trim().toLowerCase());
        if (to && to.id !== b.page_id) edges.push({ from: b.page_id, to: to.id, kind: "link" });
      }
    return { nodes: db.pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon, degree: edges.filter((e) => e.from === p.id || e.to === p.id).length })), edges };
  },
  wbs_tree: () => db.projects.map((p) => ({
    ...clone(p),
    netzplaene: db.netzplaene.filter((n) => n.project_id === p.id).map((n) => ({ ...clone(n), vorgaenge: clone(db.vorgaenge.filter((v) => v.netzplan_id === n.id)) })),
  })),
  log_time: ({ line }) => logTime(line),
  timer_status: () => running ? { entry: clone(running), idle_minutes: 0, is_idle: false } : null,
  timer_start: ({ netzplanId, vorgangNr, leistungsart, description }) => {
    if (running) fail(`timer #${running.id} is already running`);
    running = { id: id(), netzplan_id: netzplanId, vorgang_nr: vorgangNr, leistungsart, start_time: new Date().toISOString(), end_time: null, duration_minutes: null, description, status_flag: "running", source: "timer" };
    db.entries.push(running);
    return clone(running);
  },
  timer_stop: () => {
    if (!running) fail("no timer is running");
    const end = new Date();
    running.end_time = end.toISOString();
    running.duration_minutes = Math.max(1, Math.round((end - new Date(running.start_time)) / 60e3));
    running.status_flag = "draft";
    const e = running;
    running = null;
    return { entry: clone(e), idle_minutes: 0, alerts: alerts(e.netzplan_id, e.vorgang_nr) };
  },
  timer_discard: () => { db.entries = db.entries.filter((e) => e !== running); running = null; },
  time_entries: () => db.entries.map(row).sort((a, b) => a.start_time.localeCompare(b.start_time)),
  set_entry_status: ({ ids, status }) => { let n = 0; for (const e of db.entries) if (ids.includes(e.id) && e.status_flag !== "running") { e.status_flag = status; n++; } return n; },
  delete_time_entry: ({ id: eid }) => { db.entries = db.entries.filter((e) => e.id !== eid); },
  budget: ({ netzplanId }) => budget(netzplanId),
  schedule: ({ netzplanId }) => schedule(netzplanId),
  export_entries: ({ format, options, markExported }) => {
    const r = exportRows(format, options);
    if (markExported) for (const e of db.entries) if (r.exported_ids.includes(e.id)) e.status_flag = "exported";
    return r;
  },
  ai_route_preview: ({ prompt }) => route(prompt),
  ai_models: () => ({ local_model: "ollama/llama3.2", standard_model: "cloud-standard", reasoning_model: "cloud-reasoning" }),
  create_vorgang: ({ netzplanId, vorgangNr, description, durationDays, plannedHours, predecessors }) => {
    if (!vorgangNr) fail("Vorgangsnummer fehlt");
    if (db.vorgaenge.some((v) => v.netzplan_id === netzplanId && v.vorgang_nr === vorgangNr)) fail(`Vorgang ${vorgangNr} existiert bereits`);
    const preds = predecessors.map((p) => (db.vorgaenge.find((v) => v.netzplan_id === netzplanId && v.vorgang_nr === p) ?? fail(`vorgang '${p}' not found`)).id);
    const v = { id: id(), netzplan_id: netzplanId, vorgang_nr: vorgangNr, description, duration_days: durationDays, planned_hours: plannedHours, remaining_hours: null, predecessors: preds };
    db.vorgaenge.push(v);
    return clone(v);
  },
  ai_meter: () => clone(meter),
  ai_chat: (args) => chat(args),
  ai_plan_tool: ({ name, arguments: a }) => {
    if (["log_time", "search_workspace", "budget_status"].includes(name)) return { risk: "workspace" };
    const args = JSON.parse(a);
    return { risk: "requires_approval", call: { tool: name, ...args }, summary: name === "run_powershell" ? `PowerShell:\n${args.script}` : `${name} ${a}` };
  },
  ai_run_workspace_tool: ({ name, arguments: a }) => {
    const args = JSON.parse(a);
    if (name === "log_time") return JSON.stringify(logTime(args.command));
    if (name === "budget_status") return JSON.stringify(budget(npByRef(args.netzplan).id));
    return JSON.stringify(handlers.search_workspace({ query: args.query }));
  },
  ai_run_system_tool: () => "Vorschau-Modus: Systembefehle werden nur in der nativen App ausgeführt.\n[exit code: 0]",
  ai_index_pending: () => { let n = 0; for (const b of db.blocks) if (!b.has_embedding) { b.has_embedding = true; n++; } return n; },
};

export async function invoke(cmd, args) {
  const h = handlers[cmd];
  if (!h) throw `unknown command ${cmd}`;
  await sleep(4);
  return h(args);
}
