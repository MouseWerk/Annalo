import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch } from "../lib/harness.js";
import { startFakeLiteLLM } from "../lib/fake-litellm.js";

let app, llm;
before(async () => {
  llm = await startFakeLiteLLM({ port: 4999 });
  app = await launch();
});
after(async () => {
  await app?.close();
  await llm?.close();
});

test("settings: server URL, token and connection test", async () => {
  await app.keys(["Control", ","]);
  await app.waitText(".settings-head h1", /KI & LiteLLM/);
  const url = await app.$('input[aria-label="Server-URL"]');
  await url.setValue(llm.url);
  await app.waitFor(".savebar");
  await app.click(".savebar .btn-primary");
  await app.waitText(".toast-title", /Einstellungen gespeichert/);

  // Without a token the server refuses.
  await app.click(".set-row .btn-secondary");
  await app.waitText(".conn", /Keine Verbindung/);

  const key = await app.$('input[aria-label="API-Token"]');
  await key.setValue(llm.apiKey);
  await app.click(".key-input + .btn-primary");
  await app.waitText(".toast-title", /API-Token gespeichert/);
  await app.waitText(".conn", /Verbunden · 4 Modelle/);
  await app.shot("settings-ai");
  const view = await app.invoke("settings_get");
  assert.equal(view.api_key_set, true);
  assert.equal(view.settings.litellm_base_url, llm.url);
  // The key is never part of the settings payload.
  assert.ok(!JSON.stringify(view).includes(llm.apiKey));
});

test("settings: models are picked from the server list", async () => {
  const selects = await app.$$(".set-row select");
  assert.ok(selects.length >= 3, "model selects appear once connected");
  await app.select('select[aria-label="Lokales Modell"]', "firma-schnell");
  await app.select('select[aria-label="Standardmodell"]', "firma-standard");
  await app.select('select[aria-label="Reasoning-Modell"]', "firma-reasoning");
  await app.select('select[aria-label="Embedding-Modell"]', "firma-embed");
  await app.shot("settings-models");
  await app.click(".savebar .btn-primary");
  await app.waitText(".toast-title", /Einstellungen gespeichert/);
  const view = await app.invoke("settings_get");
  assert.equal(view.settings.router.standard_model, "firma-standard");
  assert.equal(view.settings.embedding_model, "firma-embed");
});

test("semantic index is built through the embedding model", async () => {
  const n = await app.invoke("ai_index_pending");
  assert.ok(n > 5, `indexed ${n} chunks`);
  assert.ok(llm.requests.some((r) => r.url === "/v1/embeddings" && r.body.model === "firma-embed"));
});

test("assistant streams an answer with markdown, links and metrics", async () => {
  await app.click(".sidebar .tree-row");
  await app.keys(["Control", "j"]);
  const ta = await app.waitFor(".composer textarea");
  await ta.setValue("Fasse die Seite zusammen");
  await app.keys(["Enter"]);
  await app.waitFor(".msg-ai .prose h2");
  await app.waitFor(".msg-meta");
  const html = await (await app.$(".msg-ai .prose")).getHTML();
  assert.match(html, /<h2>\s*Zusammenfassung\s*<\/h2>/);
  assert.match(html, /data-wikilink/);
  assert.match(html, /<pre>\s*<code/);
  const meta = await app.text(".msg-meta");
  assert.match(meta, /firma-(schnell|standard|reasoning)/);
  assert.match(meta, /Tokens/);
  assert.match(meta, /\$0\.0012/);
  const req = llm.requests.filter((r) => r.url === "/v1/chat/completions").pop();
  assert.equal(req.headers.authorization, `Bearer ${llm.apiKey}`);
  assert.equal(req.body.stream, true);
  assert.ok(req.body.messages.some((m) => m.role === "system" && /Aktuell geöffnete Seite/.test(m.content)), "active page is sent");
  await app.shot("assistant-answer");
});

test("links in answers open pages", async () => {
  const link = await app.$('.msg-ai a[data-target="Architektur"]');
  await link.click();
  await app.browser.waitUntil(async () => (await (await app.$(".page-title")).getValue()) === "Architektur");
});

test("assistant books time through a tool call", async () => {
  const before = (await app.invoke("time_entries", { from: null, to: null })).length;
  const ta = await app.$(".composer textarea");
  await ta.setValue("Buche 1,5 h auf NP-8801/1040");
  await app.keys(["Enter"]);
  await app.waitText(".tool-step", /Zeit buchen/);
  await app.waitText(".msg-ai .prose", /Erledigt/);
  const after = await app.invoke("time_entries", { from: null, to: null });
  assert.equal(after.length, before + 1);
  assert.ok(after.some((e) => e.description === "Gebucht vom Assistenten" && e.duration_minutes === 90));
  await app.shot("assistant-tool");
});

test("system tools need approval; rejecting does not run them", async () => {
  const ta = await app.$(".composer textarea");
  await ta.setValue("Zeig mir git status");
  await app.keys(["Enter"]);
  await app.waitFor(".tool-approval");
  assert.match(await app.text(".tool-approval-cmd"), /git status --short/);
  await app.shot("assistant-approval");
  await app.click(".tool-approval .btn-ghost");
  await app.waitText(".tool-step", /abgelehnt/);
  const last = llm.requests.filter((r) => r.url === "/v1/chat/completions").pop();
  assert.ok(last.body.messages.some((m) => m.role === "tool" && /abgelehnt/.test(m.content)));
});

test("a running answer can be stopped", async () => {
  const ta = await app.$(".composer textarea");
  await ta.setValue("Antworte bitte langsam");
  await app.keys(["Enter"]);
  await app.waitFor(".send-btn.stop");
  await app.browser.pause(600);
  await app.click(".send-btn.stop");
  await app.waitText(".msg-ai .small", /Abgebrochen/);
  await app.waitFor(".send-btn:not(.stop)");
});

test("status bar shows session tokens and cost", async () => {
  const sb = await app.text(".statusbar");
  assert.match(sb, /Tokens/);
  assert.match(sb, /\$/);
});

test("removing the token disables access", async () => {
  await app.keys(["Control", ","]);
  await app.click('button[aria-label="Token entfernen"]');
  await app.waitText(".toast-title", /API-Token entfernt/);
  await app.waitText(".conn", /Keine Verbindung/);
});

test("no console errors", async () => {
  assert.deepEqual(await app.consoleErrors(), []);
});
