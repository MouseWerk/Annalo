// Table toolbar / slash commands: every action must leave a valid Markdown table behind.

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { buildExtensions, toMarkdown } from "./schema";
import { TABLE_ACTIONS, inHeaderRow, runTableAction, tableActionEnabled } from "./table-actions";

const TABLE = "| A   | B   |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |\n";

/** Runs the action `id` with the cursor in the cell containing `cell`; returns the Markdown and a re-parsed pass. */
function apply(id: string, cell: string) {
  const el = document.createElement("div");
  const editor = new Editor({ element: el, extensions: buildExtensions(), content: TABLE, contentType: "markdown" });
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text === cell) pos = p;
  });
  expect(pos).toBeGreaterThan(0);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  const action = TABLE_ACTIONS.find((a) => a.id === id)!;
  const header = inHeaderRow(editor.state);
  const ran = runTableAction(editor, action);
  const md = toMarkdown(editor);
  editor.destroy();
  // What comes out must parse back to the same Markdown.
  const again = new Editor({ element: document.createElement("div"), extensions: buildExtensions(), content: md, contentType: "markdown" });
  const md2 = toMarkdown(again);
  again.destroy();
  return { md, md2, ran, header };
}

const rows = (md: string) => md.split("\n").filter((l) => l.startsWith("|") && !/^\|( *:?-+:? *\|)+$/.test(l));
const cols = (md: string) => (md.split("\n")[0].match(/\|/g)?.length ?? 1) - 1;

describe("table actions", () => {
  it("offers no header toggle (Markdown tables always have one header row)", () => {
    expect(TABLE_ACTIONS.map((a) => a.id)).not.toContain("header");
  });

  it("adds and removes rows and columns in the body", () => {
    const cases: [string, (md: string) => void][] = [
      ["row-above", (md) => expect(rows(md)).toHaveLength(4)],
      ["row-below", (md) => expect(rows(md)).toHaveLength(4)],
      ["col-left", (md) => expect(cols(md)).toBe(3)],
      ["col-right", (md) => expect(cols(md)).toBe(3)],
      ["row-delete", (md) => expect(rows(md).map((r) => r.replace(/\s+/g, ""))).toEqual(["|A|B|", "|3|4|"])],
      ["col-delete", (md) => expect(cols(md)).toBe(1)],
      ["table-delete", (md) => expect(md.trim()).toBe("")],
    ];
    for (const [id, check] of cases) {
      const { md, md2, ran, header } = apply(id, "1");
      expect(header, id).toBe(false);
      expect(ran, id).toBe(true);
      check(md);
      expect(md2, id).toBe(md);
      if (id !== "table-delete") expect(md.split("\n")[1], id).toMatch(/^\|( -+ \|)+$/);
    }
  });

  it("keeps the header row: no row above it, no deleting it", () => {
    for (const id of ["row-above", "row-delete"]) {
      const { md, ran, header } = apply(id, "A");
      expect(header).toBe(true);
      expect(ran, id).toBe(false);
      expect(md, id).toBe(TABLE);
    }
    const { md, md2 } = apply("row-below", "A");
    expect(rows(md)).toHaveLength(4);
    expect(rows(md)[0].replace(/\s+/g, "")).toBe("|A|B|");
    expect(md2).toBe(md);
  });

  it("filters header-only actions", () => {
    const el = document.createElement("div");
    const editor = new Editor({ element: el, extensions: buildExtensions(), content: TABLE, contentType: "markdown" });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    expect(inHeaderRow(editor.state)).toBe(true);
    expect(TABLE_ACTIONS.filter((a) => tableActionEnabled(editor.state, a)).map((a) => a.id)).toEqual(["row-below", "col-left", "col-right", "col-delete", "table-delete"]);
    editor.destroy();
  });
});
