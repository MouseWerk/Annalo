# Architecture

## Layers

```
 ui/ (React + TipTap, WebView2)      ── invoke()/listen() ──▶  src-tauri (IPC commands, state, secrets, sampler)
                                                                    │
 crates/aether-cli ─────────────────────────────────────────────────┤
                                                                    ▼
                                             crates/aether-core
            ┌─────────┬──────────┬───────────┬──────────┬──────────┬───────────────┐
            │ db      │ zeit     │ tracking  │ netzplan │ export   │ ai::{client,  │
            │ search  │ (parser) │ (budget)  │ (CPM)    │          │ router, rag,  │
            │ graph   │          │ activity  │          │          │ metrics,tools}│
            └─────────┴──────────┴───────────┴──────────┴──────────┴───────────────┘
                      SQLite (WAL, FTS5, f32 BLOB embeddings)     LiteLLM proxy (HTTP/SSE)
```

All logic lives in `aether-core` and is tested there; the shell only wires state,
events and OS integration. The UI never talks to the network or the filesystem directly.

## Data model (`crates/aether-core/migrations/0001_init.sql`)

| Table | Purpose |
|---|---|
| `projects` | Level 1: `project_code` (e.g. `PRJ-2026-X`) |
| `netzplaene` | Level 2: `netzplan_nr`, `wbs_element` (PSP-Element), `planned_hours` |
| `vorgaenge` + `vorgang_links` | Level 3: activities with duration, plan hours, optional manual remaining estimate, and precedence links for CPM |
| `leistungsarten` | Level 4: activity types (`DEV`, `CONSULTING`, `PM`, `TEST`) |
| `time_entries` | `netzplan_id`, `vorgang_nr`, `leistungsart`, `start_time`, `end_time`, `duration_minutes`, `description`, `status_flag` (`running`/`draft`/`released`/`exported`), `source`, `page_id` (the note a `/zeit` line was typed in, v5; cleared when the page is purged). A partial unique index allows only one running timer |
| `pages` | Page tree; `content` holds the page as one Markdown document (v2). `daily_date` marks daily notes, `favorite` pins pages, `deleted_at` marks pages in the trash (v3) |
| `notes_blocks` | Derived chunk index (split at headings, ~1200 chars) rebuilt on every save; `vector_embedding` is a little-endian `f32` BLOB. Unchanged chunks keep their embedding |
| `page_links`, `page_tags` | Outgoing `[[links]]` (lower-cased targets, so links to not-yet-existing pages resolve later) and `#tags`, for backlinks and the tag view |
| `tasks` | Task items (`- [ ] …` outside code blocks) per page: ordinal, line, text, done, due date (`📅 YYYY-MM-DD` / `due:YYYY-MM-DD`), priority (`!!` hoch, `!` mittel), tags. Rebuilt with links and tags on every save; checking a task off rewrites exactly that checkbox and saves the page |
| `pages_fts` | FTS5 over page titles (title hits rank first in search) |
| `settings` | Application settings as JSON. The LiteLLM API key is **not** stored here; the shell keeps it in the Windows Credential Manager |
| `notes_blocks_fts`, `time_entries_fts` | FTS5 external-content indexes (unicode61, diacritics removed), kept in sync by triggers |
| `ai_usage` | Per-request tokens, cost, TTFT and tokens/s |

Migrations are numbered and tracked through `PRAGMA user_version`; a database newer than
the binary is refused rather than modified.

Migration v2 converts the old block model: blocks are concatenated into
`pages.content`, then every page is re-indexed (chunks, links, tags).

## Data safety

- **Trash** (`trash.rs`): deleting a page sets `deleted_at` on it and its subtree (one shared stamp, so
  subpages trashed earlier stay separate entries). Every normal query (tree, search, links, tags, RAG,
  export) skips trashed pages. Restoring puts a page back under its parent, or at the top level if the
  parent is gone; title and daily-note clashes are resolved. Entries older than 30 days are purged on start.
- **Backups** (`backup.rs`): `VACUUM INTO` writes a consistent snapshot `aether-YYYYMMDD-HHMMSS.db`;
  older files beyond `backup_keep` (default 14) are deleted. The shell backs up on start when the newest
  backup is older than 24 h and re-checks hourly, into `backup_dir` or `<data dir>/backups`.

## Notes model

- The editor (TipTap/ProseMirror) loads and saves Markdown via `@tiptap/markdown`. Custom nodes serialize to portable syntax:
  `[[Target#Heading|Alias]]` for links and `<time-entry id=… hours=… target=…>text</time-entry>` for booked time.
- YAML frontmatter is split off before editing and re-attached on save, so imported Obsidian notes keep their properties.
  The property editor under the title (`ui/src/lib/frontmatter.ts`) reads `key: value`, dates and lists; anything more complex
  stays a raw YAML row and is written back verbatim. Its edits go through the editor's save path (one writer per page).
- A `vorgang:` / `netzplan:` property links a page to the WBS (`pagework.rs`): the work card shows budget, ETC and recent
  bookings, and `/zeit` lines without a reference on that page book on it.
- Autosave runs 450 ms after the last change and on window blur. Renames rewrite `[[links]]` in every referencing page.
- Images live as files in `<data_dir>/attachments/`, named by the first 16 hex digits of their SHA-256 (same image, same file),
  and are embedded Obsidian-style as `![[name.png|300]]`. The shell serves them through the `aether-asset:` URI scheme, which
  only answers plain file names inside that folder (no separators, `..` or hidden files; canonical path checked). Regular
  `![alt](https://…)` images load directly (CSP `img-src https:`). Vault import copies images by name; export writes the embedded ones to `attachments/`.
- Templates are the pages below the top-level page „Vorlagen“ (`templates.rs`); placeholders are filled by `apply_template`.
  The daily note uses `settings.daily_template` when set.

## Key algorithms

- **`/zeit` parser** (`zeit.rs`): tokenizer with straight and typographic quotes; the
  reference `NP/Vorgang` or a WBS element; durations in h/m/`h:mm`; options `#LA`, `@date`, `@hh:mm`.
  "Today" without a start time books the block as ending now; past days default to 08:00 local.
- **Budget / ETC** (`tracking.rs`): per Vorgang ETC = manual remaining estimate or
  `max(plan − booked, 0)`; Netzplan ETC = sum of its Vorgänge; EAC = booked + ETC.
  Levels: warning ≥ 75 %, critical ≥ 90 % or EAC > plan, exceeded when booked > plan.
- **CPM** (`netzplan.rs`): Kahn topological sort (cycle detection), forward pass FAZ/FEZ,
  backward pass SAZ/SEZ, GP = SAZ − FAZ, FP = min(FAZ of successors) − FEZ, and one walked critical path.
- **Router** (`ai/router.rs`): transparent score (prompt/context length, code, reasoning
  cues, tool use, minus simple transformations) → local / standard / reasoning tier.
  Privacy markers override everything, including manual overrides.
- **RAG** (`ai/rag.rs`): exact cosine scan over stored embeddings fused with FTS5 BM25
  hits (reciprocal rank fusion), so exact identifiers like `NP-8801` are always found.
  Template pages (the „Vorlagen“ subtree) are never retrieved.
- **Time summary** (`report.rs`): finished entries of local days `from..=to` grouped per Netzplan/Vorgang
  (hours, deduplicated descriptions) plus a total per day; offered to the assistant as the `time_summary` tool.
- **Streaming** (`ai/client.rs`): SSE decoder tolerant of split chunks and keep-alives;
  tool-call deltas are merged by index; `stream_options.include_usage` for exact counts,
  LiteLLM's `x-litellm-response-cost` header preferred for cost, the price table as fallback.

## How the concept spec maps to this implementation

| Spec | Implementation | Notes |
|---|---|---|
| WinUI 3 **or** Tauri v2 (Rust core) | Tauri v2 | One Rust core shared by the desktop app, the CLI and the tests. Mica is set through `windowEffects` |
| Win2D, 120/240 Hz | WebView2 (GPU-composited) | Animations use compositor-friendly properties and run at the display refresh rate. There is no custom Win2D render loop |
| SQLite + FTS5 + vector extension | SQLite (bundled) + FTS5 + BLOB embeddings with exact cosine scan | `sqlite-vss` is deprecated and not bundled. An exact scan is fast enough for personal workspaces. `sqlite-vec` is the upgrade path for very large corpora |
| < 5 ms cold start | The core opens the DB, runs queries and exits in ~6 ms (release CLI, Linux) | The desktop app's cold start is dominated by WebView2 initialisation, typically around a few hundred ms. That has not been measured here |
| Win32 hooks for idle and active window | `GetLastInputInfo` and `GetForegroundWindow` sampled every 5 s | No global keyboard/mouse hooks: same result, far less invasive |
| Export SAP PS (CATS), Jira, JSON, CSV | `export.rs` | CATS as an upload file (CATSDB field names). Jira as payloads for `POST /rest/api/3/issue/{key}/worklog`. Nothing is uploaded automatically |
| Function calling: PowerShell, Git, REST | `ai/tools.rs` | Every system call needs explicit user approval. git is limited to read-only subcommands, and options that execute programs are rejected |
| Database views | Timesheet (week grid + entries), Projects (tables with budget, ETC, critical path) | Graphical network diagrams and graph views were dropped in favour of tables |

## Verification status

- `aether-core`: unit and integration tests (including a fake LiteLLM SSE server); `cargo clippy` clean.
- End-to-end: `e2e/run.sh` builds the desktop app with the production frontend embedded and drives it through
  WebDriver (`tauri-driver` + WebKitWebDriver under Xvfb): notes, links, rename, tags, palette, tabs, find,
  daily notes, `/zeit`, timer, timesheet, export, projects, settings (LiteLLM URL, token, models), the assistant
  (streaming, tool calls, approvals, cancel), embeddings, vault import/export, and screenshots in both themes.
- The Windows build (WebView2, Credential Manager, Win32 idle probe) is built in CI on `windows-latest`.
