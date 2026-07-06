/**
 * `github.issue.upsert` — Surface tinyclaw scheduled-run observability over
 * GitHub issues. Maintains ONE deduplicated issue per workflow:
 *
 *   - failure + no open issue   → create issue
 *   - failure + open issue      → add a failure comment (no spam)
 *   - failure + closed issue    → reopen + comment
 *   - success + open issue      → comment "recovered" + close
 *
 * Deduplication is anchored by a hidden marker embedded in the issue body:
 *   <!-- tinyclaw:key=<workflow-id> -->
 *
 * Talks to GitHub via the `gh` CLI (already authenticated). Consumes run
 * records piped from `sched.runs`, or a single run described via flags.
 *
 * Usage in .lobster workflows:
 *   sched.runs --status error --since 2h | github.issue.upsert --repo owner/repo
 *   github.issue.upsert --repo owner/repo --workflow wf-abc --status error --title "..."
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LobsterCommand } from "./copilot.js";

const execFileAsync = promisify(execFile);

const GH_BIN = process.platform === "win32" ? "gh.exe" : "gh";
const DEFAULT_LABEL = "tinyclaw-run";
const DEFAULT_LOG_TAIL = 30;

/** Result emitted downstream for each processed run. */
export interface IssueUpsertResult {
  workflow: string;
  status: string;
  action: "created" | "updated" | "commented" | "reopened" | "closed" | "noop";
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** Skip null, empty, or unresolved ${...} template literals. */
function val(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  if (!s || s === "null" || /^\$\{.+\}$/.test(s)) return undefined;
  return s;
}

/** Normalized view of a run, from either a piped object or explicit flags. */
interface RunLike {
  key: string;
  workflowName: string;
  status: string;
  runId?: string;
  error?: string;
  logs?: string;
  triggeredAt?: string;
  durationMs?: number;
}

function coerceRecord(item: unknown): Record<string, unknown> | null {
  if (item && typeof item === "object") return item as Record<string, unknown>;
  if (typeof item === "string") {
    const t = item.trim();
    if (t.startsWith("{")) {
      try {
        return JSON.parse(t) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function marker(key: string): string {
  return `<!-- tinyclaw:key=${key} -->`;
}

function tail(text: string | undefined, n: number): string {
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.slice(-n).join("\n");
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GH_BIN, args, {
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.toString();
}

interface FoundIssue {
  number: number;
  state: string;
  url: string;
  body: string;
}

/** Ensure each label exists in the repo (idempotent upsert), ignoring failures. */
async function ensureLabels(repo: string, labels: string[]): Promise<void> {
  for (const label of labels) {
    try {
      await gh(["label", "create", label, "--repo", repo, "--force"]);
    } catch {
      // Label may already exist or we lack permission — issue create still
      // succeeds as long as the label exists; ignore and continue.
    }
  }
}

/** Find an existing tinyclaw issue for this key via its body marker. */
async function findIssue(repo: string, label: string, key: string): Promise<FoundIssue | null> {
  const raw = await gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--label",
    label,
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number,state,body,url",
  ]);
  let items: Array<{ number: number; state: string; body: string; url: string }> = [];
  try {
    items = JSON.parse(raw);
  } catch {
    return null;
  }
  const mark = marker(key);
  const match = items.find((i) => (i.body ?? "").includes(mark));
  if (!match) return null;
  return {
    number: match.number,
    state: (match.state ?? "").toLowerCase(),
    url: match.url,
    body: match.body ?? "",
  };
}

function buildBody(run: RunLike, key: string, logTail: number): string {
  const parts = [
    marker(key),
    "",
    `**Workflow:** ${run.workflowName}`,
    `**Status:** ${run.status}`,
  ];
  if (run.runId) parts.push(`**Run:** \`${run.runId}\``);
  if (run.triggeredAt) parts.push(`**Triggered:** ${run.triggeredAt}`);
  if (run.durationMs != null)
    parts.push(`**Duration:** ${(run.durationMs / 1000).toFixed(1)}s`);
  parts.push("");
  if (run.error) {
    parts.push("**Error:**", "```", run.error.trim(), "```", "");
  }
  const logs = tail(run.logs, logTail);
  if (logs) {
    parts.push(`**Log tail (last ${logTail} lines):**`, "```", logs, "```", "");
  }
  if (run.runId) {
    parts.push(`Inspect locally: \`tinyclaw sched run-detail ${run.runId}\``);
  }
  return parts.join("\n");
}

function failureComment(run: RunLike, logTail: number): string {
  const parts = [`❌ **New failure** — status \`${run.status}\``];
  if (run.runId) parts.push(`Run \`${run.runId}\``);
  if (run.triggeredAt) parts.push(`at ${run.triggeredAt}`);
  let body = parts.join(" ") + "\n";
  if (run.error) body += `\n\`\`\`\n${run.error.trim()}\n\`\`\`\n`;
  const logs = tail(run.logs, logTail);
  if (logs) body += `\n<details><summary>Log tail</summary>\n\n\`\`\`\n${logs}\n\`\`\`\n</details>\n`;
  return body;
}

// ── Status mode (one persistent issue per workflow) ─────────────────

function statusMarker(status: string): string {
  return `<!-- tinyclaw:status=${status} -->`;
}

/** Read the status embedded in an existing status-issue body, if any. */
function extractStatus(body: string): string | undefined {
  const m = body.match(/tinyclaw:status=([\w-]+)/);
  return m ? m[1] : undefined;
}

function isHealthy(status: string): boolean {
  return status !== "error" && status !== "rejected";
}

function statusTitle(run: RunLike): string {
  const emoji = isHealthy(run.status) ? "✅" : "❌";
  const label = isHealthy(run.status) ? "healthy" : "failing";
  return `[tinyclaw] ${run.workflowName} — ${emoji} ${label}`;
}

function buildStatusBody(run: RunLike, key: string, logTail: number): string {
  const healthy = isHealthy(run.status);
  const parts = [
    marker(key),
    statusMarker(run.status),
    "",
    `## ${healthy ? "✅" : "❌"} ${run.workflowName}`,
    "",
    `**Latest status:** ${run.status}`,
  ];
  if (run.runId) parts.push(`**Run:** \`${run.runId}\``);
  if (run.triggeredAt) parts.push(`**Last run:** ${run.triggeredAt}`);
  if (run.durationMs != null)
    parts.push(`**Duration:** ${(run.durationMs / 1000).toFixed(1)}s`);
  parts.push("", `_Updated by tinyclaw observability at ${new Date().toISOString()}._`, "");
  if (!healthy && run.error) {
    parts.push("**Error:**", "```", run.error.trim(), "```", "");
  }
  if (!healthy) {
    const logs = tail(run.logs, logTail);
    if (logs) parts.push(`**Log tail (last ${logTail} lines):**`, "```", logs, "```", "");
  }
  if (run.runId) {
    parts.push(`Inspect locally: \`tinyclaw sched run-detail ${run.runId}\``);
  }
  return parts.join("\n");
}

function transitionComment(prev: string | undefined, run: RunLike): string {
  const healthy = isHealthy(run.status);
  const arrow = prev ? `\`${prev}\` → \`${run.status}\`` : `\`${run.status}\``;
  const head = healthy
    ? `✅ **Recovered** — ${arrow}`
    : `❌ **Failing** — ${arrow}`;
  const bits = [head];
  if (run.runId) bits.push(`run \`${run.runId}\``);
  if (run.triggeredAt) bits.push(`at ${run.triggeredAt}`);
  let body = bits.join(" ") + "\n";
  if (!healthy && run.error) body += `\n\`\`\`\n${run.error.trim()}\n\`\`\`\n`;
  return body;
}

/**
 * Status mode: maintain exactly one persistent issue per workflow, updated in
 * place to reflect the latest run (success or failure). Never auto-closes;
 * posts a comment only when the status transitions.
 */
async function processStatus(
  run: RunLike,
  opts: { repo: string; labels: string[]; logTail: number },
): Promise<IssueUpsertResult> {
  const { repo, labels, logTail } = opts;
  const primaryLabel = labels[0] ?? DEFAULT_LABEL;
  const existing = await findIssue(repo, primaryLabel, run.key);
  const title = statusTitle(run);
  const body = buildStatusBody(run, run.key, logTail);

  if (!existing) {
    await ensureLabels(repo, labels);
    const createArgs = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
    for (const l of labels) createArgs.push("--label", l);
    const out = (await gh(createArgs)).trim();
    const url = out.split("\n").find((l) => l.startsWith("http"))?.trim() ?? out;
    const numMatch = url.match(/\/(\d+)(?:$|\/)/);
    return {
      workflow: run.key,
      status: run.status,
      action: "created",
      issueUrl: url,
      ...(numMatch ? { issueNumber: Number(numMatch[1]) } : {}),
    };
  }

  // Keep the status issue open so it always reflects current state.
  if (existing.state !== "open") {
    await gh(["issue", "reopen", String(existing.number), "--repo", repo]);
  }

  // Comment only on an actual status transition, to avoid per-run noise.
  const prevStatus = extractStatus(existing.body);
  if (prevStatus !== run.status) {
    await gh([
      "issue",
      "comment",
      String(existing.number),
      "--repo",
      repo,
      "--body",
      transitionComment(prevStatus, run),
    ]);
  }

  await gh([
    "issue",
    "edit",
    String(existing.number),
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body,
  ]);
  return {
    workflow: run.key,
    status: run.status,
    action: "updated",
    issueNumber: existing.number,
    issueUrl: existing.url,
  };
}

async function processRun(
  run: RunLike,
  opts: {
    repo: string;
    labels: string[];
    closeStatuses: Set<string>;
    logTail: number;
    mode: "alert" | "status";
    titleOverride?: string;
    bodyOverride?: string;
  },
): Promise<IssueUpsertResult> {
  if (opts.mode === "status") {
    return processStatus(run, opts);
  }
  const { repo, labels, closeStatuses, logTail } = opts;
  const primaryLabel = labels[0] ?? DEFAULT_LABEL;
  const isFailure = run.status === "error" || run.status === "rejected";
  const isRecovery = closeStatuses.has(run.status);

  if (!isFailure && !isRecovery) {
    return { workflow: run.key, status: run.status, action: "noop" };
  }

  const existing = await findIssue(repo, primaryLabel, run.key);

  // Recovery: close any open issue with a note.
  if (isRecovery) {
    if (existing && existing.state === "open") {
      const note = `✅ **Recovered** — workflow \`${run.workflowName}\` succeeded${
        run.runId ? ` (run \`${run.runId}\`)` : ""
      }. Auto-closing.`;
      await gh(["issue", "close", String(existing.number), "--repo", repo, "--comment", note]);
      return {
        workflow: run.key,
        status: run.status,
        action: "closed",
        issueNumber: existing.number,
        issueUrl: existing.url,
      };
    }
    return { workflow: run.key, status: run.status, action: "noop", issueNumber: existing?.number };
  }

  // Failure path.
  if (!existing) {
    await ensureLabels(repo, labels);
    const title = opts.titleOverride ?? `[tinyclaw] ${run.workflowName} is failing`;
    const body = opts.bodyOverride
      ? `${marker(run.key)}\n\n${opts.bodyOverride}`
      : buildBody(run, run.key, logTail);
    const createArgs = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
    for (const l of labels) createArgs.push("--label", l);
    const out = (await gh(createArgs)).trim();
    const url = out.split("\n").find((l) => l.startsWith("http"))?.trim() ?? out;
    const numMatch = url.match(/\/(\d+)(?:$|\/)/);
    return {
      workflow: run.key,
      status: run.status,
      action: "created",
      issueUrl: url,
      ...(numMatch ? { issueNumber: Number(numMatch[1]) } : {}),
    };
  }

  // Existing issue: reopen if closed, then comment the new failure.
  let action: IssueUpsertResult["action"] = "commented";
  if (existing.state !== "open") {
    await gh(["issue", "reopen", String(existing.number), "--repo", repo]);
    action = "reopened";
  }
  await gh([
    "issue",
    "comment",
    String(existing.number),
    "--repo",
    repo,
    "--body",
    failureComment(run, logTail),
  ]);
  return {
    workflow: run.key,
    status: run.status,
    action,
    issueNumber: existing.number,
    issueUrl: existing.url,
  };
}

export function createGithubIssueUpsertCommand(): LobsterCommand {
  return {
    name: "github.issue.upsert",
    meta: {
      description:
        "Create/update a deduplicated GitHub issue per workflow for run observability (via gh CLI)",
      argsSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Target repo as owner/name (required)" },
          workflow: { type: "string", description: "Workflow id/name — dedup key (when not piping records)" },
          "run-id": { type: "string", description: "Run id for the single-run form" },
          status: { type: "string", description: "Run status for the single-run form" },
          error: { type: "string", description: "Error text for the single-run form" },
          title: { type: "string", description: "Override issue title" },
          body: { type: "string", description: "Override issue body" },
          labels: { type: "string", description: `Comma-separated labels (default: ${DEFAULT_LABEL})` },
          "close-on": { type: "string", description: "Statuses that auto-close the issue (default: success)" },
          key: { type: "string", description: "Explicit dedup key override" },
          "log-tail": { type: "number", description: `Log lines to include (default: ${DEFAULT_LOG_TAIL})` },
          mode: {
            type: "string",
            description:
              "'alert' (default): open on failure, close on recovery. 'status': one persistent issue per workflow, updated in place with latest success/failure.",
          },
        },
        required: ["repo"],
      },
      sideEffects: ["network", "process"],
    },
    help() {
      return [
        "github.issue.upsert — deduplicated GitHub issues for run observability",
        "",
        "Usage:",
        "  sched.runs --status error --since 2h | github.issue.upsert --repo owner/repo",
        "  github.issue.upsert --repo owner/repo --workflow wf-abc --status error --error '...'",
        "",
        "Maintains one issue per workflow (keyed by a hidden body marker).",
        "",
        "Modes:",
        "  --mode alert  (default): failure→create; repeat→comment;",
        "                closed+failure→reopen; success→comment+close.",
        "  --mode status: one persistent issue per workflow, updated in place",
        "                with the latest success/failure; never auto-closed;",
        "                comments only on status transitions.",
        "",
        "Requires the `gh` CLI to be installed and authenticated.",
        "Consumes run records piped from sched.runs, or a single run via flags.",
      ].join("\n");
    },
    async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, unknown> }) {
      const repo = val(args.repo);
      if (!repo) throw new Error("github.issue.upsert: --repo owner/name is required");

      const labels = (val(args.labels) ?? DEFAULT_LABEL)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (labels.length === 0) labels.push(DEFAULT_LABEL);

      const closeStatuses = new Set(
        (val(args["close-on"]) ?? "success").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      );

      const logTailArg = val(args["log-tail"]);
      const logTail = logTailArg && !isNaN(Number(logTailArg)) ? Number(logTailArg) : DEFAULT_LOG_TAIL;

      const titleOverride = val(args.title);
      const bodyOverride = val(args.body);
      const keyOverride = val(args.key);
      const mode = val(args.mode) === "status" ? "status" : "alert";

      const toRunLike = (rec: Record<string, unknown>): RunLike | null => {
        const key =
          keyOverride ??
          (rec.workflowId != null ? String(rec.workflowId) : undefined) ??
          val(rec.workflow) ??
          val(args.workflow);
        if (!key) return null;
        return {
          key,
          workflowName:
            val(rec.workflowName) ?? val(rec.workflow) ?? val(args.workflow) ?? key,
          status: val(rec.status) ?? "error",
          runId: val(rec.id) ?? val(rec.runId),
          error: val(rec.error),
          logs: val(rec.logs),
          triggeredAt: val(rec.triggeredAt),
          durationMs:
            typeof rec.durationMs === "number" ? (rec.durationMs as number) : undefined,
        };
      };

      const results: IssueUpsertResult[] = [];
      const opts = { repo, labels, closeStatuses, logTail, mode, titleOverride, bodyOverride } as const;

      // Collect all piped records, then keep only the newest run per workflow
      // key. This makes a single invocation produce at most one action per
      // workflow — avoiding comment spam when a window contains many failures,
      // and sidestepping the create-then-list race where GitHub hasn't yet
      // indexed a just-created issue for the next same-key record in the batch.
      const collected: RunLike[] = [];
      for await (const item of input) {
        const rec = coerceRecord(item);
        if (!rec) continue;
        const run = toRunLike(rec);
        if (run) collected.push(run);
      }

      const newestByKey = new Map<string, RunLike>();
      for (const run of collected) {
        const prev = newestByKey.get(run.key);
        if (!prev || (run.triggeredAt ?? "") > (prev.triggeredAt ?? "")) {
          newestByKey.set(run.key, run);
        }
      }

      const toProcess =
        newestByKey.size > 0
          ? [...newestByKey.values()]
          : // Single-run form driven purely by flags (nothing piped in).
            (() => {
              const run = toRunLike({
                workflow: val(args.workflow),
                status: val(args.status),
                runId: val(args["run-id"]),
                error: val(args.error),
              });
              return run ? [run] : [];
            })();

      for (const run of toProcess) {
        try {
          results.push(await processRun(run, opts));
        } catch (err) {
          results.push({
            workflow: run.key,
            status: run.status,
            action: "noop",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { output: asStream(results) };
    },
  };
}
