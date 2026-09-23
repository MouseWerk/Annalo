const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export const h1 = (x: number) => nf1.format(x);
export const h2 = (x: number) => nf2.format(x);
export const int = (x: number) => nf0.format(x);
export const hoursFromMinutes = (m: number | null | undefined) => nf2.format((m ?? 0) / 60);

/** "1:30" style duration for timers. */
export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
export const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export function relative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 7 * 86400) return `vor ${Math.floor(diff / 86400)} Tagen`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
}

/** File size, e.g. "812 KB" or "3,4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf0.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${nf1.format(bytes / 1024 ** 2)} MB`;
  return `${nf1.format(bytes / 1024 ** 3)} GB`;
}

/** Local date as YYYY-MM-DD. */
export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday 00:00 local of the week containing `d`. */
export function weekStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

/** Parses "1:30", "1,5", "90m", "2h" into minutes. */
export function parseDurationInput(s: string): number | null {
  const v = s.trim().toLowerCase().replace(",", ".");
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = v.match(/^(\d+(?:\.\d+)?)\s*m(in)?$/))) return Math.round(+m[1]);
  if ((m = v.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return Math.round(+m[1] * 60);
  return null;
}

/** Days/hours without a trailing ",0" for whole numbers. */
export const compact = (x: number) => (Number.isInteger(x) ? String(x) : nf1.format(x));

/** Parses German numbers: "1.200,5" → 1200,5, "1,5" → 1,5; without a comma a single dot is the decimal point. Null if invalid. */
export function parseGermanNumber(s: string): number | null {
  let v = s.trim().replace(/[\s ']/g, "");
  if (v.includes(",")) {
    if (v.indexOf(",") !== v.lastIndexOf(",")) return null;
    if (v.includes(".") && !/^-?\d{1,3}(\.\d{3})*,\d*$/.test(v)) return null;
    v = v.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(v)) {
    v = v.replace(/\./g, "");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
