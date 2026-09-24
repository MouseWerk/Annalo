//! Application settings, stored as JSON in the workspace database.
//! Secrets (the LiteLLM API key) are deliberately not part of this struct;
//! the desktop shell keeps them in the OS credential store.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::ai::router::RouterConfig;
use crate::db::Database;
use crate::error::Result;
use crate::gitsync::GitSyncSettings;
use crate::network::NetworkSettings;
use crate::prefs::{
    AiPrefs, AppearancePrefs, EditorPrefs, LocalePrefs, NotesPrefs, NotificationPrefs, PrivacyPrefs, ROUNDING_STEPS,
    StartOpen, StartPrefs, TimePrefs,
};
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
    /// Look for a new release at start and every few hours (only in builds with an update
    /// key). Updates are never installed without the user's click.
    pub auto_update_check: bool,
    /// Push the Markdown mirror to a Git remote (the access token lives in the credential store).
    pub git_sync: GitSyncSettings,
    /// Proxy, extra root CA and timeouts (the proxy password lives in the credential store).
    pub network: NetworkSettings,
    pub appearance: AppearancePrefs,
    pub editor: EditorPrefs,
    pub notes: NotesPrefs,
    pub time: TimePrefs,
    pub ai: AiPrefs,
    pub notifications: NotificationPrefs,
    pub privacy: PrivacyPrefs,
    pub start: StartPrefs,
    pub locale: LocalePrefs,
    /// In-app shortcuts that differ from the defaults: command id → `Ctrl+Shift+D` (`""` = off).
    pub keymap: BTreeMap<String, String>,
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
            auto_update_check: true,
            git_sync: GitSyncSettings::default(),
            network: NetworkSettings::default(),
            appearance: AppearancePrefs::default(),
            editor: EditorPrefs::default(),
            notes: NotesPrefs::default(),
            time: TimePrefs::default(),
            ai: AiPrefs::default(),
            notifications: NotificationPrefs::default(),
            privacy: PrivacyPrefs::default(),
            start: StartPrefs::default(),
            locale: LocalePrefs::default(),
            keymap: BTreeMap::new(),
        }
    }
}

impl Settings {
    /// Clamps numbers to their ranges and replaces unusable values with defaults. Used when
    /// saving and importing; loading keeps what is stored.
    pub fn normalize(&mut self) {
        let d = Settings::default();
        let a = &mut self.appearance;
        a.accent = crate::prefs::normalize_accent(&a.accent).unwrap_or(d.appearance.accent);
        a.ui_scale = a.ui_scale.clamp(90, 125);
        let e = &mut self.editor;
        e.autosave_ms = e.autosave_ms.clamp(250, 3000);
        e.tab_size = e.tab_size.clamp(2, 8);
        e.hover_delay_ms = e.hover_delay_ms.clamp(0, 3000);
        e.default_icon = e.default_icon.take().map(|i| i.trim().to_owned()).filter(|i| !i.is_empty());
        e.inbox_title = e.inbox_title.trim().to_owned();
        if e.inbox_title.is_empty() {
            e.inbox_title = d.editor.inbox_title;
        }
        let n = &mut self.notes;
        n.daily_folder = n.daily_folder.trim().to_owned();
        if n.daily_folder.is_empty() {
            n.daily_folder = d.notes.daily_folder;
        }
        n.trash_retention_days = n.trash_retention_days.clamp(7, 365);
        n.version_interval_minutes = n.version_interval_minutes.clamp(5, 60);
        n.max_versions = n.max_versions.clamp(5, 500);
        let t = &mut self.time;
        if !ROUNDING_STEPS.contains(&t.rounding.step_minutes) {
            t.rounding.step_minutes = 0;
        }
        t.rounding.min_minutes = t.rounding.min_minutes.min(240);
        t.default_leistungsart = std::mem::take(&mut t.default_leistungsart)
            .into_iter()
            .map(|(k, v)| (k.trim().to_owned(), v.trim().to_uppercase()))
            .filter(|(k, v)| !k.is_empty() && !v.is_empty())
            .collect();
        t.export_file_pattern = t.export_file_pattern.trim().to_owned();
        if t.export_file_pattern.is_empty() {
            t.export_file_pattern = d.time.export_file_pattern;
        }
        let ai = &mut self.ai;
        ai.temperature = if ai.temperature.is_finite() { ai.temperature.clamp(0.0, 2.0) } else { d.ai.temperature };
        ai.max_tokens = ai.max_tokens.filter(|m| *m > 0).map(|m| m.clamp(16, 200_000));
        ai.monthly_cost_limit_usd = ai.monthly_cost_limit_usd.filter(|l| l.is_finite() && *l > 0.0);
        if let Some(p) = &mut ai.inline_presets {
            p.retain(|x| !x.label.trim().is_empty() && !x.instruction.trim().is_empty());
        }
        ai.meeting_template = ai.meeting_template.take().filter(|t| !t.trim().is_empty());
        let known = crate::ai::tools::definitions();
        ai.allowed_tools.retain(|t| known.iter().any(|d| d["function"]["name"] == t.as_str()));
        ai.allowed_tools.dedup();
        let nt = &mut self.notifications;
        for (v, def) in
            [(&mut nt.quiet_from, &d.notifications.quiet_from), (&mut nt.quiet_to, &d.notifications.quiet_to)]
        {
            *v = match crate::desktop::parse_hhmm(v.trim()) {
                Some(t) => t.format("%H:%M").to_string(),
                None => def.clone(),
            };
        }
        self.keymap = std::mem::take(&mut self.keymap)
            .into_iter()
            .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
            .filter(|(k, _)| !k.is_empty())
            .collect();
        // Kept for older versions, which read only this flag.
        self.open_daily_on_start = self.start.open == StartOpen::Daily;
    }

    /// The settings of one section reset to their defaults (`Abschnitt zurücksetzen`).
    /// Unknown sections are an error.
    pub fn reset_section(&mut self, section: &str) -> Result<()> {
        let d = Settings::default();
        match section {
            "network" => self.network = d.network,
            "appearance" => {
                self.appearance = d.appearance;
                self.theme = d.theme;
            }
            "editor" => self.editor = d.editor,
            "notes" => {
                self.notes = d.notes;
                self.daily_template = d.daily_template;
            }
            "time" => {
                self.time = d.time;
                self.idle_threshold_minutes = d.idle_threshold_minutes;
                self.daily_target_hours = d.daily_target_hours;
                self.workdays = d.workdays;
                self.thresholds = d.thresholds;
            }
            "ai" => {
                self.ai = d.ai;
                self.auto_route = d.auto_route;
                self.assistant_instructions = d.assistant_instructions;
                self.router.standard_threshold = d.router.standard_threshold;
                self.router.reasoning_threshold = d.router.reasoning_threshold;
            }
            "notifications" => {
                self.notifications = d.notifications;
                self.reminder_time = d.reminder_time;
            }
            "privacy" => {
                self.privacy = d.privacy;
                self.router.private_markers = d.router.private_markers;
            }
            "start" => {
                self.start = d.start;
                self.open_daily_on_start = d.open_daily_on_start;
            }
            "locale" => self.locale = d.locale,
            "keyboard" => self.keymap = d.keymap,
            other => return Err(crate::error::Error::State(format!("Unbekannter Abschnitt „{other}“"))),
        }
        Ok(())
    }
}

/// Ctrl+Alt+… is AltGr on German keyboards, so the default avoids it.
pub const DEFAULT_CAPTURE_SHORTCUT: &str = "Ctrl+Shift+Space";

/// The former default palette shortcut. It opened the Windows window menu, so it is now off
/// by default; [`Database::migrate_palette_default`] clears it from saved settings once.
const OLD_PALETTE_DEFAULT: &str = "Alt+Space";

const KEY: &str = "app";

impl Database {
    pub fn load_settings(&self) -> Result<Settings> {
        let raw: Option<String> =
            self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get(0)).optional()?;
        Ok(match raw {
            Some(json) => Self::parse_settings(&json)?,
            None => Settings::default(),
        })
    }

    /// Parses stored settings JSON; settings from before the start preferences keep
    /// „Tagesnotiz beim Start öffnen“ (`open_daily_on_start` → `start.open = daily`).
    pub fn parse_settings(json: &str) -> Result<Settings> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        let mut s: Settings = serde_json::from_value(value.clone())?;
        if value.get("start").is_none() && s.open_daily_on_start {
            s.start.open = StartOpen::Daily;
        }
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
        assert!(loaded.auto_update_check, "update checks are on by default");
        assert_eq!(loaded.git_sync, GitSyncSettings::default(), "git sync off by default");
        assert!(!loaded.git_sync.enabled && loaded.git_sync.branch == "main");
        // Partial git_sync objects fill the rest with defaults.
        db.conn()
            .execute("UPDATE settings SET value = '{\"git_sync\":{\"enabled\":true,\"mode\":\"hourly\"}}'", [])
            .unwrap();
        let gs = db.load_settings().unwrap().git_sync;
        assert!(gs.enabled && gs.mode == crate::gitsync::SyncMode::Hourly && gs.branch == "main");
        // An explicit null switches the reminder off.
        db.conn().execute("UPDATE settings SET value = '{\"reminder_time\":null}'", []).unwrap();
        assert_eq!(db.load_settings().unwrap().reminder_time, None);
        db.conn().execute("UPDATE settings SET value = '{\"palette_shortcut\":null}'", []).unwrap();
        assert_eq!(db.load_settings().unwrap().palette_shortcut, None);
    }

    #[test]
    fn new_preferences_default_and_migrate() {
        let db = Database::open_in_memory().unwrap();
        // Settings of an older version: everything new gets its default.
        db.conn()
            .execute("INSERT INTO settings (key, value) VALUES ('app', '{\"theme\":\"light\",\"open_daily_on_start\":true}')", [])
            .unwrap();
        let s = db.load_settings().unwrap();
        assert_eq!(s.start.open, StartOpen::Daily, "the old start flag carries over");
        assert_eq!(s.network, NetworkSettings::default());
        assert_eq!(s.network.mode, crate::network::ProxyMode::System);
        assert!(s.network.apply_to.ai && s.network.apply_to.git && !s.network.accept_invalid_certs);
        assert_eq!((s.editor.autosave_ms, s.editor.smart_quotes, s.editor.tab_size), (450, false, 4));
        assert_eq!(
            (s.notes.trash_retention_days, s.notes.version_interval_minutes, s.notes.max_versions),
            (30, 10, 50)
        );
        assert_eq!(s.notes.daily_folder, "Journal");
        assert_eq!(s.time.rounding, crate::prefs::Rounding::default());
        assert_eq!(s.time.rounding.apply(7), 7, "no rounding by default");
        assert_eq!(s.ai.allowed_tools, crate::prefs::WORKSPACE_TOOLS, "system tools are off by default");
        assert!(s.ai.citations && s.ai.streaming && s.ai.monthly_cost_limit_usd.is_none());
        assert!(s.notifications.end_of_day && !s.notifications.quiet_hours);
        assert!(s.privacy.read_open_page && !s.privacy.local_only);
        assert_eq!(s.locale.language, crate::prefs::Language::De);
        assert!(s.keymap.is_empty());
        // Once the start preferences exist, the old flag no longer decides.
        db.conn()
            .execute(
                "UPDATE settings SET value = '{\"open_daily_on_start\":true,\"start\":{\"open\":\"dashboard\"}}'",
                [],
            )
            .unwrap();
        assert_eq!(db.load_settings().unwrap().start.open, StartOpen::Dashboard);
        // Partial nested objects fill the rest.
        db.conn()
            .execute(
                "UPDATE settings SET value = '{\"time\":{\"rounding\":{\"step_minutes\":15}},\"network\":{\"mode\":\"manual\"}}'",
                [],
            )
            .unwrap();
        let s = db.load_settings().unwrap();
        assert_eq!((s.time.rounding.step_minutes, s.time.hours_display), (15, crate::prefs::HoursDisplay::Decimal));
        assert_eq!((s.network.mode, s.network.timeout_secs), (crate::network::ProxyMode::Manual, 30));
    }

    #[test]
    fn normalize_clamps_and_reset_restores_sections() {
        let mut s = Settings::default();
        s.appearance.ui_scale = 300;
        s.appearance.accent = "#ABC".into();
        s.editor.autosave_ms = 10;
        s.notes.trash_retention_days = 1;
        s.notes.daily_folder = "  ".into();
        s.time.rounding.step_minutes = 7;
        s.time.default_leistungsart.insert(" NP-1 ".into(), " dev ".into());
        s.ai.temperature = 9.0;
        s.ai.allowed_tools = vec!["git".into(), "rm_rf".into()];
        s.notifications.quiet_from = "25:00".into();
        s.start.open = StartOpen::Daily;
        s.normalize();
        assert_eq!((s.appearance.ui_scale, s.appearance.accent.as_str()), (125, "#aabbcc"));
        assert_eq!((s.editor.autosave_ms, s.notes.trash_retention_days), (250, 7));
        assert_eq!(s.notes.daily_folder, "Journal");
        assert_eq!(s.time.rounding.step_minutes, 0);
        assert_eq!(s.time.default_leistungsart.get("NP-1").map(String::as_str), Some("DEV"));
        assert_eq!((s.ai.temperature, s.ai.allowed_tools.clone()), (2.0, vec!["git".to_owned()]));
        assert_eq!(s.notifications.quiet_from, "22:00");
        assert!(s.open_daily_on_start);
        s.reset_section("ai").unwrap();
        assert_eq!(s.ai, AiPrefs::default());
        s.reset_section("appearance").unwrap();
        assert_eq!(s.appearance, AppearancePrefs::default());
        assert!(s.reset_section("gibt-es-nicht").is_err());
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
