//! AETHER OS desktop shell: exposes `aether-core` to the web UI over Tauri IPC.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use aether_core::activity::{self, IdleAccumulator, WindowUsage};
use aether_core::ai::LiteLlmClient;
use aether_core::ai::client::{ChatMessage, ChatRequest, Completion};
use aether_core::ai::metrics::{PriceTable, SessionMeter};
use aether_core::ai::rag::{self, ContextChunk};
use aether_core::ai::router::{self, ModelRouter, RouteDecision, RouteInput, RouterConfig};
use aether_core::ai::tools::{self, Risk, SystemCall};
use aether_core::db::EntryFilter;
use aether_core::export::{self, ExportFormat, ExportOptions, ExportResult};
use aether_core::graph::{self, PageGraph};
use aether_core::model::*;
use aether_core::netzplan::{self, Schedule};
use aether_core::search::{self, SearchHit};
use aether_core::tracking::{self, BudgetStatus, LogOutcome, Thresholds};
use aether_core::{Database, Error, demo};
use chrono::{DateTime, FixedOffset, Local, Offset, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

type Result<T> = std::result::Result<T, Error>;

// ------------------------------------------------------------------- config

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Root of the LiteLLM proxy.
    pub litellm_base_url: String,
    /// Name of the environment variable holding the proxy key (never stored in the file).
    pub litellm_api_key_env: String,
    /// Embedding model for local RAG; `None` = keyword retrieval only.
    pub embedding_model: Option<String>,
    pub router: RouterConfig,
    pub prices: PriceTable,
    pub thresholds: Thresholds,
    /// Pauses longer than this are subtracted from running timers.
    pub idle_threshold_minutes: u64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            litellm_base_url: "http://localhost:4000".into(),
            litellm_api_key_env: "LITELLM_API_KEY".into(),
            embedding_model: None,
            router: RouterConfig::default(),
            prices: PriceTable::default(),
            thresholds: Thresholds::default(),
            idle_threshold_minutes: 5,
        }
    }
}

impl Config {
    fn load_or_create(dir: &Path) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let path = dir.join("aether.config.json");
        if path.exists() {
            Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
        } else {
            let c = Config::default();
            std::fs::write(path, serde_json::to_string_pretty(&c)?)?;
            Ok(c)
        }
    }
}

// -------------------------------------------------------------------- state

pub struct AppState {
    db: Mutex<Database>,
    config: Config,
    client: LiteLlmClient,
    router: ModelRouter,
    meter: Mutex<SessionMeter>,
    session_id: String,
    idle: Mutex<IdleAccumulator>,
    usage: Mutex<WindowUsage>,
}

impl AppState {
    fn db(&self) -> MutexGuard<'_, Database> {
        // A panic while holding the lock leaves SQLite consistent (transactions roll back).
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn local_offset() -> FixedOffset {
    Local::now().offset().fix()
}

// ------------------------------------------------------------ pages/blocks

#[tauri::command]
fn workspace_tree(state: State<AppState>) -> Result<Vec<PageNode>> {
    state.db().page_tree()
}

#[tauri::command]
fn page_blocks(state: State<AppState>, page_id: i64) -> Result<Vec<Block>> {
    state.db().list_blocks(page_id)
}

#[tauri::command]
fn create_page(state: State<AppState>, parent_id: Option<i64>, title: String, icon: Option<String>) -> Result<Page> {
    state.db().create_page(parent_id, &title, icon.as_deref())
}

#[tauri::command]
fn rename_page(state: State<AppState>, id: i64, title: String) -> Result<()> {
    state.db().rename_page(id, &title)
}

#[tauri::command]
fn delete_page(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_page(id)
}

#[tauri::command]
fn add_block(state: State<AppState>, page_id: i64, block_type: String, content: String) -> Result<Block> {
    state.db().add_block(page_id, &block_type, &content)
}

#[tauri::command]
fn update_block(state: State<AppState>, id: i64, block_type: String, content: String) -> Result<Block> {
    state.db().update_block(id, &block_type, &content)
}

#[tauri::command]
fn delete_block(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_block(id)
}

#[tauri::command]
fn search_workspace(state: State<AppState>, query: String) -> Result<Vec<SearchHit>> {
    search::search(&state.db(), &query, 30)
}

#[tauri::command]
fn page_graph(state: State<AppState>) -> Result<PageGraph> {
    graph::page_graph(&state.db())
}

// ---------------------------------------------------------- time tracking

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

/// Projects → Netzpläne → Vorgänge, for the WBS selector.
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

/// Adds a Vorgang to a Netzplan; `predecessors` are Vorgang numbers of the same Netzplan.
#[tauri::command]
fn create_vorgang(
    state: State<AppState>,
    netzplan_id: i64,
    vorgang_nr: String,
    description: String,
    duration_days: f64,
    planned_hours: f64,
    predecessors: Vec<String>,
) -> Result<Vorgang> {
    let vorgang_nr = vorgang_nr.trim();
    if vorgang_nr.is_empty() {
        return Err(Error::State("Vorgangsnummer fehlt".into()));
    }
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
    // A new Vorgang has no successors, so linking it cannot create a cycle.
    let mut v = db.create_vorgang(netzplan_id, vorgang_nr, description.trim(), duration_days, planned_hours)?;
    for p in preds {
        db.link_vorgaenge(p, v.id)?;
        v.predecessors.push(p);
    }
    Ok(v)
}

#[tauri::command]
fn log_time(state: State<AppState>, line: String) -> Result<LogOutcome> {
    tracking::log_slash_command(&state.db(), &line, Utc::now(), local_offset(), &state.config.thresholds)
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
    Ok(e)
}

#[derive(Serialize)]
struct StopOutcome {
    entry: TimeEntry,
    idle_minutes: i64,
    alerts: Vec<BudgetStatus>,
}

/// Stops the timer. With `subtract_idle` the detected idle time is not booked.
#[tauri::command]
fn timer_stop(state: State<AppState>, subtract_idle: bool) -> Result<StopOutcome> {
    let now = Utc::now();
    let idle_minutes = lock(&state.idle).idle_minutes(now);
    let db = state.db();
    let entry = db.stop_timer(now, if subtract_idle { idle_minutes } else { 0 })?;
    lock(&state.idle).reset();
    let alerts = tracking::alerts_for(&db, entry.netzplan_id, entry.vorgang_nr.as_deref(), &state.config.thresholds)?;
    Ok(StopOutcome { entry, idle_minutes, alerts })
}

#[tauri::command]
fn timer_discard(state: State<AppState>) -> Result<()> {
    state.db().discard_timer()
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
fn set_entry_status(state: State<AppState>, ids: Vec<i64>, status: StatusFlag) -> Result<usize> {
    state.db().set_entry_status(&ids, status)
}

#[tauri::command]
fn delete_time_entry(state: State<AppState>, id: i64) -> Result<()> {
    state.db().delete_time_entry(id)
}

#[tauri::command]
fn budget(state: State<AppState>, netzplan_id: i64) -> Result<Vec<BudgetStatus>> {
    tracking::budget_status(&state.db(), netzplan_id, &state.config.thresholds)
}

#[tauri::command]
fn schedule(state: State<AppState>, netzplan_id: i64) -> Result<Schedule> {
    netzplan::schedule(&state.db().list_vorgaenge(netzplan_id)?)
}

#[tauri::command]
fn export_entries(
    state: State<AppState>,
    format: ExportFormat,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    mut options: ExportOptions,
    mark_exported: bool,
) -> Result<ExportResult> {
    let db = state.db();
    let rows = db.list_time_entries(&EntryFilter { from, to, ..Default::default() })?;
    options.utc_offset_minutes = local_offset().local_minus_utc() / 60;
    let res = export::export(&rows, format, &options)?;
    if mark_exported {
        db.set_entry_status(&res.exported_ids, StatusFlag::Exported)?;
    }
    Ok(res)
}

// ----------------------------------------------------------------------- AI

const SYSTEM_PROMPT: &str = "Du bist der Assistent von AETHER OS, einem lokalen Produktivitäts-Workspace. \
Antworte präzise, auf Deutsch, sofern der Nutzer nicht anders schreibt. Zeit bucht man mit der \
/zeit-Syntax (z. B. /zeit NP-8801/1020 2.5h #DEV 'Beschreibung'). Nutze Tools nur, wenn nötig.";

#[derive(Serialize, Clone)]
struct StreamPayload<'a> {
    request_id: &'a str,
    event: &'a aether_core::ai::StreamEvent,
}

#[derive(Serialize)]
struct ChatOutcome {
    completion: Completion,
    route: RouteDecision,
    context: Vec<ContextChunk>,
    meter: SessionMeter,
}

#[tauri::command]
fn ai_route_preview(state: State<AppState>, prompt: String, use_tools: bool) -> RouteDecision {
    let (force, prompt) = router::parse_override(&prompt);
    state.router.route(&RouteInput { prompt, context: &[], uses_tools: use_tools, force })
}

/// The router's model per tier, for the "Active Model" picker.
#[tauri::command]
fn ai_models(state: State<AppState>) -> RouterConfig {
    state.router.config.clone()
}

#[tauri::command]
fn ai_meter(state: State<AppState>) -> SessionMeter {
    lock(&state.meter).clone()
}

/// Runs one chat turn with RAG context and streams deltas as `ai://stream` events.
/// Tool calls in the result are executed by the UI via the `ai_*_tool` commands.
#[tauri::command]
async fn ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    mut messages: Vec<ChatMessage>,
    use_tools: bool,
) -> Result<ChatOutcome> {
    let last_user =
        messages.iter_mut().rev().find(|m| m.role == "user").ok_or_else(|| Error::State("no user message".into()))?;
    let raw = last_user.content.clone().unwrap_or_default();
    let (force, prompt) = router::parse_override(&raw);
    let prompt = prompt.to_owned();
    last_user.content = Some(prompt.clone());

    // Retrieval: embeddings are optional; keyword search always works offline.
    let query_embedding = match &state.config.embedding_model {
        Some(m) => state.client.embed(m, std::slice::from_ref(&prompt)).await.ok().and_then(|mut v| v.pop()),
        None => None,
    };
    let context = rag::retrieve(&state.db(), &prompt, query_embedding.as_deref(), 6)?;
    let context_texts: Vec<String> = context.iter().map(|c| c.text.clone()).collect();

    let route =
        state.router.route(&RouteInput { prompt: &prompt, context: &context_texts, uses_tools: use_tools, force });

    let mut full = vec![ChatMessage::system(SYSTEM_PROMPT)];
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

    let completion = state
        .client
        .chat_stream(&req, |event| {
            let _ = app.emit("ai://stream", StreamPayload { request_id: &request_id, event: &event });
        })
        .await?;

    state.db().record_ai_usage(&state.session_id, &completion.usage)?;
    let meter = {
        let mut m = lock(&state.meter);
        m.add(&completion.usage);
        m.clone()
    };
    let _ = app.emit("ai://meter", &meter);
    Ok(ChatOutcome { completion, route, context, meter })
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
fn ai_run_workspace_tool(state: State<AppState>, name: String, arguments: String) -> Result<String> {
    let args: serde_json::Value = serde_json::from_str(&arguments)?;
    let arg = |k: &str| args[k].as_str().unwrap_or_default().to_owned();
    let db = state.db();
    let out = match name.as_str() {
        "log_time" => {
            let mut line = arg("command");
            if !aether_core::zeit::is_zeit_command(&line) {
                line = format!("/zeit {line}");
            }
            serde_json::to_string(&tracking::log_slash_command(
                &db,
                &line,
                Utc::now(),
                local_offset(),
                &state.config.thresholds,
            )?)?
        }
        "search_workspace" => serde_json::to_string(&search::search(&db, &arg("query"), 10)?)?,
        "budget_status" => {
            let np = db.netzplan_by_ref(&arg("netzplan"))?;
            serde_json::to_string(&tracking::budget_status(&db, np.id, &state.config.thresholds)?)?
        }
        other => return Err(Error::State(format!("'{other}' is not a workspace tool"))),
    };
    Ok(out)
}

/// Executes a system tool. The UI calls this only after the user approved
/// the exact summary returned by `ai_plan_tool`.
#[tauri::command]
async fn ai_run_system_tool(call: SystemCall) -> Result<String> {
    tools::execute_system_tool(&call, &reqwest_client()).await
}

fn reqwest_client() -> aether_core::ai::tools::HttpClient {
    aether_core::ai::tools::HttpClient::new()
}

/// Embeds blocks that have no embedding yet. Returns the number indexed.
#[tauri::command]
async fn ai_index_pending(state: State<'_, AppState>) -> Result<usize> {
    let model =
        state.config.embedding_model.clone().ok_or_else(|| Error::State("no embedding_model configured".into()))?;
    let mut total = 0;
    loop {
        let batch = rag::pending_blocks(&state.db(), 32)?;
        if batch.is_empty() {
            return Ok(total);
        }
        let texts: Vec<String> = batch.iter().map(|(_, t)| t.clone()).collect();
        let vectors = state.client.embed(&model, &texts).await?;
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
    top_apps: Vec<(String, u64)>,
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
            let threshold = Duration::from_secs(state.config.idle_threshold_minutes * 60);
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
            let top_apps = {
                let mut u = lock(&state.usage);
                u.record(window.as_ref(), idle.is_some_and(|d| d >= threshold), INTERVAL);
                u.top(5)
            };
            let tick = ActivityTick { idle_seconds: idle.map(|d| d.as_secs()), window, timer_idle_minutes, top_apps };
            let _ = app.emit("activity://tick", tick);
        }
    });
}

// ------------------------------------------------------------------ startup

pub fn run() {
    let palette = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &palette {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("palette://toggle", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let config = Config::load_or_create(&dir)?;
            let db = Database::open(dir.join("workspace.db"))?;
            demo::seed(&db, Utc::now())?;

            let api_key = std::env::var(&config.litellm_api_key_env).ok();
            let mut client = LiteLlmClient::new(config.litellm_base_url.clone(), api_key);
            client.prices = config.prices.clone();
            let idle_threshold = Duration::from_secs(config.idle_threshold_minutes * 60);

            app.manage(AppState {
                db: Mutex::new(db),
                router: ModelRouter::new(config.router.clone()),
                client,
                config,
                meter: Mutex::new(SessionMeter::default()),
                session_id: Utc::now().format("%Y%m%dT%H%M%S").to_string(),
                idle: Mutex::new(IdleAccumulator::new(idle_threshold)),
                usage: Mutex::new(WindowUsage::default()),
            });

            // Another instance may already own the shortcut; the in-app Ctrl+K still works.
            if let Err(e) = app.global_shortcut().register(palette) {
                eprintln!("Alt+Space not available: {e}");
            }
            spawn_activity_sampler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_tree,
            page_blocks,
            create_page,
            rename_page,
            delete_page,
            add_block,
            update_block,
            delete_block,
            search_workspace,
            page_graph,
            wbs_tree,
            create_vorgang,
            log_time,
            timer_status,
            timer_start,
            timer_stop,
            timer_discard,
            time_entries,
            set_entry_status,
            delete_time_entry,
            budget,
            schedule,
            export_entries,
            ai_route_preview,
            ai_models,
            ai_meter,
            ai_chat,
            ai_plan_tool,
            ai_run_workspace_tool,
            ai_run_system_tool,
            ai_index_pending,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AETHER OS");
}
