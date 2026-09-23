# AETHER OS

A local-first productivity workspace for Windows: block-based Markdown notes,
precise time tracking on project structures (Projekt → Netzplan/PSP-Element → Vorgang →
Leistungsart), Netzplan scheduling with critical path, and an AI assistant that runs
through a LiteLLM proxy (local Ollama/vLLM or cloud models).

```
┌────┬──────────────────┬───────────────────────────────────────────┬──────────────┐
│rail│ Systems & AI     │ ← →        QUICK ACTION BAR  [Search] / t/s│              │
│ ⊞  │ ┌ LiteLLM Chat ┐ │ # TODAY'S FOCUS: AETHER ROLLOUT            │ TIME TRACKING│
│ ✎  │ │ …            │ │ ▾ Projektplan        ▾ Vorgang             │ Systeminteg… │
│ ✦  │ └──────────────┘ │   NP-8801 …            Status  Kritisch    │   00:45:12   │
│ ▤  │ Token Usage      │   • 1020 …             Budget  29/40h      │   [ STOP ]   │
│ ⬡  │ Custom Tool Tiles│ ▾ Aktive Vorgänge (table with pills)       │ UPCOMING     │
└────┴──────────────────┴───────────────────────────────────────────┴──────────────┘
```

## Repository layout

| Path | What it is |
|---|---|
| `crates/aether-core` | Platform-independent core (Rust): SQLite + FTS5 store, `/zeit` parser, time tracking, budget/ETC alerts, CPM Netzplan, exports (SAP CATS, Jira, CSV, JSON), idle detection (Win32), LiteLLM client, model router, token/cost metrics, local RAG, function calling |
| `crates/aether-cli` | `aether` command line on the same database (headless use, scripting, tests) |
| `src-tauri` | Tauri v2 desktop shell: IPC commands, Mica window, global `Alt+Space`, activity sampler |
| `ui` | Web UI as plain ES modules (no build step). Opened in a normal browser it runs against an in-memory preview backend (`ui/js/mock.js`) |
| `config` | Example `aether.config.json` and LiteLLM proxy config |
| `docs/ARCHITECTURE.md` | Design, data model, and how the concept spec maps to the implementation |

## Quick start

### Core and CLI (any OS)

```sh
cargo test -p aether-core                  # 43 tests: parser, CPM, budgets, exports, FTS, RAG, SSE client …
cargo run -p aether-cli -- --db demo.db demo
cargo run -p aether-cli -- --db demo.db zeit NP-8801/1020 2.5h '#DEV' "'Systemintegration'"
cargo run -p aether-cli -- --db demo.db budget NP-8801
cargo run -p aether-cli -- --db demo.db schedule NP-8801
cargo run -p aether-cli -- --db demo.db export --format cats --pernr 00012345 --mark
```

### Desktop app (Windows 10/11)

Prerequisites: Rust (stable, MSVC), WebView2 runtime (preinstalled on Windows 11), and
the Tauri CLI (`cargo install tauri-cli --version "^2"`).

```sh
cd src-tauri
cargo tauri dev        # run
cargo tauri build      # MSI + NSIS installer in target/release/bundle
```

On first launch the app creates `%APPDATA%\os.aether.workspace\workspace.db` (seeded with a
demo project) and `aether.config.json` next to it.

### UI preview without the native shell

```sh
cd ui && python -m http.server 8765    # open http://localhost:8765
```

### AI (optional)

Start a LiteLLM proxy, e.g. with `config/litellm.config.example.yaml`, and set
`LITELLM_API_KEY` if the proxy requires a key. The app talks to `http://localhost:4000`
by default (`litellm_base_url` in `aether.config.json`). Without a proxy everything
except the chat works offline.

## Using it

- **Book time inline**: type `/zeit NP-8801/1020 2.5h #DEV 'Systemintegration'` in any block
  and press Enter, or use the time-tracking card or the command palette.
  Durations: `2.5h`, `2,5h`, `90m`, `1h30m`, `1:30`. Optional: `#LEISTUNGSART`, `@gestern`,
  `@22.09.`, `@2026-09-22`, `@08:30` (start time). Unknown Netzpläne, Vorgänge or
  Leistungsarten are rejected.
- **Timer**: pick Projekt → Netzplan → Vorgang → Leistungsart, press Start. Idle time over
  5 minutes (keyboard/mouse inactivity) is detected, and you can subtract it when stopping.
- **Budget alerts**: every booking reports warning (≥ 75 %), critical (≥ 90 % or forecast EAC
  above plan) and exceeded states. ETC = plan − booked, or a manual remaining estimate.
- **Export**: SAP CATS (`PERNR;WORKDATE;RPROJ;RNPLNR;VORNR;LSTAR;CATSHOURS;MEINH;LTXA1`, German
  decimals), Jira worklogs (`issueKey`, `started`, `timeSpentSeconds`, with a Netzplan/Vorgang →
  issue mapping), CSV, JSON. Entries move Entwurf → Freigegeben → Exportiert (drag them on the Kanban).
- **Assistant**: routes each prompt to a local, standard or reasoning model based on
  complexity (`@local` / `@reasoning` or the model picker override it). Content tagged
  `#privat`/`#vertraulich` never leaves the local model. Answers use hybrid retrieval
  (FTS5 + vectors) over notes and time logs. Tools: `log_time`, `search_workspace` and
  `budget_status` run directly; PowerShell, git (read-only subcommands) and HTTP calls are
  shown to you and run only after you approve them.

### Keyboard

| Keys | Action |
|---|---|
| `Alt+Space` (global) / `Ctrl+K` | Quick Action Bar (command palette, search, `/zeit`, `?question`) |
| `Ctrl+Shift+T` | Start/stop timer |
| `Ctrl+Shift+A` | Focus the assistant |
| `Ctrl+.` | Focus Mode |
| `Ctrl+\` / `Ctrl+J` | Toggle side panel / time-tracking card |
| `Alt+←` / `Alt+→` | Back / forward |
