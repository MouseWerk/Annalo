import { describe, expect, it } from "vitest";
import { edited, parseFrontmatter, propertyValue, serializeFrontmatter, splitItems, type Property } from "./frontmatter";

const OBSIDIAN = `---
title: Kickoff Systemintegration
created: 2026-09-23
tags: [projekt, "kunde a", sap]
aliases:
  - Kickoff
  - "SI: Start"
vorgang: NP-8801/1020
url: https://example.com/a?b=c
empty:
author:
  name: Anna
  mail: anna@example.com
summary: |
  Zeile eins
  Zeile zwei
note: Meeting #1
# ein Kommentar
cssclasses: []
---
`;

describe("parseFrontmatter", () => {
  const props = parseFrontmatter(OBSIDIAN);
  const by = (k: string) => props.find((p) => p.key === k)!;

  it("reads typical Obsidian properties", () => {
    expect(by("title")).toMatchObject({ type: "text", value: "Kickoff Systemintegration" });
    expect(by("created")).toMatchObject({ type: "date", value: "2026-09-23" });
    expect(by("tags")).toMatchObject({ type: "list", items: ["projekt", "kunde a", "sap"] });
    expect(by("aliases")).toMatchObject({ type: "list", items: ["Kickoff", "SI: Start"] });
    expect(by("url").value).toBe("https://example.com/a?b=c");
    expect(by("empty")).toMatchObject({ type: "text", value: "" });
    expect(by("cssclasses")).toMatchObject({ type: "list", items: [] });
    expect(propertyValue(props, "vorgang")).toBe("NP-8801/1020");
  });

  it("keeps complex YAML as raw rows", () => {
    expect(by("author")).toMatchObject({ type: "raw", value: "author:\n  name: Anna\n  mail: anna@example.com" });
    expect(by("summary").type).toBe("raw");
    expect(by("note").type).toBe("raw");
    expect(props.find((p) => !p.key)).toMatchObject({ type: "raw", value: "# ein Kommentar" });
  });

  it("round-trips unchanged properties exactly", () => {
    expect(serializeFrontmatter(props)).toBe(OBSIDIAN);
    expect(serializeFrontmatter(parseFrontmatter("---\r\na: 1\r\nb:\r\n- x\r\n---\r\n"))).toBe("---\na: 1\nb:\n- x\n---\n");
  });

  it("accepts the inner block without delimiters and empty input", () => {
    expect(parseFrontmatter("a: b\n")).toMatchObject([{ key: "a", value: "b" }]);
    expect(parseFrontmatter("")).toEqual([]);
    expect(parseFrontmatter("---\n---\n")).toEqual([]);
  });
});

describe("serializeFrontmatter", () => {
  it("writes edited properties canonically and keeps the rest", () => {
    const props = parseFrontmatter(OBSIDIAN);
    const i = props.findIndex((p) => p.key === "tags");
    props[i] = edited(props[i], { items: ["projekt", "b, c"] });
    const t = props.findIndex((p) => p.key === "title");
    props[t] = edited(props[t], { key: "titel", value: "Kickoff: Start" });
    const out = serializeFrontmatter(props);
    expect(out).toContain('tags: [projekt, "b, c"]');
    expect(out).toContain('titel: "Kickoff: Start"');
    expect(out).toContain("author:\n  name: Anna\n  mail: anna@example.com");
    expect(out).toContain("summary: |\n  Zeile eins\n  Zeile zwei");
    const again = parseFrontmatter(out);
    expect(again.find((p) => p.key === "tags")!.items).toEqual(["projekt", "b, c"]);
    expect(propertyValue(again, "titel")).toBe("Kickoff: Start");
  });

  it("quotes values that would not read back", () => {
    const vals = ["#tag", "a: b", "[x]", "  lead", "x #y", '"q"', "- a", "Zeile\nzwei", "'s"];
    const props: Property[] = vals.map((v, i) => edited({ key: `k${i}`, type: "text", value: "", items: [] }, { value: v }));
    const back = parseFrontmatter(serializeFrontmatter(props));
    expect(back.map((p) => p.value)).toEqual(vals);
    expect(back.every((p) => p.type === "text")).toBe(true);
  });

  it("types dates, drops empty blocks and keeps a key line first", () => {
    const p = edited({ key: "due", type: "text", value: "", items: [] }, { value: "2026-10-01" });
    expect(p.type).toBe("date");
    expect(serializeFrontmatter([])).toBe("");
    const props = parseFrontmatter("---\na: 1\n# note\nb: 2\n---\n").slice(1);
    expect(serializeFrontmatter(props)).toBe("---\nb: 2\n# note\n---\n");
  });

  it("splits typed lists", () => {
    expect(splitItems("a, #b ,, c")).toEqual(["a", "b", "c"]);
  });
});
