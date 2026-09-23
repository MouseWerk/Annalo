//! # aether-core
//!
//! The platform-independent core of AETHER OS. Everything the UI shell needs
//! lives here so it can be tested headless and reused by the CLI:
//!
//! * [`db`] – embedded SQLite store (FTS5 full-text search, embeddings as BLOBs)
//! * [`notes`] – Markdown documents, backlinks, tags, daily notes
//! * [`trash`] – page trash (restore, purge, 30-day expiry)
//! * [`backup`] – database snapshots (`VACUUM INTO`) with rotation
//! * [`vault`] – Obsidian vault import / Markdown export
//! * [`attachments`] – pasted and imported images
//! * [`templates`] – page templates with `{{datum}}`-style placeholders
//! * [`settings`] – application settings
//! * [`tasks`] – task items across all notes (due dates, priorities)
//! * [`zeit`] – the `/zeit` slash-command parser
//! * [`tracking`] – timers, manual logging, budget/ETC alerts
//! * [`netzplan`] – critical path method (CPM) over Vorgänge
//! * [`export`] – SAP PS (CATS), Jira worklog, CSV and JSON exports
//! * [`activity`] – idle detection and active window probing (Win32 on Windows)
//! * [`ai`] – LiteLLM client, model router, token/cost metrics, local RAG

pub mod activity;
pub mod ai;
pub mod attachments;
pub mod backup;
pub mod db;
pub mod demo;
pub mod error;
pub mod export;
pub mod model;
pub mod netzplan;
pub mod notes;
pub mod search;
pub mod settings;
pub mod tasks;
pub mod templates;
pub mod tracking;
pub mod trash;
pub mod vault;
pub mod zeit;

pub use db::Database;
pub use error::{Error, Result};
