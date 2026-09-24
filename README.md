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
- Daily notes (Ctrl Shift D) with previous/next day navigation, optionally from a template; a calendar (Ctrl Shift C, right-click on the ribbon's daily-note button) shows which days have a note and the booked hours per day against the daily target
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
- Inline AI: select text and press Ctrl J (or „KI“ in the formatting toolbar, `/KI bearbeiten` for the current block): Verbessern, Kürzen, Übersetzen DE↔EN, In Stichpunkte, Als Tabelle, … or your own instruction; the result streams into a preview and replaces the text (one Ctrl Z undoes it) or goes below it
- „Besprechung zusammenfassen“ (page menu, `/Zusammenfassung`): Zusammenfassung, Entscheidungen, Aufgaben (`- [ ] … @Person 📅 …`) and Offene Punkte, inserted at the end of the page or saved as „<Titel> – Zusammenfassung“; on a page with `vorgang:` and a time span (`10:00–11:30`) it adds a `/zeit` booking suggestion
- Answers cite their sources as numbered chips `[1]`: hovering shows the cited passage, clicking opens the page, scrolls to the paragraph and briefly highlights it (the „Quellen“ chips do the same)
- Smart `/zeit`: `/zeit 2h habe am Interface-Mapping gearbeitet` on a page without `vorgang:` asks the AI for the Vorgang and shows „Buchen auf NP-8801/1020 · Systemintegration (DEV)?“ with the reason – Enter books, Tab picks another reference, Esc cancels (also in quick capture). Nothing is booked without confirmation
- Shows sources, time to first token, tokens/s, tokens and cost per answer and per session

## Connecting your LiteLLM server

Settings → **KI & LiteLLM**:

1. **Server-URL**: e.g. `https://llm.your-company.com`
2. **API-Token**: your LiteLLM virtual key or master key. It is stored in the Windows Credential Manager, never in a file or the database
3. **Testen** lists the server's models; pick the models for *Lokal*, *Standard*, *Reasoning* and (optionally) *Embeddings*

Changes apply immediately, with no restart. `config/litellm.config.example.yaml` shows a matching proxy configuration.

## Netzwerk & Proxy

Settings → **Netzwerk** applies to every outgoing connection: the LiteLLM server, the assistant's HTTP tool, the Git
sync and the updater (each can be excluded under „Anwenden auf“).

- **Proxy-Modus**: *Kein Proxy*, *System* (Windows: the WinINet settings of the current user, including the exception
  list and `<local>`; elsewhere `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`), *Manuell* (HTTP, HTTPS and SOCKS
  proxy as `host:port` or URL) or *PAC*
- **Ohne Proxy erreichen**: `host` (and its subdomains), `*.domain` / `.domain` (subdomains only), IPs, CIDR ranges
  (`10.0.0.0/8`), `<local>` (names without a dot) and `*`
- **Anmeldung**: user name in the settings, password in the Windows Credential Manager / macOS Keychain (Basic auth)
- **Zusätzliches Stammzertifikat**: a PEM (also bundles) or DER file of a company root CA, e.g. for TLS-inspecting
  proxies; the page shows the number of certificates, the first subject and its expiry. „Ungültige Zertifikate
  akzeptieren“ exists for troubleshooting only and shows a warning while it is on
- **Verbindung testen** requests `<LiteLLM>/v1/models` with the entered (also unsaved) values and shows whether the
  request went direct or through which proxy, and how long it took

PAC files are JavaScript. The core does not embed a JS engine: the UI evaluates `FindProxyForURL` in a sandboxed frame
(own `aether-pac:` scheme, opaque origin, no access to the app) for the LiteLLM host, GitHub (updates) and the Git
remote when the settings are saved or tested and at every start, and stores the answers. Limitations: no DNS
(`isInNet` only matches IP addresses, `dnsResolve` only returns IP literals, `myIpAddress()` is `127.0.0.1`), and
other hosts (the assistant's HTTP tool) use the answer for the LiteLLM host. Git receives the proxy through
`http_proxy`/`https_proxy`/`no_proxy` and the CA through `http.sslCAInfo` (extra CA plus the system bundle); Git for
Windows verifies with the Windows certificate store (schannel), so install the root CA there.

## Anpassen

Settings are grouped (Allgemein, Arbeiten, KI, System) and searchable. Besides the connections they cover:

| Section | What |
|---|---|
| Darstellung | light/dark, accent color (presets or any hex; lightness is adjusted for WCAG contrast in both modes), UI/editor/code fonts, scale 90–125 %, density, line width, reduced motion, Mica (Windows 11) |
| Sprache & Format | German or English for settings, ribbon, sidebar, tabs, status bar and commands (longer help texts, dialogs and AI prompts stay German), date format |
| Start | open the last tabs, the start page or today's note; remember window size and position; start minimized |
| Tastatur | rebind every in-app shortcut, with conflict detection (commands, editor keys, global shortcuts); Ctrl+Alt is rejected (AltGr) |
| Editor | spell check language, autosave delay, typographic quotes („…“ ‚…‘ –), closing brackets, Tab width and line numbers in code blocks, link hover preview, scroll outline, icon and location of new pages |
| Notizen | daily note title (`2026-09-24`, `24.09.2026`, `Donnerstag, 24.09.2026`) and folder, trash retention, version interval and count |
| Zeiterfassung | week start, rounding (1/5/6/10/15 min, up or nearest) and minimum for bookings and timer stops, hours as `1,50` or `1:30`, default Leistungsart per Netzplan, CATS separator and column order, export file name |
| KI | temperature, answer length, streaming, citations, allowed tools (system tools off by default), monthly cost limit (warning at 80 %, blocked at 100 % unless sent anyway), inline AI actions, meeting summary template |
| Datenschutz | private tags, whether the assistant sees the open page, local model only |
| Benachrichtigungen | each reminder and notice on/off, quiet hours for desktop notifications |
| Verwaltung | export all settings to JSON (never tokens or passwords), import with a preview of the changes, reset one section or everything |

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
pages stay in the trash for 30 days. Each backup also refreshes a read-only Markdown copy of all pages (with images) and
the bookings as `Zeiterfassung/YYYY-MM.csv` (Excel-ready) in `backups/markdown` (configurable under Settings → Sicherung).

## Automatische Updates einrichten

The app updates itself from GitHub releases: at start, every 6 hours (Settings → Über → „Automatisch nach Updates
suchen“) and via „Jetzt nach Updates suchen“ it reads
`https://github.com/mauricekleindienst/aetheros/releases/latest/download/latest.json`. A newer version shows a toast
„Version X verfügbar“ with „Installieren und neu starten“ and the release notes („Was ist neu?“); nothing is installed
without that click. Before installing, all open editors are saved; the signed NSIS installer then runs passively and
restarts the app.

Updates must be signed. The public key is committed (`src-tauri/updater.pub`) and compiled into release builds;
the updater is **only active in builds made by the release workflow with the signing secrets**. Local and CI builds show
„Automatische Updates sind in diesem Build nicht eingerichtet“ and never contact the update server. One-time setup on
GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the full content of the private key file (`aether-updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

Then every tag `vX.Y.Z` produces a signed installer and `latest.json`. To rotate the key, generate a new pair with
`cargo tauri signer generate -w aether-updater.key`, replace `src-tauri/updater.pub` and both secrets; apps installed
with the old key must be updated once by hand.

## Git-Synchronisierung

Settings → **Sicherung** → „Git-Synchronisierung“ pushes the Markdown copy (pages, images, `Zeiterfassung/*.csv`) to a
Git repository, for example on GitHub, GitLab or Azure DevOps. It needs Git installed ([git-scm.com](https://git-scm.com)).

1. Create an empty private repository and enter its **Remote-URL** (and the branch, default `main`)
2. HTTPS: create a personal access token with write access to the repository and save it under **Zugangstoken**. It is
   stored in the Windows Credential Manager and sent to Git only through environment variables, never on the command
   line, in `.git/config` or in any log. SSH URLs (`git@github.com:…`) use your system's SSH keys and agent instead
3. **Verbindung testen** runs `git ls-remote`; **Jetzt synchronisieren** syncs immediately
4. Choose when to sync: **Mit jeder Sicherung** (daily and „Jetzt sichern“) or **Stündlich**

Every sync commits only when something changed („Sicherung 24.09.2026 14:05 – 3 Dateien geändert“). The working copy
lives in `git-sync` in the data folder. Optionally the latest database backup is committed as `aether-workspace.db`
(this grows the repository quickly; GitHub rejects files over 100 MB). If the branch on the server contains a
different history (for example another computer's or an unrelated project), nothing there is overwritten: the commit
goes to the branch `aether-sync-<computer name>` and the settings say so. A new computer with the same remote continues
the existing history. Failures appear as a notification and in the status line.

**Restore**: „Aus Git wiederherstellen…“ clones the repository and imports it as a new top-level page
„Git-Import <Datum>“ (images included); existing pages are left alone.

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

All in-app shortcuts can be changed under Settings → Tastatur (the defaults are listed here).

| Keys | Action |
|---|---|
| Ctrl K / Alt Space (global, configurable) | Command palette, search, `/zeit …`, `? question` |
| Ctrl Shift Space (global) | Quick capture |
| Ctrl O | Quick switcher |
| Ctrl N | New page |
| Ctrl Shift D | Today's daily note |
| Ctrl Shift C | Calendar of daily notes |
| Ctrl Shift A | Tasks |
| Ctrl Shift T | Start/stop timer |
| Ctrl J | Assistant; with text selected in a note: inline AI |
| Ctrl F | Find in page |
| Ctrl W / Ctrl Tab | Close / switch tab |
| Ctrl \ / Ctrl Shift \ | Toggle sidebar / side panel |
| Ctrl . | Focus mode |
| Ctrl , | Settings |
