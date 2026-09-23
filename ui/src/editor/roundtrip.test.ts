// Markdown fidelity: what goes into the editor must come out unchanged, so
// notes stay compatible with Obsidian and plain Markdown tools.

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions, toMarkdown } from "./schema";

function roundtrip(md: string) {
  const el = document.createElement("div");
  const editor = new Editor({ element: el, extensions: buildExtensions(), content: md, contentType: "markdown" });
  const out = toMarkdown(editor);
  editor.destroy();
  return out;
}

const CASES: Record<string, string> = {
  paragraphs: "Erster Absatz.\n\nZweiter Absatz mit **fett**, *kursiv*, ~~durch~~ und `code`.\n",
  headings: "# H1\n\n## H2\n\n### H3\n\nText\n",
  wikilinks: "Siehe [[Architektur]], [[Jour fixe 22.09.|den Jour fixe]] und [[Seite#Abschnitt]].\n",
  tags: "Notiz #projekt #rollout/phase-2 und #meeting\n",
  highlight: "Das ist ==wichtig== hier.\n",
  bullets: "- eins\n- zwei\n  - verschachtelt\n- drei\n",
  ordered: "1. eins\n2. zwei\n3. drei\n",
  tasks: "- [ ] offen\n- [x] erledigt\n",
  quote: "> Ein Zitat\n> über zwei Zeilen\n",
  callout: "> [!note] Hinweis\n> Callout-Text\n",
  calloutWarning: "> [!warning] Achtung\n> Nicht löschen\n",
  code: "```ts\nconst x = 42;\n```\n",
  table: "| A   | B   |\n| --- | --- |\n| 1   | 2   |\n",
  link: "Web: [Anthropic](https://www.anthropic.com)\n",
  hr: "Oben\n\n---\n\nUnten\n",
  timeEntry: 'Gebucht: <time-entry id="12" hours="2,50" target="NP-8801/1020">Systemintegration</time-entry>\n',
  umlauts: "Grüße aus Köln: äöü ß €\n",
  brackets: "Plan [Entwurf] und (Klammern)\n",
  underscores: "Datei snake_case_name und 3 * 4 = 12\n",
  ampersand: "Schulung & Go-Live, a < b\n",
  literalStars: "Kein \\*Fett\\* hier\n",
  literalLinkish: "Text \\[\\[kein Link]]\n",
};

describe("markdown round-trip", () => {
  for (const [name, md] of Object.entries(CASES)) {
    it(name, () => {
      expect(roundtrip(md)).toBe(md);
    });
  }

  it("is stable on a second pass", () => {
    const all = Object.values(CASES).join("\n");
    const once = roundtrip(all);
    expect(roundtrip(once)).toBe(once);
  });
});
