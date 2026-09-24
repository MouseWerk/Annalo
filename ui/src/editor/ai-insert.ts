// Where the inline AI bar reads its text from and how the answer goes back
// into the document: always as Markdown through the editor's parser, in one
// undoable transaction.

import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { cleanMarkdown } from "./schema";

export interface AiRange {
  from: number;
  to: number;
}

/** The selection, or with an empty selection the whole current block. */
export function aiRange(editor: Editor): AiRange | null {
  const { selection } = editor.state;
  if (!selection.empty) return { from: selection.from, to: selection.to };
  const $pos = selection.$from;
  if (!$pos.parent.isTextblock || $pos.depth === 0) return null;
  // The block with its node boundaries, so a replacement can put blocks in its place.
  return { from: $pos.before(), to: $pos.after() };
}

/** Markdown of a document range (formatting and links kept); plain text if it cannot be serialized. */
export function rangeMarkdown(editor: Editor, range: AiRange): string {
  const { state } = editor;
  const plain = () => state.doc.textBetween(range.from, range.to, "\n\n", " ");
  const manager = editor.markdown;
  if (!manager) return plain();
  try {
    let content = state.doc.slice(range.from, range.to).content;
    if (content.firstChild?.isInline) content = Fragment.from(state.schema.nodes.paragraph.create(null, content));
    const doc = state.schema.topNodeType.createChecked(null, content);
    const md = cleanMarkdown(manager.serialize(doc.toJSON())).trim();
    return md || plain();
  } catch {
    return plain();
  }
}

function parse(editor: Editor, md: string): JSONContent[] {
  const doc = editor.markdown?.parse(md);
  return (doc?.content ?? []).filter((n) => n.type);
}

/**
 * Replaces `range` with the Markdown `md`. Inside one paragraph a one-paragraph answer
 * replaces inline (no split); everything else is replaced block-wise.
 */
export function replaceWithMarkdown(editor: Editor, range: AiRange, md: string): boolean {
  const blocks = parse(editor, md);
  const { doc } = editor.state;
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  const inline = $from.sameParent($to) && $from.parent.isTextblock;
  let target = range;
  let content: JSONContent[] = blocks;
  if (inline && blocks.length === 1 && blocks[0].type === "paragraph") {
    content = blocks[0].content ?? [];
  } else if (inline && range.from === $from.start() && range.to === $to.end() && $from.depth > 0) {
    // The whole text of a block: replace the block itself.
    target = { from: $from.before(), to: $from.after() };
  }
  const chain = editor.chain().command(({ tr }) => (closeHistory(tr), true));
  return (content.length ? chain.insertContentAt(target, content, { updateSelection: true }) : chain.deleteRange(target)).focus().run();
}

/** Inserts the Markdown `md` after the top-level block that contains the end of `range`. */
export function insertMarkdownBelow(editor: Editor, range: AiRange, md: string): boolean {
  const $to = editor.state.doc.resolve(Math.max(range.from, range.to - 1));
  const pos = $to.depth > 0 ? $to.after(1) : editor.state.doc.content.size;
  return insertBlocksAt(editor, pos, md);
}

/** Appends the Markdown `md` at the end of the document. */
export function appendMarkdown(editor: Editor, md: string): boolean {
  return insertBlocksAt(editor, editor.state.doc.content.size, md);
}

function insertBlocksAt(editor: Editor, pos: number, md: string): boolean {
  const blocks = parse(editor, md);
  if (!blocks.length) return false;
  return editor
    .chain()
    .command(({ tr }) => (closeHistory(tr), true))
    .insertContentAt(pos, blocks, { updateSelection: true })
    .scrollIntoView()
    .run();
}
