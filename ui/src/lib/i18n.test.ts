import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DICTS, translate, type TKey } from "./i18n";
import { COMMANDS, RESERVED } from "./keymap";

const SRC = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("German and English have the same keys, none empty", () => {
    const de = Object.keys(DICTS.de).sort();
    const en = Object.keys(DICTS.en).sort();
    expect(en).toEqual(de);
    for (const k of de) {
      expect(DICTS.de[k as TKey].trim(), k).not.toBe("");
      expect(DICTS.en[k as TKey].trim(), k).not.toBe("");
    }
  });

  it("placeholders match in both languages", () => {
    for (const k of Object.keys(DICTS.de) as TKey[]) expect(placeholders(DICTS.en[k]), k).toEqual(placeholders(DICTS.de[k]));
  });

  it("every key used in the code exists", () => {
    const used = new Set<string>();
    for (const file of sources(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:t|tr|tStatic)\("([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/label: "((?:cmd|nav|navgroup|tool|keys)\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
    }
    for (const c of COMMANDS) used.add(c.label);
    for (const r of Object.values(RESERVED)) used.add(r);
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((k) => !(k in DICTS.de));
    expect(missing).toEqual([]);
  });

  it("translates with variables and keeps the German chrome strings", () => {
    expect(translate("de", "sidebar.noHits", { q: "NP" })).toBe("Keine Treffer für „NP“");
    expect(translate("en", "sidebar.noHits", { q: "NP" })).toBe("No results for “NP”");
    // e2e tests and users rely on these German labels.
    expect(translate("de", "ribbon.timesheet")).toBe("Zeiterfassung");
    expect(translate("de", "ribbon.projects")).toBe("Projekte");
    expect(translate("de", "nav.backup")).toBe("Sicherung");
    expect(translate("en", "ribbon.settings")).toBe("Settings");
  });
});
