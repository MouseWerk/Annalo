// Block-based Markdown page editor.

import { invoke } from "./api.js";
import { render, toggleTask } from "./markdown.js";
import { $, h, toast, errorText, emit, showAlerts, hours } from "./ui.js";
import { renderInline, VIEW_TITLES } from "./views.js";

const SLASH_ITEMS = [
  { key: "text", label: "Text", icon: "¶", type: "paragraph", content: "" },
  { key: "h1", label: "Überschrift", icon: "H", type: "heading", content: "# " },
  { key: "todo", label: "To-do-Liste", icon: "☑", type: "todo", content: "- [ ] " },
  { key: "code", label: "Code", icon: "{}", type: "code", content: "```\n\n```" },
  { key: "callout", label: "Hinweis", icon: "❝", type: "callout", content: "> " },
  { key: "zeit", label: "Zeit buchen", icon: "⏱", type: "paragraph", content: "/zeit ", hint: "/zeit NP-8801/1020 2.5h" },
  ...Object.entries(VIEW_TITLES).filter(([k]) => k !== "export").map(([k, label]) => ({ key: k, label: `Ansicht: ${label}`, icon: "▦", type: "view", content: k })),
];

function inferType(content, current) {
  if (current === "view" || current === "timelog") return current;
  if (content.startsWith("```")) return "code";
  if (/^#{1,3}\s/.test(content)) return "heading";
  if (/^\s*[-*]\s+\[( |x|X)\]/.test(content)) return "todo";
  if (content.startsWith(">")) return "callout";
  return "paragraph";
}

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

export async function renderPage(root, pageId, { findPage, navigate, openSplit }) {
  const page = findPage(pageId);
  if (!page) {
    root.replaceChildren(h("div", { class: "canvas-inner" }, h("p", { class: "empty" }, "Seite nicht gefunden.")));
    return;
  }
  const blocks = await invoke("page_blocks", { pageId });
  const inner = h("div", { class: "canvas-inner" });
  root.replaceChildren(inner);

  const title = h("input", { class: "page-title", value: page.title, "aria-label": "Seitentitel" });
  let renameTimer;
  title.addEventListener("input", () => {
    clearTimeout(renameTimer);
    renameTimer = setTimeout(async () => {
      await invoke("rename_page", { id: pageId, title: title.value.trim() || "Ohne Titel" });
      emit("pages");
    }, 400);
  });

  const crumbs = [];
  for (let p = findPage(page.parent_id); p; p = findPage(p.parent_id)) crumbs.unshift(p);
  inner.append(
    h("div", { class: "page-head" },
      h("span", { class: "page-icon" }, page.icon ?? "📄"),
      title,
      h("button", { class: "btn", title: "Split-Ansicht: Seite neben einer Datenbank-Ansicht", onclick: () => openSplit(pageId) }, "⫽ Split"),
      h("button", { class: "btn", title: "Unterseite anlegen", onclick: async () => {
        const p = await invoke("create_page", { parentId: pageId, title: "Neue Seite", icon: "📄" });
        emit("pages");
        navigate(`#/page/${p.id}`);
      } }, "＋ Unterseite"),
      h("button", { class: "btn danger", title: "Seite löschen", onclick: async () => {
        if (!confirm(`„${page.title}“ und alle Unterseiten löschen?`)) return;
        await invoke("delete_page", { id: pageId });
        emit("pages");
        navigate("#/");
      } }, "🗑"),
    ),
    h("div", { class: "page-meta" },
      h("span", { class: "crumbs" }, ...crumbs.flatMap((c) => [h("a", { href: `#/page/${c.id}` }, c.title), " / "])),
      h("span", {}, `${blocks.length} Blöcke`),
    ),
  );

  const list = h("div", { class: "blocks" });
  inner.append(list);
  for (const b of blocks) list.append(blockEl(b));

  const addBlock = async (type = "paragraph", content = "") => {
    const b = await invoke("add_block", { pageId, blockType: type, content });
    const el = blockEl(b);
    list.append(el);
    edit(el, b);
  };
  inner.append(h("button", { class: "add-block", onclick: () => addBlock() }, "＋ Block hinzufügen  (/ für Blocktypen)"));

  function blockEl(b) {
    const el = h("div", { class: `block ${b.block_type}`, "data-id": b.id });
    const handle = h("button", { class: "handle", title: "Block löschen", "aria-label": "Block löschen" }, "⋮⋮");
    handle.addEventListener("click", async () => {
      await invoke("delete_block", { id: b.id });
      el.remove();
    });
    const view = h("div", { class: "rendered" });
    el.append(handle, view);
    paint(el, view, b);
    return el;
  }

  function paint(el, view, b) {
    el.className = `block ${b.block_type}`;
    if (b.block_type === "view") {
      view.replaceChildren();
      const box = h("div", { class: "inline-view" }, h("div", { class: "inline-view-title" }, `▦ ${VIEW_TITLES[b.content_markdown] ?? b.content_markdown}`));
      const body = h("div");
      box.append(body);
      view.append(box);
      renderInline(body, b.content_markdown).catch((e) => body.append(errorText(e)));
      return;
    }
    view.innerHTML = b.content_markdown.trim() ? render(b.content_markdown) : '<p style="color:var(--text-3)">Tippe etwas oder „/“ für Befehle …</p>';
    view.onclick = async (ev) => {
      const box = ev.target.closest("input[type=checkbox]");
      if (box) {
        const content = toggleTask(b.content_markdown, +box.dataset.line);
        Object.assign(b, await invoke("update_block", { id: b.id, blockType: b.block_type, content }));
        paint(el, view, b);
        return;
      }
      const wiki = ev.target.closest("a.wiki");
      if (wiki) {
        ev.preventDefault();
        const target = findPage(null, wiki.dataset.pageTitle);
        target ? navigate(`#/page/${target.id}`) : toast(`Seite „${wiki.dataset.pageTitle}“ existiert nicht`);
        return;
      }
      if (ev.target.closest("a")) return;
      if (b.block_type !== "timelog") edit(el, b);
    };
  }

  function edit(el, b) {
    const view = $(".rendered", el);
    const ta = h("textarea", { rows: 1, spellcheck: "true", "aria-label": "Block bearbeiten" });
    ta.value = b.content_markdown;
    view.replaceWith(ta);
    autosize(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    let menu = null;
    let menuItems = [];
    let done = false;

    const finish = async (save = true) => {
      if (done) return;
      done = true;
      menu?.remove();
      const content = ta.value;
      if (save && content !== b.content_markdown) {
        try {
          Object.assign(b, await invoke("update_block", { id: b.id, blockType: inferType(content, b.block_type), content }));
        } catch (e) {
          toast("Speichern fehlgeschlagen", { kind: "error", detail: errorText(e) });
        }
      }
      const fresh = h("div", { class: "rendered" });
      ta.replaceWith(fresh);
      paint(el, fresh, b);
    };

    const logZeit = async () => {
      try {
        const out = await invoke("log_time", { line: ta.value.trim() });
        const e = out.entry;
        const label = `⏱ ${hours(e.duration_minutes)}h · ${ta.value.trim().split(/\s+/)[1]} · ${e.description || "ohne Beschreibung"}`;
        ta.value = label;
        b.block_type = "timelog";
        Object.assign(b, await invoke("update_block", { id: b.id, blockType: "timelog", content: label }));
        toast(`Gebucht: ${hours(e.duration_minutes)}h`, { detail: e.description });
        showAlerts(out.alerts);
        emit("entries");
        done = true;
        const fresh = h("div", { class: "rendered" });
        ta.replaceWith(fresh);
        paint(el, fresh, b);
        addBlock();
      } catch (err) {
        toast("Buchung fehlgeschlagen", { kind: "error", detail: errorText(err) });
      }
    };

    const showMenu = () => {
      menu?.remove();
      const q = ta.value.slice(1).toLowerCase();
      const items = SLASH_ITEMS.filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.startsWith(q));
      if (!items.length || ta.value.includes(" ")) return (menu = null);
      menuItems = items;
      menu = h("div", { class: "slash-menu", role: "listbox" },
        ...items.map((i, n) => h("button", { class: n === 0 ? "sel" : "", onmousedown: (ev) => { ev.preventDefault(); apply(i); } },
          h("span", {}, i.icon), i.label, i.hint ? h("small", {}, i.hint) : null)));
      el.append(menu);
    };

    const apply = async (item) => {
      menu?.remove();
      menu = null;
      if (item.type === "view") {
        done = true;
        Object.assign(b, await invoke("update_block", { id: b.id, blockType: "view", content: item.content }));
        const fresh = h("div", { class: "rendered" });
        ta.replaceWith(fresh);
        paint(el, fresh, b);
        return;
      }
      b.block_type = item.type;
      ta.value = item.content;
      autosize(ta);
      ta.focus();
    };

    ta.addEventListener("input", () => {
      autosize(ta);
      ta.value.startsWith("/") && !ta.value.startsWith("/zeit ") ? showMenu() : (menu?.remove(), (menu = null));
    });
    ta.addEventListener("keydown", (ev) => {
      if (menu && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
        ev.preventDefault();
        const btns = [...menu.querySelectorAll("button")];
        const i = btns.findIndex((x) => x.classList.contains("sel"));
        btns[i]?.classList.remove("sel");
        btns[(i + (ev.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length].classList.add("sel");
        return;
      }
      if (menu && ev.key === "Enter") {
        ev.preventDefault();
        const btns = [...menu.querySelectorAll("button")];
        const i = Math.max(0, btns.findIndex((x) => x.classList.contains("sel")));
        apply(menuItems[i]);
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey && /^\/(zeit|time)\s/i.test(ta.value.trim())) {
        ev.preventDefault();
        logZeit();
        return;
      }
      if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey))) {
        ev.preventDefault();
        finish();
        return;
      }
      // Enter at the end of a one-line text block starts a new block.
      if (ev.key === "Enter" && !ev.shiftKey && b.block_type === "paragraph" && !ta.value.includes("\n")
          && ta.selectionStart === ta.value.length && ta.value.trim()) {
        ev.preventDefault();
        finish().then(() => addBlock());
      }
    });
    ta.addEventListener("blur", () => setTimeout(() => finish(), 120));
  }
}
