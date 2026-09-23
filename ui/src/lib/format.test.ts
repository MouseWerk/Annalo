import { describe, expect, it } from "vitest";
import { fileSize, parseGermanNumber } from "./format";

describe("parseGermanNumber", () => {
  const ok: [string, number][] = [
    ["120", 120],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["1.200,5", 1200.5],
    ["1.200.000", 1200000],
    ["1.234.567,25", 1234567.25],
    [" 42 ", 42],
    [",5", 0.5],
    ["0", 0],
    ["-3,25", -3.25],
  ];
  for (const [s, n] of ok) it(`"${s}" → ${n}`, () => expect(parseGermanNumber(s)).toBe(n));

  for (const s of ["", "abc", "1,2,3", "12.34,5", "1.2.3", "1e3", "12h"]) it(`"${s}" ist ungültig`, () => expect(parseGermanNumber(s)).toBeNull());
});

describe("fileSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(812 * 1024)).toBe("812 KB");
    expect(fileSize(3.4 * 1024 * 1024)).toBe("3,4 MB");
  });
});
