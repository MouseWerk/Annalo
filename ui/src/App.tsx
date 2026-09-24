import { useEffect, useRef, useState } from "react";
import { api, on } from "./lib/api";
import { useApp, savePref } from "./store/app";
import { applyTheme } from "./lib/actions";
import { Sidebar, stopTimer } from "./components/Sidebar";
import { ConfirmHost, StatusBar, Toasts } from "./components/Shell";
import { TemplateHost } from "./components/Templates";
import { Ribbon, openAssistant, openToday } from "./components/Ribbon";
import { Workspace } from "./components/Workspace";
import { Resizer, readSize } from "./components/Resizer";
import { LinkPreview } from "./components/LinkPreview";
import { CommandPalette } from "./components/CommandPalette";
import { CalendarPopover, openCalendar } from "./components/CalendarPopover";
import { RightPanel } from "./panels/RightPanel";
import { createSubpage } from "./views/PageView";
import { requestAddProperty } from "./views/PageProperties";
import { flushAllEditors, reloadEditors } from "./editor/NoteEditor";
import type { ActivityTick } from "./lib/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tabTitle } from "./components/Shell";

/** Stores pending edits before the app goes away; false when the user chose to stay. */
async function flushBeforeExit(): Promise<boolean> {
  try {
    await Promise.race([flushAllEditors(), new Promise((_, fail) => setTimeout(() => fail(new Error("Zeitüberschreitung")), 5000))]);
    return true;
  } catch {
    // Quitting from the tray: the window may be hidden, but the question needs an answer.
    const win = getCurrentWindow();
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
    return useApp.getState().confirm({
      title: "Nicht gespeicherte Änderungen",
      message: "Einige Änderungen konnten nicht gespeichert werden. Trotzdem schließen? Sie gehen dann verloren.",
      confirmLabel: "Trotzdem schließen",
      danger: true,
    });
  }
}

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
      if (await api.onboardingNeeded().catch(() => false)) s.set({ onboarding: true });
      else if (view.settings.open_daily_on_start) {
        const p = await api.dailyNote();
        await s.refreshTree();
        s.openPage(p.id);
      }
      document.body.classList.add("ready");
    })().catch((e) => s.error("Start fehlgeschlagen", e));
    // SQLite in a sync client's or a network folder can be corrupted: warn until dismissed.
    api
      .dataDirStatus()
      .then((d) => {
        // A move at startup, or a chosen folder that is not reachable (fallback to the default).
        const n = d.notice;
        if (n?.kind === "info") s.toast({ tone: "success", title: "Speicherort geändert", detail: n.message });
        else if (n?.kind === "warning") s.toast({ tone: "warning", persistent: true, title: "Datenordner nicht verfügbar", detail: n.message });
        else if (n?.kind === "error") s.toast({ tone: "danger", persistent: true, title: "Daten nicht verschoben", detail: n.message });
        if (d.synced) s.toast({ tone: "warning", persistent: true, title: "Datenbank im synchronisierten Ordner", detail: `Die Datenbank liegt in einem synchronisierten/Netzwerkordner – das kann sie beschädigen. Sicherungen dorthin sind unbedenklich. (${d.data_dir})` });
      })
      .catch(() => {});

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => applyTheme(useApp.getState().settings?.settings.theme ?? "system");
    media.addEventListener("change", onMedia);
    const unlisten = [
      on("data://entries", () => useApp.getState().bumpEntries()),
      on<string>("backup://failed", (msg) => useApp.getState().toast({ tone: "warning", title: "Automatische Sicherung fehlgeschlagen", detail: msg })),
      // A task was toggled outside the editor: open editors of that page take over the new Markdown.
      on<number>("data://tasks", (pageId) => reloadEditors([pageId])),
      on<ActivityTick>("activity://tick", (t) => {
        const st = useApp.getState();
        if (st.timer && t.timer_idle_minutes != null && t.timer_idle_minutes !== st.timer.idle_minutes)
          st.set({ timer: { ...st.timer, idle_minutes: t.timer_idle_minutes, is_idle: t.is_idle } });
      }),
      // Tray „Beenden“: store edits, then quit for real.
      on("app://quit-requested", async () => {
        if (await flushBeforeExit()) await api.quit().catch((e) => useApp.getState().error("Beenden fehlgeschlagen", e));
      }),
      on("tray://timer-stop", () => stopTimer()),
      // Clicked the end-of-day reminder (or came back after it).
      on("nav://timesheet", () => useApp.getState().openTab({ kind: "timesheet" })),
      // Global palette shortcut: toggles while the window is in front, otherwise always opens.
      on<boolean>("palette://toggle", (foreground) => {
        const st = useApp.getState();
        st.set({ paletteOpen: foreground ? !st.paletteOpen : true, paletteMode: "all", paletteQuery: "" });
      }),
    ];
    return () => {
      media.removeEventListener("change", onMedia);
      unlisten.forEach((u) => u.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // AltGr arrives as Ctrl+Alt on Windows; it types characters like \ | [ ] @ on German keyboards.
      if (e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey)) return;
      const st = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && !e.shiftKey && k === "k") run(() => st.set({ paletteOpen: !st.paletteOpen, paletteMode: "all", paletteQuery: "" }));
      else if (mod && !e.shiftKey && k === "o") run(() => st.set({ paletteOpen: true, paletteMode: "pages", paletteQuery: "" }));
      else if (mod && !e.shiftKey && k === "n") run(() => createSubpage(null));
      else if (mod && e.shiftKey && k === "d") run(() => openToday());
      else if (mod && e.shiftKey && k === "a") run(() => st.openTab({ kind: "tasks" }));
      else if (mod && e.shiftKey && k === "c") run(() => (st.calendar ? st.set({ calendar: null }) : openCalendar()));
      else if (mod && e.shiftKey && k === "f")
        run(() => {
          if (!st.sidebarOpen) {
            st.set({ sidebarOpen: true });
            savePref("aether.sidebar", true);
          }
          setTimeout(() => window.dispatchEvent(new Event("aether:sidebar-search")), 0);
        });
      else if (mod && !e.shiftKey && k === "t") run(() => st.openTab({ kind: "home" }, { newTab: true }));
      else if (e.altKey && !mod && e.key === "ArrowLeft") run(() => st.goBack());
      else if (e.altKey && !mod && e.key === "ArrowRight") run(() => st.goForward());
      else if (mod && e.shiftKey && k === "t") run(() => (st.timer ? stopTimer() : st.openTab({ kind: "timesheet" })));
      // The editor takes Ctrl+J on a selection (inline AI) and marks the event handled.
      else if (mod && !e.shiftKey && k === "j") {
        if (!e.defaultPrevented) run(() => openAssistant());
      }
      else if (mod && k === "w") run(() => st.activeTabId && st.closeTab(st.activeTabId));
      else if (mod && e.key === "Tab")
        run(() => {
          const i = st.tabs.findIndex((t) => t.id === st.activeTabId);
          const next = st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length];
          if (next) st.activateTab(next.id);
        });
      else if (mod && e.code === "Backslash" && !e.shiftKey)
        run(() => {
          st.set({ sidebarOpen: !st.sidebarOpen });
          savePref("aether.sidebar", !st.sidebarOpen);
        });
      else if (mod && e.shiftKey && e.code === "Backslash")
        run(() => {
          st.set({ panelOpen: !st.panelOpen });
          savePref("aether.panel", !st.panelOpen);
        });
      else if (mod && e.key === ";") run(() => requestAddProperty());
      else if (mod && e.key === ".") run(() => st.set({ focusMode: !st.focusMode }));
      else if (mod && e.key === ",") run(() => st.openTab({ kind: "settings" }));
      else if (e.key === "Escape" && st.focusMode && !st.paletteOpen) st.set({ focusMode: false });
    };
    // Mouse back/forward buttons.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) (e.preventDefault(), useApp.getState().goBack());
      else if (e.button === 4) (e.preventDefault(), useApp.getState().goForward());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, []);

  // Store pending edits before the window closes.
  useEffect(() => {
    const win = getCurrentWindow();
    let closing = false;
    const unlisten = win
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (closing) return;
        closing = true;
        // Close to tray: the app keeps running, so unsaved edits stay in the editors.
        if (useApp.getState().settings?.settings.close_to_tray) {
          await flushAllEditors().catch(() => {});
          await api.hideWindow().catch((err) => useApp.getState().error("Fenster konnte nicht ausgeblendet werden", err));
          closing = false;
          return;
        }
        if (!(await flushBeforeExit())) {
          closing = false;
          return;
        }
        // Needs core:window:allow-destroy.
        await win.destroy().catch((err) => {
          closing = false;
          useApp.getState().error("Fenster konnte nicht geschlossen werden", err);
        });
      })
      .catch(() => null);
    return () => {
      unlisten.then((f) => f?.());
    };
  }, []);

  // Window title follows the active tab.
  const pages = useApp((s) => s.pages);
  useEffect(() => {
    const title = active ? `${tabTitle(active, pages)} – AETHER OS` : "AETHER OS";
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [active, pages]);

  const [sideW, setSideW] = useState(() => readSize("aether.sidebar-w", 264));
  const [panelW, setPanelW] = useState(() => readSize("aether.panel-w", 360));
  const dragStart = useRef(0);
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  const persist = (key: string, v: number) => {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* ignore */
    }
  };

  const showSidebar = sidebarOpen && !focus;
  // The welcome choice fills the window: no assistant/outline panel next to it.
  const onboardingShown = useApp((st) => st.onboarding && st.tree.length === 0 && (st.tabs.find((t) => t.id === st.activeTabId)?.kind ?? "home") === "home");
  const showPanel = panelOpen && !focus && !onboardingShown;
  const style = { "--sidebar-w": `${sideW}px`, "--panel-w": `${panelW}px` } as React.CSSProperties;
  return (
    <div className={`app ${focus ? "focus" : ""}`} style={style}>
      {!focus && <Ribbon />}
      {showSidebar && (
        <>
          <Sidebar />
          <Resizer
            label="Seitenleiste"
            className="side-resizer"
            onResize={(dx) => {
              if (!dragStart.current) dragStart.current = sideW;
              setSideW(clamp(dragStart.current + dx, 200, 480));
            }}
            onEnd={() => {
              dragStart.current = 0;
              persist("aether.sidebar-w", sideW);
            }}
            onReset={() => (setSideW(264), persist("aether.sidebar-w", 264))}
          />
        </>
      )}
      <main className="main">
        <Workspace />
        <StatusBar />
      </main>
      {showPanel && (
        <>
          <Resizer
            label="Seitenpanel"
            className="panel-resizer"
            onResize={(dx) => {
              if (!dragStart.current) dragStart.current = panelW;
              setPanelW(clamp(dragStart.current - dx, 280, 640));
            }}
            onEnd={() => {
              dragStart.current = 0;
              persist("aether.panel-w", panelW);
            }}
            onReset={() => (setPanelW(360), persist("aether.panel-w", 360))}
          />
          <RightPanel />
        </>
      )}
      <CommandPalette />
      <LinkPreview />
      <CalendarPopover />
      <Toasts />
      <ConfirmHost />
      <TemplateHost />
    </div>
  );
}
