// Safe Markdown rendering for assistant answers.

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Renders Markdown to sanitized HTML; `[[Page]]` becomes a clickable link. */
export function renderMarkdown(md: string): string {
  const withLinks = md.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target: string, alias?: string) =>
    `<a data-wikilink data-target="${escapeHtml(target.trim())}" class="wikilink">${escapeHtml((alias ?? target).trim())}</a>`,
  );
  const html = marked.parse(withLinks, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-wikilink", "data-target", "target"] });
}
