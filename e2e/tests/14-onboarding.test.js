// First start without sample data: the welcome choice, and printing.
import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, guarded } from "../lib/harness.js";

const test = guarded(nodeTest, () => app);
let app;
before(async () => (app = await launch({ demo: false })));
after(async () => app?.close());

test("a fresh workspace offers empty, import or sample data", async () => {
  await app.waitText(".onboarding h1", /Willkommen bei AETHER OS/);
  assert.equal((await app.$$(".onb-choice")).length, 3);
  await app.shot("onboarding");
  assert.equal((await app.invoke("wbs_tree")).length, 0, "no sample data unless asked");
});

test("sample data on request, and the choice is remembered", async () => {
  await app.click(".onb-choice:nth-child(3)");
  await app.waitText(".pane.active .vh-title-text", /Willkommen/);
  assert.ok((await app.invoke("wbs_tree")).length > 0);
  assert.equal(await app.invoke("onboarding_needed"), false);
});

test("printing a page prints only the focused pane", async () => {
  await app.browser.execute(() => {
    window.__printed = 0;
    window.print = () => void window.__printed++;
  });
  await app.click('.pane.active .vh-actions [aria-label="Weitere Aktionen"]');
  await app.click("button=Drucken / als PDF");
  await app.browser.waitUntil(() => app.browser.execute(() => window.__printed === 1));
});
