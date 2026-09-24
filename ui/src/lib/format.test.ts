import { describe, expect, it } from "vitest";
import { fileSize, importSummary, parseGermanNumber, versionTimes } from "./format";

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

describe("versionTimes", () => {
  it("shows seconds only when two versions share a minute, and the date for other days", () => {
    const now = new Date(2026, 8, 24, 16, 0);
    const at = (d: number, h: number, m: number, s: number) => new Date(2026, 8, d, h, m, s).toISOString();
    expect(versionTimes([at(24, 14, 3, 5), at(24, 14, 3, 50), at(24, 9, 7, 0), at(21, 9, 7, 0)], now)).toEqual(["14:03:05", "14:03:50", "09:07", "21.09., 09:07"]);
  });
});

describe("importSummary", () => {
  it("uses singular and plural", () => {
    expect(importSummary({ pages: 1, folders: 1, attachments: 1, skipped: 1 })).toBe("1 Seite, 1 Ordner, 1 Bild, 1 Datei übersprungen");
    expect(importSummary({ pages: 12, folders: 3, attachments: 2, skipped: 4 })).toBe("12 Seiten, 3 Ordner, 2 Bilder, 4 Dateien übersprungen");
    expect(importSummary({ pages: 0, folders: 0, attachments: 0, skipped: 0 })).toBe("0 Seiten, 0 Ordner");
  });
});
