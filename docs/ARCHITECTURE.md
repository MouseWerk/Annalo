# Architecture

## Layers

```
 ui/ (ES modules, WebView2)          ── invoke()/listen() ──▶  src-tauri (IPC commands, state, sampler)
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
| `time_entries` | `netzplan_id`, `vorgang_nr`, `leistungsart`, `start_time`, `end_time`, `duration_minutes`, `description`, `status_flag` (`running`/`draft`/`released`/`exported`), `source`. A partial unique index allows only one running timer |
| `pages`, `notes_blocks` | Page tree and Markdown blocks. `vector_embedding` is a little-endian `f32` BLOB, cleared by a trigger when the text changes |
| `notes_blocks_fts`, `time_entries_fts` | FTS5 external-content indexes (unicode61, diacritics removed), kept in sync by triggers |
| `ai_usage` | Per-request tokens, cost, TTFT and tokens/s |

Migrations are numbered and tracked through `PRAGMA user_version`; a database newer than
the binary is refused rather than modified.

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
| Database views: Table, Kanban, Timeline/Gantt, Netzplan, Graph | `ui/js/views.js` | Every view can also be embedded in a page as a block (`/` → "Ansicht: …") |

## Verification status

- `aether-core`: 43 unit and integration tests (including a fake LiteLLM SSE server).
  `cargo clippy` is clean.
- `src-tauri`: compiles on Linux (WebKitGTK). The Windows-only Win32 probe was type-checked
  against `x86_64-pc-windows-gnu`. The Windows installer build runs in CI (`.github/workflows/ci.yml`)
  and has not been run locally.
- UI: every view has been exercised in headless Chromium against the preview backend
  (no console errors), in dark and light themes.
