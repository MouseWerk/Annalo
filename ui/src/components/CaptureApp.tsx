// The quick-capture window (label "capture", opened by the global shortcut or the tray):
// a few lines, each booked as time (`/zeit`) or appended to today's daily note.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { CalendarCheck2, Clock, NotebookPen } from "lucide-react";
import { api, errorText, on } from "../lib/api";
import { applyTheme } from "../lib/actions";
import { CAPTURE_HINTS, captureKind } from "../lib/capture";
import { SuggestionPopup, type PopupHandle } from "../editor/suggestion-popup";
import { zeitToken, type ZeitToken } from "../editor/zeit-suggest";
import { resetZeitCache, zeitLaItems, zeitRefItems } from "../editor/zeit-source";
import type { ZeitSuggestItem } from "../editor/extensions";

const ICONS = { zeit: Clock, task: CalendarCheck2, note: NotebookPen };
/** Window width and height range (logical px); the height follows the content. */
const WIDTH = 620;
const MIN_HEIGHT = 132;
const MAX_HEIGHT = 260;
const MAX_LINES = 6;

interface Sugg {
  token: ZeitToken;
  items: ZeitSuggestItem[];
}

export function CaptureApp() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const popup = useRef<PopupHandle>(null);
  // Latest suggestion request; older answers are dropped.
  const req = useRef(0);

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
    const unlisten = on("capture://shown", () => {
      resetZeitCache();
      focus();
    });
    window.addEventListener("focus", focus);
    document.body.classList.add("ready");
    return () => {
      window.removeEventListener("focus", focus);
      unlisten.then((f) => f());
    };
  }, []);

  // Auto-grow the field up to MAX_LINES, then the window up to MAX_HEIGHT.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES)}px`;
    const win = getCurrentWindow();
    if (win.label !== "capture" || !body.current) return;
    const h = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, body.current.offsetHeight + 32)));
    win.setSize(new LogicalSize(WIDTH, h)).catch(() => {});
  }, [text, sugg, error]);

  /** `/zeit` suggestions for the token before the caret (first line only). */
  const suggest = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const token = before.includes("\n") ? null : zeitToken(before);
    const id = ++req.current;
    if (!token) return setSugg(null);
    (token.kind === "ref" ? zeitRefItems(token.query) : zeitLaItems(token.query))
      .then((items) => id === req.current && setSugg(items.length ? { token, items } : null))
      .catch(() => id === req.current && setSugg(null));
  };

  const pick = (it: ZeitSuggestItem) => {
    const el = input.current;
    if (!el || !sugg) return;
    const caret = el.selectionStart ?? text.length;
    const after = text.slice(caret).replace(/^\S*/, "");
    const head = text.slice(0, sugg.token.from) + it.insert + (after.startsWith(" ") ? "" : " ");
    setText(head + after);
    req.current++;
    setSugg(null);
    requestAnimationFrame(() => el.setSelectionRange(head.length, head.length));
  };

  const hide = () => api.captureHide().catch(() => {});
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.captureSubmit(text);
      setText("");
      setSugg(null);
      setError(null);
      hide();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const kind = captureKind(text);
  const Icon = ICONS[kind];
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const hint = !text.trim()
    ? "Enter speichert · Shift+Enter neue Zeile · Esc schließt"
    : lines > 1
      ? `Enter erfasst ${lines} Zeilen: /zeit bucht, der Rest geht in die Tagesnotiz · Esc schließt`
      : `${CAPTURE_HINTS[kind]} · Esc schließt`;
  return (
    <div className="capture">
      <div className="capture-body" ref={body}>
        <div className="capture-field">
          <Icon size={18} strokeWidth={1.75} className="faint" />
          <textarea
            ref={input}
            className="capture-input"
            rows={1}
            value={text}
            placeholder="Notiz, todo …, - [ ] … oder /zeit NP-8801/1020 1h #DEV"
            aria-label="Schnellerfassung"
            aria-autocomplete="list"
            aria-expanded={!!sugg}
            spellCheck={false}
            autoFocus
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
              suggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={(e) => {
              if (sugg && popup.current?.onKeyDown({ event: e.nativeEvent } as SuggestionKeyDownProps)) {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (sugg) {
                  req.current++;
                  setSugg(null);
                } else hide();
              }
            }}
          />
        </div>
        {sugg && (
          <div className="capture-sugg">
            <SuggestionPopup ref={popup} items={sugg.items} className="zeit" command={(it) => pick(it as ZeitSuggestItem)} />
          </div>
        )}
        <div className={`capture-hint ${error ? "error" : ""}`} role={error ? "alert" : undefined}>
          {error ?? hint}
        </div>
      </div>
    </div>
  );
}
