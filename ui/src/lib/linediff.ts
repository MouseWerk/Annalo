// A small line diff (longest common subsequence) for the version dialog.

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Above this many line pairs the LCS table gets too big; fall back to a set comparison. */
const MAX_CELLS = 4_000_000;

/** Lines of `a` missing in `b` are `del`, lines only in `b` are `add`. */
export function lineDiff(a: string, b: string): DiffLine[] {
  // A final newline ends the last line; it is not an empty line of its own.
  const lines = (t: string) => t.replace(/\n$/, "").split("\n");
  const x = lines(a);
  const y = lines(b);
  // Common head and tail cost nothing and keep the table small.
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const out: DiffLine[] = x.slice(0, head).map((text) => ({ kind: "same", text }));
  if (xs.length * ys.length > MAX_CELLS) {
    const inY = new Set(ys);
    const inX = new Set(xs);
    out.push(...xs.map((text): DiffLine => ({ kind: inY.has(text) ? "same" : "del", text })));
    out.push(...ys.filter((l) => !inX.has(l)).map((text): DiffLine => ({ kind: "add", text })));
  } else {
    const n = xs.length;
    const m = ys.length;
    // lcs[i][j] = LCS length of xs[i..] and ys[j..], flattened.
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * (m + 1) + j] = xs[i] === ys[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xs[i] === ys[j]) {
        out.push({ kind: "same", text: xs[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) out.push({ kind: "del", text: xs[i++] });
      else out.push({ kind: "add", text: ys[j++] });
    }
    while (i < n) out.push({ kind: "del", text: xs[i++] });
    while (j < m) out.push({ kind: "add", text: ys[j++] });
  }
  out.push(...x.slice(x.length - tail).map((text): DiffLine => ({ kind: "same", text })));
  return out;
}

/** A run of unchanged lines that is folded away in the view. */
export type DiffRow = DiffLine | { kind: "skip"; count: number };

/**
 * Folds runs of more than `max` unchanged lines, keeping `context` lines next to each change.
 * Without any change everything stays visible.
 */
export function collapseDiff(lines: DiffLine[], context = 2, max = 6): DiffRow[] {
  if (!lines.some((l) => l.kind !== "same")) return lines;
  const out: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "same") {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "same") j++;
    const run = lines.slice(i, j);
    const before = i === 0 ? 0 : context; // lines after the previous change
    const after = j === lines.length ? 0 : context; // lines before the next change
    if (run.length > max && run.length > before + after) {
      out.push(...run.slice(0, before), { kind: "skip", count: run.length - before - after }, ...run.slice(run.length - after));
    } else out.push(...run);
    i = j;
  }
  return out;
}
