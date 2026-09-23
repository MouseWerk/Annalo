import { describe, expect, it } from "vitest";
import { parseGermanNumber } from "./format";

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
