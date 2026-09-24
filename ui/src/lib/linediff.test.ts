import { describe, expect, it } from "vitest";
import { lineDiff } from "./linediff";

const show = (a: string, b: string) => lineDiff(a, b).map((l) => ({ same: " ", add: "+", del: "-" })[l.kind] + l.text);

describe("lineDiff", () => {
  it("marks removed and added lines", () => {
    expect(show("a\nb\nc", "a\nx\nc\nd")).toEqual([" a", "-b", "+x", " c", "+d"]);
  });
  it("identical texts have no changes", () => {
    expect(show("eins\nzwei", "eins\nzwei")).toEqual([" eins", " zwei"]);
  });
});
