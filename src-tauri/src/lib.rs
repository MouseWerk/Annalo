//! AETHER OS desktop shell: exposes `aether-core` to the web UI over Tauri IPC.

mod secrets;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use aether_core::activity::{self, IdleAccumulator, WindowUsage};
use aether_core::ai::LiteLlmClient;
use aether_core::ai::client::{ChatMessage, ChatRequest, Completion, StreamEvent};
use aether_core::ai::metrics::SessionMeter;
use aether_core::ai::rag::{self, ContextChunk};
use aether_core::ai::router::{ModelRouter, RouteDecision, RouteInput, RouterConfig, Tier};
use aether_core::ai::tools::{self, Risk, SystemCall};
use aether_core::db::EntryFilter;
use aether_core::export::{self, ExportFormat, ExportOptions, ExportResult};
use aether_core::model::*;
use aether_core::netzplan::{self, Schedule};
use aether_core::notes::PageDoc;
use aether_core::search::{self, SearchHit};
use aether_core::settings::Settings;
use aether_core::tracking::{self, BudgetStatus, LogOutcome};
use aether_core::vault::{self, ImportReport};
use aether_core::{Database, Error, demo};
use chrono::{DateTime, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use secrets::SecretStore;

type Result<T> = std::result::Result<T, Error>;

// -------------------------------------------------------------------- state

/// AI configuration derived from the settings; rebuilt when they change.
struct AiRuntime {
    settings: Settings,
    client: Arc<LiteLlmClient>,
    router: Arc<ModelRouter>,
}

impl AiRuntime {
    fn new(settings: Settings, api_key: Option<String>) -> Self {
        let client = LiteLlmClient::new(settings.litellm_base_url.clone(), api_key);
        AiRuntime { client: Arc::new(client), router: Arc::new(ModelRouter::new(settings.router.clone())), settings }
    }
}

pub struct AppState {
    db: Mutex<Database>,
    ai: RwLock<AiRuntime>,
    secrets: SecretStore,
    data_dir: PathBuf,
    meter: Mutex<SessionMeter>,
    session_id: String,
    idle: Mutex<IdleAccumulator>,
    usage: Mutex<WindowUsage>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding the lock leaves SQLite consistent (transactions roll back).
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    fn db(&self) -> MutexGuard<'_, Database> {
        lock(&self.db)
    }
    fn settings(&self) -> Settings {
        self.ai.read().unwrap_or_else(|e| e.into_inner()).settings.clone()
    }
    fn client(&self) -> Arc<LiteLlmClient> {
        self.ai.read().unwrap_or_else(|e| e.into_inner()).client.clone()
    }
    fn router(&self) -> Arc<ModelRouter> {
        self.ai.read().unwrap_or_else(|e| e.into_inner()).router.clone()
    }
}

// ------------------------------------------------------------------- pages

#[tauri::command]
fn workspace_tree(state: State<AppState>) -> Result<Vec<PageNode>> {
    state.db().page_tree()
}

#[tauri::command]
fn page_get(state: State<AppState>, id: i64) -> Result<PageDoc> {
    state.db().page_doc(id)
}

#[tauri::command]
fn page_save(state: State<AppState>, id: i64, content: String) -> Result<PageDoc> {
    let db = state.db();
    db.save_page_content(id, &content)?;
    db.page_doc(id)
}

#[tauri::command]
fn page_create(
    state: State<AppState>,
    parent_id: Option<i64>,
    title: String,
    icon: Option<String>,
    content: Option<String>,
) -> Result<Page> {
    let db = state.db();
    // Avoid duplicate titles so [[links]] stay unambiguous.
    let mut name = title.trim().to_owned();
    let base = name.clone();
    let mut n = 2;
    while db.page_by_title(&name)?.is_some() {
        name = format!("{base} {n}");
        n += 1;
    }
    let page = db.create_page(parent_id, &name, icon.as_deref())?;
    if let Some(c) = content {
        db.save_page_content(page.id, &c)?;
    }
    Ok(page)
}

#[tauri::command]
fn page_rename(state: State<AppState>, id: i64, title: String, update_links: bool) -> Result<usize> {
    let db = state.db();
    if let Some(other) = db.page_by_title(&title)?
        && other.id != id
    {
        return Err(Error::State(format!("Eine Seite „{}“ existiert bereits", other.title)));
    }
    db.rename_page_linked(id, &title, update_links)
}

#[tauri::command]
fn page_delete(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_page(id)
}

#[tauri::command]
fn page_move(state: State<AppState>, id: i64, parent_id: Option<i64>, position: i64) -> Result<()> {
    state.db().move_page(id, parent_id, position)
}

#[tauri::command]
fn page_set_favorite(state: State<AppState>, id: i64, favorite: bool) -> Result<()> {
    state.db().set_favorite(id, favorite)
}

#[tauri::command]
fn page_set_icon(state: State<AppState>, id: i64, icon: Option<String>) -> Result<()> {
    state.db().set_page_icon(id, icon.as_deref())
}

/// Resolves a [[link]] target; with `create`, a missing page is created at the top level.
#[tauri::command]
fn page_resolve(state: State<AppState>, title: String, create: bool) -> Result<Option<Page>> {
    let db = state.db();
    match db.page_by_title(&title)? {
        Some(p) => Ok(Some(p)),
        None if create => Ok(Some(db.create_page(None, &title, Some("file-text"))?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn recent_pages(state: State<AppState>, limit: usize) -> Result<Vec<Page>> {
    state.db().recent_pages(limit)
}

#[tauri::command]
fn daily_note(state: State<AppState>, date: Option<NaiveDate>) -> Result<Page> {
    state.db().daily_note(date.unwrap_or_else(|| Local::now().date_naive()))
}

#[tauri::command]
fn tags_list(state: State<AppState>) -> Result<Vec<(String, i64)>> {
    state.db().tag_counts()
}

#[tauri::command]
fn tag_pages(state: State<AppState>, tag: String) -> Result<Vec<Page>> {
    state.db().pages_with_tag(&tag)
}

#[tauri::command]
fn search_workspace(state: State<AppState>, query: String, limit: Option<usize>) -> Result<Vec<SearchHit>> {
    search::search(&state.db(), &query, limit.unwrap_or(30))
}

#[tauri::command]
fn vault_import(state: State<AppState>, path: String) -> Result<ImportReport> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(Error::State(format!("„{path}“ ist kein Ordner")));
    }
    vault::import_vault(&state.db(), &dir)
}

#[tauri::command]
fn vault_export(state: State<AppState>, path: String) -> Result<usize> {
    vault::export_vault(&state.db(), &PathBuf::from(path))
}

// --------------------------------------------------------------------- WBS

#[derive(Serialize)]
struct NetzplanTree {
    #[serde(flatten)]
    netzplan: Netzplan,
    vorgaenge: Vec<Vorgang>,
}

#[derive(Serialize)]
struct ProjectTree {
    #[serde(flatten)]
    project: Project,
    netzplaene: Vec<NetzplanTree>,
}

/// Projects → Netzpläne → Vorgänge.
#[tauri::command]
fn wbs_tree(state: State<AppState>) -> Result<Vec<ProjectTree>> {
    let db = state.db();
    db.list_projects()?
        .into_iter()
        .map(|p| {
            let netzplaene = db
                .list_netzplaene(Some(p.id))?
                .into_iter()
                .map(|n| Ok(NetzplanTree { vorgaenge: db.list_vorgaenge(n.id)?, netzplan: n }))
                .collect::<Result<_>>()?;
            Ok(ProjectTree { project: p, netzplaene })
        })
        .collect()
}

fn required(value: &str, what: &str) -> Result<String> {
    let v = value.trim();
    if v.is_empty() { Err(Error::State(format!("{what} fehlt"))) } else { Ok(v.to_owned()) }
}

#[tauri::command]
fn project_create(state: State<AppState>, code: String, name: String) -> Result<Project> {
    state.db().create_project(&required(&code, "Projekt-ID")?, &required(&name, "Name")?)
}

#[tauri::command]
fn project_update(state: State<AppState>, id: i64, name: String) -> Result<()> {
    state.db().update_project(id, &required(&name, "Name")?)
}

#[tauri::command]
fn project_delete(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_project(id)
}

#[tauri::command]
fn netzplan_create(
    state: State<AppState>,
    project_id: i64,
    netzplan_nr: String,
    wbs_element: String,
    description: String,
    planned_hours: f64,
) -> Result<Netzplan> {
    let nr = required(&netzplan_nr, "Netzplan-Nr.")?;
    let wbs = if wbs_element.trim().is_empty() { nr.clone() } else { wbs_element.trim().to_owned() };
    state.db().create_netzplan(project_id, &nr, &wbs, description.trim(), planned_hours.max(0.0))
}

#[tauri::command]
fn netzplan_update(
    state: State<AppState>,
    id: i64,
    wbs_element: String,
    description: String,
    planned_hours: f64,
) -> Result<()> {
    state.db().update_netzplan(id, &wbs_element, &description, planned_hours.max(0.0))
}

#[tauri::command]
fn netzplan_delete(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_netzplan(id)
}

/// Adds a Vorgang; `predecessors` are Vorgang numbers of the same Netzplan.
#[tauri::command]
fn vorgang_create(
    state: State<AppState>,
    netzplan_id: i64,
    vorgang_nr: String,
    description: String,
    duration_days: f64,
    planned_hours: f64,
    predecessors: Vec<String>,
) -> Result<Vorgang> {
    let nr = required(&vorgang_nr, "Vorgangsnummer")?;
    let db = state.db();
    let existing = db.list_vorgaenge(netzplan_id)?;
    let preds: Vec<i64> = predecessors
        .iter()
        .map(|p| {
            existing
                .iter()
                .find(|v| v.vorgang_nr == *p)
                .map(|v| v.id)
                .ok_or_else(|| Error::not_found("vorgang", p.clone()))
        })
        .collect::<Result<_>>()?;
    db.atomic(|| {
        // A new Vorgang has no successors, so linking it cannot create a cycle.
        let mut v =
            db.create_vorgang(netzplan_id, &nr, description.trim(), duration_days.max(0.0), planned_hours.max(0.0))?;
        for p in preds {
            db.link_vorgaenge(p, v.id)?;
            v.predecessors.push(p);
        }
        Ok(v)
    })
}

#[tauri::command]
fn vorgang_update(
    state: State<AppState>,
    id: i64,
    description: String,
    duration_days: f64,
    planned_hours: f64,
    remaining_hours: Option<f64>,
) -> Result<()> {
    state.db().update_vorgang(id, &description, duration_days.max(0.0), planned_hours.max(0.0), remaining_hours)
}

#[tauri::command]
fn vorgang_delete(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_vorgang(id)
}

#[tauri::command]
fn leistungsarten_list(state: State<AppState>) -> Result<Vec<(String, String)>> {
    state.db().list_leistungsarten()
}

#[tauri::command]
fn leistungsart_save(state: State<AppState>, code: String, description: String) -> Result<()> {
    state.db().upsert_leistungsart(&code, &description)
}

#[tauri::command]
fn leistungsart_delete(state: State<AppState>, code: String) -> Result<()> {
    state.db().delete_leistungsart(&code)
}

// ---------------------------------------------------------- time tracking

#[tauri::command]
fn log_time(state: State<AppState>, line: String) -> Result<LogOutcome> {
    let t = state.settings().thresholds;
    tracking::log_slash_command(&state.db(), &line, Utc::now(), &Local, &t)
}

#[derive(Serialize)]
struct TimerStatus {
    entry: TimeEntry,
    idle_minutes: i64,
    is_idle: bool,
}

#[tauri::command]
fn timer_status(state: State<AppState>) -> Result<Option<TimerStatus>> {
    let running = state.db().running_timer()?;
    let idle = lock(&state.idle);
    Ok(running.map(|entry| TimerStatus { entry, idle_minutes: idle.idle_minutes(Utc::now()), is_idle: idle.is_idle() }))
}

#[tauri::command]
fn timer_start(
    app: AppHandle,
    state: State<AppState>,
    netzplan_id: i64,
    vorgang_nr: Option<String>,
    leistungsart: Option<String>,
    description: String,
) -> Result<TimeEntry> {
    let e = state.db().start_timer(
        netzplan_id,
        vorgang_nr.as_deref(),
        leistungsart.as_deref(),
        &description,
        Utc::now(),
    )?;
    lock(&state.idle).reset();
    let _ = app.emit("data://entries", ());
    Ok(e)
}

#[derive(Serialize)]
struct StopOutcome {
    entry: TimeEntry,
    idle_minutes: i64,
    alerts: Vec<BudgetStatus>,
    /// True when less than a minute was recorded and nothing was booked.
    discarded: bool,
}

/// Stops the timer. With `subtract_idle` the detected idle time is not booked.
#[tauri::command]
fn timer_stop(app: AppHandle, state: State<AppState>, subtract_idle: bool) -> Result<StopOutcome> {
    let now = Utc::now();
    let idle_minutes = lock(&state.idle).idle_minutes(now);
    let thresholds = state.settings().thresholds;
    let db = state.db();
    let entry = db.stop_timer(now, if subtract_idle { idle_minutes } else { 0 })?;
    lock(&state.idle).reset();
    let _ = app.emit("data://entries", ());
    if entry.duration_minutes.unwrap_or(0) < 1 {
        db.delete_time_entry(entry.id)?;
        return Ok(StopOutcome { entry, idle_minutes, alerts: vec![], discarded: true });
    }
    let alerts = tracking::alerts_for(&db, entry.netzplan_id, entry.vorgang_nr.as_deref(), &thresholds)?;
    Ok(StopOutcome { entry, idle_minutes, alerts, discarded: false })
}

#[tauri::command]
fn timer_discard(app: AppHandle, state: State<AppState>) -> Result<()> {
    state.db().discard_timer()?;
    let _ = app.emit("data://entries", ());
    Ok(())
}

#[tauri::command]
fn time_entries(
    state: State<AppState>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
) -> Result<Vec<TimeEntryRow>> {
    state.db().list_time_entries(&EntryFilter { from, to, ..Default::default() })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn time_entry_create(
    state: State<AppState>,
    netzplan_id: i64,
    vorgang_nr: Option<String>,
    leistungsart: Option<String>,
    start_time: DateTime<Utc>,
    duration_minutes: i64,
    description: String,
) -> Result<LogOutcome> {
    if !(1..=24 * 60).contains(&duration_minutes) {
        return Err(Error::State("Dauer muss zwischen 1 Minute und 24 Stunden liegen".into()));
    }
    let t = state.settings().thresholds;
    let db = state.db();
    let entry = db.insert_time_entry(&NewTimeEntry {
        netzplan_id,
        vorgang_nr: vorgang_nr.filter(|v| !v.is_empty()),
        leistungsart: leistungsart.filter(|v| !v.is_empty()),
        start_time,
        duration_minutes,
        description,
        source: EntrySource::Manual,
    })?;
    let alerts = tracking::alerts_for(&db, entry.netzplan_id, entry.vorgang_nr.as_deref(), &t)?;
    Ok(LogOutcome { entry, alerts })
}

#[tauri::command]
fn time_entry_update(
    state: State<AppState>,
    id: i64,
    vorgang_nr: Option<String>,
    leistungsart: Option<String>,
    start_time: DateTime<Utc>,
    duration_minutes: i64,
    description: String,
) -> Result<TimeEntry> {
    state.db().update_time_entry(
        id,
        vorgang_nr.as_deref().filter(|v| !v.is_empty()),
        leistungsart.as_deref().filter(|v| !v.is_empty()),
        start_time,
        duration_minutes,
        &description,
    )
}

#[tauri::command]
fn set_entry_status(state: State<AppState>, ids: Vec<i64>, status: StatusFlag) -> Result<usize> {
    state.db().set_entry_status(&ids, status)
}

#[tauri::command]
fn delete_time_entry(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_time_entry(id)
}

#[tauri::command]
fn budget(state: State<AppState>, netzplan_id: i64) -> Result<Vec<BudgetStatus>> {
    let t = state.settings().thresholds;
    tracking::budget_status(&state.db(), netzplan_id, &t)
}

#[tauri::command]
fn schedule(state: State<AppState>, netzplan_id: i64) -> Result<Schedule> {
    netzplan::schedule(&state.db().list_vorgaenge(netzplan_id)?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // IPC arguments map 1:1 to the UI call
fn export_entries(
    state: State<AppState>,
    format: ExportFormat,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    only_released: bool,
    mark_exported: bool,
    path: Option<String>,
    include_exported: Option<bool>,
) -> Result<ExportResult> {
    let settings = state.settings();
    let db = state.db();
    let status = only_released.then_some(StatusFlag::Released);
    let mut rows = db.list_time_entries(&EntryFilter { from, to, status, ..Default::default() })?;
    // Exported entries were already booked in SAP/Jira; exporting them again duplicates bookings.
    if !include_exported.unwrap_or(false) {
        rows.retain(|r| r.entry.status_flag != StatusFlag::Exported);
    }
    let options = ExportOptions {
        pernr: settings.pernr.clone(),
        jira_issue_map: settings.jira_issue_map.clone(),
        utc_offset_minutes: None,
    };
    let res = export::export(&rows, format, &options)?;
    if let Some(p) = path {
        std::fs::write(&p, &res.content)?;
    }
    if mark_exported {
        db.set_entry_status(&res.exported_ids, StatusFlag::Exported)?;
    }
    Ok(res)
}

// ---------------------------------------------------------------- settings

#[derive(Serialize)]
struct SettingsView {
    settings: Settings,
    api_key_set: bool,
    api_key_storage: &'static str,
    data_dir: String,
    version: &'static str,
}

#[tauri::command]
fn settings_get(state: State<AppState>) -> SettingsView {
    SettingsView {
        settings: state.settings(),
        api_key_set: state.secrets.get().is_some(),
        api_key_storage: state.secrets.backend(),
        data_dir: state.data_dir.display().to_string(),
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// Saves settings and applies them immediately (no restart needed).
#[tauri::command]
fn settings_save(state: State<AppState>, settings: Settings) -> Result<SettingsView> {
    let url = settings.litellm_base_url.trim().to_owned();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(Error::State("Die Server-URL muss mit http:// oder https:// beginnen".into()));
    }
    let mut settings = settings;
    settings.litellm_base_url = url.trim_end_matches('/').to_owned();
    state.db().save_settings(&settings)?;
    lock(&state.idle).set_threshold(Duration::from_secs(settings.idle_threshold_minutes * 60));
    *state.ai.write().unwrap_or_else(|e| e.into_inner()) = AiRuntime::new(settings, state.secrets.get());
    Ok(settings_get(state))
}

/// Stores (or with `None`, removes) the LiteLLM API key in the OS credential store.
#[tauri::command]
fn api_key_set(state: State<AppState>, key: Option<String>) -> Result<SettingsView> {
    state.secrets.set(key.as_deref().map(str::trim)).map_err(Error::State)?;
    let settings = state.settings();
    *state.ai.write().unwrap_or_else(|e| e.into_inner()) = AiRuntime::new(settings, state.secrets.get());
    Ok(settings_get(state))
}

#[derive(Serialize)]
struct ConnectionTest {
    ok: bool,
    latency_ms: u64,
    models: Vec<String>,
    error: Option<String>,
}

/// Checks a LiteLLM server by listing its models. Unsaved URL/key values can be tested.
#[tauri::command]
async fn ai_test_connection(
    state: State<'_, AppState>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<ConnectionTest> {
    let url = base_url.unwrap_or_else(|| state.settings().litellm_base_url);
    let key = api_key.filter(|k| !k.is_empty()).or_else(|| state.secrets.get());
    let client = LiteLlmClient::new(url.trim().trim_end_matches('/').to_owned(), key);
    let start = Instant::now();
    let res = client.models().await;
    let latency_ms = start.elapsed().as_millis() as u64;
    Ok(match res {
        Ok(mut models) => {
            models.sort();
            ConnectionTest { ok: true, latency_ms, models, error: None }
        }
        Err(e) => ConnectionTest { ok: false, latency_ms, models: vec![], error: Some(e.to_string()) },
    })
}

// ----------------------------------------------------------------------- AI

fn system_prompt(settings: &Settings) -> String {
    let now = Local::now();
    let mut s = format!(
        "Du bist der Assistent von AETHER OS, einem lokalen Arbeitsbereich für Notizen, Projekte und \
         Zeiterfassung. Heute ist {}. Antworte präzise und auf Deutsch, sofern der Nutzer nicht anders \
         schreibt. Nutze Markdown. Verweise auf Seiten mit [[Seitenname]]. Zeit wird mit der /zeit-Syntax \
         gebucht, z. B. /zeit NP-8801/1020 2.5h #DEV 'Beschreibung'. Nutze Tools nur, wenn nötig.",
        now.format("%A, %d.%m.%Y %H:%M")
    );
    if !settings.assistant_instructions.trim().is_empty() {
        s.push_str("\n\nZusätzliche Anweisungen des Nutzers:\n");
        s.push_str(settings.assistant_instructions.trim());
    }
    s
}

#[derive(Serialize, Clone)]
struct StreamPayload<'a> {
    request_id: &'a str,
    event: &'a StreamEvent,
}

#[derive(Serialize)]
struct ChatOutcome {
    completion: Completion,
    route: RouteDecision,
    context: Vec<ContextChunk>,
    meter: SessionMeter,
}

fn route_for(
    state: &AppState,
    prompt: &str,
    context: &[String],
    uses_tools: bool,
    tier: Option<Tier>,
) -> RouteDecision {
    let settings = state.settings();
    let force = tier.or((!settings.auto_route).then_some(Tier::Standard));
    state.router().route(&RouteInput { prompt, context, uses_tools, force })
}

#[tauri::command]
fn ai_route_preview(state: State<AppState>, prompt: String, use_tools: bool, tier: Option<Tier>) -> RouteDecision {
    route_for(&state, &prompt, &[], use_tools, tier)
}

#[tauri::command]
fn ai_models(state: State<AppState>) -> RouterConfig {
    state.settings().router
}

#[tauri::command]
fn ai_meter(state: State<AppState>) -> SessionMeter {
    lock(&state.meter).clone()
}

/// Runs one chat turn with retrieval and streams deltas as `ai://stream` events.
/// Tool calls in the result are executed by the UI via the `ai_*_tool` commands.
#[tauri::command]
async fn ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    messages: Vec<ChatMessage>,
    use_tools: bool,
    tier: Option<Tier>,
    page_id: Option<i64>,
) -> Result<ChatOutcome> {
    let prompt = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .and_then(|m| m.content.clone())
        .ok_or_else(|| Error::State("no user message".into()))?;
    let settings = state.settings();
    let client = state.client();

    // Retrieval: embeddings are optional; keyword search always works offline.
    let query_embedding = match &settings.embedding_model {
        Some(m) if !m.is_empty() => client.embed(m, std::slice::from_ref(&prompt)).await.ok().and_then(|mut v| v.pop()),
        _ => None,
    };
    let (context, active, source_tags) = {
        let db = state.db();
        let context = rag::retrieve(&db, &prompt, query_embedding.as_deref(), 6)?;
        let active = match page_id {
            Some(id) => db.page_doc(id).ok().map(|d| (d.page.title, d.content)),
            None => None,
        };
        // A chunk rarely contains its page's #privat tag, so the tags of every source page count too.
        let mut ids: Vec<i64> = context.iter().filter_map(|c| c.page_id).collect();
        ids.sort_unstable();
        ids.dedup();
        let mut tags = vec![];
        for id in ids {
            tags.extend(db.page_tags(id)?.into_iter().map(|t| format!("#{t}")));
        }
        (context, active, tags.join(" "))
    };
    let mut context_texts: Vec<String> = context.iter().map(|c| c.text.clone()).collect();
    if let Some((_, text)) = &active {
        context_texts.push(text.clone());
    }
    context_texts.push(source_tags);
    // Earlier turns (and tool results) of the conversation are sent again, so they count as well.
    context_texts.extend(messages.iter().filter_map(|m| m.content.clone()));
    let route = route_for(&state, &prompt, &context_texts, use_tools, tier);

    let mut full = vec![ChatMessage::system(system_prompt(&settings))];
    if let Some((title, text)) = &active {
        let text: String = text.chars().take(12_000).collect();
        full.push(ChatMessage::system(format!("Aktuell geöffnete Seite „{title}“:\n\n{text}")));
    }
    if !context.is_empty() {
        full.push(ChatMessage::system(rag::format_context(&context)));
    }
    full.extend(messages);
    let req = ChatRequest {
        model: route.model.clone(),
        messages: full,
        tools: if use_tools { tools::definitions() } else { vec![] },
        temperature: Some(0.3),
        max_tokens: None,
    };

    let cancel = Arc::new(AtomicBool::new(false));
    lock(&state.cancels).insert(request_id.clone(), cancel.clone());
    let result = client
        .chat_stream(&req, Some(&cancel), |event| {
            let _ = app.emit("ai://stream", StreamPayload { request_id: &request_id, event: &event });
        })
        .await;
    lock(&state.cancels).remove(&request_id);
    let completion = result?;

    state.db().record_ai_usage(&state.session_id, &completion.usage)?;
    let meter = {
        let mut m = lock(&state.meter);
        m.add(&completion.usage);
        m.clone()
    };
    let _ = app.emit("ai://meter", &meter);
    Ok(ChatOutcome { completion, route, context, meter })
}

#[tauri::command]
fn ai_cancel(state: State<AppState>, request_id: String) {
    if let Some(flag) = lock(&state.cancels).get(&request_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[derive(Serialize)]
#[serde(tag = "risk", rename_all = "snake_case")]
enum ToolPlan {
    Workspace,
    RequiresApproval { call: SystemCall, summary: String },
}

/// Classifies a tool call so the UI knows whether to ask the user first.
#[tauri::command]
fn ai_plan_tool(name: String, arguments: String) -> Result<ToolPlan> {
    Ok(match tools::classify(&name) {
        Risk::Workspace => ToolPlan::Workspace,
        Risk::RequiresApproval => {
            let call = SystemCall::from_tool_call(&name, &arguments)?;
            ToolPlan::RequiresApproval { summary: call.describe(), call }
        }
    })
}

#[tauri::command]
fn ai_run_workspace_tool(app: AppHandle, state: State<AppState>, name: String, arguments: String) -> Result<String> {
    let args: serde_json::Value = serde_json::from_str(&arguments)?;
    let arg = |k: &str| args[k].as_str().unwrap_or_default().to_owned();
    let t = state.settings().thresholds;
    let db = state.db();
    let out = match name.as_str() {
        "log_time" => {
            let mut line = arg("command");
            if !aether_core::zeit::is_zeit_command(&line) {
                line = format!("/zeit {line}");
            }
            let res = serde_json::to_string(&tracking::log_slash_command(&db, &line, Utc::now(), &Local, &t)?)?;
            let _ = app.emit("data://entries", ());
            res
        }
        // Snippets mark hits with STX/ETX; the model does not need them.
        "search_workspace" => serde_json::to_string(&search::search(&db, &arg("query"), 10)?)?
            .replace("\\u0002", "")
            .replace("\\u0003", ""),
        "budget_status" => {
            let np = db.netzplan_by_ref(&arg("netzplan"))?;
            serde_json::to_string(&tracking::budget_status(&db, np.id, &t)?)?
        }
        other => return Err(Error::State(format!("'{other}' is not a workspace tool"))),
    };
    Ok(out)
}

/// Executes a system tool. The UI calls this only after the user approved
/// the exact summary returned by `ai_plan_tool`.
#[tauri::command]
async fn ai_run_system_tool(call: SystemCall) -> Result<String> {
    tools::execute_system_tool(&call, &tools::HttpClient::new()).await
}

/// Embeds note chunks that have no embedding yet. Returns the number indexed.
#[tauri::command]
async fn ai_index_pending(state: State<'_, AppState>) -> Result<usize> {
    let model = state
        .settings()
        .embedding_model
        .filter(|m| !m.is_empty())
        .ok_or_else(|| Error::State("Kein Embedding-Modell in den Einstellungen gewählt".into()))?;
    let client = state.client();
    let mut total = 0;
    loop {
        let batch = rag::pending_blocks(&state.db(), 32)?;
        if batch.is_empty() {
            return Ok(total);
        }
        let texts: Vec<String> = batch.iter().map(|(_, t)| t.clone()).collect();
        let vectors = client.embed(&model, &texts).await?;
        let db = state.db();
        for ((id, _), v) in batch.iter().zip(&vectors) {
            rag::store_embedding(&db, *id, v)?;
        }
        total += batch.len();
    }
}

// --------------------------------------------------------------- activity

#[derive(Serialize, Clone)]
struct ActivityTick {
    idle_seconds: Option<u64>,
    window: Option<activity::WindowInfo>,
    timer_idle_minutes: Option<i64>,
    is_idle: bool,
}

/// Samples input idleness and the foreground window every 5 seconds.
fn spawn_activity_sampler(app: AppHandle) {
    const INTERVAL: Duration = Duration::from_secs(5);
    std::thread::spawn(move || {
        let probe = activity::system_probe();
        loop {
            std::thread::sleep(INTERVAL);
            let state = app.state::<AppState>();
            let idle = probe.idle_duration();
            let window = probe.foreground_window();
            let threshold = Duration::from_secs(state.settings().idle_threshold_minutes * 60);
            let is_idle = idle.is_some_and(|d| d >= threshold);
            let running = state.db().running_timer().ok().flatten().is_some();
            let timer_idle_minutes = if running {
                let mut acc = lock(&state.idle);
                if let Some(d) = idle {
                    acc.observe(Utc::now(), d);
                }
                Some(acc.idle_minutes(Utc::now()))
            } else {
                None
            };
            lock(&state.usage).record(window.as_ref(), is_idle, INTERVAL);
            let tick = ActivityTick { idle_seconds: idle.map(|d| d.as_secs()), window, timer_idle_minutes, is_idle };
            let _ = app.emit("activity://tick", tick);
        }
    });
}

/// Removes the sample project and pages created on first start.
#[tauri::command]
fn demo_remove(app: AppHandle, state: State<AppState>) -> Result<usize> {
    let n = demo::remove(&state.db())?;
    let _ = app.emit("data://entries", ());
    Ok(n)
}

/// Windows 11 (build 22000+) supports the Mica backdrop.
#[cfg(windows)]
fn supports_mica() -> bool {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    // SAFETY: `info` is a valid, correctly sized OSVERSIONINFOW.
    unsafe { RtlGetVersion(&mut info) == 0 && info.dwBuildNumber >= 22000 }
}

#[cfg(not(windows))]
fn supports_mica() -> bool {
    false
}

fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let mica = supports_mica();
    let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("AETHER OS")
        .inner_size(1480.0, 920.0)
        .min_inner_size(900.0, 560.0)
        .center();
    #[cfg(windows)]
    let builder = if mica {
        builder.transparent(true).effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::window::Effect::Mica],
            ..Default::default()
        })
    } else {
        builder
    };
    let _ = mica;
    builder.build()?;
    Ok(())
}

/// Whether the window has a Mica backdrop (the UI then lets it show through).
#[tauri::command]
fn window_backdrop() -> bool {
    supports_mica()
}

/// Switches the Mica variant to match the app theme (Windows 11 only).
#[tauri::command]
fn window_set_theme(app: AppHandle, dark: bool) {
    #[cfg(windows)]
    if supports_mica()
        && let Some(w) = app.get_webview_window("main")
    {
        let effect = if dark { tauri::window::Effect::MicaDark } else { tauri::window::Effect::MicaLight };
        let _ =
            w.set_effects(tauri::utils::config::WindowEffectsConfig { effects: vec![effect], ..Default::default() });
    }
    let _ = (app, dark);
}

#[derive(Serialize)]
struct AppInfo {
    version: &'static str,
    data_dir: String,
    platform: &'static str,
}

#[tauri::command]
fn app_info(state: State<AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.display().to_string(),
        platform: std::env::consts::OS,
    }
}

// ------------------------------------------------------------------ startup

#[derive(Deserialize, Default)]
struct StartupOptions {
    /// Seed the demo workspace on first start (default true).
    demo: Option<bool>,
}

pub fn run() {
    let palette = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &palette {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("palette://toggle", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // AETHER_DATA_DIR lets tests run against a throw-away workspace.
            let dir = match std::env::var_os("AETHER_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            let opts: StartupOptions =
                std::env::var("AETHER_STARTUP").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let db = Database::open(dir.join("workspace.db"))?;
            if opts.demo.unwrap_or(true) {
                demo::seed(&db, Utc::now())?;
            }
            let settings = db.load_settings()?;
            let secrets = SecretStore::new(&dir);
            let idle_threshold = Duration::from_secs(settings.idle_threshold_minutes * 60);
            let ai = AiRuntime::new(settings, secrets.get());

            app.manage(AppState {
                db: Mutex::new(db),
                ai: RwLock::new(ai),
                secrets,
                data_dir: dir,
                meter: Mutex::new(SessionMeter::default()),
                session_id: Utc::now().format("%Y%m%dT%H%M%S").to_string(),
                idle: Mutex::new(IdleAccumulator::new(idle_threshold)),
                usage: Mutex::new(WindowUsage::default()),
                cancels: Mutex::new(HashMap::new()),
            });

            create_main_window(app)?;

            // Another instance may already own the shortcut; Ctrl+K still works in-app.
            if let Err(e) = app.global_shortcut().register(palette) {
                eprintln!("Alt+Space not available: {e}");
            }
            spawn_activity_sampler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_tree,
            page_get,
            page_save,
            page_create,
            page_rename,
            page_delete,
            page_move,
            page_set_favorite,
            page_set_icon,
            page_resolve,
            recent_pages,
            daily_note,
            tags_list,
            tag_pages,
            search_workspace,
            vault_import,
            vault_export,
            wbs_tree,
            project_create,
            project_update,
            project_delete,
            netzplan_create,
            netzplan_update,
            netzplan_delete,
            vorgang_create,
            vorgang_update,
            vorgang_delete,
            leistungsarten_list,
            leistungsart_save,
            leistungsart_delete,
            log_time,
            timer_status,
            timer_start,
            timer_stop,
            timer_discard,
            time_entries,
            time_entry_create,
            time_entry_update,
            set_entry_status,
            delete_time_entry,
            budget,
            schedule,
            export_entries,
            settings_get,
            settings_save,
            api_key_set,
            ai_test_connection,
            ai_route_preview,
            ai_models,
            ai_meter,
            ai_chat,
            ai_cancel,
            ai_plan_tool,
            ai_run_workspace_tool,
            ai_run_system_tool,
            ai_index_pending,
            app_info,
            demo_remove,
            window_backdrop,
            window_set_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AETHER OS");
}
