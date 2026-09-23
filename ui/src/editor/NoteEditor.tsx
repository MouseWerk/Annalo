// The Markdown note editor (TipTap, live preview, autosave).

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, SquareArrowOutUpRight } from "lucide-react";
import { api, attachmentUrl, uploadAttachment } from "../lib/api";
import { insertTemplate } from "../components/Templates";
import { useApp } from "../store/app";
import { hoursFromMinutes } from "../lib/format";
import { pageSuggestItem, splitFrontmatter, type LinkSuggestItem } from "./extensions";
import { buildExtensions, toMarkdown } from "./schema";
import { zeitLaItems, zeitRefItems } from "./zeit-source";
import { IconButton } from "../components/ui";
import { findKey } from "./find";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { PageDoc } from "../lib/types";

const SAVE_DELAY = 450;

export interface NoteEditorHandle {
  editor: Editor | null;
  flush: () => Promise<void>;
  /** Replaces the page's frontmatter (property editor); saved like any other edit. */
  setFrontmatter: (fm: string) => void;
}

// Flush handles of all mounted editors (rename, window close).
const flushers = new Set<() => Promise<void>>();

/** Saves pending edits of every open editor; rejects if one of them could not be saved. */
export async function flushAllEditors() {
  await Promise.all([...flushers].map((f) => f()));
}

/** Editors showing one of `ids` (all when omitted) refetch their page, unless they hold unsaved edits. */
export function reloadEditors(ids?: number[]) {
  window.dispatchEvent(new CustomEvent("aether:reload-pages", { detail: { ids } }));
}

export function NoteEditor({
  doc,
  onSaved,
  onOpenLink,
  onOpenTag,
  handleRef,
  onFrontmatter,
  active = true,
}: {
  active?: boolean;
  doc: PageDoc;
  onSaved: (doc: PageDoc) => void;
  onOpenLink: (target: string, newTab: boolean) => void;
  onOpenTag: (tag: string) => void;
  /** The frontmatter changed from outside (another pane, a reload). */
  onFrontmatter?: (fm: string) => void;
  handleRef?: (h: NoteEditorHandle) => void;
}) {
  const frontmatter = useRef(splitFrontmatter(doc.content).frontmatter);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const cb = useRef({ onSaved, onOpenLink, onOpenTag, onFrontmatter });
  cb.current = { onSaved, onOpenLink, onOpenTag, onFrontmatter };
  const activeRef = useRef(active);
  activeRef.current = active;
  const instance = useRef(Math.random().toString(36).slice(2));

  // Another pane saved this page while we had edits: reload once ours are stored.
  const foreignPending = useRef(false);
  const busy = () => dirty.current || saving.current !== null;

  const apply = (editor: Editor, content: string) => {
    const { frontmatter: fm, body } = splitFrontmatter(content);
    if (fm !== frontmatter.current) {
      frontmatter.current = fm;
      cb.current.onFrontmatter?.(fm);
    }
    if (toMarkdown(editor) === body) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
    const max = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    if (activeRef.current) publishOutline(editor);
  };

  const reload = async (editor: Editor) => {
    if (busy()) return void (foreignPending.current = true);
    foreignPending.current = false;
    try {
      const fresh = await api.page(doc.id);
      if (editor.isDestroyed) return;
      if (busy()) return void (foreignPending.current = true);
      apply(editor, fresh.content);
    } catch {
      /* page gone: the view shows that */
    }
  };

  const save = async (editor: Editor) => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    const md = frontmatter.current + toMarkdown(editor);
    // Saves run one after another so an older one never lands last.
    const p: Promise<void> = (saving.current ?? Promise.resolve())
      .then(() => api.savePage(doc.id, md))
      .then((saved) => {
        cb.current.onSaved(saved);
        // Other panes showing the same page pick up the new content.
        window.dispatchEvent(new CustomEvent("aether:page-saved", { detail: { id: doc.id, content: md, from: instance.current } }));
        setStatus(dirty.current ? "dirty" : "saved");
      })
      .catch((e) => {
        dirty.current = true;
        setStatus("dirty");
        useApp.getState().error("Speichern fehlgeschlagen", e);
        // Try again later; the edits stay in the editor meanwhile.
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => save(editor), 5000);
      })
      .finally(() => {
        if (saving.current !== p) return;
        saving.current = null;
        if (foreignPending.current && !dirty.current && !editor.isDestroyed) reload(editor);
      });
    saving.current = p;
    await p;
  };

  const editor = useEditor(
    {
      extensions: buildExtensions({
        onOpenLink: (t, newTab) => cb.current.onOpenLink(t, newTab),
        onOpenTag: (t) => cb.current.onOpenTag(t),
        isKnown: (t) => {
          const lower = t.toLowerCase();
          for (const p of useApp.getState().pages.values()) if (p.title.toLowerCase() === lower) return true;
          return false;
        },
        searchPages: async (q) => {
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
        book: async (line) => {
          try {
            const out = await api.logTime(line, doc.id);
            const s = useApp.getState();
            s.bumpEntries();
            s.alerts(out.alerts);
            const target = out.reference || (line.trim().split(/\s+/)[1] ?? "");
            s.toast({ tone: "success", title: `${hoursFromMinutes(out.entry.duration_minutes)} h gebucht`, detail: `${target}${out.entry.description ? " · " + out.entry.description : ""}` });
            return { entryId: out.entry.id, hours: hoursFromMinutes(out.entry.duration_minutes), target, text: out.entry.description };
          } catch (e) {
            useApp.getState().error("Buchung fehlgeschlagen", e);
            return null;
          }
        },
        zeitRefs: zeitRefItems,
        zeitLeistungsarten: zeitLaItems,
        attachmentUrl,
        uploadImage: async (file) => {
          try {
            return (await uploadAttachment(file)).name;
          } catch (e) {
            useApp.getState().error("Bild nicht gespeichert", e);
            return null;
          }
        },
        onPickImage: (editor) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
          input.multiple = true;
          input.onchange = async () => {
            for (const file of input.files ?? []) {
              try {
                const saved = await uploadAttachment(file);
                if (!editor.isDestroyed) editor.chain().focus().insertContent({ type: "imageEmbed", attrs: { name: saved.name } }).run();
              } catch (e) {
                useApp.getState().error("Bild nicht gespeichert", e);
              }
            }
          };
          input.click();
        },
        onPickTemplate: (editor) => insertTemplate(editor, useApp.getState().pages.get(doc.id)?.title ?? doc.title),
        onZeitLost: (res) =>
          useApp.getState().toast({ tone: "warning", title: "Gebucht, aber Zeile nicht mehr gefunden", detail: `${res.hours} h · ${res.target} – kein Chip eingefügt` }),
      }),
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
        if (activeRef.current) publishOutline(editor);
      },
      onCreate: ({ editor }) => activeRef.current && publishOutline(editor),
      // Other panes with this page store their edits first, so we continue from them.
      onFocus: () => window.dispatchEvent(new CustomEvent("aether:flush-page", { detail: { id: doc.id, from: instance.current } })),
    },
    [doc.id],
  );

  useEffect(() => {
    if (!editor) return;
    const flushNow = async () => {
      window.clearTimeout(saveTimer.current);
      await save(editor);
      await saving.current;
      if (dirty.current) throw new Error("Änderungen konnten nicht gespeichert werden");
    };
    const setFrontmatter = (fm: string) => {
      if (fm === frontmatter.current) return;
      frontmatter.current = fm;
      dirty.current = true;
      setStatus("dirty");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => save(editor), SAVE_DELAY);
    };
    handleRef?.({ editor, flush: flushNow, setFrontmatter });
    flushers.add(flushNow);
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      save(editor);
    };
    window.addEventListener("blur", flush);
    return () => {
      flushers.delete(flushNow);
      window.removeEventListener("blur", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The focused pane owns the outline panel.
  useEffect(() => {
    if (!editor || !active) return;
    publishOutline(editor);
    useApp.getState().set({
      scrollToPos: (pos) => {
        editor.chain().focus().setTextSelection(pos + 1).run();
        const dom = editor.view.domAtPos(pos + 1).node as HTMLElement;
        (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  }, [editor, active]);

  // Same page open in another pane: take over its saved content unless we have unsaved
  // (or in-flight) edits; then reload after our own save. Renames reload all pages.
  useEffect(() => {
    if (!editor) return;
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ id: number; content: string; from: string }>).detail;
      if (d.id !== doc.id || d.from === instance.current) return;
      if (busy()) foreignPending.current = true;
      else apply(editor, d.content);
    };
    const onReload = (e: Event) => {
      const ids = (e as CustomEvent<{ ids?: number[] }>).detail?.ids;
      if (!ids || ids.includes(doc.id)) reload(editor);
    };
    const onFlushPage = (e: Event) => {
      const d = (e as CustomEvent<{ id: number; from: string }>).detail;
      if (d.id !== doc.id || d.from === instance.current) return;
      window.clearTimeout(saveTimer.current);
      save(editor);
    };
    window.addEventListener("aether:page-saved", onSaved);
    window.addEventListener("aether:reload-pages", onReload);
    window.addEventListener("aether:flush-page", onFlushPage);
    return () => {
      window.removeEventListener("aether:page-saved", onSaved);
      window.removeEventListener("aether:reload-pages", onReload);
      window.removeEventListener("aether:flush-page", onFlushPage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc.id]);

  // Ctrl+F: find in this page.
  const [find, setFind] = useState<string | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && activeRef.current) {
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
        <div className="find-anchor">
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
        </div>
      )}
      {editor && (
        <BubbleMenu editor={editor} className="bubble" shouldShow={({ editor: e, state }) => find === null && !state.selection.empty && !e.isActive("codeBlock") && !e.isActive("wikiLink") && !e.isActive("timeEntry") && !e.isActive("imageEmbed") && !e.isActive("image")}>
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
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ", " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  useApp.getState().set({ outline, editorStats: { words, chars: text.replace(/\s/g, "").length } });
}
