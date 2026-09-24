// „Besprechung zusammenfassen“ (page menu, /Zusammenfassung): streams a summary with decisions,
// tasks and open points, then inserts it at the end of the page, saves it as a new page or copies it.

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Check, Copy, FilePlus2, ListEnd, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { Button, Dialog } from "../components/ui";
import { renderMarkdown } from "../lib/markdown";
import { usd } from "../lib/format";
import { bookingSuggestion, meetingSummaryInstruction, summaryPageContent, summaryPageTitle } from "../lib/aitext";
import { useAiTransform } from "../lib/useAiTransform";
import { appendMarkdown } from "../editor/ai-insert";
import { toMarkdown } from "../editor/schema";

interface Props {
  page: { id: number; title: string };
  /** The page's Vorgang/Netzplan (`vorgang:` property), for a booking suggestion. */
  reference: string | null;
  getEditor: () => Editor | null;
  flush: () => Promise<void>;
  onClose: () => void;
}

export function MeetingSummaryDialog({ open, ...props }: Props & { open: boolean }) {
  return open ? <SummaryDialog {...props} /> : null;
}

function SummaryDialog({ page, reference, getEditor, flush, onClose }: Props) {
  const ai = useAiTransform();
  const [body, setBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const s = useApp.getState;

  const start = async () => {
    // The editor holds the newest text; saving first keeps the privacy markers current.
    await flush().catch(() => {});
    const editor = getEditor();
    const md = editor && !editor.isDestroyed ? toMarkdown(editor) : (await api.page(page.id)).content;
    setBody(md);
    if (!md.trim()) return;
    ai.run(meetingSummaryInstruction(), md, page.id);
  };

  useEffect(() => {
    start().catch((e) => s().error("Zusammenfassung nicht möglich", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = !ai.busy && !!ai.text && !ai.error;
  const booking = done && body ? bookingSuggestion(reference, body, page.title) : null;
  const result = booking ? `${ai.text}\n\n${booking}` : ai.text;

  const insertAtEnd = () => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed) return s().toast({ tone: "warning", title: "Seite ist nicht geöffnet" });
    if (appendMarkdown(editor, result)) {
      s().toast({ tone: "success", title: "Zusammenfassung eingefügt" });
      onClose();
    }
  };

  const asPage = async () => {
    setSaving(true);
    try {
      const parent = s().pages.get(page.id)?.parent_id ?? null;
      const p = await api.createPage(summaryPageTitle(page.title), parent, "file-text", summaryPageContent(page.title, result));
      await s().refreshTree();
      s().openPage(p.id, { newTab: true });
      onClose();
    } catch (e) {
      s().error("Seite nicht angelegt", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Besprechung zusammenfassen"
      description={`Zusammenfassung, Entscheidungen, Aufgaben und offene Punkte aus „${page.title}“.`}
      width={720}
      footer={
        <>
          <span className="summary-meta faint small">
            {ai.meta && (
              <span title={ai.meta.reasons.join("\n")}>
                <span className={`tier-dot tier-${ai.meta.tier}`} /> {ai.meta.model}
                {ai.meta.cost > 0 && ` · ${usd(ai.meta.cost)}`}
              </span>
            )}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          {done ? (
            <>
              <Button
                icon={copied ? Check : Copy}
                onClick={() => {
                  navigator.clipboard.writeText(result);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                Kopieren
              </Button>
              <Button icon={FilePlus2} loading={saving} onClick={asPage}>
                Als neue Seite
              </Button>
              <Button variant="primary" icon={ListEnd} onClick={insertAtEnd}>
                Am Seitenende einfügen
              </Button>
            </>
          ) : ai.busy ? (
            <Button onClick={() => ai.cancel()}>Stoppen</Button>
          ) : (
            <Button icon={RotateCcw} disabled={!body?.trim()} onClick={() => start()}>
              Erneut
            </Button>
          )}
        </>
      }
    >
      <div className="summary-preview" aria-live="polite">
        {body !== null && !body.trim() ? (
          <div className="faint">Die Seite ist leer – es gibt nichts zusammenzufassen.</div>
        ) : ai.error ? (
          <div className="msg-error">
            <div>Die Anfrage ist fehlgeschlagen.</div>
            <div className="faint small mono">{ai.error}</div>
          </div>
        ) : !ai.text ? (
          <div className="thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className={`prose prose-chat ${ai.busy ? "streaming" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }} />
        )}
        {ai.cancelled && <div className="faint small">Abgebrochen</div>}
      </div>
    </Dialog>
  );
}
