// Mirrors of the Rust types that cross the IPC boundary (serde snake_case).

export interface Page {
  id: number;
  parent_id: number | null;
  title: string;
  icon: string | null;
  position: number;
  updated_at: string;
  favorite: boolean;
  daily_date: string | null;
  /** Set while the page is in the trash. */
  deleted_at?: string | null;
}
export interface PageNode extends Page {
  children: PageNode[];
}
export interface Backlink {
  page_id: number;
  title: string;
  icon: string | null;
  context: string;
}
export interface PageDoc extends Page {
  content: string;
  tags: string[];
  backlinks: Backlink[];
  unresolved_links: string[];
}

export type SearchHit =
  | { kind: "page"; page_id: number; title: string; icon: string | null; score: number }
  | { kind: "note"; page_id: number; title: string; icon: string | null; snippet: string; score: number }
  | { kind: "time_entry"; id: number; netzplan_nr: string; vorgang_nr: string | null; snippet: string; score: number };

export type StatusFlag = "running" | "draft" | "released" | "exported";

export interface TimeEntry {
  id: number;
  netzplan_id: number;
  vorgang_nr: string | null;
  leistungsart: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  description: string;
  status_flag: StatusFlag;
  source: "manual" | "timer" | "slash" | "auto";
}
export interface TimeEntryRow extends TimeEntry {
  project_code: string;
  netzplan_nr: string;
  wbs_element: string;
}

export interface Vorgang {
  id: number;
  netzplan_id: number;
  vorgang_nr: string;
  description: string;
  duration_days: number;
  planned_hours: number;
  remaining_hours: number | null;
  predecessors: number[];
}
export interface Netzplan {
  id: number;
  project_id: number;
  netzplan_nr: string;
  wbs_element: string;
  description: string;
  planned_hours: number;
}
export interface NetzplanTree extends Netzplan {
  vorgaenge: Vorgang[];
}
export interface Project {
  id: number;
  project_code: string;
  name: string;
  created_at: string;
}
export interface ProjectTree extends Project {
  netzplaene: NetzplanTree[];
}

export type AlertLevel = "ok" | "warning" | "critical" | "exceeded";
export interface BudgetStatus {
  label: string;
  netzplan_id: number;
  vorgang_nr: string | null;
  planned_hours: number;
  booked_hours: number;
  etc_hours: number;
  eac_hours: number;
  consumed: number;
  level: AlertLevel;
}
export interface ScheduleNode {
  vorgang_id: number;
  vorgang_nr: string;
  description: string;
  duration: number;
  faz: number;
  fez: number;
  saz: number;
  sez: number;
  gp: number;
  fp: number;
  critical: boolean;
}
export interface Schedule {
  nodes: ScheduleNode[];
  duration: number;
  critical_path: number[];
}

export interface LogOutcome {
  entry: TimeEntry;
  alerts: BudgetStatus[];
}
export interface TimerStatus {
  entry: TimeEntry;
  idle_minutes: number;
  is_idle: boolean;
}
export interface StopOutcome extends LogOutcome {
  idle_minutes: number;
  discarded: boolean;
}
export type ExportFormat = "sap_cats" | "jira_worklog" | "csv" | "json";
export interface ExportResult {
  content: string;
  exported_ids: number[];
  skipped: [number, string][];
}

export type Tier = "local" | "standard" | "reasoning";
export interface RouterConfig {
  local_model: string;
  standard_model: string;
  reasoning_model: string;
  standard_threshold: number;
  reasoning_threshold: number;
  private_markers: string[];
}
export interface Settings {
  litellm_base_url: string;
  router: RouterConfig;
  auto_route: boolean;
  embedding_model: string | null;
  assistant_instructions: string;
  thresholds: { warning: number; critical: number };
  idle_threshold_minutes: number;
  pernr: string | null;
  jira_issue_map: Record<string, string>;
  theme: "system" | "light" | "dark";
  open_daily_on_start: boolean;
  daily_target_hours: number;
  workdays: number[];
  backup_dir: string | null;
  backup_keep: number;
  /** Template page for new daily notes. */
  daily_template: number | null;
}
export interface SettingsView {
  settings: Settings;
  api_key_set: boolean;
  api_key_storage: string;
  data_dir: string;
  /** Effective backup folder. */
  backup_dir: string;
  version: string;
}
export interface TrashEntry extends Page {
  deleted_at: string;
  /** Subpages deleted together with this page. */
  descendants: number;
  parent_title: string | null;
}
export interface BackupInfo {
  path: string;
  file_name: string;
  created_at: string;
  size_bytes: number;
}
export interface ConnectionTest {
  ok: boolean;
  latency_ms: number;
  models: string[];
  error: string | null;
}
export interface RouteDecision {
  tier: Tier;
  model: string;
  score: number;
  reasons: string[];
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface UsageRecord {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  ttft_ms: number | null;
  tokens_per_second: number | null;
}
export interface Completion {
  content: string;
  tool_calls: ToolCall[];
  finish_reason: string | null;
  usage: UsageRecord;
  exact_usage: boolean;
}
export interface ContextChunk {
  source: string;
  page_id: number | null;
  text: string;
  score: number;
  block_id: number | null;
  time_entry_id: number | null;
}
export interface SessionMeter {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  last_ttft_ms: number | null;
  last_tokens_per_second: number | null;
}
export interface ChatOutcome {
  completion: Completion;
  route: RouteDecision;
  context: ContextChunk[];
  meter: SessionMeter;
}
export type StreamEvent =
  | { type: "delta"; text: string; tokens_per_second: number | null }
  | { type: "first_token"; ttft_ms: number };
export type ToolPlan =
  | { risk: "workspace" }
  | { risk: "requires_approval"; call: unknown; summary: string };
export interface ImportReport {
  pages: number;
  folders: number;
  attachments: number;
  skipped: number;
  root_page_id: number;
}
export type TaskStatus = "open" | "done" | "all";
export interface Task {
  page_id: number;
  page_title: string;
  page_icon: string | null;
  /** Index among the page's task items; identifies the task for task_set_done. */
  ordinal: number;
  line: number;
  text: string;
  done: boolean;
  /** YYYY-MM-DD */
  due: string | null;
  /** 0 keine, 1 mittel (!), 2 hoch (!!) */
  priority: number;
  tags: string[];
}
export interface TaskFilter {
  status?: TaskStatus;
  due_before?: string | null;
  tag?: string | null;
  page_id?: number | null;
}
export interface SavedAttachment {
  name: string;
  path: string;
  size: number;
  markdown: string;
}
export interface ActivityTick {
  idle_seconds: number | null;
  window: { title: string; process: string } | null;
  timer_idle_minutes: number | null;
  is_idle: boolean;
}
