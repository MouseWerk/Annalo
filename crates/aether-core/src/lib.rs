//! # aether-core
//!
//! The platform-independent core of AETHER OS. Everything the UI shell needs
//! lives here so it can be tested headless and reused by the CLI:
//!
//! * [`db`] – embedded SQLite store (FTS5 full-text search, embeddings as BLOBs)
//! * [`notes`] – Markdown documents, backlinks, tags, daily notes
//! * [`pagework`] – pages linked to a Vorgang (`vorgang:` property): budget and bookings
//! * [`trash`] – page trash (restore, purge, 30-day expiry)
//! * [`versions`] – page version history (snapshots, restore)
//! * [`backup`] – database snapshots (`VACUUM INTO`) with rotation
//! * [`vault`] – Obsidian vault import / Markdown export
//! * [`attachments`] – pasted and imported images
//! * [`templates`] – page templates with `{{datum}}`-style placeholders
//! * [`settings`] – application settings
//! * [`tasks`] – task items across all notes (due dates, priorities)
//! * [`zeit`] – the `/zeit` slash-command parser
//! * [`tracking`] – timers, manual logging, budget/ETC alerts
//! * [`report`] – time summaries per Netzplan/Vorgang and day (status reports)
//! * [`netzplan`] – critical path method (CPM) over Vorgänge
//! * [`export`] – SAP PS (CATS), Jira worklog, CSV and JSON exports
//! * [`desktop`] – quick capture into the daily note, end-of-day reminders
//! * [`datadir`] – data folder location (`location.json`), synced-folder check
//! * [`activity`] – idle detection and active window probing (Win32 on Windows)
//! * [`ai`] – LiteLLM client, model router, token/cost metrics, local RAG

pub mod activity;
pub mod ai;
pub mod attachments;
pub mod backup;
pub mod datadir;
pub mod db;
pub mod demo;
pub mod desktop;
pub mod error;
pub mod export;
pub mod model;
pub mod netzplan;
pub mod notes;
pub mod pagework;
pub mod report;
pub mod search;
pub mod settings;
pub mod tasks;
pub mod templates;
pub mod tracking;
pub mod trash;
pub mod vault;
pub mod versions;
pub mod zeit;

pub use db::Database;
pub use error::{Error, Result};
