import { useEffect } from "react";
import { api, on } from "./lib/api";
import { useApp, savePref } from "./store/app";
import { applyTheme } from "./lib/actions";
import { Sidebar, stopTimer } from "./components/Sidebar";
import { ConfirmHost, Home, StatusBar, TabBar, Toasts } from "./components/Shell";
import { CommandPalette } from "./components/CommandPalette";
import { RightPanel } from "./panels/RightPanel";
import { PageView, createSubpage } from "./views/PageView";
import { TimesheetView } from "./views/TimesheetView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";
import { TagView } from "./views/TagView";
import type { ActivityTick } from "./lib/types";

export function App() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const panelOpen = useApp((s) => s.panelOpen);
  const focus = useApp((s) => s.focusMode);
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    const s = useApp.getState();
    (async () => {
      const [view] = await Promise.all([api.settings(), s.refreshTree(), s.refreshTimer(), api.meter().then((m) => s.set({ meter: m }))]);
      s.set({ settings: view });
      applyTheme(view.settings.theme);
      if (view.settings.open_daily_on_start) {
        const p = await api.dailyNote();
        await s.refreshTree();
        s.openPage(p.id);
      }
      document.body.classList.add("ready");
    })().catch((e) => s.error("Start fehlgeschlagen", e));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => applyTheme(useApp.getState().settings?.settings.theme ?? "system");
    media.addEventListener("change", onMedia);
    const unlisten = [
      on("data://entries", () => useApp.getState().bumpEntries()),
      on<ActivityTick>("activity://tick", (t) => {
        const st = useApp.getState();
        if (st.timer && t.timer_idle_minutes != null && t.timer_idle_minutes !== st.timer.idle_minutes)
          st.set({ timer: { ...st.timer, idle_minutes: t.timer_idle_minutes, is_idle: t.is_idle } });
      }),
      on("palette://toggle", () => {
        const st = useApp.getState();
        st.set({ paletteOpen: !st.paletteOpen, paletteMode: "all", paletteQuery: "" });
      }),
    ];
    return () => {
      media.removeEventListener("change", onMedia);
      unlisten.forEach((u) => u.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && !e.shiftKey && k === "k") run(() => st.set({ paletteOpen: !st.paletteOpen, paletteMode: "all", paletteQuery: "" }));
      else if (e.altKey && e.code === "Space") run(() => st.set({ paletteOpen: !st.paletteOpen, paletteMode: "all", paletteQuery: "" }));
      else if (mod && !e.shiftKey && k === "o") run(() => st.set({ paletteOpen: true, paletteMode: "pages", paletteQuery: "" }));
      else if (mod && !e.shiftKey && k === "n") run(() => createSubpage(null));
      else if (mod && e.shiftKey && k === "d")
        run(async () => {
          const p = await api.dailyNote();
          await st.refreshTree();
          st.openPage(p.id);
        });
      else if (mod && e.shiftKey && k === "t") run(() => (st.timer ? stopTimer() : st.openTab({ kind: "timesheet" })));
      else if (mod && !e.shiftKey && k === "j")
        run(() => {
          st.set({ panelOpen: true, panelTab: "assistant" });
          savePref("aether.panel", true);
          setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 30);
        });
      else if (mod && k === "w") run(() => st.activeTabId && st.closeTab(st.activeTabId));
      else if (mod && e.key === "Tab")
        run(() => {
          const i = st.tabs.findIndex((t) => t.id === st.activeTabId);
          const next = st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length];
          if (next) st.activateTab(next.id);
        });
      else if (mod && e.key === "\\" && !e.shiftKey)
        run(() => {
          st.set({ sidebarOpen: !st.sidebarOpen });
          savePref("aether.sidebar", !st.sidebarOpen);
        });
      else if (mod && (e.key === "|" || (e.shiftKey && e.code === "Backslash")))
        run(() => {
          st.set({ panelOpen: !st.panelOpen });
          savePref("aether.panel", !st.panelOpen);
        });
      else if (mod && e.key === ".") run(() => st.set({ focusMode: !st.focusMode }));
      else if (mod && e.key === ",") run(() => st.openTab({ kind: "settings" }));
      else if (e.key === "Escape" && st.focusMode && !st.paletteOpen) st.set({ focusMode: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cls = ["app", sidebarOpen && !focus ? "" : "no-sidebar", panelOpen && !focus ? "" : "no-panel", focus ? "focus" : ""].join(" ");
  return (
    <div className={cls}>
      {sidebarOpen && !focus && <Sidebar />}
      <main className="main">
        {!focus && <TabBar />}
        <div className="content" key={active?.id ?? "home"}>
          {!active && <Home />}
          {active?.kind === "page" && <PageView pageId={active.pageId!} />}
          {active?.kind === "timesheet" && <TimesheetView />}
          {active?.kind === "projects" && <ProjectsView />}
          {active?.kind === "settings" && <SettingsView />}
          {active?.kind === "tag" && <TagView tag={active.tag!} />}
        </div>
        <StatusBar />
      </main>
      {panelOpen && !focus && <RightPanel />}
      <CommandPalette />
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
