// The editor schema shared by the app and the Markdown round-trip tests.

import { Extension, type Editor, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Callouts, SlashCommand, TagHighlight, TimeEntryChip, WikiLink, WikiLinkSuggest, ZeitCommand, type LinkSuggestItem, type ZeitResult } from "./extensions";
import { FindInPage } from "./find";

const lowlight = createLowlight(common);

/**
 * Escapes only what would change meaning when the Markdown is parsed again.
 * The default serializer escapes every `[ ] _ * ~`, which litters files
 * (`a\_b`, `\[Entwurf\]`) that Obsidian users read and edit directly.
 */
export function escapeText(t: string): string {
  return t
    .replace(/\\(?=[\\`*_[\]~=#<>!|])/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\[\[/g, "\\[\\[")
    .replace(/\[([^\]\n]*)\]\(/g, "\\[$1\\](")
    .replace(/(^|[^\p{L}\p{N}*\\])\*(?=\S)/gu, "$1\\*")
    .replace(/([^\s\\])\*(?=$|[^\p{L}\p{N}*])/gu, "$1\\*")
    .replace(/(^|[^\p{L}\p{N}_\\])_(?=\S)/gu, "$1\\_")
    .replace(/([^\s\\])_(?=$|[^\p{L}\p{N}_])/gu, "$1\\_")
    .replace(/~~/g, "\\~\\~")
    .replace(/==/g, "\\=\\=")
    .replace(/&(?=#?\w+;)/g, "&amp;")
    .replace(/<(?=[A-Za-z/!])/g, "&lt;");
}

interface SerializerInternals {
  codeTypes: Set<string>;
  encodeTextForMarkdown: (text: string, node: { marks?: (string | { type: string })[] }, parent?: { type?: string }) => string;
}

/** Installs the minimal escaping on the editor's Markdown serializer. */
const MarkdownFidelity = Extension.create({
  name: "markdownFidelity",
  onBeforeCreate() {
    const manager = (this.editor as unknown as { markdown?: SerializerInternals }).markdown;
    if (!manager) return;
    manager.encodeTextForMarkdown = (text, node, parent) => {
      const inCode = (parent?.type != null && manager.codeTypes.has(parent.type)) || (node.marks ?? []).some((m) => manager.codeTypes.has(typeof m === "string" ? m : m.type));
      return inCode ? text : escapeText(text);
    };
  },
});

export interface SchemaOptions {
  onOpenLink?: (target: string, newTab: boolean) => void;
  onOpenTag?: (tag: string) => void;
  isKnown?: (target: string) => boolean;
  searchPages?: (q: string) => Promise<LinkSuggestItem[]>;
  book?: (line: string) => Promise<ZeitResult | null>;
}

export function buildExtensions(o: SchemaOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: null } },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Überschrift" : "Schreibe etwas, / für Befehle, [[ für Links"),
      showOnlyCurrent: true,
    }),
    Markdown,
    MarkdownFidelity,
    WikiLink.configure({ onOpen: o.onOpenLink ?? (() => {}), isKnown: o.isKnown ?? (() => true) }),
    WikiLinkSuggest.configure({ search: o.searchPages ?? (async () => []) }),
    SlashCommand,
    TimeEntryChip,
    ZeitCommand.configure({ book: o.book ?? (async () => null) }),
    TagHighlight.configure({ onOpen: o.onOpenTag ?? (() => {}) }),
    FindInPage,
    Callouts,
  ];
}

/**
 * Serializes the document and removes escapes the serializer adds but that
 * Obsidian-style Markdown does not need (callout markers, task brackets,
 * wiki-link brackets in plain text).
 */
export function toMarkdown(editor: Editor): string {
  return cleanMarkdown(editor.getMarkdown());
}

export function cleanMarkdown(md: string): string {
  return (
    md
      .replace(/^((?:>\s?)+)\\\[!(\w+)\\\]/gm, "$1[!$2]")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .trimEnd() + "\n"
  );
}
