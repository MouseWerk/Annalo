// Smart /zeit: the confirmation of an AI-suggested reference for a `/zeit` line without one.
// Enter books, Tab chooses another reference, Esc cancels. Nothing is booked without Enter
// (or a click on „Buchen“).

import { useEffect, useRef, type CSSProperties } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "../components/ui";
import { confidenceLabel } from "./zeit-suggest";
import type { ZeitGuess } from "../lib/types";

export type ZeitChoice = "book" | "other" | "cancel";

export function ZeitConfirm({ guess, onChoice, style, className = "" }: { guess: ZeitGuess | null; onChoice: (c: ZeitChoice) => void; style?: CSSProperties; className?: string }) {
  const cb = useRef(onChoice);
  cb.current = onChoice;
  const ready = guess !== null;
  // Capture phase: runs before the editor (or an input) sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let choice: ZeitChoice | null;
      if (e.key === "Escape") choice = "cancel";
      else if (e.key === "Enter" && !e.shiftKey) choice = ready ? "book" : null;
      else if (e.key === "Tab") choice = ready ? "other" : null;
      else {
        // Typing on changes the line: the suggestion no longer applies.
        if ((e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === "Backspace" || e.key === "Delete") cb.current("cancel");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (choice) cb.current(choice);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ready]);

  const target = guess ? `${guess.reference}${guess.title ? ` · ${guess.title}` : ""}${guess.leistungsart ? ` (${guess.leistungsart})` : ""}` : "";
  return (
    <div className={`zeit-confirm ${className}`} role="alertdialog" aria-label="Buchung bestätigen" style={style} onMouseDown={(e) => e.preventDefault()}>
      {!guess ? (
        <div className="zeit-confirm-line faint">
          <Loader2 size={14} className="spin" /> KI sucht den passenden Vorgang… (Esc bricht ab)
        </div>
      ) : (
        <>
          <div className="zeit-confirm-line">
            <Sparkles size={14} className="zeit-confirm-icon" />
            <span>
              Buchen auf <strong className="zeit-confirm-target">{target}</strong>?
            </span>
            <span className={`zeit-confirm-conf conf-${confidenceLabel(guess.confidence)}`} title={`Konfidenz ${Math.round(guess.confidence * 100)} %`}>
              {confidenceLabel(guess.confidence)}
            </span>
          </div>
          {guess.reason && <div className="zeit-confirm-reason">Grund: {guess.reason}</div>}
          <div className="zeit-confirm-actions">
            <Button size="sm" variant="primary" onClick={() => cb.current("book")}>
              Buchen · Enter
            </Button>
            <Button size="sm" onClick={() => cb.current("other")}>
              Anderen wählen · Tab
            </Button>
            <Button size="sm" variant="ghost" onClick={() => cb.current("cancel")}>
              Abbrechen · Esc
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
