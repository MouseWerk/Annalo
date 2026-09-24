// Monthly AI cost limit (Settings → KI): a warning from 80 %, and at 100 % the shell refuses
// requests until the user sends one anyway.

import { errorText } from "./api";
import { useApp } from "../store/app";

/** Start of the shell's error when the limit is reached (see src-tauri/src/prefs.rs). */
export const COST_LIMIT_PREFIX = "KI-Kostenlimit erreicht";

export const isCostLimit = (e: unknown) => errorText(e).includes(COST_LIMIT_PREFIX);

/** Asks whether to send despite the limit. */
export function confirmOverLimit(e: unknown): Promise<boolean> {
  return useApp.getState().confirm({
    title: "Monatliches KI-Kostenlimit erreicht",
    message: `${errorText(e)}. Diese Anfrage trotzdem senden? Das Limit lässt sich unter Einstellungen › KI ändern.`,
    confirmLabel: "Trotzdem senden",
  });
}

let warnedAt = 0;
/** Toast once per 10 % step above 80 % of the limit. */
export function warnCost(fraction: number | null | undefined) {
  if (fraction == null || fraction < 0.8) return;
  const step = Math.floor(fraction * 10);
  if (step <= warnedAt) return;
  warnedAt = step;
  useApp.getState().toast({
    tone: fraction >= 1 ? "danger" : "warning",
    title: fraction >= 1 ? "KI-Kostenlimit erreicht" : `${Math.round(fraction * 100)} % des KI-Kostenlimits verbraucht`,
    detail: "Monatliches Limit unter Einstellungen › KI.",
  });
}

/** Runs `send`; when the limit blocks it, asks and runs it again with the override. */
export async function withCostLimit<T>(send: (override: boolean) => Promise<T>): Promise<T> {
  try {
    return await send(false);
  } catch (e) {
    if (!isCostLimit(e) || !(await confirmOverLimit(e))) throw e;
    return send(true);
  }
}

/** Whether answers are shown while they stream (Settings → KI). */
export const streamingOn = () => useApp.getState().settings?.settings.ai?.streaming !== false;
