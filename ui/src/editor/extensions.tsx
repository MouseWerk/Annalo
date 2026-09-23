// Custom TipTap extensions: wiki links, [[ autocomplete, slash commands,
// /zeit booking, #tag highlighting and time-entry chips.

import { Extension, Node, mergeAttributes, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  AlertTriangle, Info, CheckSquare, Code2, FilePlus2, Heading1, Heading2, Heading3, Link2, List, ListOrdered, Minus, Quote, Table2, Text, Timer, CalendarDays, Highlighter,
} from "lucide-react";
import { popupRenderer, type PopupItem } from "./suggestion-popup";
import { PageIcon } from "../components/icons";

// ------------------------------------------------------------- wiki links

export interface WikiLinkOptions {
  onOpen: (target: string, newTab: boolean) => void;
  isKnown: (target: string) => boolean;
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onOpen: () => {}, isKnown: () => true };
  },

  addAttributes() {
    return {
      target: { default: "" },
      anchor: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wikilink]", getAttrs: (el) => ({ target: (el as HTMLElement).dataset.target, alias: (el as HTMLElement).dataset.alias ?? null }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.alias || (node.attrs.anchor ? `${node.attrs.target} › ${node.attrs.anchor}` : node.attrs.target);
    return ["a", mergeAttributes(HTMLAttributes, { "data-wikilink": "", "data-target": node.attrs.target, class: "wikilink" }), label];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("a");
      dom.dataset.wikilink = "";
      dom.dataset.target = node.attrs.target;
      dom.className = `wikilink${this.options.isKnown(node.attrs.target) ? "" : " unresolved"}`;
      dom.textContent = node.attrs.alias || (node.attrs.anchor ? `${node.attrs.target} › ${node.attrs.anchor}` : node.attrs.target);
      dom.title = this.options.isKnown(node.attrs.target) ? node.attrs.target : `${node.attrs.target} (noch nicht angelegt, Klick erstellt die Seite)`;
      dom.addEventListener("mousedown", (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        e.preventDefault();
        this.options.onOpen(node.attrs.target, e.ctrlKey || e.metaKey || e.button === 1);
      });
      return { dom };
    };
  },

  renderText({ node }) {
    return `[[${node.attrs.target}${node.attrs.anchor ? "#" + node.attrs.anchor : ""}${node.attrs.alias ? "|" + node.attrs.alias : ""}]]`;
  },

  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize(src: string) {
      const m = /^\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/.exec(src);
      if (!m) return undefined;
      return { type: "wikiLink", raw: m[0], target: m[1].trim(), anchor: m[2]?.trim() ?? null, alias: m[3]?.trim() ?? null };
    },
  },
  parseMarkdown: (token) => ({ type: "wikiLink", attrs: { target: token.target, anchor: token.anchor, alias: token.alias } }),
  renderMarkdown: (node) =>
    `[[${node.attrs?.target}${node.attrs?.anchor ? "#" + node.attrs.anchor : ""}${node.attrs?.alias ? "|" + node.attrs.alias : ""}]]`,
});

export interface LinkSuggestItem extends PopupItem {
  target: string;
  create?: boolean;
}

export const WikiLinkSuggest = Extension.create<{ search: (q: string) => Promise<LinkSuggestItem[]> }>({
  name: "wikiLinkSuggest",
  addOptions() {
    return { search: async () => [] };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<LinkSuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey("wikiLinkSuggest"),
        char: "[[",
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => this.options.search(query),
        command: ({ editor, range, props }) => {
          // Swallow an auto-closed "]]" right after the caret.
          const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size), "");
          const to = after === "]]" ? range.to + 2 : range.to;
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to }, [
              { type: "wikiLink", attrs: { target: props.target } },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: popupRenderer<LinkSuggestItem>("Tippe einen Seitennamen"),
      }),
    ];
  },
});

export function pageSuggestItem(p: { id: number; title: string; icon: string | null }, subtitle?: string): LinkSuggestItem {
  return { id: `p${p.id}`, title: p.title, target: p.title, subtitle, icon: <PageIcon name={p.icon} size={15} /> };
}

// ----------------------------------------------------------- slash menu

interface SlashItem extends PopupItem {
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}

const ic = (C: typeof Text) => <C size={15} strokeWidth={1.75} />;

function slashItems(): SlashItem[] {
  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return [
    { id: "text", title: "Text", icon: ic(Text), section: "Grundlagen", keywords: "absatz paragraph text", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { id: "h1", title: "Überschrift 1", icon: ic(Heading1), hint: "#", section: "Grundlagen", keywords: "heading titel h1", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { id: "h2", title: "Überschrift 2", icon: ic(Heading2), hint: "##", section: "Grundlagen", keywords: "heading h2", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { id: "h3", title: "Überschrift 3", icon: ic(Heading3), hint: "###", section: "Grundlagen", keywords: "heading h3", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { id: "todo", title: "Aufgabenliste", icon: ic(CheckSquare), hint: "[ ]", section: "Listen", keywords: "todo task checkbox aufgabe", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { id: "ul", title: "Aufzählung", icon: ic(List), hint: "-", section: "Listen", keywords: "bullet liste", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { id: "ol", title: "Nummerierte Liste", icon: ic(ListOrdered), hint: "1.", section: "Listen", keywords: "ordered nummer", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { id: "quote", title: "Zitat", icon: ic(Quote), hint: ">", section: "Blöcke", keywords: "quote zitat", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { id: "callout", title: "Hinweisbox", subtitle: "Obsidian-Callout", icon: ic(Info), section: "Blöcke", keywords: "callout hinweis info note", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().insertContent("[!note] ").run() },
    { id: "warn", title: "Warnbox", icon: ic(AlertTriangle), section: "Blöcke", keywords: "callout warnung warning", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().insertContent("[!warning] ").run() },
    { id: "code", title: "Codeblock", icon: ic(Code2), hint: "```", section: "Blöcke", keywords: "code snippet", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
    { id: "table", title: "Tabelle", icon: ic(Table2), section: "Blöcke", keywords: "table tabelle", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "hr", title: "Trennlinie", icon: ic(Minus), hint: "---", section: "Blöcke", keywords: "divider linie hr", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { id: "mark", title: "Hervorheben", icon: ic(Highlighter), hint: "==", section: "Blöcke", keywords: "highlight markieren", run: (e, r) => e.chain().focus().deleteRange(r).toggleHighlight().run() },
    { id: "link", title: "Seitenlink", icon: ic(Link2), hint: "[[", section: "Einfügen", keywords: "link verknüpfung wiki", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("[[").run() },
    { id: "date", title: "Heutiges Datum", icon: ic(CalendarDays), hint: today, section: "Einfügen", keywords: "datum date heute", run: (e, r) => e.chain().focus().deleteRange(r).insertContent(today + " ").run() },
    { id: "zeit", title: "Zeit buchen", subtitle: "NP-8801/1020 2.5h Beschreibung", icon: ic(Timer), hint: "/zeit", section: "Zeiterfassung", keywords: "zeit time buchen stunden", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("/zeit ").run() },
    { id: "subpage", title: "Unterseite", icon: ic(FilePlus2), section: "Einfügen", keywords: "seite page unterseite", run: (e, r) => e.chain().focus().deleteRange(r).insertContent("[[").run() },
  ];
}

/** Lower-case, umlaut-tolerant form for matching ("Überschrift" ~ "ueberschrift" ~ "uberschrift"). */
export function fold(s: string) {
  const lower = s.toLowerCase();
  const ascii = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const expanded = lower.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  return `${ascii} ${expanded}`;
}

/** Umlaut-tolerant substring match: "ueber" and "uber" both find "Überschrift". */
export function fuzzyIncludes(text: string, query: string) {
  const hay = fold(text);
  const q = query.toLowerCase();
  const qAscii = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return hay.includes(q) || hay.includes(qAscii);
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        allow: ({ state, range }) => {
          // Only at the start of a block or after whitespace, never inside code.
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
          return before === "" || /\s$/.test(before);
        },
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          return slashItems().filter((i) => !q || fuzzyIncludes(`${i.title} ${i.keywords}`, q) || i.id.startsWith(q));
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popupRenderer<SlashItem>("Kein Befehl gefunden"),
      }),
    ];
  },
});

// ------------------------------------------------------------ /zeit + chips

export const TimeEntryChip = Node.create({
  name: "timeEntry",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return { entryId: { default: null }, hours: { default: "" }, target: { default: "" }, text: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "time-entry" }];
  },
  renderHTML({ node }) {
    return ["time-entry", { id: node.attrs.entryId, class: "time-chip" }, `${node.attrs.hours} h · ${node.attrs.target}${node.attrs.text ? " · " + node.attrs.text : ""}`];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "time-chip";
      dom.contentEditable = "false";
      dom.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      const label = document.createElement("span");
      label.textContent = `${node.attrs.hours} h`;
      const target = document.createElement("span");
      target.className = "time-chip-target";
      target.textContent = node.attrs.target;
      dom.append(label, target);
      if (node.attrs.text) {
        const t = document.createElement("span");
        t.className = "time-chip-text";
        t.textContent = node.attrs.text;
        dom.append(t);
      }
      dom.title = "Gebuchter Zeiteintrag";
      return { dom };
    };
  },
  markdownTokenizer: {
    name: "timeEntry",
    level: "inline",
    start: (src: string) => src.indexOf("<time-entry"),
    tokenize(src: string) {
      const m = /^<time-entry\s+([^>]*)>([^<]*)<\/time-entry>/.exec(src);
      if (!m) return undefined;
      const attrs: Record<string, string> = {};
      for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      return { type: "timeEntry", raw: m[0], attrs, text: m[2] };
    },
  },
  parseMarkdown: (token) => ({
    type: "timeEntry",
    attrs: { entryId: token.attrs.id ?? null, hours: token.attrs.hours ?? "", target: token.attrs.target ?? "", text: unescapeHtml(token.text ?? "") },
  }),
  renderMarkdown: (node) =>
    `<time-entry id="${node.attrs?.entryId ?? ""}" hours="${escapeAttr(node.attrs?.hours)}" target="${escapeAttr(node.attrs?.target)}">${escapeHtml(node.attrs?.text ?? "")}</time-entry>`,
});

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: unknown) => escapeHtml(String(s ?? "")).replace(/"/g, "&quot;");
const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export interface ZeitResult {
  entryId: number;
  hours: string;
  target: string;
  text: string;
}

/** Enter on a paragraph that starts with `/zeit …` books the time and turns the line into a chip. */
export const ZeitCommand = Extension.create<
  { book: (line: string) => Promise<ZeitResult | null>; onLost: (res: ZeitResult) => void },
  { pending: Set<string> }
>({
  name: "zeitCommand",
  addOptions() {
    return { book: async () => null, onLost: () => {} };
  },
  addStorage() {
    return { pending: new Set<string>() };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph") return false;
        const text = $from.parent.textContent.trim();
        if (!/^\/(zeit|time)\s+\S+\s+\S+/i.test(text)) return false;
        // A second Enter while the booking is in flight must not book twice.
        const pending = this.storage.pending;
        if (pending.has(text)) return true;
        pending.add(text);
        const start = $from.start();
        this.options
          .book(text)
          .then((res) => {
            if (!res || editor.isDestroyed) return;
            // Find the line again: at its old position, else anywhere (the doc may have changed).
            let from = -1;
            const at = editor.state.doc.nodeAt(start - 1);
            if (at?.type.name === "paragraph" && at.textContent.trim() === text) from = start;
            else
              editor.state.doc.descendants((node, pos) => {
                if (from >= 0) return false;
                if (node.type.name === "paragraph" && node.textContent.trim() === text) {
                  from = pos + 1;
                  return false;
                }
                return true;
              });
            if (from < 0) return this.options.onLost(res);
            const to = from + editor.state.doc.nodeAt(from - 1)!.content.size;
            editor
              .chain()
              .insertContentAt({ from, to }, [{ type: "timeEntry", attrs: res }])
              .insertContentAt(from + 1, { type: "paragraph" })
              .focus(from + 2)
              .run();
          })
          .finally(() => pending.delete(text));
        return true;
      },
    };
  },
});

// ---------------------------------------------------------------- #tags

const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)/gu;

export const TagHighlight = Extension.create<{ onOpen: (tag: string) => void }>({
  name: "tagHighlight",
  addOptions() {
    return { onOpen: () => {} };
  },
  addProseMirrorPlugins() {
    const onOpen = this.options.onOpen;
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.spec.code || node.marks.some((m) => m.type.name === "code")) return;
        const text = node.text ?? "";
        for (const m of text.matchAll(TAG_RE)) {
          const from = pos + (m.index ?? 0) + m[1].length;
          decos.push(Decoration.inline(from, from + m[2].length + 1, { class: "tag", "data-tag": m[2].toLowerCase(), nodeName: "span" }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey("tagHighlight"),
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement).closest<HTMLElement>(".tag[data-tag]");
            if (!el) return false;
            onOpen(el.dataset.tag!);
            return true;
          },
        },
      }),
    ];
  },
});

// ---------------------------------------------------------- frontmatter

/** Splits YAML frontmatter off so the editor never mangles it. */
export function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  // A leading horizontal rule is not frontmatter: the first line must be a `key:`.
  if (!m || !/^[\w-]+\s*:/.test(m[1].split(/\r?\n/)[0])) return { frontmatter: "", body: md };
  return { frontmatter: m[0].endsWith("\n") ? m[0] : m[0] + "\n", body: md.slice(m[0].length).replace(/^\r?\n/, "") };
}

// ------------------------------------------------------------- callouts

const CALLOUT_RE = /^\[!(\w+)\][+-]?\s*/;

/** Styles Obsidian callouts (`> [!note] Title`) without changing the Markdown. */
export const Callouts = Extension.create({
  name: "callouts",
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== "blockquote") return true;
        const first = node.firstChild;
        const m = first?.isTextblock ? CALLOUT_RE.exec(first.textContent) : null;
        if (m) {
          const type = m[1].toLowerCase();
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${type}`, "data-callout": type }));
          const start = pos + 2; // blockquote open + paragraph open
          decos.push(Decoration.inline(start, start + m[0].trimEnd().length, { class: "callout-marker", "data-label": type }));
          // Title = rest of the first line (up to a line break).
          let end = start;
          let stop = false;
          first!.forEach((child, offset) => {
            if (stop) return;
            if (child.type.name === "hardBreak") {
              stop = true;
              return;
            }
            const text = child.isText ? child.text! : "";
            const nl = text.indexOf("\n");
            end = start + offset + (nl >= 0 ? nl : child.nodeSize);
            if (nl >= 0) stop = true;
          });
          const titleFrom = start + m[0].length;
          if (end > titleFrom) decos.push(Decoration.inline(titleFrom, end, { class: "callout-title" }));
        }
        return false;
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey("callouts"),
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
