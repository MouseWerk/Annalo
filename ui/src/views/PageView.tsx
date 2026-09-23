// A note: title, icon, properties, editor and backlinks.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2, CornerDownRight, FileText, Hash, Link2, MoreHorizontal, PencilLine, SmilePlus, Star, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useApp, type Tab } from "../store/app";
import { ViewHeader } from "../components/ViewHeader";
import { NoteEditor, flushAllEditors, reloadEditors, type NoteEditorHandle } from "../editor/NoteEditor";
import { splitFrontmatter } from "../editor/extensions";
import { PAGE_ICONS, PageIcon } from "../components/icons";
import { Button, EmptyState, IconButton, Spinner, useMenu } from "../components/ui";
import { addDays, dateLong, isoDay, relative } from "../lib/format";
import { linkContext } from "../components/linkContext";
import type { PageDoc } from "../lib/types";

export function PageView({ pageId, tab, active }: { pageId: number; tab: Tab; active: boolean }) {
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const pages = useApp((s) => s.pages);
  const handle = useRef<NoteEditorHandle | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setMissing(false);
    api
      .page(pageId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        if (activeRef.current) useApp.getState().set({ activeDoc: d });
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      handle.current?.flush();
    };
  }, [pageId]);

  // The focused pane drives the outline, links panel and assistant context.
  useEffect(() => {
    if (active && doc) useApp.getState().set({ activeDoc: doc });
  }, [active, doc]);

  // Another pane changed this page (or a rename rewrote links): refresh tags and backlinks.
  useEffect(() => {
    const refresh = () =>
      api.page(pageId).then((fresh) => setDoc((cur) => (cur ? { ...cur, tags: fresh.tags, backlinks: fresh.backlinks, unresolved_links: fresh.unresolved_links, content: fresh.content, updated_at: fresh.updated_at } : cur))).catch(() => {});
    const onSaved = (e: Event) => (e as CustomEvent<{ id: number }>).detail.id === pageId && refresh();
    const onReload = (e: Event) => {
      const ids = (e as CustomEvent<{ ids?: number[] }>).detail?.ids;
      if (!ids || ids.includes(pageId)) refresh();
    };
    window.addEventListener("aether:page-saved", onSaved);
    window.addEventListener("aether:reload-pages", onReload);
    return () => {
      window.removeEventListener("aether:page-saved", onSaved);
      window.removeEventListener("aether:reload-pages", onReload);
    };
  }, [pageId]);

  const openLink = useCallback(async (target: string, newTab: boolean) => {
    try {
      await handle.current?.flush();
      const page = await api.resolvePage(target, true);
      if (!page) return;
      if (!useApp.getState().pages.has(page.id)) await useApp.getState().refreshTree();
      useApp.getState().openPage(page.id, { newTab: newTab && !altKey.current, split: altKey.current });
    } catch (e) {
      useApp.getState().error("Link konnte nicht geöffnet werden", e);
    }
  }, []);
  const openTag = useCallback((tag: string) => useApp.getState().openTab({ kind: "tag", tag }, { newTab: true }), []);
  // Alt+click on a link opens it in the pane to the right.
  const altKey = useRef(false);
  useEffect(() => {
    const track = (e: MouseEvent) => (altKey.current = e.altKey);
    window.addEventListener("mousedown", track, true);
    return () => window.removeEventListener("mousedown", track, true);
  }, []);

  if (missing)
    return (
      <>
        <ViewHeader tab={tab} title="Seite nicht gefunden" />
        <EmptyState icon={FileText} title="Seite nicht gefunden">Sie wurde vermutlich gelöscht.</EmptyState>
      </>
    );
  if (!doc)
    return (
      <>
        <ViewHeader tab={tab} title={pages.get(pageId)?.title ?? ""} />
        <div className="center-fill"><Spinner /></div>
      </>
    );

  const node = pages.get(doc.id);
  const crumbs: { id: number; title: string }[] = [];
  for (let p = node?.parent_id != null ? pages.get(node.parent_id) : undefined; p; p = p.parent_id != null ? pages.get(p.parent_id) : undefined) crumbs.unshift(p);

  return (
    <div className="page-view" ref={root}>
      <PageHeader tab={tab} root={root} doc={doc} crumbs={crumbs} onChange={(d) => setDoc({ ...doc, ...d })}>
        <Properties doc={doc} />
        <NoteEditor
          key={doc.id}
          active={active}
          doc={doc}
          onSaved={(d) => {
            setDoc((cur) => (cur ? { ...cur, tags: d.tags, backlinks: d.backlinks, unresolved_links: d.unresolved_links, updated_at: d.updated_at } : d));
            if (activeRef.current) useApp.getState().set({ activeDoc: d });
          }}
          onOpenLink={openLink}
          onOpenTag={openTag}
          handleRef={(h) => (handle.current = h)}
        />
        <Backlinks doc={doc} />
      </PageHeader>
    </div>
  );
}

function PageHeader({
  tab,
  root,
  doc,
  crumbs,
  onChange,
  children,
}: {
  tab: Tab;
  root: React.RefObject<HTMLDivElement | null>;
  doc: PageDoc;
  crumbs: { id: number; title: string }[];
  onChange: (d: Partial<PageDoc>) => void;
  children: React.ReactNode;
}) {
  const [title, setTitle] = useState(doc.title);
  const [iconOpen, setIconOpen] = useState(false);
  const [menu, openMenu] = useMenu();
  const s = useApp.getState;
  useEffect(() => setTitle(doc.title), [doc.title]);

  const commitTitle = async () => {
    const t = title.trim();
    if (!t || t === doc.title) return setTitle(doc.title);
    try {
      // All editors: a pending autosave elsewhere would write the old [[links]] back.
      await flushAllEditors();
      const n = await api.renamePage(doc.id, t, true);
      onChange({ title: t });
      reloadEditors();
      await s().refreshTree();
      if (n > 0) s().toast({ tone: "info", title: "Umbenannt", detail: `Links in ${n} ${n === 1 ? "Seite" : "Seiten"} aktualisiert` });
    } catch (e) {
      setTitle(doc.title);
      s().error("Umbenennen nicht möglich", e);
    }
  };

  const daily = doc.daily_date ? new Date(doc.daily_date + "T12:00:00") : null;
  const goDay = async (delta: number) => {
    const p = await api.dailyNote(isoDay(addDays(daily!, delta)));
    await s().refreshTree();
    s().openPage(p.id);
  };

  const titleInput = useRef<HTMLTextAreaElement>(null);
  // The title wraps like a heading instead of scrolling sideways.
  const fitTitle = () => {
    const el = titleInput.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fitTitle, [title]);
  useEffect(() => {
    const el = titleInput.current;
    if (!el) return;
    const ro = new ResizeObserver(fitTitle);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const actions = (
    <>
      {daily && (
        <>
          <IconButton icon={ChevronLeft} label="Vorheriger Tag" size={26} iconSize={15} onClick={() => goDay(-1)} />
          <IconButton icon={ChevronRight} label="Nächster Tag" size={26} iconSize={15} onClick={() => goDay(1)} />
        </>
      )}
      <IconButton
        icon={Star}
        label={doc.favorite ? "Lesezeichen entfernen" : "Lesezeichen setzen"}
        active={doc.favorite}
        className={doc.favorite ? "star-on" : ""}
        size={26}
        iconSize={15}
        onClick={async () => {
          try {
            await api.setFavorite(doc.id, !doc.favorite);
            onChange({ favorite: !doc.favorite });
            s().refreshTree();
          } catch (e) {
            s().error("Lesezeichen konnte nicht gesetzt werden", e);
          }
        }}
      />
      <IconButton
        icon={MoreHorizontal}
        label="Weitere Aktionen"
        size={26}
        iconSize={15}
        onClick={(e) =>
          openMenu(e, [
            { label: "Umbenennen", icon: PencilLine, onSelect: () => titleInput.current?.select() },
            { label: "Symbol ändern", icon: SmilePlus, onSelect: () => setIconOpen(true) },
            { label: "Rechts daneben öffnen", icon: Columns2, onSelect: () => s().splitTab(tab.id) },
            { label: "Link kopieren", icon: Link2, onSelect: () => navigator.clipboard.writeText(`[[${doc.title}]]`) },
            { label: "Unterseite anlegen", icon: CornerDownRight, onSelect: () => createSubpage(doc.id) },
            "separator",
            { label: "Seite löschen", icon: Trash2, danger: true, onSelect: () => deletePage(doc) },
          ])
        }
      />
    </>
  );

  return (
    <>
      <ViewHeader
        tab={tab}
        crumbs={crumbs.map((c) => (
          <span key={c.id} className="crumb">
            <button type="button" onClick={(e) => s().openPage(c.id, { newTab: e.ctrlKey || e.metaKey })}>{c.title}</button>
            <span className="crumb-sep">/</span>
          </span>
        ))}
        title={doc.title}
        actions={actions}
      />
      <div className="page-scroll">
        <div className="page">
          <header className="page-header">
            <div className="page-title-row">
              <button type="button" className="page-icon-btn" aria-label="Symbol ändern" onClick={() => setIconOpen((v) => !v)}>
                <PageIcon name={doc.icon} size={26} />
              </button>
              <textarea
                ref={titleInput}
                className="page-title"
                rows={1}
                value={title}
                spellCheck={false}
                aria-label="Seitentitel"
                onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                    root.current?.querySelector<HTMLElement>(".ProseMirror")?.focus();
                  }
                  if (e.key === "Escape") setTitle(doc.title);
                }}
              />
            </div>
            {daily && <div className="page-subtitle">{dateLong(daily.toISOString())}</div>}
            {iconOpen && (
              <div className="icon-picker" role="listbox" aria-label="Symbol wählen">
                {Object.entries(PAGE_ICONS).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={name}
                    className={doc.icon === name ? "on" : ""}
                    onClick={async () => {
                      try {
                        await api.setIcon(doc.id, name);
                        onChange({ icon: name });
                        setIconOpen(false);
                        s().refreshTree();
                      } catch (e) {
                        s().error("Symbol konnte nicht geändert werden", e);
                      }
                    }}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            )}
            {menu}
          </header>
          {children}
        </div>
      </div>
    </>
  );
}

function Properties({ doc }: { doc: PageDoc }) {
  const { frontmatter: fm, body } = splitFrontmatter(doc.content);
  const [open, setOpen] = useState(false);
  // Inline #tags are already clickable in the text; only show the others (frontmatter tags).
  const lower = body.toLowerCase();
  const extraTags = doc.tags.filter((t) => !lower.includes(`#${t.toLowerCase()}`));
  return (
    <div className="props">
      <span className="prop faint">Bearbeitet {relative(doc.updated_at)}</span>
      {extraTags.map((t) => (
        <button key={t} type="button" className="tag-chip" onClick={() => useApp.getState().openTab({ kind: "tag", tag: t }, { newTab: true })}>
          <Hash size={11} />
          {t}
        </button>
      ))}
      {fm && (
        <button type="button" className="prop prop-btn" onClick={() => setOpen((v) => !v)}>
          Eigenschaften
        </button>
      )}
      {open && fm && <pre className="frontmatter">{fm.trim()}</pre>}
    </div>
  );
}

function Backlinks({ doc }: { doc: PageDoc }) {
  if (!doc.backlinks.length) return null;
  return (
    <section className="backlinks" aria-label="Rückverweise">
      <h2>
        <Link2 size={14} /> Verlinkt von {doc.backlinks.length} {doc.backlinks.length === 1 ? "Seite" : "Seiten"}
      </h2>
      {doc.backlinks.map((b) => (
        <button key={b.page_id} type="button" className="backlink" onClick={(e) => useApp.getState().openPage(b.page_id, { newTab: e.ctrlKey || e.metaKey })}>
          <span className="backlink-title">
            <PageIcon name={b.icon} size={14} /> {b.title}
          </span>
          {b.context && <span className="backlink-context">{linkContext(b.context, doc.title)}</span>}
        </button>
      ))}
    </section>
  );
}

export async function createSubpage(parentId: number | null, title = "Unbenannt") {
  const s = useApp.getState();
  try {
    const p = await api.createPage(title, parentId);
    await s.refreshTree();
    s.openPage(p.id);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(".pane.active .page-title")?.select(), 120);
  } catch (e) {
    s.error("Seite konnte nicht angelegt werden", e);
  }
}

export async function deletePage(page: { id: number; title: string }) {
  const s = useApp.getState();
  const kids = s.pages.get(page.id)?.children.length ?? 0;
  const message = kids
    ? `„${page.title}“ und ${kids} ${kids === 1 ? "Unterseite" : "Unterseiten"} werden gelöscht. Das kann nicht rückgängig gemacht werden.`
    : `„${page.title}“ wird gelöscht. Das kann nicht rückgängig gemacht werden.`;
  if (!(await s.confirm({ title: "Seite löschen?", message, confirmLabel: "Löschen", danger: true }))) return;
  try {
    await api.deletePage(page.id);
    await s.refreshTree();
    s.toast({ tone: "info", title: "Seite gelöscht", detail: page.title });
  } catch (e) {
    s.error("Seite konnte nicht gelöscht werden", e);
  }
}

export function NewPageButton() {
  return <Button icon={FileText} onClick={() => createSubpage(null)}>Neue Seite</Button>;
}
