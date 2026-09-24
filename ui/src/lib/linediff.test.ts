import { describe, expect, it } from "vitest";
import { collapseDiff, lineDiff } from "./linediff";

const show = (a: string, b: string) => lineDiff(a, b).map((l) => ({ same: " ", add: "+", del: "-" })[l.kind] + l.text);

describe("lineDiff", () => {
  it("marks removed and added lines", () => {
    expect(show("a\nb\nc", "a\nx\nc\nd")).toEqual([" a", "-b", "+x", " c", "+d"]);
  });
  it("identical texts have no changes", () => {
    expect(show("eins\nzwei", "eins\nzwei")).toEqual([" eins", " zwei"]);
  });
  it("a trailing newline is not an empty line", () => {
    expect(show("a\nb\n", "a\nb")).toEqual([" a", " b"]);
    expect(show("a\n", "a\nb\n")).toEqual([" a", "+b"]);
  });
});

describe("collapseDiff", () => {
  const lines = (n: number, p = "z") => Array.from({ length: n }, (_, i) => `${p}${i + 1}`).join("\n");
  const view = (a: string, b: string) => collapseDiff(lineDiff(a, b)).map((l) => (l.kind === "skip" ? `…${l.count}` : l.kind[0] + (l as { text: string }).text));
  it("folds long unchanged runs, keeping two lines of context", () => {
    const a = `${lines(10)}\nalt\n${lines(10, "y")}`;
    const b = `${lines(10)}\nneu\n${lines(10, "y")}`;
    expect(view(a, b)).toEqual(["…8", "sz9", "sz10", "dalt", "aneu", "sy1", "sy2", "…8"]);
  });
  it("keeps short runs and texts without changes", () => {
    expect(view(`${lines(6)}\nx`, `${lines(6)}\ny`)).toEqual(["sz1", "sz2", "sz3", "sz4", "sz5", "sz6", "dx", "ay"]);
    expect(view(lines(20), lines(20))).toHaveLength(20);
  });
  it("folds between two changes", () => {
    const a = `a\n${lines(9)}\nb`;
    const b = `A\n${lines(9)}\nB`;
    expect(view(a, b)).toEqual(["da", "aA", "sz1", "sz2", "…5", "sz8", "sz9", "db", "aB"]);
  });
});
