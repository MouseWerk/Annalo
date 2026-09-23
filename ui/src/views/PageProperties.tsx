// Page properties (frontmatter) editor and the work card of a page linked to a Vorgang.

import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, CalendarDays, ChevronDown, ChevronRight, ListTree, Play, Plus, Tags, TriangleAlert, Type, Workflow, X, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { Badge, Button, IconButton, Progress } from "../components/ui";
import { DATE_RE, LIST_KEYS, edited, parseFrontmatter, propertyValue, serializeFrontmatter, splitItems, type Property } from "../lib/frontmatter";
import { dateShort, h2, hoursFromMinutes } from "../lib/format";
import { NetzplanSelect, VorgangSelect, useWbs } from "./wbs";
import { LEVEL } from "./ProjectsView";
import type { PageWork } from "../lib/types";

const TYPE_ICON: Record<Property["type"], LucideIcon> = { text: Type, date: CalendarDays, list: Tags, raw: Braces };
const isWbsKey = (key: string) => /^(vorgang|netzplan)$/i.test(key);

/** The WBS reference of a page's properties, as the core resolves it (`vorgang:` / `netzplan:`). */
export function pageReference(fm: string): string | null {
  const props = parseFrontmatter(fm);
  const v = propertyValue(props, "vorgang");
  const n = propertyValue(props, "netzplan");
  if (v && (v.includes("/") || !n)) return v;
  if (v && n) return `${n}/${v}`;
  return n;
}

export function PropertyEditor({ fm, onChange, adding, onAdded }: { fm: string; onChange: (fm: string) => void; adding: boolean; onAdded: () => void }) {
  const props = useMemo(() => parseFrontmatter(fm), [fm]);
  const [open, setOpen] = useState(true);
  const commit = (next: Property[]) => onChange(serializeFrontmatter(next));
  const update = (i: number, change: Partial<Property>) => commit(props.map((p, j) => (j === i ? edited(p, change) : p)));
  const taken = (key: string, except = -1) => props.some((p, j) => j !== except && p.key.toLowerCase() === key.toLowerCase());
  const rows = props.map((p, i) => ({ p, i })).filter(({ p }) => p.key || p.value.trim());

  if (!rows.length && !adding) return null;
  return (
    <section className="properties" aria-label="Eigenschaften">
      <button type="button" className="properties-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Eigenschaften
      </button>
      {open && (
        <>
          {rows.map(({ p, i }) => (
            <PropertyRow
              key={`${i}:${p.key}`}
              prop={p}
              onChange={(c) => update(i, c)}
              onRename={(key) => {
                if (!key || key === p.key) return false;
                if (taken(key, i)) {
                  useApp.getState().toast({ tone: "warning", title: `Eigenschaft „${key}“ gibt es schon` });
                  return false;
                }
                update(i, { key });
                return true;
              }}
              onRemove={() => commit(props.filter((_, j) => j !== i))}
            />
          ))}
          <NewProperty
            autoOpen={adding}
            onDone={onAdded}
            onAdd={(key) => {
              if (taken(key)) {
                useApp.getState().toast({ tone: "warning", title: `Eigenschaft „${key}“ gibt es schon` });
                return;
              }
              const list = LIST_KEYS.has(key.toLowerCase());
              commit([...props, edited({ key, type: list ? "list" : "text", value: "", items: [] }, {})]);
              // Continue with the value of the new row.
              setTimeout(() => document.querySelector<HTMLElement>(`.properties [data-prop-key="${CSS.escape(key)}"] .prop-value-input`)?.focus(), 30);
            }}
          />
        </>
      )}
    </section>
  );
}

function PropertyRow({ prop, onChange, onRename, onRemove }: { prop: Property; onChange: (c: Partial<Property>) => void; onRename: (key: string) => boolean; onRemove: () => void }) {
  const [key, setKey] = useState(prop.key);
  useEffect(() => setKey(prop.key), [prop.key]);
  const Icon = isWbsKey(prop.key) ? Workflow : TYPE_ICON[prop.type];
  const commitKey = () => {
    const k = key.trim();
    if (!onRename(k)) setKey(prop.key);
  };
  return (
    <div className={`prop-row prop-type-${prop.type}`} data-prop-key={prop.key}>
      <span className="prop-icon" aria-hidden>
        <Icon size={14} />
      </span>
      {prop.type === "raw" ? (
        <span className="prop-key prop-key-static" title="YAML – wird unverändert gespeichert">{prop.key || "YAML"}</span>
      ) : (
        <input
          className="prop-key"
          value={key}
          aria-label="Name der Eigenschaft"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value.replace(/[:\n]/g, ""))}
          onBlur={commitKey}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setKey(prop.key);
          }}
        />
      )}
      <div className="prop-value">
        <PropertyValue prop={prop} onChange={onChange} />
      </div>
      <IconButton icon={X} label="Eigenschaft entfernen" size={22} iconSize={13} className="prop-remove" onClick={onRemove} />
    </div>
  );
}

function PropertyValue({ prop, onChange }: { prop: Property; onChange: (c: Partial<Property>) => void }) {
  if (prop.type === "list") return <ListValue items={prop.items} onChange={(items) => onChange({ items })} />;
  if (prop.type === "raw") return <RawValue value={prop.value} onChange={(value) => onChange({ value })} />;
  if (prop.type === "date")
    return (
      <input
        type="date"
        className="prop-value-input"
        value={DATE_RE.test(prop.value) ? prop.value : ""}
        aria-label={prop.key}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    );
  return <TextValue prop={prop} onChange={(value) => onChange({ value })} />;
}

function TextValue({ prop, onChange }: { prop: Property; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(prop.value);
  const [picker, setPicker] = useState(false);
  useEffect(() => setDraft(prop.value), [prop.value]);
  const commit = () => draft !== prop.value && onChange(draft);
  return (
    <>
      <input
        className="prop-value-input"
        value={draft}
        placeholder="Leer"
        aria-label={prop.key}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(prop.value);
        }}
      />
      {isWbsKey(prop.key) && (
        <IconButton icon={ListTree} label={prop.key.toLowerCase() === "netzplan" ? "Netzplan wählen" : "Vorgang wählen"} size={22} iconSize={13} active={picker} onClick={() => setPicker((v) => !v)} />
      )}
      {picker && <WbsPicker value={prop.value} netzplanOnly={prop.key.toLowerCase() === "netzplan"} onChange={onChange} onClose={() => setPicker(false)} />}
    </>
  );
}

/** Picks Netzplan (and Vorgang) from the project structure: writes `NP-8801/1020`. */
function WbsPicker({ value, netzplanOnly, onChange, onClose }: { value: string; netzplanOnly: boolean; onChange: (v: string) => void; onClose: () => void }) {
  const { wbs } = useWbs();
  const [npRef, vRef = ""] = value.split("/");
  const nps = wbs.flatMap((p) => p.netzplaene);
  const lower = (npRef ?? "").trim().toLowerCase();
  const np = nps.find((n) => n.netzplan_nr.toLowerCase() === lower || n.wbs_element.toLowerCase() === lower) ?? null;
  const vorgang = np?.vorgaenge.find((v) => v.vorgang_nr.toLowerCase() === vRef.trim().toLowerCase())?.vorgang_nr ?? "";
  return (
    <div className="prop-picker" role="group" aria-label="Vorgang wählen">
      <NetzplanSelect wbs={wbs} value={np?.id ?? null} onChange={(id) => onChange(nps.find((n) => n.id === id)?.netzplan_nr ?? "")} />
      {!netzplanOnly && (
        <VorgangSelect wbs={wbs} netzplanId={np?.id ?? null} value={vorgang} onChange={(v) => np && onChange(v ? `${np.netzplan_nr}/${v}` : np.netzplan_nr)} />
      )}
      <Button size="sm" variant="ghost" onClick={onClose}>Fertig</Button>
    </div>
  );
}

function ListValue({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const more = splitItems(draft).filter((x) => !items.includes(x));
    setDraft("");
    if (more.length) onChange([...items, ...more]);
  };
  return (
    <div className="prop-list">
      {items.map((item, i) => (
        <span key={`${i}:${item}`} className="prop-chip">
          {item}
          <button type="button" aria-label={`${item} entfernen`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="prop-value-input prop-list-input"
        value={draft}
        placeholder={items.length ? "" : "Leer"}
        aria-label="Eintrag hinzufügen"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && items.length) onChange(items.slice(0, -1));
        }}
      />
    </div>
  );
}

function RawValue({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      className="prop-value-input prop-raw"
      rows={1}
      value={draft}
      aria-label="YAML"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
    />
  );
}

function NewProperty({ autoOpen, onAdd, onDone }: { autoOpen: boolean; onAdd: (key: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState<string | null>(autoOpen ? "" : null);
  useEffect(() => {
    if (autoOpen) setDraft("");
  }, [autoOpen]);
  const finish = () => {
    const k = (draft ?? "").trim();
    setDraft(null);
    onDone();
    if (k) onAdd(k);
  };
  if (draft === null)
    return (
      <button type="button" className="prop-add" onClick={() => setDraft("")}>
        <Plus size={13} /> Eigenschaft hinzufügen
      </button>
    );
  return (
    <div className="prop-row prop-new">
      <span className="prop-icon" aria-hidden>
        <Plus size={14} />
      </span>
      <input
        className="prop-key"
        autoFocus
        value={draft}
        placeholder="Name, z. B. vorgang"
        aria-label="Name der neuen Eigenschaft"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value.replace(/[:\n]/g, ""))}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            onDone();
          }
        }}
      />
    </div>
  );
}

/** Budget, ETC and the latest bookings of the Vorgang the page is linked to. */
export function WorkCard({ pageId, reference, title }: { pageId: number; reference: string; title: string }) {
  const entriesVersion = useApp((s) => s.entriesVersion);
  const timer = useApp((s) => s.timer);
  const [work, setWork] = useState<PageWork | null>(null);
  const [saved, setSaved] = useState(0);
  const [open, setOpen] = useState(false);

  // The card reads the saved page: reload after each save of this page.
  useEffect(() => {
    const onSaved = (e: Event) => (e as CustomEvent<{ id: number }>).detail.id === pageId && setSaved((n) => n + 1);
    window.addEventListener("aether:page-saved", onSaved);
    return () => window.removeEventListener("aether:page-saved", onSaved);
  }, [pageId]);
  useEffect(() => {
    let alive = true;
    api
      .pageWork(pageId)
      .then((w) => alive && setWork(w))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId, entriesVersion, saved, reference]);

  if (!work) return null;
  if (work.error)
    return (
      <section className="work-card work-error" aria-label="Vorgang">
        <TriangleAlert size={14} /> {work.error}
      </section>
    );
  const level = LEVEL[work.level];
  const start = async () => {
    const s = useApp.getState();
    try {
      await api.timerStart(work.netzplan_id!, work.vorgang, localStorage.getItem("aether.timer.la") || "DEV", title);
      s.bumpEntries();
      s.toast({ tone: "info", title: "Timer gestartet", detail: work.label });
    } catch (e) {
      s.error("Timer nicht gestartet", e);
    }
  };
  return (
    <section className="work-card" aria-label="Vorgang">
      <div className="work-head">
        <Workflow size={14} className="faint" />
        <span className="work-title">
          <span className="mono strong">{work.label}</span>
          {work.title && <span> · {work.title}</span>}
        </span>
        <Badge tone={level.tone}>{level.label}</Badge>
        <Button size="sm" icon={Play} disabled={!!timer} onClick={start}>
          {timer ? "Timer läuft" : "Timer starten"}
        </Button>
      </div>
      {work.planned_hours > 0 && <Progress value={work.consumed} tone={level.tone} />}
      <div className="work-stats">
        <span className="num">
          {h2(work.booked_hours)} / {h2(work.planned_hours)} h gebucht
        </span>
        <span className="num">ETC {h2(work.etc_hours)} h</span>
        {work.page_hours > 0 && <span className="num">{h2(work.page_hours)} h von dieser Seite</span>}
      </div>
      {work.entries.length > 0 && (
        <>
          <button type="button" className="work-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Letzte Buchungen
          </button>
          {open && (
            <ul className="work-entries">
              {work.entries.map((e) => (
                <li key={e.id} className={e.page_id === pageId ? "own" : ""}>
                  <span className="faint">{dateShort(e.start_time)}</span>
                  <span className="num">{hoursFromMinutes(e.duration_minutes)} h</span>
                  <span className="work-entry-desc">{e.description || "–"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
