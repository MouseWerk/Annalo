// Tab bar, status bar, start screen, toasts and the confirm dialog host.

import { useEffect, useState } from "react";
import {
  AlertTriangle, Briefcase, Home as HomeIcon, CalendarCheck2, CheckCircle2, Cpu, FilePlus2, Hash, Info, Link2, Play, Search, Settings, Timer, Trash2, X, XCircle, ListChecks,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp, type Tab } from "../store/app";
import { PageIcon } from "./icons";
import { Button, Dialog, IconButton } from "./ui";
import { clock, h1, relative, usd } from "../lib/format";
import { useTimerSeconds, stopTimer } from "./Sidebar";
import { createSubpage } from "../views/PageView";
import { Onboarding } from "./Onboarding";
import { AetherLogo } from "./Logo";
import { UpdateToast } from "./Updates";
import type { Page } from "../lib/types";

export function tabTitle(t: Tab, pages: Map<number, { title: string }>) {
  switch (t.kind) {
    case "home":
      return "Neuer Tab";
    case "page":
      return pages.get(t.pageId!)?.title ?? "Seite";
    case "timesheet":
      return "Zeiterfassung";
    case "projects":
      return "Projekte";
    case "settings":
      return "Einstellungen";
    case "tag":
      return `#${t.tag}`;
    case "trash":
      return "Papierkorb";
    case "tasks":
      return "Aufgaben";
  }
}

export function TabIcon({ t }: { t: Tab }) {
  const pages = useApp((s) => s.pages);
  switch (t.kind) {
    case "home":
      return <HomeIcon size={14} strokeWidth={1.75} />;
    case "page":
      return <PageIcon name={pages.get(t.pageId!)?.icon} size={14} />;
    case "timesheet":
      return <Timer size={14} strokeWidth={1.75} />;
    case "projects":
      return <Briefcase size={14} strokeWidth={1.75} />;
    case "settings":
      return <Settings size={14} strokeWidth={1.75} />;
    case "tag":
      return <Hash size={14} strokeWidth={1.75} />;
    case "trash":
      return <Trash2 size={14} strokeWidth={1.75} />;
    case "tasks":
      return <ListChecks size={14} strokeWidth={1.75} />;
  }
}

export function StatusBar() {
  const timer = useApp((s) => s.timer);
  const meter = useApp((s) => s.meter);
  const settings = useApp((s) => s.settings);
  const seconds = useTimerSeconds();
  const s = useApp.getState;
  const configured = !!settings?.api_key_set;
  const onPage = useApp((st) => st.tabs.find((t) => t.id === st.activeTabId)?.kind === "page");
  const stats = useApp((st) => st.editorStats);
  const doc = useApp((st) => st.activeDoc);
  const focusMode = useApp((st) => st.focusMode);
  return (
    <footer className="statusbar">
      {timer ? (
        <button type="button" className="sb-item sb-timer" onClick={() => stopTimer()} title="Timer stoppen">
          <span className="rec-dot" aria-hidden />
          <span className="num">{clock(seconds)}</span>
          <span className="faint">{timer.entry.vorgang_nr ? `${timer.entry.vorgang_nr}` : ""}</span>
          {timer.idle_minutes > 0 && <span className="sb-warn">{timer.idle_minutes} Min. inaktiv</span>}
        </button>
      ) : (
        <button type="button" className="sb-item" onClick={() => s().openTab({ kind: "timesheet" })}>
          <Play size={12} /> Timer starten
        </button>
      )}
      <span className="sb-spacer" />
      {focusMode && (
        <button type="button" className="sb-item" onClick={() => s().set({ focusMode: false })} title="Fokusmodus beenden">
          Fokusmodus <kbd>Esc</kbd>
        </button>
      )}
      {onPage && doc && (
        <button type="button" className="sb-item" onClick={() => s().set({ panelOpen: true, panelTab: "links" })} title="Rückverweise anzeigen">
          <Link2 size={12} />
          <span className="num">{doc.backlinks.length}</span>
        </button>
      )}
      {onPage && stats && (
        <span className="sb-item sb-static num" title={`${stats.chars.toLocaleString("de-DE")} Zeichen`}>
          {stats.words.toLocaleString("de-DE")} {stats.words === 1 ? "Wort" : "Wörter"}
        </span>
      )}
      <button type="button" className="sb-item" onClick={() => s().set({ panelOpen: true, panelTab: "assistant" })} title="KI-Sitzung">
        <Cpu size={12} />
        {meter && meter.requests > 0 ? (
          <>
            <span className="num">{meter.last_tokens_per_second != null ? `${h1(meter.last_tokens_per_second)} t/s` : "–"}</span>
            <span className="faint num">{(meter.prompt_tokens + meter.completion_tokens).toLocaleString("de-DE")} Tokens</span>
            <span className="faint num">{usd(meter.cost_usd)}</span>
          </>
        ) : (
          <span className="faint">{configured ? settings?.settings.router.standard_model : "KI einrichten"}</span>
        )}
      </button>
    </footer>
  );
}

export function Home() {
  const onboarding = useApp((st) => st.onboarding);
  const empty = useApp((st) => st.tree.length === 0);
  // Something imported or created meanwhile (e.g. via Settings): the choice is moot.
  return onboarding && empty ? <Onboarding /> : <StartPage />;
}

function StartPage() {
  const [recent, setRecent] = useState<Page[]>([]);
  const s = useApp.getState;
  useEffect(() => {
    api.recentPages(8).then(setRecent).catch(() => {});
  }, []);
  const openToday = async () => {
    const p = await api.dailyNote();
    await s().refreshTree();
    s().openPage(p.id);
  };
  const actions = [
    { icon: CalendarCheck2, label: "Heute", hint: "Ctrl Shift D", run: openToday },
    { icon: FilePlus2, label: "Neue Seite", hint: "Ctrl N", run: () => createSubpage(null) },
    { icon: Search, label: "Suchen", hint: "Ctrl K", run: () => s().set({ paletteOpen: true, paletteMode: "all", paletteQuery: "" }) },
    { icon: ListChecks, label: "Aufgaben", hint: "Ctrl Shift A", run: () => s().openTab({ kind: "tasks" }) },
    { icon: Timer, label: "Zeiterfassung", hint: "Woche und Timer", run: () => s().openTab({ kind: "timesheet" }) },
  ];
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  return (
    <div className="home">
      <div className="home-inner">
        <AetherLogo size={34} className="home-logo" />
        <h1>{greeting}</h1>
        <p className="muted">
          {new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <div className="home-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="home-action" onClick={a.run}>
              <a.icon size={18} strokeWidth={1.75} />
              <span className="home-action-label">{a.label}</span>
              <span className="home-action-hint">{a.hint}</span>
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <>
            <h2>Zuletzt bearbeitet</h2>
            <div className="home-recent">
              {recent.map((p) => (
                <button key={p.id} type="button" className="home-recent-item" onClick={() => s().openPage(p.id)}>
                  <PageIcon name={p.icon} size={15} />
                  <span className="grow">{p.title}</span>
                  <span className="faint">{relative(p.updated_at)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
  return (
    <div className="toasts" aria-live="polite">
      <UpdateToast />
      {toasts.map((t) => {
        const Icon = icon[t.tone];
        return (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "danger" ? "alert" : "status"}>
            <Icon size={16} className="toast-icon" />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            {t.action && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </Button>
            )}
            <IconButton icon={X} label="Schließen" size={22} iconSize={13} onClick={() => dismiss(t.id)} />
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmHost() {
  const req = useApp((s) => s.confirmRequest);
  if (!req) return null;
  return (
    <Dialog
      open
      onClose={() => req.resolve("cancel")}
      title={req.title}
      width={req.altLabel ? 480 : 420}
      footer={
        <>
          <Button variant="ghost" onClick={() => req.resolve("cancel")}>
            {req.cancelLabel ?? "Abbrechen"}
          </Button>
          {req.altLabel && <Button onClick={() => req.resolve("alt")}>{req.altLabel}</Button>}
          <Button variant={req.danger ? "danger" : "primary"} onClick={() => req.resolve("confirm")} data-autofocus>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="dialog-text">{req.message}</p>
    </Dialog>
  );
}
