# AETHER OS

A local-first desktop workspace for Windows: Markdown notes with `[[links]]`,
backlinks and tags (an Obsidian replacement), precise time tracking on project
structures (Projekt → Netzplan/PSP-Element → Vorgang → Leistungsart), and an AI
assistant that runs against **your own LiteLLM server**.

## What you get

**Notes**
- Live-preview Markdown editor: headings, lists, task lists, tables, code blocks with syntax highlighting, highlights, links
- `[[Wiki links]]` with autocomplete; clicking a missing page creates it; renames rewrite links everywhere
- Backlinks under every page and in the side panel, outline, tags (`#tag`) with a tag view
- Daily notes (Ctrl Shift D) with previous/next day navigation, optionally from a template
- Tasks across all notes (Ctrl Shift A): `- [ ] Angebot senden 📅 2026-09-30 !!` (also `due:2026-09-30`; `!!` = hoch, `!` = mittel), grouped into Überfällig / Heute / Diese Woche / Später / Ohne Datum, filterable by status and tag, checked off right in the list
- Images: paste or drop screenshots into a note; they are stored under `attachments/` and embedded as `![[name.png]]`
- Templates: pages under „Vorlagen“ with `{{datum}}`, `{{date}}`, `{{zeit}}`, `{{titel}}`, `{{wochentag}}`, `{{kw}}`; `/Vorlage einfügen` or „Neue Seite aus Vorlage…“ in the palette
- Slash menu (`/`), formatting toolbar on selection, a table toolbar (rows, columns, header) while the cursor is in a table, find in page (Ctrl F)
- Version history: „Versionen…“ in the page menu lists earlier states (kept 30 days) with a diff against now, and restores them
- Tabs, favorites, a drag-and-drop page tree, a command palette (Ctrl K) and a quick switcher (Ctrl O)
- Import an Obsidian vault (folders, frontmatter, links, tags and images kept), export everything back to Markdown files

**Time tracking**
- Type `/zeit NP-8801/1020 2.5h #DEV Systemintegration` in any note and press Enter. It books the time and leaves a chip in the note
- `/zeit` autocompletes: Netzplan/Vorgang (recently booked first, with the remaining plan hours) and, after `#`, the Leistungsart
- Link a note to a Vorgang with the property `vorgang: NP-8801/1020` (or `netzplan: NP-8801`): the page shows a work card with budget, ETC, the latest bookings and a timer button, and `/zeit 1.5h Abstimmung` there books on that Vorgang
- Timer with idle detection (inactive time can be subtracted), quick booking, manual entries
- Weekly timesheet with a grid per Netzplan/Vorgang, release workflow, and export to SAP CATS, Jira worklogs, CSV or JSON
- Projects view: budget, booked hours, remaining effort (ETC), forecast (EAC), critical path and float, as tables
- Budget warnings when a booking pushes a Netzplan or Vorgang over its thresholds

**Desktop**
- Tray icon: open, stop the timer or restart the last booking, quick capture, quit; the tooltip shows the running timer (`NP-8801/1020 · 01:23`)
- Closing hides the window to the tray (Settings → Desktop), start with Windows (minimized), one instance per workspace
- Quick capture (Ctrl Shift Space, global): one line into today's daily note, `todo …` / `- [ ] …` as a task, `/zeit …` books time
- End-of-day reminder on workdays when less than the daily target is booked (default 17:30), and once when a timer is still running after 20:00

**Assistant**
- Streams answers from your LiteLLM server; knows the open page and searches notes and time logs (keyword + semantic)
- Model routing: local, standard and reasoning models; `#privat` content always stays on the local model
- Can book time, search and check budgets; system tools (PowerShell, git, HTTP) only run after you approve them
- „Wochenbericht erstellen“ (Ctrl K) drafts this week's status e-mail from your bookings and done tasks; „In neue Seite einfügen“ saves it as „Wochenbericht KW nn“
- Shows sources, time to first token, tokens/s, tokens and cost per answer and per session

## Connecting your LiteLLM server

Settings → **KI & LiteLLM**:

1. **Server-URL**: e.g. `https://llm.your-company.com`
2. **API-Token**: your LiteLLM virtual key or master key. It is stored in the Windows Credential Manager, never in a file or the database
3. **Testen** lists the server's models; pick the models for *Lokal*, *Standard*, *Reasoning* and (optionally) *Embeddings*

Changes apply immediately, with no restart. `config/litellm.config.example.yaml` shows a matching proxy configuration.

## Building

Prerequisites: Rust (stable, MSVC on Windows), Node 22, and on Windows the WebView2 runtime (preinstalled on Windows 11).

```sh
npm ci --prefix ui
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri dev      # run with hot reload
cargo tauri build    # NSIS + MSI installers in target/release/bundle
```

Data lives in `%APPDATA%\os.aether.workspace\` (`workspace.db`); Settings → AETHER OS → „Speicherort ändern…“ moves it
(avoid OneDrive/Dropbox and network folders for the database; backups there are fine). The first start seeds a small demo workspace.
The database is backed up daily into `backups` there (or a folder chosen under Settings → Sicherung), and deleted
pages stay in the trash for 30 days.

## Automatische Updates einrichten

The app updates itself from GitHub releases: at start, every 6 hours (Settings → Über → „Automatisch nach Updates
suchen“) and via „Jetzt nach Updates suchen“ it reads
`https://github.com/mauricekleindienst/aetheros/releases/latest/download/latest.json`. A newer version shows a toast
„Version X verfügbar“ with „Installieren und neu starten“ and the release notes („Was ist neu?“); nothing is installed
without that click. Before installing, all open editors are saved; the signed NSIS installer then runs passively and
restarts the app.

Updates must be signed. The public key is compiled into the app, so the updater is **only active in builds made with
`AETHER_UPDATER_PUBKEY`** (the release workflow). Local and CI builds show „Automatische Updates sind in diesem Build
nicht eingerichtet“ and never contact the update server. One-time setup:

1. Create the signing keypair (choose a password; keep the private key safe and **never commit it**):
   ```sh
   cargo tauri signer generate -w ~/.tauri/aether.key
   ```
   This writes `~/.tauri/aether.key` (private) and `~/.tauri/aether.key.pub` (public).
2. On GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**, add:

   | Secret | Value |
   |---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | the full content of `~/.tauri/aether.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password from step 1 |
   | `AETHER_UPDATER_PUBKEY` | the full content of `~/.tauri/aether.key.pub` |

3. Release a version. The tag is the version (`vMAJOR.MINOR.PATCH`, numeric – the MSI needs it): the workflow
   `.github/workflows/release.yml` writes it into `src-tauri/tauri.conf.json` and `Cargo.toml` for the build. Bump
   `version` in both files in the repository too, so local builds match:
   ```sh
   git commit -am "Release 1.1.0"
   git tag -a v1.1.0 -m "Was ist neu: …"   # the tag message becomes the release notes
   git push && git push --tags             # or: git tag v1.1.0 && git push --tags
   ```
   The workflow builds NSIS + MSI with their `.sig` files and publishes the release with `latest.json`. Installed
   versions from then on find the update. The first version with the updater (built by this workflow) has to be
   installed manually once.

If the private key is lost, installed apps cannot verify new releases: create a new keypair, update the secrets and
install the next version manually. Keep a backup of the key and its password.

## Tests

```sh
cargo test -p aether-core      # core: parser, CPM, budgets, exports, FTS, RAG, notes, vault, settings
e2e/run.sh                     # end-to-end: drives the real desktop app via WebDriver (Linux, Xvfb)
```

The end-to-end suite starts the actual app binary under `tauri-driver`, with a fresh data directory per test file,
and a fake LiteLLM server for the assistant tests. It also saves screenshots of every screen (dark and light) to `e2e/screenshots/`.

## Repository layout

| Path | Contents |
|---|---|
| `crates/aether-core` | Rust core: SQLite + FTS5 store, documents/links/tags, `/zeit` parser, time tracking, budgets, CPM, exports, idle detection (Win32), LiteLLM client, router, RAG, tools, vault import/export |
| `crates/aether-cli` | `aether` command line on the same database |
| `src-tauri` | Tauri v2 desktop shell: IPC commands, credential storage, global shortcuts, tray, quick capture, reminders, activity sampler |
| `ui` | React + TypeScript + TipTap frontend (Vite), Lucide icons |
| `e2e` | WebdriverIO end-to-end tests against the desktop app |
| `docs/ARCHITECTURE.md` | Design notes |

## Keyboard

| Keys | Action |
|---|---|
| Ctrl K / Alt Space (global, configurable) | Command palette, search, `/zeit …`, `? question` |
| Ctrl Shift Space (global) | Quick capture |
| Ctrl O | Quick switcher |
| Ctrl N | New page |
| Ctrl Shift D | Today's daily note |
| Ctrl Shift A | Tasks |
| Ctrl Shift T | Start/stop timer |
| Ctrl J | Assistant |
| Ctrl F | Find in page |
| Ctrl W / Ctrl Tab | Close / switch tab |
| Ctrl \ / Ctrl Shift \ | Toggle sidebar / side panel |
| Ctrl . | Focus mode |
| Ctrl , | Settings |
