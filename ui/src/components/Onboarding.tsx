// First start: choose between sample data, an empty workspace and an Obsidian import.

import { useState } from "react";
import { FolderInput, LayoutDashboard, Server, Sparkles, SquareDashed } from "lucide-react";
import { api } from "../lib/api";
import { importVault } from "../lib/actions";
import { useApp } from "../store/app";

export function Onboarding() {
  const [busy, setBusy] = useState(false);
  const s = useApp.getState;
  const finish = async (samples: boolean) => {
    setBusy(true);
    try {
      await api.finishOnboarding(samples);
      await s().refreshTree();
      s().bumpWbs();
      s().set({ onboarding: false });
      if (samples) {
        const welcome = [...s().pages.values()].find((p) => p.title === "Willkommen");
        if (welcome) s().openPage(welcome.id);
      }
    } catch (e) {
      s().error("Start fehlgeschlagen", e);
    } finally {
      setBusy(false);
    }
  };
  const choices = [
    {
      icon: SquareDashed,
      title: "Leer starten",
      text: "Ein leerer Arbeitsbereich für deine eigenen Notizen und Projekte.",
      run: () => finish(false),
    },
    {
      icon: FolderInput,
      title: "Obsidian-Vault importieren",
      text: "Ordner, [[Links]], #Tags, Eigenschaften und Bilder werden übernommen.",
      run: async () => {
        await finish(false);
        await importVault();
      },
    },
    {
      icon: LayoutDashboard,
      title: "Mit Beispieldaten erkunden",
      text: "Ein Beispielprojekt mit Netzplänen, Buchungen und Notizen. Lässt sich später in den Einstellungen entfernen.",
      run: () => finish(true),
    },
  ];
  return (
    <div className="home">
      <div className="home-inner onboarding">
        <div className="onb-mark" aria-hidden>
          <Sparkles size={22} strokeWidth={1.75} />
        </div>
        <h1>Willkommen bei AETHER OS</h1>
        <p className="muted">Notizen, Projekte und Zeiterfassung an einem Ort. Wie möchtest du beginnen?</p>
        <div className="onb-choices">
          {choices.map((c) => (
            <button key={c.title} type="button" className="onb-choice" disabled={busy} onClick={c.run}>
              <c.icon size={20} strokeWidth={1.75} />
              <span className="onb-title">{c.title}</span>
              <span className="onb-text">{c.text}</span>
            </button>
          ))}
        </div>
        <button type="button" className="onb-server" onClick={() => s().openTab({ kind: "settings" })}>
          <Server size={14} strokeWidth={1.75} /> KI-Server (LiteLLM) jetzt einrichten
        </button>
      </div>
    </div>
  );
}
