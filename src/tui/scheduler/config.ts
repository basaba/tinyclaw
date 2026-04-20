import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ScheduleConfig, RunHistory, RunRecord } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "lobster-copilot");
const SCHEDULES_FILE = join(CONFIG_DIR, "schedules.json");
const HISTORY_FILE = join(CONFIG_DIR, "history.json");
const MAX_RUNS_PER_WORKFLOW = 100;

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// ── Schedules ───────────────────────────────────────────────────────

export function loadSchedules(): ScheduleConfig {
  try {
    const raw = readFileSync(SCHEDULES_FILE, "utf-8");
    return JSON.parse(raw) as ScheduleConfig;
  } catch {
    return { workflows: [] };
  }
}

export function saveSchedules(config: ScheduleConfig): void {
  ensureDir();
  writeFileSync(SCHEDULES_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ── Run History ─────────────────────────────────────────────────────

export function loadHistory(): RunHistory {
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as RunHistory;
  } catch {
    return { runs: [] };
  }
}

export function saveHistory(history: RunHistory): void {
  ensureDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

export function appendRun(run: RunRecord): void {
  const history = loadHistory();
  history.runs.push(run);

  // Cap per workflow
  const byWorkflow = new Map<string, RunRecord[]>();
  for (const r of history.runs) {
    const list = byWorkflow.get(r.workflowId) ?? [];
    list.push(r);
    byWorkflow.set(r.workflowId, list);
  }
  const capped: RunRecord[] = [];
  for (const [, list] of byWorkflow) {
    capped.push(...list.slice(-MAX_RUNS_PER_WORKFLOW));
  }
  history.runs = capped;
  saveHistory(history);
}

export function updateRun(runId: string, patch: Partial<RunRecord>): void {
  const history = loadHistory();
  const idx = history.runs.findIndex((r) => r.id === runId);
  if (idx >= 0) {
    history.runs[idx] = { ...history.runs[idx], ...patch };
    saveHistory(history);
  }
}

export function getRunsForWorkflow(workflowId: string): RunRecord[] {
  const history = loadHistory();
  return history.runs
    .filter((r) => r.workflowId === workflowId)
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
}
