/**
 * `kusto.query` — Run a KQL query against an Azure Data Explorer (Kusto) cluster.
 *
 * Usage in workflows:
 *   kusto.query --cluster https://help.kusto.windows.net --database Samples \
 *               --query "StormEvents | take 5"
 *
 *   echo "StormEvents | count" | kusto.query --cluster ... --database Samples
 *
 *   kusto.query ... | copilot --prompt "Summarize"
 *
 * Auth:
 *   Uses the local `az login` cached token (AzCli identity). Run `az login`
 *   first; the underlying SDK does not handle interactive sign-in itself.
 */

import {
  Client as KustoClient,
  KustoConnectionStringBuilder,
} from "azure-kusto-data";
import type { LobsterCommand } from "./copilot.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function collectInputAsText(
  input: AsyncIterable<unknown>,
): Promise<string> {
  const parts: string[] = [];
  for await (const item of input) {
    if (typeof item === "string") parts.push(item);
    else if (item != null) parts.push(JSON.stringify(item));
  }
  return parts.join("\n").trim();
}

function buildConnectionString(
  args: Record<string, unknown>,
): KustoConnectionStringBuilder {
  const cluster = String(args.cluster ?? "").trim();
  if (!cluster) throw new Error("kusto.query: --cluster is required");
  return KustoConnectionStringBuilder.withAzLoginIdentity(cluster);
}

/** Minimal interface for the bits of the Kusto client we use. */
export interface KustoQueryClient {
  execute(
    database: string,
    query: string,
  ): Promise<{
    primaryResults?: Array<{
      toJSON(): {
        columns?: Array<{ name?: string; ColumnName?: string }>;
        data?: unknown[];
      };
    }>;
  }>;
  close?(): Promise<void> | void;
}

export type KustoClientFactory = (
  args: Record<string, unknown>,
) => KustoQueryClient;

const defaultClientFactory: KustoClientFactory = (args) => {
  const kcsb = buildConnectionString(args);
  return new KustoClient(kcsb) as unknown as KustoQueryClient;
};

export function createKustoQueryCommand(
  clientFactory: KustoClientFactory = defaultClientFactory,
): LobsterCommand {
  return {
    name: "kusto.query",
    meta: {
      description:
        "Run a KQL query against an Azure Data Explorer (Kusto) cluster",
      argsSchema: {
        type: "object",
        properties: {
          cluster: {
            type: "string",
            description:
              "Cluster URI, e.g. https://<cluster>.<region>.kusto.windows.net",
          },
          database: { type: "string", description: "Kusto database name" },
          query: {
            type: "string",
            description: "KQL query (or pipe one in via stdin)",
          },
          format: {
            type: "string",
            enum: ["rows", "table"],
            description:
              "Output: 'rows' (default, one item per row) or 'table' ({columns, rows})",
          },
        },
        required: ["cluster", "database"],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "kusto.query — run a KQL query against an Azure Data Explorer cluster",
        "",
        "Usage:",
        "  kusto.query --cluster https://help.kusto.windows.net \\",
        "              --database Samples \\",
        '              --query "StormEvents | take 5"',
        "",
        '  echo "StormEvents | count" | kusto.query --cluster ... --database Samples',
        "",
        '  kusto.query ... | copilot --prompt "Summarize" | teams.send --self',
        "",
        "Auth:",
        "  Uses your local 'az login' cached token. Run `az login` first.",
        "",
        "Output:",
        "  --format rows   (default) one stream item per row, as a plain object",
        "  --format table  single item: { columns: [...], rows: [[...], ...] }",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const piped = await collectInputAsText(input);
      const query = String(args.query ?? piped ?? "").trim();
      if (!query) {
        throw new Error("kusto.query: missing --query and no piped KQL input");
      }

      const database = String(args.database ?? "").trim();
      if (!database) throw new Error("kusto.query: --database is required");

      const client = clientFactory(args);

      let response;
      try {
        response = await client.execute(database, query);
      } finally {
        if (typeof client.close === "function") {
          try {
            await client.close();
          } catch {
            /* ignore close errors */
          }
        }
      }

      const primary = response.primaryResults?.[0];
      if (!primary) return { output: asStream([]) };

      const json = primary.toJSON();
      const columns = (json.columns ?? []).map(
        (c) => c.name ?? c.ColumnName ?? "",
      );
      const rawRows = (json.data ?? []) as unknown[];

      const format = args.format === "table" ? "table" : "rows";
      if (format === "table") {
        const rows = rawRows.map((r) =>
          Array.isArray(r)
            ? r
            : columns.map((c) => (r as Record<string, unknown>)[c]),
        );
        return { output: asStream([{ columns, rows }]) };
      }

      const rows = rawRows.map((r) => {
        if (!Array.isArray(r)) return r;
        const obj: Record<string, unknown> = {};
        columns.forEach((c, i) => {
          obj[c] = (r as unknown[])[i];
        });
        return obj;
      });
      return { output: asStream(rows) };
    },
  };
}
