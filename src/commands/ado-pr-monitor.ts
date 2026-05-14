/**
 * `ado.pr.monitor` — Lobster command wrapping the ADO PR monitor recipe.
 *
 * Usage in .lobster workflows:
 *   ado.pr.monitor --org https://dev.azure.com/myorg --project MyProject --status active
 *   ado.pr.monitor --org ... --project ... --changes-only
 *   ado.pr.monitor --org ... --project ... --target-branch main --json
 */

import type { LobsterCommand } from "./copilot.js";
import {
  adoPrMonitor,
  type AdoPrMonitorOptions,
} from "../recipes/ado/pr-monitor.js";
import type { AdoPrListOptions } from "../recipes/ado/pr-list.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

export function createAdoPrMonitorCommand(): LobsterCommand {
  return {
    name: "ado.pr.monitor",
    meta: {
      description:
        "Monitor Azure DevOps PRs — fetch, diff against last run, report changes",
      argsSchema: {
        type: "object",
        properties: {
          org: { type: "string", description: "Azure DevOps org URL" },
          project: { type: "string", description: "Project name" },
          repository: { type: "string", description: "Repository name" },
          "source-branch": { type: "string" },
          "target-branch": { type: "string" },
          creator: { type: "string", description: "Filter by PR creator(s), comma-separated for multiple" },
          reviewer: { type: "string" },
          status: { type: "string", description: "active|completed|abandoned|all" },
          top: { type: "number" },
          days: { type: "number", description: "Only PRs created within the last N days" },
          "changes-only": { type: "boolean" },
          key: { type: "string" },
        },
        required: [],
      },
      sideEffects: ["network", "filesystem"],
    },
    help() {
      return [
        "ado.pr.monitor — Monitor Azure DevOps PRs and detect changes",
        "",
        "Usage:",
        `  ado.pr.monitor --org https://dev.azure.com/myorg --project MyProject`,
        `  ado.pr.monitor --org ... --project ... --status active --target-branch main`,
        `  ado.pr.monitor --org ... --project ... --creator "alice,bob"`,
        `  ado.pr.monitor --org ... --project ... --changes-only`,
        "",
        "Fetches PRs matching filters, compares against last-known state,",
        "and reports new, removed, and updated PRs.",
        "--creator accepts comma-separated values to filter by multiple creators.",
        "State is persisted via the Lobster SDK state store (~/.lobster/state/).",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      // Drain input
      for await (const _item of input) {
        // no-op
      }

      // Helper: skip null, empty, or unresolved ${...} template literals
      const val = (v: unknown): string | undefined => {
        if (v == null) return undefined;
        const s = String(v);
        if (!s || s === "null" || /^\$\{.+\}$/.test(s)) return undefined;
        return s;
      };

      const org = val(args.org) ?? "";
      const project = val(args.project) ?? "";

      const options: AdoPrMonitorOptions = { org, project };
      const repo = val(args.repository);
      if (repo) options.repository = repo;
      const srcBranch = val(args["source-branch"]);
      if (srcBranch) options.sourceBranch = srcBranch;
      const tgtBranch = val(args["target-branch"]);
      if (tgtBranch) options.targetBranch = tgtBranch;
      const creator = val(args.creator);
      if (creator) options.creator = creator.includes(",") ? creator.split(",").map((c: string) => c.trim()) : creator;
      const reviewer = val(args.reviewer);
      if (reviewer) options.reviewer = reviewer;
      const status = val(args.status);
      if (status) options.status = status as AdoPrListOptions["status"];
      const top = val(args.top);
      if (top) options.top = Number(top);
      const days = val(args.days);
      if (days && !isNaN(Number(days))) options.days = Number(days);
      if (args["changes-only"]) options.changesOnly = true;
      const key = val(args.key);
      if (key) options.key = key;

      const result = await adoPrMonitor(options, process.env as any);

      return { output: asStream(result.prs) };
    },
  };
}
