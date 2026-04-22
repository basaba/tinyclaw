/**
 * Azure DevOps PR Monitor Recipe
 *
 * Fetches PRs matching search criteria, diffs against the last-known
 * snapshot, and reports what changed (new, removed, updated PRs).
 *
 * State is persisted to a JSON file so the monitor can detect changes
 * across scheduler runs without needing the Lobster SDK diffLast
 * primitive.
 *
 * @example
 *   import { adoPrMonitor } from "../recipes/ado/index.js";
 *
 *   const result = await adoPrMonitor({
 *     org: "https://dev.azure.com/myorg",
 *     project: "MyProject",
 *     status: "active",
 *   });
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fetchAdoPrs, type AdoPrListOptions } from "./pr-list.js";

// ── State persistence ───────────────────────────────────────────────

const STATE_DIR = path.join(os.homedir(), ".lobster-copilot", "state");

function stateFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(STATE_DIR, `ado-pr-${safe}.json`);
}

function loadState(key: string): Record<number, any> | null {
  const fp = stateFile(key);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function saveState(key: string, snapshot: Record<number, any>): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(key), JSON.stringify(snapshot, null, 2));
}

// ── PR normalization ────────────────────────────────────────────────

function pickPrSubset(pr: any) {
  if (!pr || typeof pr !== "object") return null;
  return {
    pullRequestId: pr.pullRequestId,
    title: pr.title,
    url: pr.url,
    status: pr.status,
    isDraft: pr.isDraft,
    mergeStatus: pr.mergeStatus,
    sourceRefName: pr.sourceRefName,
    targetRefName: pr.targetRefName,
    createdBy:
      pr.createdBy?.displayName ?? pr.createdBy?.uniqueName ?? null,
    reviewers: (pr.reviewers ?? []).map((r: any) => ({
      name: r.displayName ?? r.uniqueName,
      vote: r.vote,
    })),
    creationDate: pr.creationDate,
    closedDate: pr.closedDate,
  };
}

function normalizeSnapshot(prs: any[]): Record<number, any> {
  const map: Record<number, any> = {};
  for (const pr of prs) {
    const subset = pickPrSubset(pr);
    if (subset) map[subset.pullRequestId] = subset;
  }
  return map;
}

// ── Diff logic ──────────────────────────────────────────────────────

export interface PrChangeSummary {
  added: any[];
  removed: any[];
  modified: { pr: any; changes: Record<string, { from: any; to: any }> }[];
}

function buildChangeSummary(
  before: Record<number, any> | null,
  after: Record<number, any>,
): PrChangeSummary {
  const added: any[] = [];
  const removed: any[] = [];
  const modified: PrChangeSummary["modified"] = [];

  const beforeKeys = before ? Object.keys(before).map(Number) : [];
  const afterKeys = Object.keys(after).map(Number);

  for (const id of afterKeys) {
    if (!before || !(id in before)) {
      added.push(after[id]);
    } else if (JSON.stringify(after[id]) !== JSON.stringify(before[id])) {
      const changes: Record<string, { from: any; to: any }> = {};
      for (const key of Object.keys(after[id])) {
        if (JSON.stringify(after[id][key]) !== JSON.stringify(before[id][key])) {
          changes[key] = { from: before[id][key], to: after[id][key] };
        }
      }
      modified.push({ pr: after[id], changes });
    }
  }

  for (const id of beforeKeys) {
    if (!(id in after)) {
      removed.push(before![id]);
    }
  }

  return { added, removed, modified };
}

function formatChangeMessage(
  project: string,
  summary: PrChangeSummary,
  totalPrs: number,
): string {
  const parts: string[] = [`PRs in ${project} (${totalPrs} total)`];

  if (summary.added.length) {
    parts.push(
      `+${summary.added.length} new: ${summary.added.map((p) => `#${p.pullRequestId} ${p.title}`).join(", ")}`,
    );
  }
  if (summary.removed.length) {
    parts.push(
      `-${summary.removed.length} closed: ${summary.removed.map((p) => `#${p.pullRequestId}`).join(", ")}`,
    );
  }
  if (summary.modified.length) {
    parts.push(
      `~${summary.modified.length} updated: ${summary.modified.map((m) => `#${m.pr.pullRequestId} (${Object.keys(m.changes).join(", ")})`).join(", ")}`,
    );
  }

  return parts.join(" | ");
}

// ── State key ───────────────────────────────────────────────────────

function buildKey(options: AdoPrMonitorOptions): string {
  if (options.key) return options.key;
  const parts = [`${options.org}/${options.project}`];
  if (options.repository) parts.push(`repo=${options.repository}`);
  if (options.sourceBranch) parts.push(`src=${options.sourceBranch}`);
  if (options.targetBranch) parts.push(`tgt=${options.targetBranch}`);
  if (options.creator) parts.push(`creator=${options.creator}`);
  if (options.reviewer) parts.push(`reviewer=${options.reviewer}`);
  if (options.status) parts.push(`status=${options.status}`);
  return parts.join(":");
}

// ── Public API ──────────────────────────────────────────────────────

export interface AdoPrMonitorOptions extends AdoPrListOptions {
  key?: string;
  changesOnly?: boolean;
  /** Only include PRs created within the last N days */
  days?: number;
}

export interface AdoPrMonitorResult {
  kind: "ado.pr.monitor";
  project: string;
  key: string;
  changed: boolean;
  totalPrs: number;
  summary: PrChangeSummary;
  message: string;
  snapshot: Record<number, any>;
  suppressed?: boolean;
}

/**
 * Fetch ADO PRs, diff against last known state, return change report.
 *
 * State is persisted to `~/.lobster-copilot/state/` so repeated runs
 * (e.g. via the scheduler) detect changes across invocations.
 */
export async function adoPrMonitor(
  options: AdoPrMonitorOptions,
  env?: Record<string, string | undefined>,
): Promise<AdoPrMonitorResult> {
  const key = buildKey(options);

  let prs = await fetchAdoPrs(options, env);

  // Client-side time window filter (az repos pr list has no date flag)
  if (options.days && options.days > 0) {
    const cutoff = Date.now() - options.days * 86_400_000;
    prs = prs.filter((pr) => {
      const created = Date.parse(pr.creationDate);
      return !isNaN(created) && created >= cutoff;
    });
  }

  const snapshot = normalizeSnapshot(prs);
  const before = loadState(key);

  const changed = before === null || JSON.stringify(before) !== JSON.stringify(snapshot);
  const summary = buildChangeSummary(before, snapshot);
  const totalPrs = Object.keys(snapshot).length;
  const message = changed
    ? formatChangeMessage(options.project, summary, totalPrs)
    : `No changes in ${options.project} (${totalPrs} PRs)`;

  // Persist new state
  saveState(key, snapshot);

  if (options.changesOnly && !changed) {
    return {
      kind: "ado.pr.monitor",
      project: options.project,
      key,
      changed: false,
      totalPrs,
      summary,
      message,
      snapshot,
      suppressed: true,
    };
  }

  return {
    kind: "ado.pr.monitor",
    project: options.project,
    key,
    changed,
    totalPrs,
    summary,
    message,
    snapshot,
  };
}
