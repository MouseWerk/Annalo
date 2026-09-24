import { describe, expect, it } from "vitest";
import { previewMarkdown } from "./LinkPreview";
import { markPositions } from "./ScrollOutline";

describe("previewMarkdown", () => {
  it("drops frontmatter and keeps short pages whole", () => {
    expect(previewMarkdown("---\nstatus: x\n---\nHallo\n")).toEqual({ text: "Hallo", more: false });
  });
  it("cuts long pages at a paragraph boundary", () => {
    const md = `${"a".repeat(600)}\n\n${"b".repeat(600)}`;
    const p = previewMarkdown(md, 900);
    expect(p.more).toBe(true);
    expect(p.text).toBe("a".repeat(600));
  });
});

describe("markPositions", () => {
  it("maps heading offsets to fractions of the document", () => {
    expect(markPositions([0, 500, 2000], 1000)).toEqual([0, 0.5, 1]);
  });
});
