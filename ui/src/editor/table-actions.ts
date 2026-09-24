// Table editing commands, shared by the table toolbar and the slash menu.

import type { ChainedCommands, Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import {
  BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, TableColumnsSplit, TableRowsSplit, Trash2, type LucideIcon,
} from "lucide-react";

export interface TableAction {
  id: string;
  title: string;
  icon: LucideIcon;
  keywords: string;
  danger?: boolean;
  /** Not available in the header row: Markdown tables always keep exactly one header row. */
  bodyOnly?: boolean;
  run: (chain: ChainedCommands) => ChainedCommands;
}

export const TABLE_ACTIONS: TableAction[] = [
  { id: "row-above", title: "Zeile darüber", icon: BetweenHorizontalStart, keywords: "tabelle zeile row oben einfügen", bodyOnly: true, run: (c) => c.addRowBefore() },
  { id: "row-below", title: "Zeile darunter", icon: BetweenHorizontalEnd, keywords: "tabelle zeile row unten einfügen", run: (c) => c.addRowAfter() },
  { id: "col-left", title: "Spalte links", icon: BetweenVerticalStart, keywords: "tabelle spalte column links einfügen", run: (c) => c.addColumnBefore() },
  { id: "col-right", title: "Spalte rechts", icon: BetweenVerticalEnd, keywords: "tabelle spalte column rechts einfügen", run: (c) => c.addColumnAfter() },
  { id: "row-delete", title: "Zeile löschen", icon: TableRowsSplit, keywords: "tabelle zeile row entfernen löschen", danger: true, bodyOnly: true, run: (c) => c.deleteRow() },
  { id: "col-delete", title: "Spalte löschen", icon: TableColumnsSplit, keywords: "tabelle spalte column entfernen löschen", danger: true, run: (c) => c.deleteColumn() },
  { id: "table-delete", title: "Tabelle löschen", icon: Trash2, keywords: "tabelle table entfernen löschen", danger: true, run: (c) => c.deleteTable() },
];

/** Whether the selection is in the first (header) row of a table. */
export function inHeaderRow(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "tableRow") return $from.index(d - 1) === 0;
  }
  return false;
}

/** The actions available at the current selection. */
export const tableActionEnabled = (state: EditorState, a: TableAction) => !(a.bodyOnly && inHeaderRow(state));

export const runTableAction = (editor: Editor, a: TableAction) => tableActionEnabled(editor.state, a) && a.run(editor.chain().focus()).run();
