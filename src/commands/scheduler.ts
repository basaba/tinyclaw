/**
 * CLI handler for scheduler commands.
 * Connects to the running daemon and executes operations.
 *
 * Usage: lobster-copilot sched <subcommand> [options]
 */
import { readFileSync } from "node:fs";
import { DaemonClient } from "../tui/scheduler/daemon-client.js";
import type { WorkflowEntry, RunRecord } from "../tui/scheduler/types.js";

// ── Helpers ─────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/** Parse JSON with fallback for unquoted keys/values (PowerShell quote-stripping). */
function parseJsonRelaxed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const relaxed = text
      .replace(/([{,])\s*([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      .replace(/:\s*([^",{}\[\]\s][^,}]*?)\s*(?=[,}])/g, (_, v) => `:"${v.trim()}"`);
    return JSON.parse(relaxed);
  }
}

function needArg(args: string[], idx: number, flag: string): string {
  const val = args[idx];
  if (!val || val.startsWith("-")) die(`${flag} requires a value`);
  return val;
}

async function withClient<T>(fn: (client: DaemonClient) => Promise<T>): Promise<T> {
  if (!DaemonClient.isDaemonRunning()) {
    die("Daemon is not running. Start it with: lobster-copilot daemon start");
  }
  const client = new DaemonClient();
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

function out(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── Formatters ──────────────────────────────────────────────────────

function fmtWorkflowTable(workflows: WorkflowEntry[]): void {
  if (workflows.length === 0) {
    console.log("No workflows configured.");
    return;
  }
  const header = ["ID", "Name", "File", "Schedule", "Enabled"];
  const rows = workflows.map((w) => [
    w.id,
    w.name,
    w.filePath,
    w.schedule,
    w.enabled ? "✅" : "⏸️",
  ]);
  printTable(header, rows);
}

function fmtRunTable(runs: RunRecord[]): void {
  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }
  const header = ["ID", "Status", "Triggered", "Duration", "Trigger"];
  const rows = runs.map((r) => [
    r.id.slice(0, 8),
    fmtStatus(r.status),
    new Date(r.triggeredAt).toLocaleString(),
    r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—",
    r.triggeredBy,
  ]);
  printTable(header, rows);
}

function fmtRunDetail(run: RunRecord): void {
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${fmtStatus(run.status)}`);
  console.log(`Workflow: ${run.workflowId}`);
  console.log(`Trigger: ${run.triggeredBy}`);
  console.log(`Started: ${new Date(run.triggeredAt).toLocaleString()}`);
  if (run.completedAt) console.log(`Completed: ${new Date(run.completedAt).toLocaleString()}`);
  if (run.durationMs != null) console.log(`Duration: ${(run.durationMs / 1000).toFixed(1)}s`);
  console.log(`File: ${run.input.filePath}`);
  if (run.input.args) console.log(`Args: ${JSON.stringify(run.input.args)}`);
  if (run.error) console.log(`\nError:\n${run.error}`);
  if (run.logs) console.log(`\n── Logs ──\n${run.logs}`);
  if (run.output) console.log(`\n── Output ──\n${run.output}`);
  if (run.approvalInfo) {
    console.log(`\n── Approval ──`);
    console.log(`Prompt: ${run.approvalInfo.prompt}`);
    if (run.approvalInfo.preview) console.log(`Preview: ${run.approvalInfo.preview}`);
    console.log(`Items: ${JSON.stringify(run.approvalInfo.items, null, 2)}`);
  }
}

function fmtStatus(status: RunRecord["status"]): string {
  const map: Record<string, string> = {
    running: "🔄 running",
    success: "✅ success",
    error: "❌ error",
    "pending-approval": "⏳ pending-approval",
    rejected: "🚫 rejected",
  };
  return map[status] ?? status;
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const sep = widths.map((w) => "─".repeat(w)).join("──");
  const fmtRow = (r: string[]) =>
    r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  console.log(fmtRow(header));
  console.log(sep);
  rows.forEach((r) => console.log(fmtRow(r)));
}

// ── Subcommand dispatch ─────────────────────────────────────────────

export async function handleScheduler(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const jsonFlag = rest.includes("--json");
  const cleanArgs = rest.filter((a) => a !== "--json");

  switch (sub) {
    case "list":
      return cmdList(jsonFlag);
    case "add":
      return cmdAdd(cleanArgs, jsonFlag);
    case "edit":
      return cmdEdit(cleanArgs, jsonFlag);
    case "remove":
      return cmdRemove(cleanArgs);
    case "toggle":
      return cmdToggle(cleanArgs);
    case "run":
      return cmdRun(cleanArgs);
    case "history":
      return cmdHistory(cleanArgs, jsonFlag);
    case "run-detail":
      return cmdRunDetail(cleanArgs, jsonFlag);
    case "delete-run":
      return cmdDeleteRun(cleanArgs);
    case "clear-history":
      return cmdClearHistory(cleanArgs);
    case "approvals":
      return cmdApprovals(jsonFlag);
    case "approve":
      return cmdResolve(cleanArgs, true);
    case "reject":
      return cmdResolve(cleanArgs, false);
    case "status":
      return cmdStatus(jsonFlag);
    case "cat":
      return cmdCat(cleanArgs);
    case "help":
    case "--help":
    case "-h":
      return printSchedHelp();
    default:
      if (!sub) {
        printSchedHelp();
      } else {
        die(`Unknown sched command: ${sub}\nRun 'lobster-copilot sched help' for usage.`);
      }
  }
}

// ── Commands ────────────────────────────────────────────────────────

async function cmdList(json: boolean): Promise<void> {
  const workflows = await withClient((c) => c.getWorkflows());
  if (json) return out(workflows, true);
  fmtWorkflowTable(workflows);
}

async function cmdAdd(args: string[], json: boolean): Promise<void> {
  let name: string | undefined;
  let filePath: string | undefined;
  let schedule: string | undefined;
  let wfArgs: Record<string, unknown> | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") name = needArg(args, ++i, "--name");
    else if (a === "--file") filePath = needArg(args, ++i, "--file");
    else if (a === "--schedule") schedule = needArg(args, ++i, "--schedule");
    else if (a === "--args-json") {
      const raw = needArg(args, ++i, "--args-json");
      try { wfArgs = parseJsonRelaxed(raw) as Record<string, unknown>; }
      catch { die(`--args-json must be valid JSON, got: ${raw}`); }
    }
  }

  if (!name) die("--name is required");
  if (!filePath) die("--file is required");
  if (!schedule) die("--schedule is required");

  const id = `wf-${Date.now().toString(36)}`;
  const entry: WorkflowEntry = { id, name, filePath, schedule, enabled: true, ...(wfArgs ? { args: wfArgs } : {}) };

  await withClient((c) => c.addWorkflow(entry));
  if (json) return out(entry, true);
  console.log(`✅ Workflow added: ${id} (${name})`);
}

async function cmdEdit(args: string[], json: boolean): Promise<void> {
  const id = args[0];
  if (!id || id.startsWith("-")) die("Usage: sched edit <id> [--name ..] [--file ..] [--schedule ..] [--args-json ..]");

  const patch: Partial<WorkflowEntry> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") patch.name = needArg(args, ++i, "--name");
    else if (a === "--file") patch.filePath = needArg(args, ++i, "--file");
    else if (a === "--schedule") patch.schedule = needArg(args, ++i, "--schedule");
    else if (a === "--args-json") {
      const raw = needArg(args, ++i, "--args-json");
      try { patch.args = parseJsonRelaxed(raw) as Record<string, unknown>; }
      catch { die(`--args-json must be valid JSON, got: ${raw}`); }
    }
  }

  if (Object.keys(patch).length === 0) die("No changes specified");

  await withClient((c) => c.updateWorkflow(id, patch));
  if (json) return out({ id, ...patch }, true);
  console.log(`✅ Workflow ${id} updated`);
}

async function cmdRemove(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: sched remove <id>");
  await withClient((c) => c.removeWorkflow(id));
  console.log(`✅ Workflow ${id} removed`);
}

async function cmdToggle(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: sched toggle <id>");
  await withClient((c) => c.toggleWorkflow(id));
  console.log(`✅ Workflow ${id} toggled`);
}

async function cmdRun(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: sched run <id>");
  await withClient((c) => c.runNow(id));
  console.log(`🚀 Workflow ${id} triggered`);
}

async function cmdHistory(args: string[], json: boolean): Promise<void> {
  const workflowId = args[0];
  if (!workflowId) die("Usage: sched history <workflow-id>");
  const runs = await withClient((c) => c.getHistory(workflowId));
  if (json) return out(runs, true);
  fmtRunTable(runs);
}

async function cmdRunDetail(args: string[], json: boolean): Promise<void> {
  const runId = args[0];
  if (!runId) die("Usage: sched run-detail <run-id>");
  const run = await withClient((c) => c.getRun(runId));
  if (!run) die(`Run ${runId} not found`);
  if (json) return out(run, true);
  fmtRunDetail(run);
}

async function cmdDeleteRun(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) die("Usage: sched delete-run <run-id>");
  await withClient((c) => c.deleteRun(runId));
  console.log(`✅ Run ${runId} deleted`);
}

async function cmdClearHistory(args: string[]): Promise<void> {
  const workflowId = args[0];
  if (!workflowId) die("Usage: sched clear-history <workflow-id>");
  await withClient((c) => c.clearHistory(workflowId));
  console.log(`✅ History cleared for workflow ${workflowId}`);
}

async function cmdApprovals(json: boolean): Promise<void> {
  const runs = await withClient((c) => c.listApprovals());
  if (json) return out(runs, true);
  if (runs.length === 0) {
    console.log("No pending approvals.");
    return;
  }
  for (const r of runs) {
    console.log(`\nRun: ${r.id} (workflow: ${r.workflowId})`);
    if (r.approvalInfo) {
      console.log(`  Prompt: ${r.approvalInfo.prompt}`);
      if (r.approvalInfo.preview) console.log(`  Preview: ${r.approvalInfo.preview}`);
      console.log(`  Items: ${r.approvalInfo.items.length}`);
    }
  }
}

async function cmdResolve(args: string[], approved: boolean): Promise<void> {
  const runId = args[0];
  if (!runId) die(`Usage: sched ${approved ? "approve" : "reject"} <run-id>`);
  await withClient((c) => c.resolveApproval(runId, approved));
  console.log(approved ? `✅ Run ${runId} approved` : `🚫 Run ${runId} rejected`);
}

async function cmdStatus(json: boolean): Promise<void> {
  const status = await withClient((c) => c.getStatus());
  if (json) return out(status, true);
  console.log(`🦞 Daemon: running (pid ${status.pid})`);
  console.log(`   Workflows: ${status.workflows.length}`);
  const enabled = status.workflows.filter((w) => w.enabled).length;
  console.log(`   Enabled: ${enabled}, Paused: ${status.workflows.length - enabled}`);
}

async function cmdCat(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: sched cat <workflow-id>");
  const workflows = await withClient((c) => c.getWorkflows());
  const wf = workflows.find((w) => w.id === id);
  if (!wf) die(`Workflow ${id} not found`);
  try {
    const content = readFileSync(wf.filePath, "utf-8");
    console.log(content);
  } catch (err) {
    die(`Failed to read ${wf.filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Help ────────────────────────────────────────────────────────────

function printSchedHelp(): void {
  console.log(`lobster-copilot sched — Scheduler management CLI

Usage:
  lobster-copilot sched <command> [options]

Workflow Management:
  list                         List all scheduled workflows
  add --name <n> --file <f> --schedule <s> [--args-json <j>]
                               Add a new workflow
  edit <id> [--name ..] [--file ..] [--schedule ..] [--args-json ..]
                               Update a workflow
  remove <id>                  Remove a workflow
  toggle <id>                  Enable/disable a workflow
  cat <id>                     Print the workflow file contents

Execution:
  run <id>                     Trigger a workflow run immediately
  status                       Show daemon status and workflow summary

History:
  history <workflow-id>        Show run history for a workflow
  run-detail <run-id>          Show full detail for a run
  delete-run <run-id>          Delete a run record
  clear-history <workflow-id>  Clear all history for a workflow

Approvals:
  approvals                    List pending approvals
  approve <run-id>             Approve a pending run
  reject <run-id>              Reject a pending run

Global Options:
  --json                       Output raw JSON instead of formatted text

Examples:
  lobster-copilot sched list
  lobster-copilot sched add --name "Daily report" --file ./report.lobster --schedule "every 24h"
  lobster-copilot sched run wf-abc123
  lobster-copilot sched history wf-abc123 --json
  lobster-copilot sched approve run-xyz789
`);
}
