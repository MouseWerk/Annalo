// The Markdown note editor (TipTap, live preview, autosave).

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, SquareArrowOutUpRight } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { hoursFromMinutes } from "../lib/format";
import { SlashCommand, TagHighlight, TimeEntryChip, WikiLink, WikiLinkSuggest, ZeitCommand, pageSuggestItem, splitFrontmatter, type LinkSuggestItem } from "./extensions";
import { IconButton } from "../components/ui";
import { FindInPage, findKey } from "./find";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { PageDoc } from "../lib/types";

const SAVE_DELAY = 450;
const lowlight = createLowlight(common);

export interface NoteEditorHandle {
  editor: Editor | null;
  flush: () => Promise<void>;
}

export function NoteEditor({
  doc,
  onSaved,
  onOpenLink,
  onOpenTag,
  handleRef,
}: {
  doc: PageDoc;
  onSaved: (doc: PageDoc) => void;
  onOpenLink: (target: string, newTab: boolean) => void;
  onOpenTag: (tag: string) => void;
  handleRef?: (h: NoteEditorHandle) => void;
}) {
  const frontmatter = useRef(splitFrontmatter(doc.content).frontmatter);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const cb = useRef({ onSaved, onOpenLink, onOpenTag });
  cb.current = { onSaved, onOpenLink, onOpenTag };

  const save = async (editor: Editor) => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    const md = frontmatter.current + editor.getMarkdown();
    const p = api
      .savePage(doc.id, md)
      .then((saved) => {
        cb.current.onSaved(saved);
        setStatus(dirty.current ? "dirty" : "saved");
      })
      .catch((e) => {
        dirty.current = true;
        setStatus("dirty");
        useApp.getState().error("Speichern fehlgeschlagen", e);
      });
    saving.current = p;
    await p;
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
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
        WikiLink.configure({
          onOpen: (t, newTab) => cb.current.onOpenLink(t, newTab),
          isKnown: (t) => {
            const lower = t.toLowerCase();
            for (const p of useApp.getState().pages.values()) if (p.title.toLowerCase() === lower) return true;
            return false;
          },
        }),
        WikiLinkSuggest.configure({
          search: async (q) => {
            const pages = [...useApp.getState().pages.values()];
            const lower = q.toLowerCase().trim();
            const matches = pages
              .filter((p) => p.id !== doc.id && (!lower || p.title.toLowerCase().includes(lower)))
              .sort((a, b) => {
                const as = a.title.toLowerCase().startsWith(lower) ? 0 : 1;
                const bs = b.title.toLowerCase().startsWith(lower) ? 0 : 1;
                return as - bs || b.updated_at.localeCompare(a.updated_at);
              })
              .slice(0, 8)
              .map((p) => pageSuggestItem(p, p.parent_id ? useApp.getState().pages.get(p.parent_id)?.title : undefined));
            const items: LinkSuggestItem[] = matches;
            if (lower && !pages.some((p) => p.title.toLowerCase() === lower)) {
              items.push({ id: "create", title: `„${q.trim()}“ neu verlinken`, subtitle: "Seite wird beim Öffnen angelegt", target: q.trim(), create: true });
            }
            return items;
          },
        }),
        SlashCommand,
        TimeEntryChip,
        ZeitCommand.configure({
          book: async (line) => {
            try {
              const out = await api.logTime(line);
              const s = useApp.getState();
              s.bumpEntries();
              s.alerts(out.alerts);
              const target = line.trim().split(/\s+/)[1] ?? "";
              s.toast({ tone: "success", title: `${hoursFromMinutes(out.entry.duration_minutes)} h gebucht`, detail: `${target}${out.entry.description ? " · " + out.entry.description : ""}` });
              return { entryId: out.entry.id, hours: hoursFromMinutes(out.entry.duration_minutes), target, text: out.entry.description };
            } catch (e) {
              useApp.getState().error("Buchung fehlgeschlagen", e);
              return null;
            }
          },
        }),
        TagHighlight.configure({ onOpen: (t) => cb.current.onOpenTag(t) }),
        FindInPage,
      ],
      content: splitFrontmatter(doc.content).body,
      contentType: "markdown",
      editorProps: {
        attributes: { class: "prose", spellcheck: "true", "aria-label": "Notiz" },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          const a = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
          if (a && !a.dataset.wikilink && (event.ctrlKey || event.metaKey)) {
            openUrl(a.href).catch(() => {});
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        dirty.current = true;
        setStatus("dirty");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => save(editor), SAVE_DELAY);
        publishOutline(editor);
      },
      onCreate: ({ editor }) => publishOutline(editor),
    },
    [doc.id],
  );

  useEffect(() => {
    if (!editor) return;
    handleRef?.({
      editor,
      flush: async () => {
        window.clearTimeout(saveTimer.current);
        await save(editor);
        await saving.current;
      },
    });
    useApp.getState().set({
      scrollToPos: (pos) => {
        editor.chain().focus().setTextSelection(pos + 1).run();
        const dom = editor.view.domAtPos(pos + 1).node as HTMLElement;
        (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      save(editor);
    };
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Ctrl+F: find in this page.
  const [find, setFind] = useState<string | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const sel = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").trim();
        setFind((f) => (sel && sel.length < 60 ? sel : (f ?? "")));
        setTimeout(() => findInput.current?.select(), 10);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    editor.commands.setFindQuery(find ?? "");
  }, [find, editor]);
  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const f = findKey.getState(e.state);
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        highlight: e.isActive("highlight"),
        link: e.isActive("link"),
        findIndex: f?.index ?? 0,
        findCount: f?.matches.length ?? 0,
      };
    },
  });
  const closeFind = () => {
    setFind(null);
    editor?.commands.focus();
  };

  return (
    <div className="editor-wrap" data-save-status={status}>
      {find !== null && (
        <div className="find-bar" role="search">
          <Search size={14} className="faint" />
          <input
            ref={findInput}
            value={find}
            placeholder="In Seite suchen"
            aria-label="In Seite suchen"
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.findStep(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="find-count num">{find ? (ui?.findCount ? `${ui.findIndex + 1}/${ui.findCount}` : "0") : ""}</span>
          <IconButton icon={ChevronUp} label="Vorheriger Treffer" size={24} iconSize={14} onClick={() => editor?.commands.findStep(-1)} />
          <IconButton icon={ChevronDown} label="Nächster Treffer" size={24} iconSize={14} onClick={() => editor?.commands.findStep(1)} />
          <IconButton icon={X} label="Schließen" size={24} iconSize={14} onClick={closeFind} />
        </div>
      )}
      {editor && (
        <BubbleMenu editor={editor} className="bubble" shouldShow={({ editor: e, state }) => !state.selection.empty && !e.isActive("codeBlock") && !e.isActive("wikiLink") && !e.isActive("timeEntry")}>
          <IconButton icon={Bold} label="Fett (Ctrl B)" active={ui?.bold} onClick={() => editor.chain().focus().toggleBold().run()} tooltipSide="top" />
          <IconButton icon={Italic} label="Kursiv (Ctrl I)" active={ui?.italic} onClick={() => editor.chain().focus().toggleItalic().run()} tooltipSide="top" />
          <IconButton icon={Strikethrough} label="Durchgestrichen" active={ui?.strike} onClick={() => editor.chain().focus().toggleStrike().run()} tooltipSide="top" />
          <IconButton icon={Code} label="Code" active={ui?.code} onClick={() => editor.chain().focus().toggleCode().run()} tooltipSide="top" />
          <IconButton icon={Highlighter} label="Hervorheben" active={ui?.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()} tooltipSide="top" />
          <span className="bubble-sep" />
          <IconButton
            icon={Link2}
            label="Als Seitenlink [[ ]]"
            onClick={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, " ").trim();
              if (!text) return;
              editor.chain().focus().insertContentAt({ from, to }, { type: "wikiLink", attrs: { target: text } }).run();
            }}
            tooltipSide="top"
          />
          {linkDraft === null ? (
            <IconButton
              icon={SquareArrowOutUpRight}
              label={ui?.link ? "Weblink entfernen" : "Weblink"}
              active={ui?.link}
              onClick={() => (editor.isActive("link") ? editor.chain().focus().unsetLink().run() : setLinkDraft("https://"))}
              tooltipSide="top"
            />
          ) : (
            <input
              className="bubble-input"
              autoFocus
              value={linkDraft}
              aria-label="URL"
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={() => setLinkDraft(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (/^(https?:\/\/|mailto:)\S+/.test(linkDraft)) editor.chain().focus().setLink({ href: linkDraft }).run();
                  setLinkDraft(null);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setLinkDraft(null);
                  editor.commands.focus();
                }
              }}
            />
          )}
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function publishOutline(editor: Editor) {
  const outline: { level: number; text: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") outline.push({ level: node.attrs.level, text: node.textContent, pos });
    return node.type.name !== "heading";
  });
  useApp.getState().set({ outline });
}
