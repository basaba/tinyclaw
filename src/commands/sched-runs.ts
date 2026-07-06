/**
 * `sched.runs` — Emit recent scheduler run records as a stream, for observability
 * workflows (e.g. piping failures into `github.issue.upsert`).
 *
 * Runs in-process inside the daemon, reading the same history.json the scheduler
 * writes, so no shell-out or daemon socket round-trip is required.
 *
 * Usage in .lobster workflows:
 *   sched.runs --status error --since 2h
 *   sched.runs --status error,rejected --workflow wf-abc123 --limit 20
 *   sched.runs --status all --since 1d
 */

import type { LobsterCommand } from "./copilot.js";
import { loadHistory } from "../tui/scheduler/config.js";
import { loadSchedules } from "../tui/scheduler/config.js";
import type { RunRecord } from "../tui/scheduler/types.js";

/** A run record enriched with its owning workflow's display metadata. */
export interface EnrichedRun extends RunRecord {
  workflowName: string;
  workflowFile: string;
}

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

const SINCE_RE = /^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i;

/** Parse a relative duration like "2h", "30m", "1d" into milliseconds. */
export function parseSinceMs(expr: string): number | null {
  const m = SINCE_RE.exec(expr.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("d")) return n * 86_400_000;
  if (unit.startsWith("h")) return n * 3_600_000;
  if (unit.startsWith("m")) return n * 60_000;
  return n * 1000;
}

/** Skip null, empty, or unresolved ${...} template literals. */
function val(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  if (!s || s === "null" || /^\$\{.+\}$/.test(s)) return undefined;
  return s;
}

export function createSchedRunsCommand(): LobsterCommand {
  return {
    name: "sched.runs",
    meta: {
      description:
        "Emit recent scheduler run records (for observability), filtered by status/workflow/time",
      argsSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "Comma-separated statuses to include (error,rejected,success,running,pending-approval) or 'all'. Default: error,rejected",
          },
          workflow: { type: "string", description: "Filter to a single workflow id" },
          since: { type: "string", description: "Only runs newer than this (e.g. 2h, 30m, 1d)" },
          limit: { type: "number", description: "Max records to emit (default 50)" },
          latest: {
            type: "boolean",
            description:
              "Emit only the most recent run per workflow (current state). Ignores --status filtering so a workflow's latest success/failure is reported as-is.",
          },
        },
        required: [],
      },
      sideEffects: ["filesystem"],
    },
    help() {
      return [
        "sched.runs — emit recent scheduler run records as a stream",
        "",
        "Usage:",
        "  sched.runs --status error --since 2h",
        "  sched.runs --status error,rejected --workflow wf-abc123 --limit 20",
        "  sched.runs --since 2h --latest    # current state per workflow",
        "  sched.runs --status all --since 1d",
        "",
        "Each emitted item is a run record enriched with workflowName and",
        "workflowFile. Intended to be piped into github.issue.upsert.",
        "Default status filter is 'error,rejected' (failures only).",
        "With --latest, only each workflow's most recent run is emitted",
        "(status filter is bypassed) — ideal for open-or-close observability.",
      ].join("\n");
    },
    async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, unknown> }) {
      // Drain any upstream input — this command is a source.
      for await (const _item of input) {
        // no-op
      }

      const statusArg = val(args.status);
      const latest = args.latest === true || val(args.latest) === "true";
      const statuses =
        !statusArg || statusArg.toLowerCase() === "all"
          ? null
          : new Set(statusArg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      // In --latest mode we report each workflow's current state, so status
      // filtering is bypassed (a latest success must be visible to close issues).
      const effectiveStatuses = latest
        ? null
        : statuses ?? (statusArg ? null : new Set(["error", "rejected"]));

      const workflowId = val(args.workflow);

      let sinceMs: number | null = null;
      const sinceArg = val(args.since);
      if (sinceArg) {
        const ms = parseSinceMs(sinceArg);
        if (ms != null) sinceMs = Date.now() - ms;
      }

      const limitArg = val(args.limit);
      const limit = limitArg && !isNaN(Number(limitArg)) ? Number(limitArg) : 50;

      const workflows = loadSchedules().workflows;
      const wfById = new Map(workflows.map((w) => [w.id, w]));

      let runs = loadHistory()
        .runs.filter((r) => {
          if (workflowId && r.workflowId !== workflowId) return false;
          if (effectiveStatuses && !effectiveStatuses.has(r.status)) return false;
          if (sinceMs != null && new Date(r.triggeredAt).getTime() < sinceMs) return false;
          return true;
        })
        .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));

      // Keep only the most recent run per workflow (current state).
      if (latest) {
        const seen = new Set<string>();
        runs = runs.filter((r) => {
          if (seen.has(r.workflowId)) return false;
          seen.add(r.workflowId);
          return true;
        });
      }

      runs = runs.slice(0, limit);

      const enriched: EnrichedRun[] = runs.map((r) => {
        const wf = wfById.get(r.workflowId);
        return {
          ...r,
          workflowName: wf?.name ?? r.workflowId,
          workflowFile: wf?.filePath ?? r.input.filePath,
        };
      });

      return { output: asStream(enriched) };
    },
  };
}
