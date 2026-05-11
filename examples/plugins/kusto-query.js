/**
 * tinyclaw plugin — `kusto.query`
 *
 * Run a KQL query against an Azure Data Explorer (Kusto) cluster from any
 * Lobster pipeline. Output rows can be piped into `copilot`, `teams.send`,
 * `mail.send`, etc.
 *
 * Setup:
 *   1. Copy this file to your plugins directory:
 *        ~/.config/tinyclaw/plugins/kusto-query.js
 *      (or set LOBSTER_PLUGINS / pass --plugins <dir>)
 *   2. Install the SDK in that directory:
 *        cd ~/.config/tinyclaw/plugins
 *        npm init -y && npm pkg set type=module
 *        npm install azure-kusto-data
 *
 * Usage:
 *   kusto.query --cluster https://help.kusto.windows.net \
 *               --database Samples \
 *               --query "StormEvents | take 5"
 *
 *   echo "StormEvents | count" | kusto.query --cluster ... --database Samples
 *
 *   kusto.query ... | copilot --prompt "Summarize"
 *
 * Auth (in priority order):
 *   --managed-identity [--client-id <id>]            system or user MI
 *   --client-id ... --client-secret ... --tenant ... AAD app key
 *   (default)                                        local `az login` token
 */

// @ts-check

import { Client, KustoConnectionStringBuilder } from "azure-kusto-data";

function asStream(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function collectInputAsText(input) {
  const parts = [];
  if (!input) return "";
  for await (const item of input) {
    if (typeof item === "string") parts.push(item);
    else if (item != null) parts.push(JSON.stringify(item));
  }
  return parts.join("\n").trim();
}

function buildConnectionString(args) {
  const cluster = String(args.cluster ?? "").trim();
  if (!cluster) throw new Error("kusto.query: --cluster is required");

  const clientId = args["client-id"];
  const clientSecret = args["client-secret"];
  const tenant = args.tenant ?? args["tenant-id"];

  if (args["managed-identity"]) {
    return typeof clientId === "string" && clientId
      ? KustoConnectionStringBuilder.withUserManagedIdentity(cluster, clientId)
      : KustoConnectionStringBuilder.withSystemManagedIdentity(cluster);
  }

  if (clientId && clientSecret && tenant) {
    return KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
      cluster,
      String(clientId),
      String(clientSecret),
      String(tenant),
    );
  }

  return KustoConnectionStringBuilder.withAzLoginIdentity(cluster);
}

export function createCommand() {
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
          "client-id": { type: "string", description: "AAD app client id" },
          "client-secret": {
            type: "string",
            description: "AAD app client secret",
          },
          tenant: { type: "string", description: "AAD tenant id" },
          "managed-identity": {
            type: "boolean",
            description:
              "Use managed identity (system, or user via --client-id)",
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
        "Auth (in priority order):",
        "  --managed-identity [--client-id <id>]              system / user MI",
        "  --client-id ... --client-secret ... --tenant ...   AAD app",
        "  (default)                                          local 'az login' identity",
        "",
        "Output:",
        "  --format rows   (default) one stream item per row, as a plain object",
        "  --format table  single item: { columns: [...], rows: [[...], ...] }",
      ].join("\n");
    },

    async run({ input, args }) {
      const piped = await collectInputAsText(input);
      const query = String(args.query ?? piped ?? "").trim();
      if (!query) {
        throw new Error("kusto.query: missing --query and no piped KQL input");
      }

      const database = String(args.database ?? "").trim();
      if (!database) throw new Error("kusto.query: --database is required");

      const kcsb = buildConnectionString(args);
      const client = new Client(kcsb);

      let response;
      try {
        response = await client.execute(database, query);
      } finally {
        if (typeof client.close === "function") {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        }
      }

      const primary = response.primaryResults?.[0];
      if (!primary) return { output: asStream([]) };

      const json = primary.toJSON();
      const columns = (json.columns ?? []).map((c) => c.name ?? c.ColumnName);
      const rawRows = json.data ?? [];

      const format = args.format === "table" ? "table" : "rows";
      if (format === "table") {
        const rows = rawRows.map((r) =>
          Array.isArray(r) ? r : columns.map((c) => r[c]),
        );
        return { output: asStream([{ columns, rows }]) };
      }

      const rows = rawRows.map((r) => {
        if (!Array.isArray(r)) return r;
        const obj = {};
        columns.forEach((c, i) => {
          obj[c] = r[i];
        });
        return obj;
      });
      return { output: asStream(rows) };
    },
  };
}

export default createCommand;
