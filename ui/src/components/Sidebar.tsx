// Left sidebar: navigation, favorites, page tree (drag & drop), tags, timer.

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, CornerDownRight, FilePlus2, FolderTree, Hash, PencilLine, Plus, Search, Square, Star, StarOff, Timer, Trash2, X,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { PageIcon } from "./icons";
import { Button, IconButton, useMenu } from "./ui";
import { clock, h2 } from "../lib/format";
import { createSubpage, deletePage } from "../views/PageView";
import type { PageNode, SearchHit } from "../lib/types";

type SideTab = "files" | "search" | "bookmarks" | "tags";

export function Sidebar() {
  const tree = useApp((s) => s.tree);
  const pages = useApp((s) => s.pages);
  const active = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const [tab, setTabState] = useState<SideTab>(() => (localStorage.getItem("aether.sidetab") as SideTab) || "files");
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("aether.collapsed") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const setTab = (t: SideTab) => {
    setTabState(t);
    localStorage.setItem("aether.sidetab", t);
  };
  const saveCollapsed = (next: Set<number>) => {
    setCollapsed(next);
    localStorage.setItem("aether.collapsed", JSON.stringify([...next]));
  };
  useEffect(() => {
    const onFocusSearch = () => setTab("search");
    window.addEventListener("aether:sidebar-search", onFocusSearch);
    return () => window.removeEventListener("aether:sidebar-search", onFocusSearch);
  }, []);

  const tabs: { id: SideTab; label: string; icon: typeof Search }[] = [
    { id: "files", label: "Dateien", icon: FolderTree },
    { id: "search", label: "Suche (Ctrl Shift F)", icon: Search },
    { id: "bookmarks", label: "Lesezeichen", icon: Star },
    { id: "tags", label: "Tags", icon: Hash },
  ];
  const withChildren = [...pages.values()].filter((p) => p.children.length).map((p) => p.id);
  const allCollapsed = withChildren.length > 0 && withChildren.every((id) => collapsed.has(id));

  return (
    <aside className="sidebar" aria-label="Seitenleiste">
      <div className="side-tabs" role="tablist">
        {tabs.map((t) => (
          <IconButton key={t.id} icon={t.icon} label={t.label} active={tab === t.id} size={30} iconSize={16} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id} />
        ))}
      </div>

      {tab === "files" && (
        <>
          <div className="side-toolbar">
            <span className="side-title">Dateien</span>
            <IconButton icon={FilePlus2} label="Neue Seite" size={26} iconSize={15} onClick={() => createSubpage(null)} />
            <IconButton
              icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
              label={allCollapsed ? "Alle aufklappen" : "Alle einklappen"}
              size={26}
              iconSize={15}
              onClick={() => saveCollapsed(allCollapsed ? new Set() : new Set(withChildren))}
            />
          </div>
          <div className="sidebar-scroll">
            {tree.length === 0 ? (
              <div className="side-empty">
                Noch keine Seiten.
                <Button size="sm" icon={FilePlus2} onClick={() => createSubpage(null)}>
                  Neue Seite
                </Button>
              </div>
            ) : (
              <PageTree nodes={tree} activePageId={active?.kind === "page" ? active.pageId : undefined} collapsed={collapsed} setCollapsed={saveCollapsed} />
            )}
          </div>
        </>
      )}
      {tab === "search" && <SearchPane />}
      {tab === "bookmarks" && <Bookmarks activePageId={active?.kind === "page" ? active.pageId : undefined} />}
      {tab === "tags" && <TagsPane activeTag={active?.kind === "tag" ? active.tag : undefined} />}

      <TimerDock />
      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const s = useApp.getState;
  return (
    <div className="sidebar-foot">
      <button type="button" className="side-foot-btn" onClick={() => s().openTab({ kind: "timesheet" })} title="Zeiterfassung öffnen">
        <Timer size={14} strokeWidth={1.75} />
        <span>Heute</span>
        <TodayHours />
      </button>
    </div>
  );
}

// ------------------------------------------------------------- search pane

function SearchPane() {
  const [q, setQ] = useState(() => sessionStorage.getItem("aether.sidesearch") ?? "");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const s = useApp.getState;
  useEffect(() => {
    setTimeout(() => input.current?.focus(), 30);
    const onFocus = () => input.current?.select();
    window.addEventListener("aether:sidebar-search", onFocus);
    return () => window.removeEventListener("aether:sidebar-search", onFocus);
  }, []);
  useEffect(() => {
    sessionStorage.setItem("aether.sidesearch", q);
    if (q.trim().length < 2) return setHits(null);
    let alive = true;
    const t = setTimeout(() => api.search(q, 60).then((h) => alive && setHits(h)).catch(() => {}), 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  const pageHits = (hits ?? []).filter((h) => h.kind !== "time_entry") as Extract<SearchHit, { page_id: number }>[];
  const byPage = new Map<number, { title: string; icon: string | null; snippets: string[] }>();
  for (const h of pageHits) {
    const e = byPage.get(h.page_id) ?? { title: h.title, icon: h.icon, snippets: [] };
    if (h.kind === "note") e.snippets.push(h.snippet);
    byPage.set(h.page_id, e);
  }
  const entries = (hits ?? []).filter((h) => h.kind === "time_entry") as Extract<SearchHit, { kind: "time_entry" }>[];
  return (
    <div className="side-pane">
      <div className="side-search">
        <Search size={14} className="faint" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suchen …"
          aria-label="Volltextsuche"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = [...byPage.keys()][0];
              if (first) s().openPage(first, { newTab: e.ctrlKey || e.metaKey });
            }
            if (e.key === "Escape") setQ("");
          }}
        />
        {q && <IconButton icon={X} label="Leeren" size={22} iconSize={13} onClick={() => setQ("")} />}
      </div>
      <div className="sidebar-scroll">
        {hits && (
          <div className="side-result-count">
            {byPage.size} {byPage.size === 1 ? "Seite" : "Seiten"}
            {entries.length > 0 && `, ${entries.length} Zeiteinträge`}
          </div>
        )}
        {[...byPage.entries()].map(([id, p]) => (
          <button key={id} type="button" className="side-result" onClick={(e) => s().openPage(id, { newTab: e.ctrlKey || e.metaKey, split: e.altKey })}>
            <span className="side-result-title">
              <PageIcon name={p.icon} size={14} /> {p.title}
            </span>
            {p.snippets.slice(0, 2).map((sn, i) => (
              <span key={i} className="side-result-snippet" dangerouslySetInnerHTML={{ __html: markHits(sn) }} />
            ))}
          </button>
        ))}
        {entries.map((h) => (
          <button key={h.id} type="button" className="side-result" onClick={() => s().openTab({ kind: "timesheet" })}>
            <span className="side-result-title">
              <Timer size={14} /> {h.netzplan_nr}
              {h.vorgang_nr ? `/${h.vorgang_nr}` : ""}
            </span>
            <span className="side-result-snippet" dangerouslySetInnerHTML={{ __html: markHits(h.snippet) }} />
          </button>
        ))}
        {hits && hits.length === 0 && <div className="side-empty">Keine Treffer für „{q}“</div>}
        {!hits && <div className="side-empty faint">Durchsucht Titel, Notizen und Zeiteinträge. Umlaute und Groß-/Kleinschreibung egal.</div>}
      </div>
    </div>
  );
}

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const markHits = (sn: string) => escHtml(sn).replace(/\u0002([^\u0003]*)\u0003/g, "<mark>$1</mark>");

function Bookmarks({ activePageId }: { activePageId?: number }) {
  const pages = useApp((s) => s.pages);
  const favorites = [...pages.values()].filter((p) => p.favorite).sort((a, b) => a.title.localeCompare(b.title, "de"));
  const s = useApp.getState;
  return (
    <div className="side-pane">
      <div className="side-toolbar">
        <span className="side-title">Lesezeichen</span>
      </div>
      <div className="sidebar-scroll">
        {favorites.length === 0 && <div className="side-empty faint">Markiere Seiten mit dem Stern, um sie hier zu sammeln.</div>}
        {favorites.map((p) => (
          <button key={p.id} type="button" className={`tree-row ${activePageId === p.id ? "active" : ""}`} onClick={(e) => s().openPage(p.id, { newTab: e.ctrlKey || e.metaKey, split: e.altKey })}>
            <span className="tree-twisty leaf" />
            <PageIcon name={p.icon} size={15} className="tree-icon" />
            <span className="tree-label">{p.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TagsPane({ activeTag }: { activeTag?: string }) {
  const pages = useApp((s) => s.pages);
  const [tags, setTags] = useState<[string, number][]>([]);
  useEffect(() => {
    api.tags().then(setTags).catch(() => {});
  }, [pages]);
  const s = useApp.getState;
  return (
    <div className="side-pane">
      <div className="side-toolbar">
        <span className="side-title">Tags</span>
      </div>
      <div className="sidebar-scroll">
        {tags.length === 0 && <div className="side-empty faint">Schreibe #tag in eine Notiz, um sie zu verschlagworten.</div>}
        {tags.map(([tag, n]) => (
          <button key={tag} type="button" className={`tree-row ${activeTag === tag ? "active" : ""}`} onClick={() => s().openTab({ kind: "tag", tag })}>
            <span className="tree-twisty leaf" />
            <Hash size={14} className="tree-icon" />
            <span className="tree-label">{tag}</span>
            <span className="tree-count">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TodayHours() {
  const version = useApp((s) => s.entriesVersion);
  const [min, setMin] = useState(0);
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    api.entries(start.toISOString()).then((rows) => setMin(rows.reduce((a, r) => a + (r.duration_minutes ?? 0), 0))).catch(() => {});
  }, [version]);
  return min > 0 ? <span className="nav-badge num">{h2(min / 60)} h</span> : null;
}

// --------------------------------------------------------------- page tree

type DropPos = "before" | "inside" | "after";

function PageTree({
  nodes,
  activePageId,
  collapsed,
  setCollapsed,
}: {
  nodes: PageNode[];
  activePageId?: number;
  collapsed: Set<number>;
  setCollapsed: (s: Set<number>) => void;
}) {
  const [drag, setDrag] = useState<{ id: number; over?: number; pos?: DropPos } | null>(null);
  const [menu, openMenu] = useMenu();
  const s = useApp.getState;

  const toggle = (id: number) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
  };

  // Keep the active page visible: expand its ancestors.
  useEffect(() => {
    if (activePageId == null) return;
    const pages = s().pages;
    let p = pages.get(activePageId);
    let changed = false;
    const next = new Set(collapsed);
    while (p?.parent_id != null) {
      if (next.delete(p.parent_id)) changed = true;
      p = pages.get(p.parent_id);
    }
    if (changed) setCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  const onDrop = async (target: PageNode, pos: DropPos) => {
    const id = drag?.id;
    setDrag(null);
    if (id == null || id === target.id) return;
    const pages = s().pages;
    try {
      if (pos === "inside") {
        await api.movePage(id, target.id, target.children.length);
        const next = new Set(collapsed);
        next.delete(target.id);
        setCollapsed(next);
      } else {
        const siblings = target.parent_id == null ? s().tree : (pages.get(target.parent_id)?.children ?? []);
        const without = siblings.filter((x) => x.id !== id);
        const idx = without.findIndex((x) => x.id === target.id) + (pos === "after" ? 1 : 0);
        await api.movePage(id, target.parent_id, idx);
      }
      await s().refreshTree();
    } catch (e) {
      s().error("Verschieben nicht möglich", e);
    }
  };

  const row = (n: PageNode, depth: number): React.ReactNode => {
    const open = !collapsed.has(n.id);
    const over = drag?.over === n.id ? drag.pos : undefined;
    return (
      <div key={n.id} role="treeitem" aria-expanded={n.children.length ? open : undefined}>
        <div
          className={`tree-row ${activePageId === n.id ? "active" : ""} ${over ? `drop-${over}` : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e: DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(n.id));
            setDrag({ id: n.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            if (!drag || drag.id === n.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const pos: DropPos = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
            if (drag.over !== n.id || drag.pos !== pos) setDrag({ ...drag, over: n.id, pos });
          }}
          onDragLeave={() => drag?.over === n.id && setDrag({ id: drag.id })}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(n, drag?.pos ?? "inside");
          }}
          onClick={(e) => s().openPage(n.id, { newTab: e.ctrlKey || e.metaKey, split: e.altKey })}
          onAuxClick={(e) => e.button === 1 && s().openPage(n.id, { newTab: true })}
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "In neuem Tab öffnen", icon: CornerDownRight, shortcut: "Ctrl Klick", onSelect: () => s().openPage(n.id, { newTab: true }) },
              { label: "Rechts daneben öffnen", icon: Columns2, shortcut: "Alt Klick", onSelect: () => s().openPage(n.id, { split: true }) },
              { label: "Unterseite anlegen", icon: FilePlus2, onSelect: () => createSubpage(n.id) },
              {
                label: n.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten",
                icon: n.favorite ? StarOff : Star,
                onSelect: async () => {
                  await api.setFavorite(n.id, !n.favorite);
                  s().refreshTree();
                },
              },
              {
                label: "Umbenennen",
                icon: PencilLine,
                onSelect: () => {
                  s().openPage(n.id);
                  setTimeout(() => document.querySelector<HTMLTextAreaElement>(".pane.active .page-title")?.select(), 150);
                },
              },
              "separator",
              { label: "Löschen", icon: Trash2, danger: true, onSelect: () => deletePage(n) },
            ])
          }
        >
          <span
            className={`tree-twisty ${n.children.length ? "" : "leaf"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(n.id);
            }}
          >
            {n.children.length > 0 && <ChevronRight size={12} className={`chev ${open ? "open" : ""}`} />}
          </span>
          <PageIcon name={n.icon} size={15} className="tree-icon" />
          <span className="tree-label">{n.title}</span>
          <span className="tree-row-actions">
            <IconButton
              icon={Plus}
              label="Unterseite"
              size={20}
              iconSize={13}
              tooltipSide="right"
              onClick={(e) => {
                e.stopPropagation();
                createSubpage(n.id);
              }}
            />
          </span>
        </div>
        {open && n.children.length > 0 && <div role="group">{n.children.map((c) => row(c, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="tree" role="tree" aria-label="Seiten">
      {nodes.map((n) => row(n, 0))}
      {menu}
    </div>
  );
}

// ------------------------------------------------------------- timer dock

export function useTimerSeconds() {
  const timer = useApp((s) => s.timer);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);
  return timer ? (now - new Date(timer.entry.start_time).getTime()) / 1000 : 0;
}

function TimerDock() {
  const timer = useApp((s) => s.timer);
  const seconds = useTimerSeconds();
  if (!timer) return null;
  const e = timer.entry;
  return (
    <div className="timer-dock" role="status">
      <span className="rec-dot" aria-hidden />
      <button type="button" className="timer-dock-main" onClick={() => useApp.getState().openTab({ kind: "timesheet" })}>
        <span className="timer-dock-time num">{clock(seconds)}</span>
        <span className="timer-dock-label">{e.description || `${e.vorgang_nr ?? "Timer"}`}</span>
      </button>
      <IconButton icon={Square} label="Timer stoppen" size={26} iconSize={13} onClick={() => stopTimer()} />
    </div>
  );
}

export async function stopTimer() {
  const s = useApp.getState();
  const t = s.timer;
  if (!t) return;
  try {
    let subtract = false;
    if (t.idle_minutes > 0) {
      subtract = await s.confirm({
        title: "Leerlauf erkannt",
        message: `Du warst ${t.idle_minutes} Minuten inaktiv. Soll diese Zeit von der Buchung abgezogen werden?`,
        confirmLabel: "Abziehen",
      });
    }
    const out = await api.timerStop(subtract);
    if (out.discarded) s.toast({ tone: "info", title: "Nicht gebucht", detail: "Der Timer lief weniger als eine Minute." });
    else s.toast({ tone: "success", title: `${h2((out.entry.duration_minutes ?? 0) / 60)} h gebucht`, detail: out.entry.description || undefined });
    s.alerts(out.alerts);
    s.bumpEntries();
  } catch (e) {
    s.error("Timer konnte nicht gestoppt werden", e);
  }
}
