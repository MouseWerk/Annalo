// The quick-capture window (label "capture", opened by the global shortcut or the tray):
// one line that is booked as time or appended to today's daily note.

import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, Clock, NotebookPen } from "lucide-react";
import { api, errorText, on } from "../lib/api";
import { applyTheme } from "../lib/actions";
import { CAPTURE_HINTS, captureKind } from "../lib/capture";

const ICONS = { zeit: Clock, task: CalendarCheck2, note: NotebookPen };

export function CaptureApp() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add("capture-mode");
    api
      .settings()
      .then((v) => applyTheme(v.settings.theme))
      .catch(() => {});
    const focus = () => {
      setError(null);
      input.current?.focus();
    };
    focus();
    const unlisten = on("capture://shown", focus);
    window.addEventListener("focus", focus);
    document.body.classList.add("ready");
    return () => {
      window.removeEventListener("focus", focus);
      unlisten.then((f) => f());
    };
  }, []);

  const hide = () => api.captureHide().catch(() => {});
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.captureSubmit(text);
      setText("");
      setError(null);
      hide();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const kind = captureKind(text);
  const Icon = ICONS[kind];
  return (
    <div className="capture">
      <div className="capture-field">
        <Icon size={18} strokeWidth={1.75} className="faint" />
        <input
          ref={input}
          className="capture-input"
          value={text}
          placeholder="Notiz, todo …, - [ ] … oder /zeit NP-8801/1020 1h #DEV"
          aria-label="Schnellerfassung"
          spellCheck={false}
          autoFocus
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              hide();
            }
          }}
        />
      </div>
      <div className={`capture-hint ${error ? "error" : ""}`} role={error ? "alert" : undefined}>
        {error ?? (text.trim() ? CAPTURE_HINTS[kind] : "Enter speichert · Esc schließt")}
      </div>
    </div>
  );
}
