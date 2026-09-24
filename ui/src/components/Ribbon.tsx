// Obsidian-style ribbon: a slim column of global actions left of the sidebar.

import { useRef } from "react";
import { Briefcase, CalendarCheck2, ChevronDown, FilePlus2, Search, ListChecks, PanelLeft, Settings, Sparkles, Timer } from "lucide-react";
import { api } from "../lib/api";
import { useApp, savePref } from "../store/app";
import { IconButton } from "./ui";
import { createSubpage } from "../views/PageView";
import { openCalendar } from "./CalendarPopover";
import { keys } from "../lib/shortcut";

export async function openToday() {
  const s = useApp.getState();
  try {
    const p = await api.dailyNote();
    await s.refreshTree();
    s.openPage(p.id);
  } catch (e) {
    s.error("Tagesnotiz konnte nicht geöffnet werden", e);
  }
}

export function openAssistant() {
  const s = useApp.getState();
  s.set({ panelOpen: true, panelTab: "assistant" });
  savePref("aether.panel", true);
  setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 50);
}

/** „Heutige Tagesnotiz“; right-click, a long press or the small chevron opens the calendar. */
function DailyButton() {
  const wrap = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const show = () => openCalendar(wrap.current, undefined, "right");
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
  };
  return (
    <div className="ribbon-daily" ref={wrap}>
      <IconButton
        icon={CalendarCheck2}
        label={`Heutige Tagesnotiz (${keys("Mod Shift D")}) – Rechtsklick: Kalender`}
        tooltipSide="right"
        size={32}
        iconSize={17}
        onClick={() => {
          if (press.current?.fired) return;
          openToday();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          show();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = { timer: 0, fired: false };
          p.timer = window.setTimeout(() => {
            p.fired = true;
            show();
          }, 500);
          press.current = p;
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
      />
      <button type="button" className="ribbon-chevron" aria-label={`Kalender (${keys("Mod Shift C")})`} data-tooltip={`Kalender (${keys("Mod Shift C")})`} data-tooltip-side="right" onClick={show}>
        <ChevronDown size={11} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

export function Ribbon() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const s = useApp.getState;
  const side = "right" as const;
  return (
    <nav className="ribbon" aria-label="Aktionen">
      {/* macOS: room for the traffic lights; drags the window like a title bar. */}
      <div className="ribbon-titlebar" data-tauri-drag-region />
      <IconButton
        icon={PanelLeft}
        label={`Seitenleiste ${sidebarOpen ? "ausblenden" : "einblenden"} (${keys("Mod \\")})`}
        active={sidebarOpen}
        tooltipSide={side}
        size={32}
        iconSize={17}
        onClick={() => {
          s().set({ sidebarOpen: !sidebarOpen });
          savePref("aether.sidebar", !sidebarOpen);
        }}
      />
      <span className="ribbon-sep" />
      <IconButton icon={FilePlus2} label={`Neue Seite (${keys("Mod N")})`} tooltipSide={side} size={32} iconSize={17} onClick={() => createSubpage(null)} />
      <DailyButton />
      <IconButton icon={Search} label={`Befehlspalette (${keys("Mod K")})`} tooltipSide={side} size={32} iconSize={17} onClick={() => s().set({ paletteOpen: true, paletteMode: "all", paletteQuery: "" })} />
      <span className="ribbon-sep" />
      <IconButton icon={Timer} label="Zeiterfassung" active={tab?.kind === "timesheet"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "timesheet" })} />
      <IconButton icon={ListChecks} label={`Aufgaben (${keys("Mod Shift A")})`} active={tab?.kind === "tasks"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "tasks" })} />
      <IconButton icon={Briefcase} label="Projekte" active={tab?.kind === "projects"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "projects" })} />
      <IconButton icon={Sparkles} label={`Assistent (${keys("Mod J")})`} tooltipSide={side} size={32} iconSize={17} onClick={openAssistant} />
      <span className="grow" />
      <IconButton icon={Settings} label={`Einstellungen (${keys("Mod ,")})`} active={tab?.kind === "settings"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "settings" })} />
    </nav>
  );
}
