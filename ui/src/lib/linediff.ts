// A small line diff (longest common subsequence) for the version dialog.

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Above this many line pairs the LCS table gets too big; fall back to a set comparison. */
const MAX_CELLS = 4_000_000;

/** Lines of `a` missing in `b` are `del`, lines only in `b` are `add`. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
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
