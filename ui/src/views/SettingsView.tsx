// Settings: LiteLLM server + token, models and routing; time tracking;
// notes (vault import/export); backups; appearance; about.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, DatabaseBackup, Monitor, Eye, EyeOff, FolderInput, FolderOpen, FolderOutput, KeyRound, Loader2, Palette, Plus, RefreshCw, Server, Sparkles, Timer, Trash2, NotebookPen, Info, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { applyTheme, exportVault, importVault, pickFolder } from "../lib/actions";
import { flushAllEditors } from "../editor/NoteEditor";
import { fileSize, relative } from "../lib/format";
import { Badge, Button, Field, IconButton, Input, Segmented, Select, Switch, TextArea } from "../components/ui";
import { recordShortcut } from "../lib/shortcut";
import type { BackupInfo, ConnectionTest, DesktopInfo, Page, Settings } from "../lib/types";

type Section = "ai" | "time" | "notes" | "backup" | "desktop" | "appearance" | "about";
const SECTIONS: { id: Section; label: string; icon: typeof Server }[] = [
  { id: "ai", label: "KI & LiteLLM", icon: Sparkles },
  { id: "time", label: "Zeiterfassung", icon: Timer },
  { id: "notes", label: "Notizen", icon: NotebookPen },
  { id: "backup", label: "Sicherung", icon: DatabaseBackup },
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "appearance", label: "Darstellung", icon: Palette },
  { id: "about", label: "Über", icon: Info },
];

export function SettingsView() {
  const view = useApp((s) => s.settings);
  const [section, setSection] = useState<Section>("ai");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const s = useApp.getState;

  useEffect(() => {
    if (!view) s().refreshSettings();
    else setDraft(structuredClone(view.settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const dirty = useMemo(() => !!view && !!draft && JSON.stringify(view.settings) !== JSON.stringify(draft), [view, draft]);
  if (!view || !draft) return null;

  const update = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const save = async (next = draft) => {
    if (next.thresholds.warning >= next.thresholds.critical)
      return s().toast({ tone: "warning", title: "Nicht gespeichert", detail: "Die Warnschwelle muss unter der kritischen Schwelle liegen." });
    setSaving(true);
    try {
      const saved = await api.saveSettings(next);
      s().set({ settings: saved });
      applyTheme(saved.settings.theme);
      s().toast({ tone: "success", title: "Einstellungen gespeichert" });
    } catch (e) {
      s().error("Speichern fehlgeschlagen", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Einstellungen">
        <div className="settings-nav-title">Einstellungen</div>
        {SECTIONS.map((x) => (
          <button key={x.id} type="button" className={`settings-nav-item ${section === x.id ? "active" : ""}`} onClick={() => setSection(x.id)}>
            <x.icon size={15} strokeWidth={1.75} />
            {x.label}
          </button>
        ))}
      </nav>
      <div className="settings-scroll">
        <div className="settings-body">
          {section === "ai" && <AiSection draft={draft} update={update} />}
          {section === "time" && <TimeSection draft={draft} update={update} />}
          {section === "notes" && <NotesSection draft={draft} update={update} />}
          {section === "backup" && (
            <BackupSection
              draft={draft}
              update={(p) => {
                const next = { ...draft, ...p };
                setDraft(next);
                save(next);
              }}
            />
          )}
          {section === "desktop" && <DesktopSection draft={draft} update={update} />}
          {section === "appearance" && (
            <AppearanceSection
              draft={draft}
              update={(p) => {
                const next = { ...draft, ...p };
                setDraft(next);
                save(next);
              }}
            />
          )}
          {section === "about" && <AboutSection />}
        </div>
        {dirty && (
          <div className="savebar" role="region" aria-label="Ungespeicherte Änderungen">
            <span>Ungespeicherte Änderungen</span>
            <Button variant="ghost" onClick={() => setDraft(structuredClone(view.settings))}>
              Verwerfen
            </Button>
            <Button variant="primary" onClick={() => save()} loading={saving}>
              Speichern
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="set-group">
      <div className="set-group-head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="set-group-body">{children}</div>
    </section>
  );
}

function Row({ label, description, children, stack }: { label: string; description?: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row ${stack ? "stack" : ""}`}>
      <div className="set-row-text">
        <div className="set-row-label">{label}</div>
        {description && <div className="set-row-desc">{description}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

// -------------------------------------------------------------------- AI

function AiSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  const view = useApp((s) => s.settings)!;
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);
  const s = useApp.getState;
  const models = test?.ok ? test.models : [];

  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api.testConnection(draft.litellm_base_url, key || null));
    } catch (e) {
      setTest({ ok: false, latency_ms: 0, models: [], error: String(e) });
    } finally {
      setTesting(false);
    }
  };
  useEffect(() => {
    runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async (value: string | null) => {
    try {
      const v = await api.setApiKey(value);
      s().set({ settings: v });
      setKey("");
      s().toast({ tone: "success", title: value ? "API-Token gespeichert" : "API-Token entfernt", detail: v.api_key_storage });
      runTest();
    } catch (e) {
      s().error("Token konnte nicht gespeichert werden", e);
    }
  };

  const router = draft.router;
  const setRouter = (p: Partial<Settings["router"]>) => update({ router: { ...router, ...p } });

  return (
    <>
      <header className="settings-head">
        <h1>KI & LiteLLM</h1>
        <p>AETHER OS spricht mit deinem LiteLLM-Server. Lokale Modelle (Ollama, vLLM) und Cloud-Modelle werden dort konfiguriert.</p>
      </header>

      <Group title="Server" description="Adresse deines LiteLLM-Proxys und der Zugangstoken (Virtual Key oder Master Key).">
        <Row stack label="Server-URL" description="z. B. https://llm.firma.de oder http://localhost:4000">
          <Input value={draft.litellm_base_url} onChange={(e) => update({ litellm_base_url: e.target.value })} placeholder="https://" aria-label="Server-URL" className="grow" />
        </Row>
        <Row
          stack
          label="API-Token"
          description={
            <>
              {view.api_key_set ? <Badge tone="success">Hinterlegt</Badge> : <Badge>Nicht gesetzt</Badge>}
              <span>Sicher gespeichert in: {view.api_key_storage}</span>
            </>
          }
        >
          <div className="key-input">
            <KeyRound size={14} className="faint" />
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={view.api_key_set ? "Neuen Token eingeben, um ihn zu ersetzen" : "sk-…"}
              aria-label="API-Token"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && saveKey(key.trim())}
            />
            <IconButton icon={showKey ? EyeOff : Eye} label={showKey ? "Verbergen" : "Anzeigen"} size={24} iconSize={14} onClick={() => setShowKey(!showKey)} />
          </div>
          <Button variant="primary" onClick={() => saveKey(key.trim())} disabled={!key.trim()}>
            Speichern
          </Button>
          {view.api_key_set && <IconButton icon={Trash2} label="Token entfernen" onClick={() => saveKey(null)} />}
        </Row>
        <Row label="Verbindung" description="Fragt die verfügbaren Modelle beim Server ab.">
          <div className={`conn ${test ? (test.ok ? "ok" : "fail") : ""}`}>
            {testing ? (
              <>
                <Loader2 size={14} className="spin" /> Prüfe …
              </>
            ) : test?.ok ? (
              <>
                <CheckCircle2 size={14} /> Verbunden · {test.models.length} Modelle · {test.latency_ms} ms
              </>
            ) : test ? (
              <span title={test.error ?? ""}>
                <XCircle size={14} /> Keine Verbindung
              </span>
            ) : null}
          </div>
          <Button icon={RefreshCw} onClick={runTest} disabled={testing}>
            Testen
          </Button>
        </Row>
        {test && !test.ok && test.error && <p className="error-note mono small">{test.error}</p>}
      </Group>

      <Group title="Modelle" description="Welche Modelle des Servers für welche Aufgaben verwendet werden.">
        <Row label="Automatisches Routing" description="Einfache Aufgaben gehen an das lokale Modell, komplexe an stärkere Modelle.">
          <Switch checked={draft.auto_route} onChange={(v) => update({ auto_route: v })} label="Automatisches Routing" />
        </Row>
        <Row label="Lokal / schnell" description="Für kurze Fragen, Umformulierungen und vertrauliche Inhalte.">
          <ModelInput value={router.local_model} models={models} onChange={(v) => setRouter({ local_model: v })} label="Lokales Modell" />
        </Row>
        <Row label="Standard" description={draft.auto_route ? "Für die meisten Aufgaben." : "Wird für alle Anfragen verwendet."}>
          <ModelInput value={router.standard_model} models={models} onChange={(v) => setRouter({ standard_model: v })} label="Standardmodell" />
        </Row>
        <Row label="Reasoning" description="Für Analysen, Planung und Code.">
          <ModelInput value={router.reasoning_model} models={models} onChange={(v) => setRouter({ reasoning_model: v })} label="Reasoning-Modell" />
        </Row>
        <Row label="Embeddings" description="Für die semantische Suche in Notizen. Leer = nur Stichwortsuche.">
          <ModelInput value={draft.embedding_model ?? ""} models={models} onChange={(v) => update({ embedding_model: v || null })} label="Embedding-Modell" allowEmpty />
        </Row>
      </Group>

      <Group title="Datenschutz & Verhalten">
        <Row stack label="Vertraulichkeits-Markierungen" description="Inhalte mit diesen Tags gehen immer nur an das lokale Modell.">
          <Input
            value={router.private_markers.join(", ")}
            onChange={(e) => setRouter({ private_markers: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
            className="grow"
            aria-label="Markierungen"
          />
        </Row>
        <Field label="Zusätzliche Anweisungen an den Assistenten" hint="z. B. Rolle, Tonalität, bevorzugte Formate">
          <TextArea rows={4} value={draft.assistant_instructions} onChange={(e) => update({ assistant_instructions: e.target.value })} placeholder="Ich bin SAP-Berater im Projekt … Antworte knapp." />
        </Field>
      </Group>
    </>
  );
}

function ModelInput({ value, models, onChange, label, allowEmpty }: { value: string; models: string[]; onChange: (v: string) => void; label: string; allowEmpty?: boolean }) {
  if (models.length) {
    const missing = value && !models.includes(value);
    return (
      <div className="model-input">
        <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="w-360">
          {allowEmpty && <option value="">Keines</option>}
          {!allowEmpty && !value && <option value="">Modell wählen</option>}
          {missing && <option value={value}>{value} (nicht auf dem Server)</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        {missing && <span className="warn-note small">Dieses Modell bietet der Server nicht an</span>}
      </div>
    );
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={allowEmpty ? "Keines" : "Modellname"} aria-label={label} className="w-360" />;
}

// ------------------------------------------------------------------ time

/** Number field that keeps what is typed and only validates and clamps on blur/Enter. */
function NumberInput({ value, min, max, step = 1, onCommit, ...rest }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "min" | "max" | "step" | "onChange">) {
  const [raw, setRaw] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setRaw(String(value));
  }, [value, editing]);
  const parsed = raw.trim() === "" ? NaN : Number(raw.replace(",", "."));
  const commit = () => {
    const v = Number.isFinite(parsed) ? Math.round(Math.min(max, Math.max(min, parsed)) / step) * step : value;
    setRaw(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <Input
      {...rest}
      type="number"
      min={min}
      max={max}
      step={step}
      value={raw}
      aria-invalid={!Number.isFinite(parsed) || parsed < min || parsed > max}
      onFocus={() => setEditing(true)}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false);
        commit();
      }}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function TimeSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  const [las, setLas] = useState<[string, string][]>([]);
  const [newLa, setNewLa] = useState({ code: "", desc: "" });
  const [mapKey, setMapKey] = useState("");
  const [mapVal, setMapVal] = useState("");
  const s = useApp.getState;
  const reload = () => api.leistungsarten().then(setLas);
  useEffect(() => {
    reload();
  }, []);
  const pct = (x: number) => Math.round(x * 100);

  return (
    <>
      <header className="settings-head">
        <h1>Zeiterfassung</h1>
        <p>Leerlauferkennung, Budgetwarnungen und Angaben für SAP- und Jira-Exporte.</p>
      </header>
      <Group title="Timer">
        <Row label="Leerlauf ab" description="Pausen ohne Tastatur- oder Mauseingabe, die länger dauern, werden beim Stoppen zum Abziehen angeboten.">
          <div className="unit-input">
            <NumberInput min={1} max={120} value={draft.idle_threshold_minutes} onCommit={(v) => update({ idle_threshold_minutes: v })} aria-label="Minuten" />
            <span className="faint">Minuten</span>
          </div>
        </Row>
      </Group>
      <Group title="Arbeitszeit" description="Tage unter dem Soll werden in der Wochenübersicht markiert.">
        <Row label="Soll pro Arbeitstag">
          <div className="unit-input">
            <NumberInput min={0.5} max={16} step={0.25} value={draft.daily_target_hours} onCommit={(v) => update({ daily_target_hours: v })} aria-label="Stunden" />
            <span className="faint">Stunden</span>
          </div>
        </Row>
        <Row label="Arbeitstage">
          <div className="day-toggle" role="group" aria-label="Arbeitstage">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d, i) => {
              const on = draft.workdays.includes(i + 1);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={on ? "on" : ""}
                  onClick={() => update({ workdays: on ? draft.workdays.filter((x) => x !== i + 1) : [...draft.workdays, i + 1].sort() })}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Row>
      </Group>
      <Group title="Budgetwarnungen" description="Gilt für Netzpläne und Vorgänge.">
        <Row label="Warnung ab">
          <div className="unit-input">
            <NumberInput min={1} max={100} value={pct(draft.thresholds.warning)} onCommit={(v) => update({ thresholds: { ...draft.thresholds, warning: v / 100 } })} aria-label="Warnung in Prozent" />
            <span className="faint">% verbraucht</span>
          </div>
        </Row>
        <Row label="Kritisch ab" description="Oder wenn die Prognose (gebucht + Restaufwand) den Plan übersteigt.">
          <div className="unit-input">
            <NumberInput min={1} max={100} value={pct(draft.thresholds.critical)} onCommit={(v) => update({ thresholds: { ...draft.thresholds, critical: v / 100 } })} aria-label="Kritisch in Prozent" />
            <span className="faint">% verbraucht</span>
          </div>
        </Row>
        {pct(draft.thresholds.warning) >= pct(draft.thresholds.critical) && (
          <p className="error-note small" role="alert">Die Warnschwelle muss unter der kritischen Schwelle liegen.</p>
        )}
      </Group>
      <Group title="SAP CATS">
        <Row label="Personalnummer (PERNR)">
          <Input value={draft.pernr ?? ""} onChange={(e) => update({ pernr: e.target.value || null })} placeholder="00012345" aria-label="Personalnummer" />
        </Row>
      </Group>
      <Group title="Jira-Zuordnung" description="Netzplan oder Netzplan/Vorgang zu Jira-Issue. Die spezifischere Zuordnung gewinnt.">
        <div className="map-list">
          {Object.entries(draft.jira_issue_map).map(([k, v]) => (
            <div key={k} className="map-row">
              <span className="mono">{k}</span>
              <span className="faint">→</span>
              <span className="mono">{v}</span>
              <span className="grow" />
              <IconButton
                icon={Trash2}
                label="Entfernen"
                size={24}
                iconSize={13}
                onClick={() => {
                  const m = { ...draft.jira_issue_map };
                  delete m[k];
                  update({ jira_issue_map: m });
                }}
              />
            </div>
          ))}
          <div className="map-row">
            <Input value={mapKey} onChange={(e) => setMapKey(e.target.value)} placeholder="NP-8801/1020" className="mono" aria-label="Netzplan/Vorgang" />
            <span className="faint">→</span>
            <Input value={mapVal} onChange={(e) => setMapVal(e.target.value)} placeholder="AET-12" className="mono" aria-label="Jira-Issue" />
            <Button
              icon={Plus}
              disabled={!mapKey.trim() || !mapVal.trim()}
              onClick={() => {
                update({ jira_issue_map: { ...draft.jira_issue_map, [mapKey.trim()]: mapVal.trim() } });
                setMapKey("");
                setMapVal("");
              }}
            >
              Hinzufügen
            </Button>
          </div>
        </div>
      </Group>
      <Group title="Leistungsarten" description="Werden direkt gespeichert.">
        <div className="map-list">
          {las.map(([code, desc]) => (
            <div key={code} className="map-row">
              <Badge>{code}</Badge>
              <span>{desc}</span>
              <span className="grow" />
              <IconButton
                icon={Trash2}
                label="Löschen"
                size={24}
                iconSize={13}
                onClick={async () => {
                  try {
                    await api.deleteLeistungsart(code);
                    reload();
                    s().bumpWbs();
                  } catch (e) {
                    s().error("Löschen nicht möglich", e);
                  }
                }}
              />
            </div>
          ))}
          <div className="map-row">
            <Input value={newLa.code} onChange={(e) => setNewLa({ ...newLa, code: e.target.value.toUpperCase() })} placeholder="CODE" className="mono w-120" aria-label="Code" />
            <Input value={newLa.desc} onChange={(e) => setNewLa({ ...newLa, desc: e.target.value })} placeholder="Beschreibung" aria-label="Beschreibung" />
            <Button
              icon={Plus}
              disabled={!newLa.code.trim()}
              onClick={async () => {
                try {
                  await api.saveLeistungsart(newLa.code, newLa.desc);
                  setNewLa({ code: "", desc: "" });
                  reload();
                  s().bumpWbs();
                } catch (e) {
                  s().error("Speichern nicht möglich", e);
                }
              }}
            >
              Hinzufügen
            </Button>
          </div>
        </div>
      </Group>
    </>
  );
}

// ----------------------------------------------------------------- notes

function NotesSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  const [path, setPath] = useState("");
  const [templates, setTemplates] = useState<Page[]>([]);
  useEffect(() => {
    api.templates().then(setTemplates, () => {});
  }, []);
  const missing = draft.daily_template != null && !templates.some((t) => t.id === draft.daily_template);
  return (
    <>
      <header className="settings-head">
        <h1>Notizen</h1>
        <p>Alle Notizen sind Markdown und liegen lokal. Du kannst jederzeit aus Obsidian importieren oder alles als Markdown-Ordner exportieren.</p>
      </header>
      <Group title="Start">
        <Row label="Tagesnotiz beim Start öffnen">
          <Switch checked={draft.open_daily_on_start} onChange={(v) => update({ open_daily_on_start: v })} label="Tagesnotiz beim Start" />
        </Row>
        <Row label="Vorlage für Tagesnotizen" description="Gilt für neu angelegte Tagesnotizen. Vorlagen sind die Seiten unter „Vorlagen“.">
          <Select
            value={draft.daily_template == null ? "" : String(draft.daily_template)}
            onChange={(e) => update({ daily_template: e.target.value ? Number(e.target.value) : null })}
            aria-label="Vorlage für Tagesnotizen"
            className="w-360"
          >
            <option value="">Standard (Fokus und Notizen)</option>
            {missing && templates.length > 0 && <option value={String(draft.daily_template)}>Gelöschte Vorlage</option>}
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.title}
              </option>
            ))}
          </Select>
        </Row>
      </Group>
      <Group title="Obsidian" description="Ordner werden zu Seiten, [[Links]] und #Tags bleiben erhalten. Bilder werden als Anhänge übernommen, andere Dateien übersprungen.">
        <Row label="Vault importieren">
          <Button icon={FolderInput} onClick={() => importVault()}>
            Ordner wählen …
          </Button>
        </Row>
        <Row stack label="Pfad direkt angeben" description="Alternativ zum Dialog.">
          <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\\Users\\du\\Obsidian\\Vault" className="grow" aria-label="Vault-Pfad" />
          <Button onClick={() => path.trim() && importVault(path.trim())} disabled={!path.trim()}>
            Importieren
          </Button>
        </Row>
        <Row label="Als Markdown exportieren" description="Schreibt jede Seite als .md-Datei, Unterseiten als Ordner.">
          <Button icon={FolderOutput} onClick={() => exportVault()}>
            Zielordner wählen …
          </Button>
        </Row>
      </Group>
      <Group title="Beispieldaten">
        <Row label="Beispieldaten entfernen" description="Löscht das Beispielprojekt PRJ-2026-X mit seinen Zeiten und die Beispielseiten. Deine eigenen Seiten und Tagesnotizen bleiben erhalten.">
          <Button
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              const s = useApp.getState();
              if (!(await s.confirm({ title: "Beispieldaten entfernen?", message: "Das Beispielprojekt, seine Zeitbuchungen und die Beispielseiten werden gelöscht.", confirmLabel: "Entfernen", danger: true }))) return;
              try {
                const n = await api.removeDemo();
                await s.refreshTree();
                s.bumpWbs();
                s.bumpEntries();
                s.toast({ tone: "success", title: "Beispieldaten entfernt", detail: n ? "Beispielprojekt und -seiten gelöscht" : "Beispielprojekt gelöscht" });
              } catch (e) {
                s.error("Entfernen fehlgeschlagen", e);
              }
            }}
          >
            Entfernen
          </Button>
        </Row>
      </Group>
    </>
  );
}

function BackupSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  const view = useApp((s) => s.settings)!;
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const s = useApp.getState;
  const reload = () => api.backups().then(setList).catch(() => setList([]));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.backup_dir, view.settings.backup_keep]);

  const pick = async () => {
    const dir = await pickFolder("Ordner für Sicherungen");
    if (dir) update({ backup_dir: dir });
  };
  const backupNow = async () => {
    setBusy(true);
    try {
      const b = await api.backupNow();
      s().toast({ tone: "success", title: "Sicherung erstellt", detail: `${b.file_name} · ${fileSize(b.size_bytes)}` });
      reload();
    } catch (e) {
      s().error("Sicherung fehlgeschlagen", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="settings-head">
        <h1>Sicherung</h1>
        <p>Die Datenbank wird einmal täglich automatisch gesichert. Eine Sicherung ist eine vollständige Kopie von workspace.db. Zum Wiederherstellen die Datei bei geschlossener App in den Datenordner kopieren und in workspace.db umbenennen.</p>
      </header>
      <Group title="Automatische Sicherung" description="Wird beim Start und danach stündlich geprüft; gesichert wird, wenn die letzte Sicherung älter als 24 Stunden ist.">
        <Row
          label="Ordner"
          description={
            <>
              <span>{draft.backup_dir ? "Eigener Ordner, z. B. ein Netzlaufwerk:" : "Standard, im Datenordner:"}</span>
              <span className="mono selectable backup-path">{view.backup_dir}</span>
            </>
          }
        >
          <Button icon={FolderOpen} onClick={pick}>
            Ordner wählen …
          </Button>
          {draft.backup_dir && (
            <Button variant="ghost" onClick={() => update({ backup_dir: null })}>
              Standard
            </Button>
          )}
        </Row>
        <Row label="Anzahl behalten" description="Ältere Sicherungen werden gelöscht.">
          <div className="unit-input">
            <NumberInput min={1} max={365} value={draft.backup_keep} onCommit={(v) => update({ backup_keep: v })} aria-label="Anzahl Sicherungen" />
            <span className="faint">Sicherungen</span>
          </div>
        </Row>
      </Group>
      <Group title="Sicherungen">
        <Row label="Jetzt sichern" description="Legt sofort eine zusätzliche Sicherung an.">
          <Button icon={DatabaseBackup} onClick={backupNow} loading={busy}>
            Jetzt sichern
          </Button>
        </Row>
        <div className="backup-list" aria-label="Vorhandene Sicherungen">
          {list?.length === 0 && <p className="faint small">Noch keine Sicherung vorhanden.</p>}
          {list?.map((b) => (
            <div key={b.path} className="backup-row" title={b.path}>
              <span className="grow">{new Date(b.created_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className="faint small">{relative(b.created_at)}</span>
              <span className="faint small num">{fileSize(b.size_bytes)}</span>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}

function DesktopSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const s = useApp.getState;
  const view = useApp((st) => st.settings);
  useEffect(() => {
    api.desktopInfo().then(setInfo, () => setInfo(null));
  }, [view]);
  const setAutostart = async (on: boolean) => {
    try {
      setInfo(await api.setAutostart(on));
    } catch (e) {
      s().error("Autostart konnte nicht geändert werden", e);
    }
  };
  const reminderOn = draft.reminder_time != null;

  return (
    <>
      <header className="settings-head">
        <h1>Desktop</h1>
        <p>Symbol im Infobereich, Autostart, Erinnerungen und die Schnellerfassung.</p>
      </header>
      <Group title="Fenster">
        <Row
          label="In den Infobereich schließen"
          description={
            <>
              Schließen blendet das Fenster nur aus; Timer und Erinnerungen laufen weiter. Beenden über das Symbol im Infobereich.
              {info && !info.tray && <Badge tone="warning">Kein Infobereich verfügbar – das Fenster wird minimiert</Badge>}
            </>
          }
        >
          <Switch label="In den Infobereich schließen" checked={draft.close_to_tray} onChange={(v) => update({ close_to_tray: v })} />
        </Row>
        <Row label="Mit Windows starten" description="Startet bei der Anmeldung minimiert im Infobereich. Wird sofort übernommen.">
          <Switch label="Mit Windows starten" checked={!!info?.autostart} onChange={setAutostart} />
        </Row>
      </Group>
      <Group title="Befehlspalette">
        <Row label="Tastenkürzel (global)" description="Holt AETHER OS mit der Befehlspalette nach vorn, z. B. Alt+Space oder Ctrl+Shift+K. Leer = aus. Ctrl K funktioniert im Fenster immer.">
          <Input
            value={draft.palette_shortcut ?? ""}
            onChange={(e) => update({ palette_shortcut: e.target.value || null })}
            placeholder="Alt+Space"
            aria-label="Tastenkürzel Befehlspalette"
            className="mono"
          />
        </Row>
      </Group>
      <Group title="Feierabend-Erinnerung" description="Hinweis an Arbeitstagen, wenn weniger als das Tagessoll gebucht ist. Ein Klick darauf öffnet die Zeiterfassung. Läuft nach 20 Uhr noch ein Timer, erinnert AETHER OS einmal daran.">
        <Row label="Erinnern um">
          <div className="unit-input">
            {reminderOn && (
              <Input
                type="time"
                className="time-input"
                value={draft.reminder_time ?? ""}
                onChange={(e) => update({ reminder_time: e.target.value || null })}
                aria-label="Uhrzeit der Erinnerung"
              />
            )}
            <span className="faint">{reminderOn ? "Uhr" : "Aus"}</span>
            <Switch label="Feierabend-Erinnerung" checked={reminderOn} onChange={(v) => update({ reminder_time: v ? "17:30" : null })} />
          </div>
        </Row>
      </Group>
      <Group title="Schnellerfassung" description="Ein kleines Fenster über allen anderen: Text landet in der heutigen Tagesnotiz, „todo …“ oder „- [ ] …“ als Aufgabe, „/zeit …“ wird gebucht.">
        <Row
          label="Tastenkürzel (global)"
          description="Ins Feld klicken und die Tasten drücken, z. B. Ctrl+Shift+Space. Ctrl+Alt meiden – das ist AltGr auf deutschen Tastaturen. Entf = aus."
        >
          <div className="unit-input shortcut-input">
            <Input
              value={draft.capture_shortcut}
              onChange={(e) => update({ capture_shortcut: e.target.value })}
              onKeyDown={(e) => {
                const next = recordShortcut(e.nativeEvent);
                if (next === undefined) return;
                e.preventDefault();
                if (next !== null) update({ capture_shortcut: next });
              }}
              placeholder="Tasten drücken …"
              aria-label="Tastenkürzel Schnellerfassung"
              className="mono"
            />
            {info && draft.capture_shortcut === view?.settings.capture_shortcut && (
              info.capture_shortcut_active ? <Badge tone="success">Aktiv</Badge> : <Badge tone="warning">Nicht registriert</Badge>
            )}
          </div>
        </Row>
      </Group>
    </>
  );
}

function AppearanceSection({ draft, update }: { draft: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <>
      <header className="settings-head">
        <h1>Darstellung</h1>
      </header>
      <Group title="Farbschema">
        <Row label="Modus">
          <Segmented
            value={draft.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Hell" },
              { value: "dark", label: "Dunkel" },
            ]}
            onChange={(v) => update({ theme: v })}
          />
        </Row>
      </Group>
    </>
  );
}

async function moveDataDir() {
  const s = useApp.getState();
  const dir = await pickFolder("Neuer Speicherort für die Daten");
  if (!dir) return;
  try {
    await flushAllEditors();
    const moved = await api.setDataDir(dir);
    const warn = moved.synced ? " Achtung: Der Ordner ist synchronisiert oder liegt im Netzwerk – das kann die Datenbank beschädigen." : "";
    const restart = await s.confirm({
      title: "Neu starten?",
      message: `Die Daten wurden nach ${moved.data_dir} kopiert und werden nach dem Neustart von dort geladen. Änderungen bis zum Neustart landen noch im alten Ordner.${warn}`,
      confirmLabel: "Jetzt neu starten",
    });
    if (restart) await api.restart();
    else s.toast({ tone: "warning", persistent: true, title: "Neustart ausstehend", detail: `Der neue Speicherort ${moved.data_dir} gilt ab dem nächsten Start.` });
  } catch (e) {
    s.error("Speicherort nicht geändert", e);
  }
}

function AboutSection() {
  const view = useApp((s) => s.settings)!;
  const palette = view.settings.palette_shortcut;
  const shortcuts: [string, string][] = [
    ["Ctrl K", "Befehlspalette & Suche"],
    ["Ctrl O", "Seite öffnen"],
    ...(palette ? [[palette.replace(/\+/g, " "), "Befehlspalette (global)"] as [string, string]] : []),
    ["Ctrl Shift Space", "Schnellerfassung (global)"],
    ["Ctrl N", "Neue Seite"],
    ["Ctrl Shift D", "Heutige Tagesnotiz"],
    ["Ctrl Shift T", "Timer starten / stoppen"],
    ["Ctrl J", "Assistent"],
    ["Ctrl W", "Tab schließen"],
    ["Ctrl Tab", "Nächster Tab"],
    ["Ctrl \\", "Seitenleiste"],
    ["Ctrl Shift \\", "Seitenpanel"],
    ["Ctrl .", "Fokusmodus"],
    ["Ctrl ,", "Einstellungen"],
  ];
  return (
    <>
      <header className="settings-head">
        <h1>AETHER OS</h1>
        <p>Version {view.version}</p>
      </header>
      <Group title="Daten">
        <Row label="Datenordner" description="Datenbank, Einstellungen und Schlüsselablage (unter Linux).">
          <span className="mono small selectable">{view.data_dir}</span>
        </Row>
        <Row label="Speicherort ändern" description="Kopiert Datenbank, Bilder und Sicherungen in einen anderen Ordner und startet neu. Der alte Ordner bleibt unverändert. Kein OneDrive-, Dropbox- oder Netzwerkordner.">
          <Button icon={FolderInput} onClick={() => moveDataDir()}>
            Speicherort ändern…
          </Button>
        </Row>
      </Group>
      <Group title="Tastenkürzel">
        <div className="shortcut-list">
          {shortcuts.map(([k, d]) => (
            <div key={k} className="shortcut">
              <span>{d}</span>
              <span className="keys">
                {k.split(" ").map((x) => (
                  <kbd key={x}>{x}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}
