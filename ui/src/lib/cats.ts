// Week helpers for the timesheet: gaps against the daily target and a CATS-ready grid.

import { addDays, isoDay } from "./format";
import type { TimeEntryRow } from "./types";

export interface DayGap {
  day: Date;
  bookedMinutes: number;
  missingMinutes: number;
}

/** Past (and today's, once over) workdays of the week that are below the daily target. */
export function weekGaps(rows: TimeEntryRow[], week: Date, now: Date, targetHours: number, workdays: number[]): DayGap[] {
  const target = Math.round(targetHours * 60);
  const today = isoDay(now);
  const out: DayGap[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(week, i);
    const key = isoDay(day);
    // Today only counts once the working day is over.
    if (key > today || (key === today && now.getHours() < 18)) continue;
    if (!workdays.includes(i + 1)) continue;
    const booked = rows
      .filter((r) => r.status_flag !== "running" && isoDay(new Date(r.start_time)) === key)
      .reduce((a, r) => a + (r.duration_minutes ?? 0), 0);
    if (booked < target) out.push({ day, bookedMinutes: booked, missingMinutes: target - booked });
  }
  return out;
}

const hours = (m: number) => (m ? (m / 60).toFixed(2).replace(".", ",") : "");

/**
 * Tab-separated rows in the layout of the CATS/CAT2 entry grid: one line per
 * Netzplan/Vorgang/Leistungsart, one column per weekday. Pastes straight into
 * SAP GUI or Excel.
 */
export function catsGrid(rows: TimeEntryRow[], week: Date): { text: string; ids: number[] } {
  const keys = Array.from({ length: 7 }, (_, i) => isoDay(addDays(week, i)));
  const lines = new Map<string, { np: string; vg: string; la: string; perDay: number[] }>();
  const ids: number[] = [];
  for (const r of rows) {
    if (r.status_flag === "running" || !r.duration_minutes) continue;
    const d = keys.indexOf(isoDay(new Date(r.start_time)));
    if (d < 0) continue;
    const k = `${r.netzplan_nr}\u0000${r.vorgang_nr ?? ""}\u0000${r.leistungsart ?? ""}`;
    const line = lines.get(k) ?? { np: r.netzplan_nr, vg: r.vorgang_nr ?? "", la: r.leistungsart ?? "", perDay: Array(7).fill(0) };
    line.perDay[d] += r.duration_minutes;
    lines.set(k, line);
    ids.push(r.id);
  }
  const sorted = [...lines.values()].sort((a, b) => `${a.np}/${a.vg}/${a.la}`.localeCompare(`${b.np}/${b.vg}/${b.la}`));
  const text = sorted.map((l) => [l.np, l.vg, l.la, ...l.perDay.map(hours)].join("\t")).join("\r\n");
  return { text: text ? text + "\r\n" : "", ids };
}
