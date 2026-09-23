//! # aether-core
//!
//! The platform-independent core of AETHER OS. Everything the UI shell needs
//! lives here so it can be tested headless and reused by the CLI:
//!
//! * [`db`] – embedded SQLite store (FTS5 full-text search, embeddings as BLOBs)
//! * [`zeit`] – the `/zeit` slash-command parser
//! * [`tracking`] – timers, manual logging, budget/ETC alerts
//! * [`netzplan`] – critical path method (CPM) over Vorgänge
//! * [`export`] – SAP PS (CATS), Jira worklog, CSV and JSON exports
//! * [`graph`] – page graph (hierarchy + `[[wiki links]]`)
//! * [`activity`] – idle detection and active window probing (Win32 on Windows)
//! * [`ai`] – LiteLLM client, model router, token/cost metrics, local RAG

pub mod activity;
pub mod ai;
pub mod db;
pub mod demo;
pub mod error;
pub mod export;
pub mod graph;
pub mod model;
pub mod netzplan;
pub mod search;
pub mod tracking;
pub mod zeit;

pub use db::Database;
pub use error::{Error, Result};
