// Global UI state: tabs, panels, cached workspace data, timer and toasts.

import { create } from "zustand";
import { api, errorText } from "../lib/api";
import type { BudgetStatus, PageDoc, PageNode, SessionMeter, SettingsView, TimerStatus } from "../lib/types";

export type TabKind = "page" | "timesheet" | "projects" | "settings" | "tag";
export interface Tab {
  id: string;
  kind: TabKind;
  pageId?: number;
  tag?: string;
}
export type PanelTab = "assistant" | "outline" | "links";

export interface Toast {
  id: number;
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface State {
  confirmRequest: ConfirmRequest | null;
  confirm: (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  tabs: Tab[];
  activeTabId: string;
  tree: PageNode[];
  pages: Map<number, PageNode>;
  sidebarOpen: boolean;
  panelOpen: boolean;
  panelTab: PanelTab;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteMode: "all" | "pages";
  timer: TimerStatus | null;
  meter: SessionMeter | null;
  settings: SettingsView | null;
  /** Bumped whenever time entries change so views can refetch. */
  entriesVersion: number;
  /** Bumped whenever the WBS (projects, Netzpläne, Vorgänge) changes. */
  wbsVersion: number;
  /** The document shown in the active page tab (outline and backlinks read it). */
  activeDoc: PageDoc | null;
  /** Headings of the active editor for the outline panel. */
  outline: { level: number; text: string; pos: number }[];
  scrollToPos: ((pos: number) => void) | null;
  toasts: Toast[];
  focusMode: boolean;

  openTab: (tab: Omit<Tab, "id">, opts?: { newTab?: boolean }) => void;
  openPage: (pageId: number, opts?: { newTab?: boolean }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  refreshTree: () => Promise<void>;
  refreshTimer: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  bumpEntries: () => void;
  bumpWbs: () => void;
  set: (patch: Partial<State>) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  error: (title: string, e: unknown) => void;
  alerts: (alerts: BudgetStatus[]) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function loadTabs(): { tabs: Tab[]; active: string } {
  try {
    const raw = JSON.parse(localStorage.getItem("aether.tabs") ?? "null");
    if (raw?.tabs?.length) return { tabs: raw.tabs, active: raw.active ?? raw.tabs[0].id };
  } catch {
    /* ignore */
  }
  return { tabs: [], active: "" };
}
function saveTabs(tabs: Tab[], active: string) {
  try {
    localStorage.setItem("aether.tabs", JSON.stringify({ tabs, active }));
  } catch {
    /* ignore */
  }
}
function pref(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
export function savePref(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const initial = loadTabs();
let toastSeq = 0;

export const useApp = create<State>((set, get) => ({
  confirmRequest: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) =>
      set({
        confirmRequest: {
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "Bestätigen",
          danger: opts.danger ?? false,
          resolve: (ok) => {
            set({ confirmRequest: null });
            resolve(ok);
          },
        },
      }),
    ),
  tabs: initial.tabs,
  activeTabId: initial.active,
  tree: [],
  pages: new Map(),
  sidebarOpen: pref("aether.sidebar", true),
  panelOpen: pref("aether.panel", true),
  panelTab: "assistant",
  paletteOpen: false,
  paletteQuery: "",
  paletteMode: "all",
  timer: null,
  meter: null,
  settings: null,
  entriesVersion: 0,
  wbsVersion: 0,
  activeDoc: null,
  outline: [],
  scrollToPos: null,
  toasts: [],
  focusMode: false,

  openTab: (spec, opts) => {
    const { tabs, activeTabId } = get();
    const same = (t: Tab) => t.kind === spec.kind && t.pageId === spec.pageId && t.tag === spec.tag;
    const existing = tabs.find(same);
    if (existing) {
      set({ activeTabId: existing.id });
      saveTabs(tabs, existing.id);
      return;
    }
    const tab: Tab = { ...spec, id: uid() };
    let next: Tab[];
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (opts?.newTab || idx < 0) next = [...tabs.slice(0, idx + 1), tab, ...tabs.slice(idx + 1)];
    else next = tabs.map((t, i) => (i === idx ? tab : t));
    set({ tabs: next, activeTabId: tab.id });
    saveTabs(next, tab.id);
  },
  openPage: (pageId, opts) => get().openTab({ kind: "page", pageId }, opts),
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    const active = id === activeTabId ? (next[Math.min(idx, next.length - 1)]?.id ?? "") : activeTabId;
    set({ tabs: next, activeTabId: active });
    saveTabs(next, active);
  },
  activateTab: (id) => {
    set({ activeTabId: id });
    saveTabs(get().tabs, id);
  },
  refreshTree: async () => {
    const tree = await api.tree();
    const pages = new Map<number, PageNode>();
    const walk = (list: PageNode[]) => list.forEach((p) => (pages.set(p.id, p), walk(p.children)));
    walk(tree);
    // Drop tabs of deleted pages.
    const tabs = get().tabs.filter((t) => t.kind !== "page" || pages.has(t.pageId!));
    const active = tabs.some((t) => t.id === get().activeTabId) ? get().activeTabId : (tabs[0]?.id ?? "");
    set({ tree, pages, tabs, activeTabId: active });
    saveTabs(tabs, active);
  },
  refreshTimer: async () => set({ timer: await api.timerStatus() }),
  refreshSettings: async () => set({ settings: await api.settings() }),
  bumpEntries: () => {
    set({ entriesVersion: get().entriesVersion + 1 });
    get().refreshTimer();
  },
  bumpWbs: () => set({ wbsVersion: get().wbsVersion + 1 }),
  set: (patch) => set(patch),
  toast: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismissToast(id), t.tone === "danger" ? 8000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  error: (title, e) => get().toast({ tone: "danger", title, detail: errorText(e) }),
  alerts: (alerts) => {
    for (const a of alerts) {
      const pct = Math.round(a.consumed * 100);
      const title =
        a.level === "exceeded" ? `Budget überschritten: ${a.label}` : a.level === "critical" ? `Budget kritisch: ${a.label}` : `Budget-Warnung: ${a.label}`;
      get().toast({
        tone: a.level === "warning" ? "warning" : "danger",
        title,
        detail: `${a.booked_hours.toFixed(1).replace(".", ",")} von ${a.planned_hours.toFixed(1).replace(".", ",")} h gebucht (${pct} %), Restaufwand ${a.etc_hours.toFixed(1).replace(".", ",")} h`,
      });
    }
  },
}));

export const activeTab = () => {
  const s = useApp.getState();
  return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
};
