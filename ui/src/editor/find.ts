// Find in page: highlights all matches and steps through them.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export const findKey = new PluginKey<FindState>("find");
interface FindState {
  query: string;
  index: number;
  matches: { from: number; to: number }[];
}

function search(doc: PMNode, query: string) {
  const matches: { from: number; to: number }[] = [];
  if (!query) return matches;
  const q = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text!.toLowerCase();
    let i = text.indexOf(q);
    while (i >= 0) {
      matches.push({ from: pos + i, to: pos + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
  });
  return matches;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    find: {
      setFindQuery: (query: string) => ReturnType;
      findStep: (delta: 1 | -1) => ReturnType;
    };
  }
}

export const FindInPage = Extension.create({
  name: "find",
  addCommands() {
    return {
      setFindQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { query, index: 0 }));
          return true;
        },
      findStep:
        (delta) =>
        ({ state, tr, dispatch, view }) => {
          const st = findKey.getState(state);
          if (!st || !st.matches.length) return false;
          const index = (st.index + delta + st.matches.length) % st.matches.length;
          const m = st.matches[index];
          if (dispatch) {
            dispatch(tr.setMeta(findKey, { query: st.query, index }).setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView());
            requestAnimationFrame(() => (view.domAtPos(m.from).node as HTMLElement).parentElement?.scrollIntoView({ block: "center", behavior: "smooth" }));
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", index: 0, matches: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as { query: string; index: number } | undefined;
            if (meta) return { query: meta.query, index: meta.index, matches: search(tr.doc, meta.query) };
            if (tr.docChanged && prev.query) return { ...prev, matches: search(tr.doc, prev.query) };
            return prev;
          },
        },
        props: {
          decorations(state) {
            const st = findKey.getState(state);
            if (!st?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              st.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === st.index ? "find-hit current" : "find-hit" })),
            );
          },
        },
      }),
    ];
  },
});
