import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkflowEntry, RunRecord } from "./types.js";

// ── Paths ───────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "lobster-copilot");
export const SOCKET_PATH = join(CONFIG_DIR, "daemon.sock");
export const PID_FILE = join(CONFIG_DIR, "daemon.pid");

// ── Request messages (TUI → Daemon) ─────────────────────────────────

export type DaemonRequest =
  | { cmd: "status" }
  | { cmd: "list-workflows" }
  | { cmd: "add-workflow"; workflow: WorkflowEntry }
  | { cmd: "remove-workflow"; id: string }
  | { cmd: "toggle-workflow"; id: string }
  | { cmd: "update-workflow"; id: string; patch: Partial<WorkflowEntry> }
  | { cmd: "run-now"; id: string }
  | { cmd: "get-history"; workflowId: string }
  | { cmd: "list-approvals" }
  | { cmd: "resolve-approval"; runId: string; approved: boolean }
  | { cmd: "delete-run"; runId: string }
  | { cmd: "clear-history"; workflowId: string }
  | { cmd: "stop-daemon" };

// ── Response messages (Daemon → TUI) ────────────────────────────────

export type DaemonResponse =
  | { type: "status"; running: boolean; pid: number; workflows: WorkflowEntry[] }
  | { type: "workflows"; workflows: WorkflowEntry[] }
  | { type: "history"; runs: RunRecord[] }
  | { type: "approvals"; runs: RunRecord[] }
  | { type: "ok"; message?: string }
  | { type: "error"; message: string }
  | { type: "event"; event: DaemonEvent };

// ── Push events (Daemon → connected TUI clients) ────────────────────

export type DaemonEvent =
  | { kind: "run-start"; run: RunRecord }
  | { kind: "run-complete"; run: RunRecord }
  | { kind: "run-output"; runId: string; text: string }
  | { kind: "approval-pending"; run: RunRecord }
  | { kind: "config-changed" };
