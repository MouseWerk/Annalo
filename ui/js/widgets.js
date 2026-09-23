// Time tracking card (right) and the LiteLLM chat (left "Systems & AI" panel).

import { invoke, listen } from "./api.js";
import { render } from "./markdown.js";
import { h, toast, errorText, emit, on, showAlerts, hours, num } from "./ui.js";

const LEISTUNGSARTEN = ["DEV", "CONSULTING", "PM", "TEST"];
const pad = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------ time tracker

export async function mountTimeTracker(root) {
  let wbs = [];
  let status = null;
  let tickHandle = null;
  let windowInfo = null;

  const chip = h("span", { class: "chip" }, "bereit");
  const task = h("div", { class: "timer-task" });
  const wbsLine = h("div", { class: "timer-wbs" });
  const display = h("div", { class: "timer-display", "aria-live": "off" }, "00:00:00");
  const sub = h("div", { class: "timer-sub" });
  const project = h("select", { "aria-label": "Projekt" });
  const netz = h("select", { "aria-label": "Netzplan / PSP-Element" });
  const vorgang = h("select", { class: "full", "aria-label": "Vorgang" });
  const la = h("select", { "aria-label": "Leistungsart" }, ...LEISTUNGSARTEN.map((x) => h("option", { value: x }, x)));
  const desc = h("input", { class: "field full", placeholder: "Beschreibung", "aria-label": "Beschreibung" });
  const picker = h("div", { class: "wbs-picker" }, project, netz, vorgang, la, desc);
  const mainBtn = h("button", { class: "btn wide primary" }, "Start");
  const discardBtn = h("button", { class: "icon-btn ghost small", title: "Timer verwerfen", "aria-label": "Timer verwerfen" }, "✕");
  const zeit = h("input", { class: "field zeit-input", placeholder: "/zeit NP-8801/1020 2.5h 'Text'", "aria-label": "Zeit manuell buchen" });
  const miniBudget = h("div", { class: "mini-budget" });
  const upcoming = h("div");

  root.append(
    h("div", { class: "card-label" }, h("span", {}, "Time Tracking"), h("span", { class: "row" }, chip, discardBtn)),
    task, wbsLine, display, sub, mainBtn, picker,
    zeit, h("div", { class: "hint" }, "Enter bucht · 2.5h, 90m, 1:30 · #DEV · @gestern @08:30"),
    miniBudget,
    h("div", { class: "upcoming" }, h("div", { class: "card-label" }, "Upcoming"), upcoming));

  const fill = (sel, items, label) => {
    const prev = sel.value;
    sel.replaceChildren(...items.map((i) => h("option", { value: i.value }, label(i))));
    if (items.some((i) => String(i.value) === String(prev))) sel.value = prev;
  };
  const allNetzplaene = () => wbs.flatMap((p) => p.netzplaene);
  const currentNetzplan = () => allNetzplaene().find((n) => n.id === +netz.value);

  const cascade = () => {
    fill(project, wbs.map((p) => ({ value: p.id, ...p })), (p) => p.project_code);
    const p = wbs.find((x) => x.id === +project.value) ?? wbs[0];
    fill(netz, (p?.netzplaene ?? []).map((n) => ({ value: n.id, ...n })), (n) => n.netzplan_nr);
    const n = currentNetzplan();
    fill(vorgang, [{ value: "", vorgang_nr: "", description: "(kein Vorgang)" }, ...(n?.vorgaenge ?? []).map((v) => ({ value: v.vorgang_nr, ...v }))],
      (v) => (v.vorgang_nr ? `${v.vorgang_nr} · ${v.description}` : v.description));
    paintStatic();
  };
  project.addEventListener("change", cascade);
  netz.addEventListener("change", cascade);
  vorgang.addEventListener("change", paintStatic);

  function selectWbs({ netzplanId, vorgangNr }) {
    if (status) return;
    const p = wbs.find((x) => x.netzplaene.some((n) => n.id === netzplanId));
    if (!p) return;
    project.value = p.id;
    cascade();
    netz.value = netzplanId;
    cascade();
    vorgang.value = vorgangNr ?? "";
    paintStatic();
  }

  async function paintStatic() {
    const n = currentNetzplan();
    const v = n?.vorgaenge.find((x) => x.vorgang_nr === vorgang.value);
    if (!status) {
      task.textContent = v?.description ?? n?.description ?? "Kein Netzplan";
      wbsLine.textContent = n ? `${n.netzplan_nr}${v ? "/" + v.vorgang_nr : ""} · ${la.value}` : "";
    }
    if (!n) return miniBudget.replaceChildren();
    const [budget, sched] = await Promise.all([invoke("budget", { netzplanId: n.id }), invoke("schedule", { netzplanId: n.id })]);
    const rows = budget.filter((b) => b.vorgang_nr == null || b.vorgang_nr === vorgang.value);
    miniBudget.replaceChildren(...rows.map((b) => h("div", { class: "budget-row", style: { gridTemplateColumns: "64px 1fr auto" } },
      h("span", { class: "mono" }, b.vorgang_nr ? `/${b.vorgang_nr}` : b.label),
      h("div", { class: "bar", title: `ETC ${num(b.etc_hours)}h · EAC ${num(b.eac_hours)}h` },
        h("i", { class: b.level, style: { width: `${Math.min(b.consumed, 1) * 100}%` } })),
      h("span", { style: { fontSize: "11px" } }, `${num(b.booked_hours, 0)}/${num(b.planned_hours, 0)}h`))));
    // Upcoming: the next Vorgänge by earliest start that still have plan hours left.
    const next = sched.nodes
      .filter((x) => x.vorgang_nr !== vorgang.value)
      .filter((x) => (budget.find((b) => b.vorgang_nr === x.vorgang_nr)?.consumed ?? 0) < 1)
      .sort((a, b) => a.faz - b.faz || Number(b.critical) - Number(a.critical))
      .slice(0, 2);
    upcoming.replaceChildren(...(next.length
      ? next.map((x) => h("p", {}, `${x.vorgang_nr} ${x.description} `, h("span", { class: "hint" }, `ab T${x.faz}${x.critical ? " · kritisch" : ""}`)))
      : [h("p", { class: "hint" }, "Keine offenen Vorgänge")]));
  }

  const paint = () => {
    const running = Boolean(status);
    display.classList.toggle("running", running);
    mainBtn.textContent = running ? "Stop" : "Start";
    mainBtn.classList.toggle("primary", !running);
    discardBtn.hidden = !running;
    picker.hidden = running;
    chip.className = `chip ${running ? (status.is_idle ? "warning" : "running") : ""}`;
    chip.textContent = running ? (status.is_idle ? "Leerlauf" : "läuft") : "bereit";
    if (!running) {
      display.textContent = "00:00:00";
      sub.textContent = windowInfo?.process ? `Aktives Fenster: ${windowInfo.process}` : "";
      return;
    }
    const e = status.entry;
    const n = allNetzplaene().find((x) => x.id === e.netzplan_id);
    const v = n?.vorgaenge.find((x) => x.vorgang_nr === e.vorgang_nr);
    task.textContent = e.description || v?.description || n?.description || "Timer";
    wbsLine.textContent = `${n?.netzplan_nr ?? "?"}${e.vorgang_nr ? "/" + e.vorgang_nr : ""} · ${e.leistungsart ?? "–"}`;
    const secs = Math.max(0, Math.floor((Date.now() - new Date(e.start_time)) / 1000));
    display.textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
    sub.replaceChildren(status.idle_minutes > 0 ? h("span", { class: "idle-badge" }, `${status.idle_minutes} min Leerlauf erkannt`) : "");
  };

  const refresh = async () => {
    status = await invoke("timer_status");
    if (status) {
      const e = status.entry;
      selectWbs({ netzplanId: e.netzplan_id, vorgangNr: e.vorgang_nr });
      if (e.leistungsart) la.value = e.leistungsart;
      desc.value = e.description;
    }
    clearInterval(tickHandle);
    if (status) tickHandle = setInterval(paint, 1000);
    paint();
    paintStatic();
  };

  mainBtn.addEventListener("click", async () => {
    try {
      if (!status) {
        if (!netz.value) return toast("Bitte zuerst einen Netzplan wählen", { kind: "warn" });
        await invoke("timer_start", { netzplanId: +netz.value, vorgangNr: vorgang.value || null, leistungsart: la.value || null, description: desc.value });
      } else {
        const idle = status.idle_minutes;
        const subtract = idle > 0 && confirm(`${idle} Minuten Leerlauf erkannt. Von der Buchung abziehen?`);
        const out = await invoke("timer_stop", { subtractIdle: subtract });
        toast(`Gebucht: ${hours(out.entry.duration_minutes)}h`, { detail: out.entry.description });
        showAlerts(out.alerts);
        desc.value = "";
      }
      emit("entries");
    } catch (e) {
      toast("Timer-Fehler", { kind: "error", detail: errorText(e) });
    }
  });
  discardBtn.addEventListener("click", async () => {
    if (!confirm("Laufenden Timer verwerfen?")) return;
    await invoke("timer_discard");
    emit("entries");
  });
  la.addEventListener("change", paintStatic);
  zeit.addEventListener("keydown", async (ev) => {
    if (ev.key !== "Enter" || !zeit.value.trim()) return;
    let line = zeit.value.trim();
    if (!/^\/(zeit|time)\b/i.test(line)) line = `/zeit ${line}`;
    try {
      const out = await invoke("log_time", { line });
      toast(`Gebucht: ${hours(out.entry.duration_minutes)}h`, { detail: out.entry.description });
      showAlerts(out.alerts);
      zeit.value = "";
      emit("entries");
    } catch (e) {
      toast("Buchung fehlgeschlagen", { kind: "error", detail: errorText(e) });
    }
  });

  on("entries", refresh);
  on("timer:toggle", () => mainBtn.click());
  on("timer:focus", () => zeit.focus());
  on("wbs:select", selectWbs);
  listen("activity://tick", (t) => {
    windowInfo = t.window;
    if (status && t.timer_idle_minutes != null) {
      status.idle_minutes = t.timer_idle_minutes;
      status.is_idle = (t.idle_seconds ?? 0) >= 300;
    }
    paint();
  });

  wbs = await invoke("wbs_tree");
  cascade();
  await refresh();
}

// ------------------------------------------------------------ AI assistant

let activeContext = null;
/// Called by the shell when the visible page changes.
export function setActiveContext(ctx) {
  activeContext = ctx;
  const el = document.getElementById("ai-context");
  if (el) el.textContent = ctx ? `Liest „${ctx.title}“ · ~${Math.ceil(ctx.text.length / 4)} Tokens` : "Workspace-RAG";
}

export async function mountAssistant(root, { onMeter, onLiveSpeed, modelOverride }) {
  const history = [];
  const chat = h("div", { class: "chat", role: "log", "aria-live": "polite" });
  const input = h("textarea", { rows: 1, placeholder: "Type your command…", "aria-label": "Nachricht" });
  const badge = h("div", { class: "route-badge" });
  const useTools = h("input", { type: "checkbox", checked: true, "aria-label": "Tools erlauben" });
  const sendBtn = h("button", { class: "icon-btn ghost", title: "Senden (Enter)", "aria-label": "Senden" }, "➤");
  let busy = false;
  let streamTarget = null;

  root.append(
    h("div", { class: "card-label" }, h("span", {}, "◍ LiteLLM Chat"),
      h("label", { class: "row", title: "Function Calling erlauben", style: { textTransform: "none", letterSpacing: 0, fontWeight: 400 } }, useTools, "Tools")),
    h("div", { class: "hint", id: "ai-context", style: { marginTop: "-4px", marginBottom: "6px" } }, "Workspace-RAG"),
    chat,
    h("div", { class: "composer" }, h("div", { class: "composer-box" }, input, sendBtn), badge));

  const add = (role, content = "", cls = "") => {
    const m = h("div", { class: `msg ${role} ${cls}` });
    if (role === "assistant") m.innerHTML = render(content);
    else m.textContent = content;
    chat.append(m);
    chat.scrollTop = chat.scrollHeight;
    return m;
  };
  add("assistant", "Hallo! Ich kenne deine Notizen, Netzpläne und Zeitlogs. Frag z. B. *„Wie steht NP-8801?“* oder *„Buche 1.5h auf NP-8801/1040“*.");

  const withOverride = (text) => {
    const tier = modelOverride();
    return tier && !/^@(local|standard|reasoning)\b/.test(text) ? `@${tier} ${text}` : text;
  };

  let previewTimer;
  const previewRoute = () => {
    clearTimeout(previewTimer);
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    previewTimer = setTimeout(async () => {
      if (!input.value.trim()) return badge.replaceChildren();
      const r = await invoke("ai_route_preview", { prompt: withOverride(input.value), useTools: useTools.checked });
      badge.replaceChildren(h("span", { class: `tier ${r.tier}` }, r.tier), h("span", { class: "mono" }, r.model),
        h("span", { title: r.reasons.join("\n") }, `Score ${r.score}`));
    }, 250);
  };
  input.addEventListener("input", previewRoute);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", () => send());

  let streamText = "";
  listen("ai://stream", ({ request_id, event }) => {
    if (!streamTarget || request_id !== streamTarget.id) return;
    if (event.type === "first_token") onLiveSpeed({ ttft: event.ttft_ms });
    if (event.type === "delta") {
      streamText += event.text;
      streamTarget.el.innerHTML = render(streamText);
      chat.scrollTop = chat.scrollHeight;
      onLiveSpeed({ tps: event.tokens_per_second });
    }
  });
  listen("ai://meter", onMeter);

  async function runTools(calls) {
    const results = [];
    for (const c of calls) {
      try {
        const plan = await invoke("ai_plan_tool", { name: c.function.name, arguments: c.function.arguments });
        let out;
        if (plan.risk === "workspace") {
          out = await invoke("ai_run_workspace_tool", { name: c.function.name, arguments: c.function.arguments });
          add("system", `Tool ${c.function.name} ausgeführt`);
          if (c.function.name === "log_time") {
            showAlerts(JSON.parse(out).alerts);
            emit("entries");
          }
        } else {
          const approved = await askApproval(plan.summary);
          out = approved ? await invoke("ai_run_system_tool", { call: plan.call }) : "Vom Nutzer abgelehnt.";
          if (approved) add("assistant", "```\n" + out + "\n```");
        }
        results.push({ role: "tool", tool_call_id: c.id, content: out });
      } catch (e) {
        results.push({ role: "tool", tool_call_id: c.id, content: `Fehler: ${errorText(e)}` });
      }
    }
    return results;
  }

  function askApproval(summary) {
    return new Promise((resolve) => {
      const card = h("div", { class: "approval" }, h("b", {}, "⚠ Systembefehl bestätigen"), h("pre", {}, summary));
      const done = (ok) => { card.replaceWith(add("system", ok ? "Ausführung bestätigt" : "Ausführung abgelehnt")); resolve(ok); };
      card.append(h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => done(true) }, "Ausführen"),
        h("button", { class: "btn", onclick: () => done(false) }, "Ablehnen")));
      chat.append(card);
      chat.scrollTop = chat.scrollHeight;
    });
  }

  async function send(textArg) {
    const text = (textArg ?? input.value).trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";
    badge.replaceChildren();
    add("user", text);
    const turnStart = history.length;
    history.push({ role: "user", content: withOverride(text) });

    try {
      for (let round = 0; round < 4; round++) {
        const ctx = activeContext
          ? [{ role: "system", content: `Aktive Seite „${activeContext.title}“:\n${activeContext.text.slice(0, 6000)}` }]
          : [];
        const requestId = crypto.randomUUID();
        streamText = "";
        streamTarget = { id: requestId, el: add("assistant", "", "cursor") };
        const out = await invoke("ai_chat", { requestId, messages: [...ctx, ...history], useTools: useTools.checked });
        const c = out.completion;
        const el = streamTarget.el;
        el.classList.remove("cursor");
        el.innerHTML = render(c.content || (c.tool_calls.length ? "_Ruft Tools auf …_" : ""));
        const u = c.usage;
        el.append(h("div", { class: "meta" },
          h("span", { class: `tier ${out.route.tier}`, title: out.route.reasons.join("\n") }, out.route.model),
          u.ttft_ms != null ? h("span", {}, `TTFT ${Math.round(u.ttft_ms)} ms`) : "",
          u.tokens_per_second != null ? h("span", {}, `${num(u.tokens_per_second)} t/s`) : "",
          h("span", {}, `${u.prompt_tokens}+${u.completion_tokens} Tok${c.exact_usage ? "" : " ≈"}`),
          h("span", {}, `$${u.cost_usd.toFixed(4)}`),
          out.context.length ? h("span", { title: out.context.map((x) => x.source).join("\n") }, `${out.context.length} Quellen`) : ""));
        streamTarget = null;
        onMeter(out.meter);
        history.push({ role: "assistant", content: c.content || null, tool_calls: c.tool_calls });
        if (!c.tool_calls.length) break;
        history.push(...(await runTools(c.tool_calls)));
      }
    } catch (e) {
      streamTarget?.el.remove();
      streamTarget = null;
      add("system", `Fehler: ${errorText(e)}`);
      history.length = turnStart;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  on("assistant:focus", () => input.focus());
  on("assistant:ask", (q) => send(q));
}
