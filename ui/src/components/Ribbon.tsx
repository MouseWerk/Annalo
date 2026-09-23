// Obsidian-style ribbon: a slim column of global actions left of the sidebar.

import { Briefcase, CalendarCheck2, FilePlus2, Search, ListChecks, PanelLeft, Settings, Sparkles, Timer } from "lucide-react";
import { api } from "../lib/api";
import { useApp, savePref } from "../store/app";
import { IconButton } from "./ui";
import { createSubpage } from "../views/PageView";

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

export function Ribbon() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const s = useApp.getState;
  const side = "right" as const;
  return (
    <nav className="ribbon" aria-label="Aktionen">
      <IconButton
        icon={PanelLeft}
        label={sidebarOpen ? "Seitenleiste ausblenden (Ctrl \\)" : "Seitenleiste einblenden (Ctrl \\)"}
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
      <IconButton icon={FilePlus2} label="Neue Seite (Ctrl N)" tooltipSide={side} size={32} iconSize={17} onClick={() => createSubpage(null)} />
      <IconButton icon={CalendarCheck2} label="Heutige Tagesnotiz (Ctrl Shift D)" tooltipSide={side} size={32} iconSize={17} onClick={openToday} />
      <IconButton icon={Search} label="Befehlspalette (Ctrl K)" tooltipSide={side} size={32} iconSize={17} onClick={() => s().set({ paletteOpen: true, paletteMode: "all", paletteQuery: "" })} />
      <span className="ribbon-sep" />
      <IconButton icon={Timer} label="Zeiterfassung" active={tab?.kind === "timesheet"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "timesheet" })} />
      <IconButton icon={ListChecks} label="Aufgaben (Ctrl Shift A)" active={tab?.kind === "tasks"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "tasks" })} />
      <IconButton icon={Briefcase} label="Projekte" active={tab?.kind === "projects"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "projects" })} />
      <IconButton icon={Sparkles} label="Assistent (Ctrl J)" tooltipSide={side} size={32} iconSize={17} onClick={openAssistant} />
      <span className="grow" />
      <IconButton icon={Settings} label="Einstellungen (Ctrl ,)" active={tab?.kind === "settings"} tooltipSide={side} size={32} iconSize={17} onClick={() => s().openTab({ kind: "settings" })} />
    </nav>
  );
}
