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
    /// Target working hours per workday; days below it are flagged in the timesheet.
    pub daily_target_hours: f64,
    /// Workdays as ISO weekday numbers (1 = Monday … 7 = Sunday).
    pub workdays: Vec<u32>,
    /// Folder for automatic backups; `None` = `backups` in the data folder.
    pub backup_dir: Option<String>,
    /// Number of backups kept; older ones are deleted.
    pub backup_keep: usize,
    /// After every backup, write the workspace as Markdown files (+ time entries as CSV).
    pub markdown_mirror: bool,
    /// Folder of the Markdown mirror; `None` = `markdown` in the backup folder.
    pub markdown_mirror_dir: Option<String>,
    /// Template page for new daily notes; `None` = built-in sections.
    pub daily_template: Option<i64>,
    /// Closing the main window hides it to the tray instead of quitting.
    pub close_to_tray: bool,
    /// End-of-day reminder as `HH:MM` (local time); `None` = off.
    pub reminder_time: Option<String>,
    /// Global shortcut for the quick-capture window, e.g. `Ctrl+Shift+Space`.
    pub capture_shortcut: String,
    /// Global shortcut that brings up the command palette, e.g. `Ctrl+Shift+K`; `None` or `""` = off
    /// (the default: Ctrl+K works inside the app).
    pub palette_shortcut: Option<String>,
    /// Global shortcut of the quick-search window (Spotlight-like), e.g. `Ctrl+Shift+O`; `""` = off.
    pub search_shortcut: String,
    /// Widgets of the start page (and of new tabs).
    pub dashboard: Dashboard,
}

/// Width of a dashboard widget in the start page's grid: one, two or all four columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WidgetSize {
    #[serde(rename = "s")]
    Small,
    #[serde(rename = "l")]
    Large,
    /// Unknown sizes (e.g. from a newer version) fall back to medium.
    #[serde(rename = "m", other)]
    Medium,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Widget {
    /// Stable id within the dashboard (drag & drop, keys).
    pub id: String,
    /// One of [`WIDGET_KINDS`]; unknown kinds are dropped by [`Dashboard::normalized`].
    pub kind: String,
    pub size: WidgetSize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Dashboard {
    pub widgets: Vec<Widget>,
    /// Scratch text of the „Notiz“ widget.
    pub note: String,
}

/// Widget kinds of the start page: Heute, Woche, Budgets, Zuletzt bearbeitet, Lesezeichen,
/// Timer, Notiz, Kalender.
pub const WIDGET_KINDS: [&str; 8] = ["today", "week", "budgets", "recent", "favorites", "timer", "note", "calendar"];

/// At most this many widgets are kept.
pub const MAX_WIDGETS: usize = 24;

/// Longest scratch note kept (characters).
pub const MAX_NOTE_CHARS: usize = 20_000;

impl Default for Dashboard {
    fn default() -> Self {
        let w = |kind: &str, size| Widget { id: kind.into(), kind: kind.into(), size };
        Dashboard {
            widgets: vec![
                w("today", WidgetSize::Medium),
                w("week", WidgetSize::Medium),
                w("timer", WidgetSize::Small),
                w("budgets", WidgetSize::Small),
                w("recent", WidgetSize::Medium),
            ],
            note: String::new(),
        }
    }
}

impl Dashboard {
    /// Drops unknown kinds, gives every widget a unique non-empty id, caps the count and the note.
    pub fn normalized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.widgets.retain(|w| WIDGET_KINDS.contains(&w.kind.as_str()));
        self.widgets.truncate(MAX_WIDGETS);
        for w in &mut self.widgets {
            let base = if w.id.trim().is_empty() { w.kind.clone() } else { w.id.trim().to_owned() };
            let mut id = base.clone();
            let mut n = 2;
            while !seen.insert(id.clone()) {
                id = format!("{base}-{n}");
                n += 1;
            }
            w.id = id;
        }
        if self.note.chars().count() > MAX_NOTE_CHARS {
            self.note = self.note.chars().take(MAX_NOTE_CHARS).collect();
        }
        self
    }
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
            daily_target_hours: 8.0,
            workdays: vec![1, 2, 3, 4, 5],
            backup_dir: None,
            backup_keep: 14,
            markdown_mirror: true,
            markdown_mirror_dir: None,
            daily_template: None,
            close_to_tray: cfg!(windows),
            reminder_time: Some("17:30".into()),
            capture_shortcut: DEFAULT_CAPTURE_SHORTCUT.into(),
            palette_shortcut: None,
            search_shortcut: DEFAULT_SEARCH_SHORTCUT.into(),
            dashboard: Dashboard::default(),
        }
    }
}

/// Ctrl+Alt+… is AltGr on German keyboards, so the default avoids it.
pub const DEFAULT_CAPTURE_SHORTCUT: &str = "Ctrl+Shift+Space";

/// Quick search. Not Ctrl+Shift+F: that is the sidebar search inside the app.
pub const DEFAULT_SEARCH_SHORTCUT: &str = "Ctrl+Shift+O";

/// The former default palette shortcut. It opened the Windows window menu, so it is now off
/// by default; [`Database::migrate_palette_default`] clears it from saved settings once.
const OLD_PALETTE_DEFAULT: &str = "Alt+Space";

const KEY: &str = "app";

impl Database {
    pub fn load_settings(&self) -> Result<Settings> {
        let raw: Option<String> =
            self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get(0)).optional()?;
        let mut s: Settings = match raw {
            Some(json) => serde_json::from_str(&json)?,
            None => Settings::default(),
        };
        s.dashboard = s.dashboard.normalized();
        Ok(s)
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![KEY, serde_json::to_string(s)?],
        )?;
        Ok(())
    }

    /// Earlier versions saved `Alt+Space` as the palette shortcut with any settings change,
    /// so an explicit choice cannot be told apart: switch it off once.
    pub fn migrate_palette_default(&self) -> Result<()> {
        const FLAG: &str = "palette_default_off";
        if self.meta_get(FLAG)?.is_some() {
            return Ok(());
        }
        let raw: Option<String> =
            self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get(0)).optional()?;
        if raw.is_some() {
            let mut s = self.load_settings()?;
            if s.palette_shortcut.as_deref() == Some(OLD_PALETTE_DEFAULT) {
                s.palette_shortcut = None;
                self.save_settings(&s)?;
            }
        }
        self.meta_set(FLAG, "1")
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
        assert_eq!((loaded.backup_dir, loaded.backup_keep), (None, 14));
        assert_eq!((loaded.markdown_mirror, loaded.markdown_mirror_dir), (true, None), "mirror on by default");
        assert_eq!(loaded.reminder_time.as_deref(), Some("17:30"));
        assert_eq!(loaded.capture_shortcut, DEFAULT_CAPTURE_SHORTCUT);
        assert_eq!(loaded.palette_shortcut, None, "the palette shortcut is off by default");
        // An explicit null switches the reminder off.
        db.conn().execute("UPDATE settings SET value = '{\"reminder_time\":null}'", []).unwrap();
        assert_eq!(db.load_settings().unwrap().reminder_time, None);
        db.conn().execute("UPDATE settings SET value = '{\"palette_shortcut\":null}'", []).unwrap();
        assert_eq!(db.load_settings().unwrap().palette_shortcut, None);
    }

    #[test]
    fn dashboard_and_search_shortcut_default_for_old_settings() {
        let db = Database::open_in_memory().unwrap();
        // Settings saved before the dashboard and the quick search existed.
        db.save_settings(&Settings::default()).unwrap();
        db.conn().execute(r#"UPDATE settings SET value = '{"theme":"dark","capture_shortcut":"Alt+Q"}'"#, []).unwrap();
        let s = db.load_settings().unwrap();
        assert_eq!(s.search_shortcut, DEFAULT_SEARCH_SHORTCUT);
        assert_eq!(s.dashboard, Dashboard::default());
        let kinds: Vec<_> = s.dashboard.widgets.iter().map(|w| w.kind.as_str()).collect();
        assert_eq!(kinds, ["today", "week", "timer", "budgets", "recent"]);
        assert!(kinds.iter().all(|k| WIDGET_KINDS.contains(k)));
        // An explicitly empty dashboard stays empty; "" switches the search shortcut off.
        db.conn()
            .execute(r#"UPDATE settings SET value = '{"search_shortcut":"","dashboard":{"widgets":[]}}'"#, [])
            .unwrap();
        let s = db.load_settings().unwrap();
        assert_eq!((s.search_shortcut.as_str(), s.dashboard.widgets.len(), s.dashboard.note.as_str()), ("", 0, ""));
    }

    #[test]
    fn dashboard_is_normalized_on_load() {
        let db = Database::open_in_memory().unwrap();
        let json = r#"{"dashboard":{"note":"Hallo","widgets":[
            {"id":"a","kind":"today","size":"l"},
            {"id":"a","kind":"week","size":"s"},
            {"id":"","kind":"timer","size":"xl"},
            {"id":"x","kind":"wetter","size":"m"}]}}"#;
        db.conn().execute("INSERT INTO settings (key, value) VALUES ('app', ?1)", [json]).unwrap();
        let d = db.load_settings().unwrap().dashboard;
        assert_eq!(d.note, "Hallo");
        let got: Vec<_> = d.widgets.iter().map(|w| (w.id.as_str(), w.kind.as_str(), w.size)).collect();
        assert_eq!(
            got,
            [
                ("a", "today", WidgetSize::Large),
                ("a-2", "week", WidgetSize::Small),
                ("timer", "timer", WidgetSize::Medium)
            ]
        );
        let many = Dashboard {
            widgets: (0..40)
                .map(|i| Widget { id: format!("w{i}"), kind: "note".into(), size: WidgetSize::Small })
                .collect(),
            note: "x".repeat(MAX_NOTE_CHARS + 5),
        }
        .normalized();
        assert_eq!((many.widgets.len(), many.note.len()), (MAX_WIDGETS, MAX_NOTE_CHARS));
        // Sizes serialize with their short names.
        let s =
            serde_json::to_string(&Widget { id: "t".into(), kind: "today".into(), size: WidgetSize::Small }).unwrap();
        assert_eq!(s, r#"{"id":"t","kind":"today","size":"s"}"#);
    }

    #[test]
    fn old_alt_space_default_is_switched_off_once() {
        let db = Database::open_in_memory().unwrap();
        let s = Settings { palette_shortcut: Some(OLD_PALETTE_DEFAULT.into()), ..Default::default() };
        db.save_settings(&s).unwrap();
        db.migrate_palette_default().unwrap();
        assert_eq!(db.load_settings().unwrap().palette_shortcut, None);
        // Chosen again afterwards: kept.
        db.save_settings(&s).unwrap();
        db.migrate_palette_default().unwrap();
        assert_eq!(db.load_settings().unwrap().palette_shortcut.as_deref(), Some(OLD_PALETTE_DEFAULT));
        // Other shortcuts are never touched.
        let db = Database::open_in_memory().unwrap();
        let s = Settings { palette_shortcut: Some("Ctrl+Shift+K".into()), ..Default::default() };
        db.save_settings(&s).unwrap();
        db.migrate_palette_default().unwrap();
        assert_eq!(db.load_settings().unwrap(), s);
    }
}
