/**
 * Azure DevOps PR Monitor Recipe
 *
 * Fetches PRs matching search criteria, diffs against the last-known
 * snapshot, and reports what changed (new, removed, updated PRs).
 *
 * Uses the Lobster SDK's built-in state management (`diffAndStore`)
 * for persistence and change detection across scheduler runs.
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

import { fetchAdoPrs, normalizeCreators, type AdoPrListOptions } from "./pr-list.js";
// @ts-ignore — lobster state export is JS-only, no .d.ts yet
import { diffAndStore } from "@basaba/lobster/state";

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
    lastMergeSourceCommit: pr.lastMergeSourceCommit?.commitId ?? null,
    lastMergeTargetCommit: pr.lastMergeTargetCommit?.commitId ?? null,
    lastMergeCommit: pr.lastMergeCommit?.commitId ?? null,
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
  const base = [options.org, options.project].filter(Boolean).join("/") || "default";
  const parts = [base];
  if (options.repository) parts.push(`repo=${options.repository}`);
  if (options.sourceBranch) parts.push(`src=${options.sourceBranch}`);
  if (options.targetBranch) parts.push(`tgt=${options.targetBranch}`);
  if (options.creator) {
    const creators = normalizeCreators(options.creator);
    parts.push(`creator=${creators.sort().join(",")}`);
  }
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
  prs: any[];
  summary: PrChangeSummary;
  message: string;
  snapshot: Record<number, any>;
  suppressed?: boolean;
}

/**
 * Fetch ADO PRs, diff against last known state, return change report.
 *
 * Uses the Lobster SDK's `diffAndStore` for state persistence
 * (defaults to `~/.lobster/state/`).
 */
export async function adoPrMonitor(
  options: AdoPrMonitorOptions,
  env?: Record<string, string | undefined>,
): Promise<AdoPrMonitorResult> {
  const key = `ado-pr-${buildKey(options)}`;

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

  // Use Lobster SDK state management for persistence & diff
  const { before, changed } = await diffAndStore({
    env: env ?? process.env,
    key,
    value: snapshot,
  });

  const summary = buildChangeSummary(before, snapshot);

  // Annotate each PR with its change status
  const addedIds = new Set(summary.added.map((p) => p.pullRequestId));
  const modifiedIds = new Set(summary.modified.map((m) => m.pr.pullRequestId));
  const annotatedPrs = Object.values(snapshot).map((pr) => ({
    ...pr,
    changed: addedIds.has(pr.pullRequestId) || modifiedIds.has(pr.pullRequestId),
  }));
  // Include removed PRs as well
  for (const pr of summary.removed) {
    annotatedPrs.push({ ...pr, changed: true });
  }

  const totalPrs = Object.keys(snapshot).length;
  const projectLabel = options.project || "default";
  const message = changed
    ? formatChangeMessage(projectLabel, summary, totalPrs)
    : `No changes in ${projectLabel} (${totalPrs} PRs)`;

  if (options.changesOnly && !changed) {
    return {
      kind: "ado.pr.monitor",
      project: options.project || "default",
      key,
      changed: false,
      totalPrs,
      prs: annotatedPrs,
      summary,
      message,
      snapshot,
      suppressed: true,
    };
  }

  return {
    kind: "ado.pr.monitor",
    project: options.project || "default",
    key,
    changed,
    totalPrs,
    prs: annotatedPrs,
    summary,
    message,
    snapshot,
  };
}
