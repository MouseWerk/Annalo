//! Application settings, stored as JSON in the workspace database.
//! Secrets (the LiteLLM API key) are deliberately not part of this struct;
//! the desktop shell keeps them in the OS credential store.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::ai::router::RouterConfig;
use crate::db::Database;
use crate::error::Result;
use crate::tracking::Thresholds;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Root URL of the LiteLLM proxy, e.g. `https://llm.example.com`.
    pub litellm_base_url: String,
    /// Model names per tier as exposed by the proxy.
    pub router: RouterConfig,
    /// Route by prompt complexity; when off, `router.standard_model` is always used.
    pub auto_route: bool,
    /// Embedding model for semantic search; `None` = keyword search only.
    pub embedding_model: Option<String>,
    /// Extra instructions appended to the assistant's system prompt.
    pub assistant_instructions: String,
    pub thresholds: Thresholds,
    /// Pauses longer than this are offered for subtraction when a timer stops.
    pub idle_threshold_minutes: u64,
    /// SAP personnel number for CATS exports.
    pub pernr: Option<String>,
    /// `NP-8801/1020` or `NP-8801` → Jira issue key.
    pub jira_issue_map: HashMap<String, String>,
    /// `system`, `light` or `dark`.
    pub theme: String,
    /// Open today's daily note on start.
    pub open_daily_on_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            litellm_base_url: "http://localhost:4000".into(),
            router: RouterConfig::default(),
            auto_route: true,
            embedding_model: None,
            assistant_instructions: String::new(),
            thresholds: Thresholds::default(),
            idle_threshold_minutes: 5,
            pernr: None,
            jira_issue_map: HashMap::new(),
            theme: "system".into(),
            open_daily_on_start: false,
        }
    }
}

const KEY: &str = "app";

impl Database {
    pub fn load_settings(&self) -> Result<Settings> {
        let raw: Option<String> =
            self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get(0)).optional()?;
        Ok(match raw {
            Some(json) => serde_json::from_str(&json)?,
            None => Settings::default(),
        })
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![KEY, serde_json::to_string(s)?],
        )?;
        Ok(())
    }

    /// Internal flags kept next to the settings (e.g. whether sample data was seeded).
    pub fn meta_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = ?1", [format!("meta.{key}")], |r| r.get(0))
            .optional()?)
    }

    pub fn meta_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![format!("meta.{key}"), value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults_for_missing_fields() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.load_settings().unwrap(), Settings::default());
        let s = Settings {
            litellm_base_url: "https://llm.firma.de".into(),
            router: RouterConfig { standard_model: "gpt-firma".into(), ..Default::default() },
            ..Default::default()
        };
        db.save_settings(&s).unwrap();
        assert_eq!(db.load_settings().unwrap(), s);

        // Older settings JSON without newer fields still loads.
        db.conn().execute("UPDATE settings SET value = '{\"theme\":\"dark\"}'", []).unwrap();
        let loaded = db.load_settings().unwrap();
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.idle_threshold_minutes, 5);
    }
}
