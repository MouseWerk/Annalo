// Small, safe Markdown renderer for blocks and chat: everything is escaped
// first, then a limited set of constructs is turned back into HTML.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, alias) => `<a href="#" class="wiki" data-page-title="${t.trim()}">${alias ?? t}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function render(md) {
  const lines = String(md ?? "").split("\n");
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push("</ul>"); list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      closeList();
      const body = [];
      while (++i < lines.length && !lines[i].startsWith("```")) body.push(lines[i]);
      out.push(`<pre data-lang="${esc(fence[1])}"><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/);
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (task || item) {
      if (!list) { out.push("<ul>"); list = true; }
      if (task) {
        const done = task[1] !== " ";
        out.push(`<li class="task${done ? " done" : ""}"><input type="checkbox" data-line="${i}"${done ? " checked" : ""}><span>${inline(task[2])}</span></li>`);
      } else out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      const body = [quote[1]];
      while (i + 1 < lines.length && lines[i + 1].startsWith(">")) body.push(lines[++i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${body.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

/// Toggles the n-th line's task checkbox in a markdown string.
export function toggleTask(md, lineNo) {
  const lines = md.split("\n");
  lines[lineNo] = lines[lineNo].replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]"));
  return lines.join("\n");
}

/// Search snippets mark hits as [term]; render them as <mark>.
export const snippet = (s) => esc(s).replace(/\[([^\]]*)\]/g, "<mark>$1</mark>");
