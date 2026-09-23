// Left sidebar: navigation, favorites, page tree (drag & drop), tags, timer.

import { useEffect, useState, type DragEvent } from "react";
import {
  Briefcase, CalendarCheck2, ChevronRight, CornerDownRight, FilePlus2, Hash, PanelLeftClose, PencilLine, Plus, Search, Settings, Sparkles, Square, Star, StarOff, Timer, Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp, savePref, type Tab } from "../store/app";
import { PageIcon } from "./icons";
import { IconButton, useMenu } from "./ui";
import { clock, h2, isoDay } from "../lib/format";
import { createSubpage, deletePage } from "../views/PageView";
import type { PageNode } from "../lib/types";

export function Sidebar() {
  const tree = useApp((s) => s.tree);
  const pages = useApp((s) => s.pages);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const [tags, setTags] = useState<[string, number][]>([]);
  const [tagsOpen, setTagsOpen] = useState(true);
  const s = useApp.getState;

  useEffect(() => {
    api.tags().then(setTags).catch(() => {});
  }, [pages]);

  const favorites = [...pages.values()].filter((p) => p.favorite);
  const isActive = (kind: Tab["kind"], extra?: Partial<Tab>) => active?.kind === kind && (!extra || Object.entries(extra).every(([k, v]) => active[k as keyof Tab] === v));

  const openToday = async () => {
    try {
      const p = await api.dailyNote();
      await s().refreshTree();
      s().openPage(p.id);
    } catch (e) {
      s().error("Tagesnotiz konnte nicht geöffnet werden", e);
    }
  };
  const todayId = [...pages.values()].find((p) => p.daily_date === isoDay(new Date()))?.id;

  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="sidebar-head">
        <div className="brand">
          <img src="/icon.png" alt="" width={20} height={20} />
          <span>Aether OS</span>
        </div>
        <IconButton
          icon={PanelLeftClose}
          label="Seitenleiste ausblenden (Ctrl \)"
          onClick={() => {
            s().set({ sidebarOpen: false });
            savePref("aether.sidebar", false);
          }}
        />
      </div>

      <div className="sidebar-actions">
        <button type="button" className="search-btn" onClick={() => s().set({ paletteOpen: true, paletteMode: "all", paletteQuery: "" })}>
          <Search size={14} strokeWidth={2} />
          <span>Suchen</span>
          <kbd>Ctrl K</kbd>
        </button>
        <IconButton icon={FilePlus2} label="Neue Seite (Ctrl N)" size={30} onClick={() => createSubpage(null)} />
      </div>

      <nav className="nav">
        <NavItem icon={CalendarCheck2} label="Heute" active={isActive("page", { pageId: todayId })} onClick={openToday} />
        <NavItem icon={Timer} label="Zeiterfassung" active={isActive("timesheet")} onClick={() => s().openTab({ kind: "timesheet" })} trailing={<TodayHours />} />
        <NavItem icon={Briefcase} label="Projekte" active={isActive("projects")} onClick={() => s().openTab({ kind: "projects" })} />
        <NavItem
          icon={Sparkles}
          label="Assistent"
          onClick={() => {
            s().set({ panelOpen: true, panelTab: "assistant" });
            savePref("aether.panel", true);
            setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 50);
          }}
        />
      </nav>

      <div className="sidebar-scroll">
        {favorites.length > 0 && (
          <Section title="Favoriten">
            {favorites.map((p) => (
              <button key={p.id} type="button" className={`tree-row depth-0 ${isActive("page", { pageId: p.id }) ? "active" : ""}`} onClick={(e) => s().openPage(p.id, { newTab: e.ctrlKey || e.metaKey })}>
                <span className="tree-twisty" />
                <PageIcon name={p.icon} size={15} className="tree-icon" />
                <span className="tree-label">{p.title}</span>
              </button>
            ))}
          </Section>
        )}
        <Section
          title="Seiten"
          action={<IconButton icon={Plus} label="Neue Seite" size={22} iconSize={14} onClick={() => createSubpage(null)} />}
        >
          <PageTree nodes={tree} activePageId={active?.kind === "page" ? active.pageId : undefined} />
        </Section>
        {tags.length > 0 && (
          <Section title="Tags" collapsible open={tagsOpen} onToggle={() => setTagsOpen((v) => !v)}>
            {tagsOpen &&
              tags.map(([tag, n]) => (
                <button key={tag} type="button" className={`tree-row depth-0 ${isActive("tag", { tag }) ? "active" : ""}`} onClick={() => s().openTab({ kind: "tag", tag })}>
                  <span className="tree-twisty" />
                  <Hash size={14} className="tree-icon" />
                  <span className="tree-label">{tag}</span>
                  <span className="tree-count">{n}</span>
                </button>
              ))}
          </Section>
        )}
      </div>

      <TimerDock />
      <div className="sidebar-foot">
        <NavItem icon={Settings} label="Einstellungen" active={isActive("settings")} onClick={() => s().openTab({ kind: "settings" })} />
      </div>
    </aside>
  );
}

function NavItem({ icon: Icon, label, active, onClick, trailing }: { icon: typeof Timer; label: string; active?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={16} strokeWidth={1.75} />
      <span>{label}</span>
      {trailing}
    </button>
  );
}

function Section({ title, children, action, collapsible, open = true, onToggle }: { title: string; children: React.ReactNode; action?: React.ReactNode; collapsible?: boolean; open?: boolean; onToggle?: () => void }) {
  return (
    <section className="side-section">
      <div className="side-section-head">
        {collapsible ? (
          <button type="button" className="side-section-title" onClick={onToggle} aria-expanded={open}>
            {title}
            <ChevronRight size={12} className={`chev ${open ? "open" : ""}`} />
          </button>
        ) : (
          <span className="side-section-title">{title}</span>
        )}
        {action}
      </div>
      {children}
    </section>
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

function PageTree({ nodes, activePageId }: { nodes: PageNode[]; activePageId?: number }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("aether.collapsed") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [drag, setDrag] = useState<{ id: number; over?: number; pos?: DropPos } | null>(null);
  const [menu, openMenu] = useMenu();
  const s = useApp.getState;

  const toggle = (id: number) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
    localStorage.setItem("aether.collapsed", JSON.stringify([...next]));
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
          onClick={(e) => s().openPage(n.id, { newTab: e.ctrlKey || e.metaKey })}
          onAuxClick={(e) => e.button === 1 && s().openPage(n.id, { newTab: true })}
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "In neuem Tab öffnen", icon: CornerDownRight, onSelect: () => s().openPage(n.id, { newTab: true }) },
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
                  setTimeout(() => document.querySelector<HTMLInputElement>(".page-title")?.select(), 150);
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
