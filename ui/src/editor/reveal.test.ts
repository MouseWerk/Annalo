import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./schema";
import { citeFlashKey, editorForPage, FLASH_MS, locateText, registerEditor, revealText } from "./reveal";
import { citeNeedles } from "../lib/citations";

let editor: Editor | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

function make(md: string) {
  host = document.createElement("div");
  host.className = "pane active";
  document.body.append(host);
  editor = new Editor({ element: host, extensions: buildExtensions(), content: md, contentType: "markdown" });
  return editor;
}

const PAGE = "# Plan\n\nIntro ohne Bezug.\n\n## Netzplan\n\nNetzplan NP-8801 wird im Oktober mit [[Architektur|der Architektur]] freigegeben. Danach Abnahme.\n\n- Punkt mit **fett** drin\n";

describe("locateText", () => {
  it("finds the paragraph of a chunk's first sentence, wiki links by label", () => {
    const e = make(PAGE);
    const chunk = "## Netzplan\n\nNetzplan NP-8801 wird im Oktober mit [[Architektur|der Architektur]] freigegeben. Danach Abnahme.";
    const r = locateText(e.state.doc, citeNeedles(chunk))!;
    expect(r).not.toBeNull();
    const node = e.state.doc.nodeAt(r.from)!;
    expect(node.type.name).toBe("paragraph");
    expect(node.textContent).toContain("Netzplan NP-8801 wird im Oktober");
    expect(r.to).toBe(r.from + node.nodeSize);
  });

  it("falls back to later needles (heading) and to null", () => {
    const e = make(PAGE);
    const r = locateText(e.state.doc, ["gibt es nicht", "Netzplan"])!;
    expect(e.state.doc.nodeAt(r.from)!.type.name).toBe("heading");
    expect(locateText(e.state.doc, ["gibt es nicht"])).toBeNull();
    expect(locateText(e.state.doc, [])).toBeNull();
  });

  it("is case- and whitespace-insensitive and finds list items", () => {
    const e = make(PAGE);
    const r = locateText(e.state.doc, citeNeedles("- Punkt  mit **fett**   drin"))!;
    expect(e.state.doc.nodeAt(r.from)!.textContent).toBe("Punkt mit fett drin");
  });
});

describe("revealText", () => {
  it("opens the page, waits for its editor, selects and flashes the paragraph", async () => {
    const e = make(PAGE);
    const open = vi.fn();
    let unregister = () => {};
    // The editor appears only after the page was opened.
    open.mockImplementation((id: number) => setTimeout(() => (unregister = registerEditor(id, e)), 50));
    // happy-dom has no layout: treat the editor as shown.
    vi.spyOn(e.view.dom, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const found = await revealText(7, "## Netzplan\n\nNetzplan NP-8801 wird im Oktober freigegeben.", open);
    expect(open).toHaveBeenCalledWith(7);
    // The sentence differs (the link is in between), the paragraph start matches.
    expect(found).toBe(true);
    const deco = citeFlashKey.getState(e.state)!.find();
    expect(deco).toHaveLength(1);
    expect(e.view.dom.querySelector(".cite-flash")?.textContent).toContain("NP-8801");
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toContain("NP-8801");
    expect(editorForPage(7)).toBe(e);
    // Unknown text: top of the page.
    expect(await revealText(7, "Steht nirgends auf der Seite.", open)).toBe(false);
    expect(e.state.selection.from).toBe(1);
    unregister();
    expect(editorForPage(7)).toBeNull();
  });

  it("clears the flash after a while", () => {
    vi.useFakeTimers();
    const e = make(PAGE);
    const r = locateText(e.state.doc, ["Intro ohne Bezug"])!;
    e.view.dispatch(e.state.tr.setMeta(citeFlashKey, r));
    expect(citeFlashKey.getState(e.state)!.find()).toHaveLength(1);
    // Mapped through edits.
    e.commands.insertContentAt(0, "<p>Neu</p>");
    expect(citeFlashKey.getState(e.state)!.find()[0].from).toBeGreaterThan(r.from);
    e.view.dispatch(e.state.tr.setMeta(citeFlashKey, null));
    expect(citeFlashKey.getState(e.state)!.find()).toHaveLength(0);
    expect(FLASH_MS).toBeGreaterThan(500);
  });
});
