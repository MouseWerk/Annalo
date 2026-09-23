// A note: title, icon, properties, editor and backlinks.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CornerDownRight, FileText, Hash, Link2, MoreHorizontal, PencilLine, SmilePlus, Star, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { NoteEditor, type NoteEditorHandle } from "../editor/NoteEditor";
import { splitFrontmatter } from "../editor/extensions";
import { PAGE_ICONS, PageIcon } from "../components/icons";
import { Button, EmptyState, IconButton, Spinner, useMenu } from "../components/ui";
import { addDays, dateLong, isoDay, relative } from "../lib/format";
import { linkContext } from "../components/linkContext";
import type { PageDoc } from "../lib/types";

export function PageView({ pageId }: { pageId: number }) {
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const pages = useApp((s) => s.pages);
  const handle = useRef<NoteEditorHandle | null>(null);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setMissing(false);
    api
      .page(pageId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        useApp.getState().set({ activeDoc: d });
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      handle.current?.flush();
    };
  }, [pageId]);

  const openLink = useCallback(async (target: string, newTab: boolean) => {
    try {
      await handle.current?.flush();
      const page = await api.resolvePage(target, true);
      if (!page) return;
      if (!useApp.getState().pages.has(page.id)) await useApp.getState().refreshTree();
      useApp.getState().openPage(page.id, { newTab });
    } catch (e) {
      useApp.getState().error("Link konnte nicht geöffnet werden", e);
    }
  }, []);
  const openTag = useCallback((tag: string) => useApp.getState().openTab({ kind: "tag", tag }, { newTab: true }), []);

  if (missing) return <EmptyState icon={FileText} title="Seite nicht gefunden">Sie wurde vermutlich gelöscht.</EmptyState>;
  if (!doc) return <div className="center-fill"><Spinner /></div>;

  const node = pages.get(doc.id);
  const crumbs: { id: number; title: string }[] = [];
  for (let p = node?.parent_id != null ? pages.get(node.parent_id) : undefined; p; p = p.parent_id != null ? pages.get(p.parent_id) : undefined) crumbs.unshift(p);

  return (
    <div className="page-scroll">
      <div className="page">
        <PageHeader doc={doc} crumbs={crumbs} onChange={(d) => setDoc({ ...doc, ...d })} flush={() => handle.current?.flush() ?? Promise.resolve()} />
        <Properties doc={doc} onChange={setDoc} />
        <NoteEditor
          key={doc.id}
          doc={doc}
          onSaved={(d) => {
            setDoc((cur) => (cur ? { ...cur, tags: d.tags, backlinks: d.backlinks, unresolved_links: d.unresolved_links, updated_at: d.updated_at } : d));
            useApp.getState().set({ activeDoc: d });
          }}
          onOpenLink={openLink}
          onOpenTag={openTag}
          handleRef={(h) => (handle.current = h)}
        />
        <Backlinks doc={doc} />
      </div>
    </div>
  );
}

function PageHeader({ doc, crumbs, onChange, flush }: { doc: PageDoc; crumbs: { id: number; title: string }[]; onChange: (d: Partial<PageDoc>) => void; flush: () => Promise<void> }) {
  const [title, setTitle] = useState(doc.title);
  const [iconOpen, setIconOpen] = useState(false);
  const [menu, openMenu] = useMenu();
  const s = useApp.getState;
  useEffect(() => setTitle(doc.title), [doc.title]);

  const commitTitle = async () => {
    const t = title.trim();
    if (!t || t === doc.title) return setTitle(doc.title);
    try {
      await flush();
      const n = await api.renamePage(doc.id, t, true);
      onChange({ title: t });
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

  return (
    <header className="page-header">
      <div className="page-topline">
        <nav className="crumbs" aria-label="Pfad">
          {crumbs.map((c) => (
            <span key={c.id} className="crumb">
              <button type="button" onClick={() => s().openPage(c.id)}>{c.title}</button>
              <ChevronRight size={12} className="faint" />
            </span>
          ))}
        </nav>
        <div className="page-actions">
          {daily && (
            <>
              <IconButton icon={ChevronLeft} label="Vorheriger Tag" onClick={() => goDay(-1)} />
              <IconButton icon={ChevronRight} label="Nächster Tag" onClick={() => goDay(1)} />
            </>
          )}
          <IconButton
            icon={Star}
            label={doc.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}
            active={doc.favorite}
            className={doc.favorite ? "star-on" : ""}
            onClick={async () => {
              await api.setFavorite(doc.id, !doc.favorite);
              onChange({ favorite: !doc.favorite });
              s().refreshTree();
            }}
          />
          <IconButton
            icon={MoreHorizontal}
            label="Weitere Aktionen"
            onClick={(e) =>
              openMenu(e, [
                { label: "Umbenennen", icon: PencilLine, onSelect: () => document.querySelector<HTMLInputElement>(".page-title")?.select() },
                { label: "Symbol ändern", icon: SmilePlus, onSelect: () => setIconOpen(true) },
                { label: "Link kopieren", icon: Link2, onSelect: () => navigator.clipboard.writeText(`[[${doc.title}]]`) },
                { label: "Unterseite anlegen", icon: CornerDownRight, onSelect: () => createSubpage(doc.id) },
                "separator",
                { label: "Seite löschen", icon: Trash2, danger: true, onSelect: () => deletePage(doc) },
              ])
            }
          />
        </div>
      </div>
      <div className="page-title-row">
        <button type="button" className="page-icon-btn" aria-label="Symbol ändern" onClick={() => setIconOpen((v) => !v)}>
          <PageIcon name={doc.icon} size={26} />
        </button>
        <input
          className="page-title"
          value={title}
          aria-label="Seitentitel"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              document.querySelector<HTMLElement>(".ProseMirror")?.focus();
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
                await api.setIcon(doc.id, name);
                onChange({ icon: name });
                setIconOpen(false);
                s().refreshTree();
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      )}
      {menu}
    </header>
  );
}

function Properties({ doc, onChange }: { doc: PageDoc; onChange: (d: PageDoc) => void }) {
  const fm = splitFrontmatter(doc.content).frontmatter;
  const [open, setOpen] = useState(false);
  const words = splitFrontmatter(doc.content).body.split(/\s+/).filter(Boolean).length;
  return (
    <div className="props">
      <span className="prop faint">Bearbeitet {relative(doc.updated_at)}</span>
      <span className="prop faint">{words.toLocaleString("de-DE")} Wörter</span>
      {doc.backlinks.length > 0 && (
        <span className="prop faint">
          <Link2 size={12} /> {doc.backlinks.length} {doc.backlinks.length === 1 ? "Rückverweis" : "Rückverweise"}
        </span>
      )}
      {doc.tags.map((t) => (
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
      {void onChange}
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
    setTimeout(() => document.querySelector<HTMLInputElement>(".page-title")?.select(), 120);
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
  await api.deletePage(page.id);
  await s.refreshTree();
  s.toast({ tone: "info", title: "Seite gelöscht", detail: page.title });
}

export function NewPageButton() {
  return <Button icon={FileText} onClick={() => createSubpage(null)}>Neue Seite</Button>;
}
