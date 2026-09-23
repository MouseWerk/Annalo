// Typed wrappers around the Tauri IPC commands (see src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as T from "./types";

const call = <R>(cmd: string, args?: Record<string, unknown>) => invoke<R>(cmd, args);

export const api = {
  // pages
  tree: () => call<T.PageNode[]>("workspace_tree"),
  page: (id: number) => call<T.PageDoc>("page_get", { id }),
  savePage: (id: number, content: string) => call<T.PageDoc>("page_save", { id, content }),
  createPage: (title: string, parentId: number | null = null, icon: string | null = "file-text", content?: string) =>
    call<T.Page>("page_create", { parentId, title, icon, content: content ?? null }),
  renamePage: (id: number, title: string, updateLinks = true) => call<number>("page_rename", { id, title, updateLinks }),
  deletePage: (id: number) => call<void>("page_delete", { id }),
  movePage: (id: number, parentId: number | null, position: number) => call<void>("page_move", { id, parentId, position }),
  setFavorite: (id: number, favorite: boolean) => call<void>("page_set_favorite", { id, favorite }),
  setIcon: (id: number, icon: string | null) => call<void>("page_set_icon", { id, icon }),
  resolvePage: (title: string, create: boolean) => call<T.Page | null>("page_resolve", { title, create }),
  recentPages: (limit = 8) => call<T.Page[]>("recent_pages", { limit }),
  dailyNote: (date?: string) => call<T.Page>("daily_note", { date: date ?? null }),
  tags: () => call<[string, number][]>("tags_list"),
  tagPages: (tag: string) => call<T.Page[]>("tag_pages", { tag }),
  search: (query: string, limit = 30) => call<T.SearchHit[]>("search_workspace", { query, limit }),
  importVault: (path: string) => call<T.ImportReport>("vault_import", { path }),
  exportVault: (path: string) => call<number>("vault_export", { path }),

  // WBS
  wbs: () => call<T.ProjectTree[]>("wbs_tree"),
  createProject: (code: string, name: string) => call<T.Project>("project_create", { code, name }),
  updateProject: (id: number, name: string) => call<void>("project_update", { id, name }),
  deleteProject: (id: number) => call<void>("project_delete", { id }),
  createNetzplan: (projectId: number, netzplanNr: string, wbsElement: string, description: string, plannedHours: number) =>
    call<T.Netzplan>("netzplan_create", { projectId, netzplanNr, wbsElement, description, plannedHours }),
  updateNetzplan: (id: number, wbsElement: string, description: string, plannedHours: number) =>
    call<void>("netzplan_update", { id, wbsElement, description, plannedHours }),
  deleteNetzplan: (id: number) => call<void>("netzplan_delete", { id }),
  createVorgang: (netzplanId: number, vorgangNr: string, description: string, durationDays: number, plannedHours: number, predecessors: string[]) =>
    call<T.Vorgang>("vorgang_create", { netzplanId, vorgangNr, description, durationDays, plannedHours, predecessors }),
  updateVorgang: (id: number, description: string, durationDays: number, plannedHours: number, remainingHours: number | null) =>
    call<void>("vorgang_update", { id, description, durationDays, plannedHours, remainingHours }),
  deleteVorgang: (id: number) => call<void>("vorgang_delete", { id }),
  leistungsarten: () => call<[string, string][]>("leistungsarten_list"),
  saveLeistungsart: (code: string, description: string) => call<void>("leistungsart_save", { code, description }),
  deleteLeistungsart: (code: string) => call<void>("leistungsart_delete", { code }),

  // time
  logTime: (line: string) => call<T.LogOutcome>("log_time", { line }),
  timerStatus: () => call<T.TimerStatus | null>("timer_status"),
  timerStart: (netzplanId: number, vorgangNr: string | null, leistungsart: string | null, description: string) =>
    call<T.TimeEntry>("timer_start", { netzplanId, vorgangNr, leistungsart, description }),
  timerStop: (subtractIdle: boolean) => call<T.StopOutcome>("timer_stop", { subtractIdle }),
  timerDiscard: () => call<void>("timer_discard"),
  entries: (from?: string, to?: string) => call<T.TimeEntryRow[]>("time_entries", { from: from ?? null, to: to ?? null }),
  createEntry: (e: { netzplanId: number; vorgangNr: string | null; leistungsart: string | null; startTime: string; durationMinutes: number; description: string }) =>
    call<T.LogOutcome>("time_entry_create", e),
  updateEntry: (e: { id: number; vorgangNr: string | null; leistungsart: string | null; startTime: string; durationMinutes: number; description: string }) =>
    call<T.TimeEntry>("time_entry_update", e),
  setStatus: (ids: number[], status: T.StatusFlag) => call<number>("set_entry_status", { ids, status }),
  deleteEntry: (id: number) => call<void>("delete_time_entry", { id }),
  budget: (netzplanId: number) => call<T.BudgetStatus[]>("budget", { netzplanId }),
  schedule: (netzplanId: number) => call<T.Schedule>("schedule", { netzplanId }),
  exportEntries: (a: { format: T.ExportFormat; from: string | null; to: string | null; onlyReleased: boolean; markExported: boolean; path: string | null }) =>
    call<T.ExportResult>("export_entries", a),

  // settings
  settings: () => call<T.SettingsView>("settings_get"),
  saveSettings: (settings: T.Settings) => call<T.SettingsView>("settings_save", { settings }),
  setApiKey: (key: string | null) => call<T.SettingsView>("api_key_set", { key }),
  testConnection: (baseUrl: string | null, apiKey: string | null) => call<T.ConnectionTest>("ai_test_connection", { baseUrl, apiKey }),
  removeDemo: () => call<number>("demo_remove"),
  appInfo: () => call<{ version: string; data_dir: string; platform: string }>("app_info"),

  // AI
  routePreview: (prompt: string, useTools: boolean, tier: T.Tier | null) => call<T.RouteDecision>("ai_route_preview", { prompt, useTools, tier }),
  meter: () => call<T.SessionMeter>("ai_meter"),
  chat: (a: { requestId: string; messages: T.ChatMessage[]; useTools: boolean; tier: T.Tier | null; pageId: number | null }) =>
    call<T.ChatOutcome>("ai_chat", a),
  cancelChat: (requestId: string) => call<void>("ai_cancel", { requestId }),
  planTool: (name: string, args: string) => call<T.ToolPlan>("ai_plan_tool", { name, arguments: args }),
  runWorkspaceTool: (name: string, args: string) => call<string>("ai_run_workspace_tool", { name, arguments: args }),
  runSystemTool: (callSpec: unknown) => call<string>("ai_run_system_tool", { call: callSpec }),
  indexPending: () => call<number>("ai_index_pending"),
};

export function on<P>(event: string, handler: (payload: P) => void): Promise<UnlistenFn> {
  return listen<P>(event, (e) => handler(e.payload));
}

/** Errors from Rust arrive as plain strings. */
export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
