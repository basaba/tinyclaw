import type { LobsterCommand } from "./copilot.js";
import {
  resolveServer,
  callTool,
} from "../mcp-client/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

// ── agency.mcp.call ─────────────────────────────────────────────────

export function createMcpCallCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "agency.mcp.call",
    meta: {
      description: "Call a tool on an MCP server directly (no LLM)",
      argsSchema: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name" },
          tool: { type: "string", description: "Tool name to call" },
          args: { type: "string", description: "JSON object of tool arguments" },
          "input-key": {
            type: "string",
            description: "Key to inject piped input as in tool arguments",
          },
          _: { type: "array", items: { type: "string" } },
        },
        required: [],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "agency.mcp.call — call a tool on an MCP server without LLM",
        "",
        "Usage:",
        `  agency.mcp.call --server icm --tool search_incidents --args '{"query": "sev1"}'`,
        `  echo '{"query":"sev1"}' | agency.mcp.call --server icm --tool search_incidents`,
        `  copilot --prompt 'Generate a query' | agency.mcp.call --server kusto --tool execute_query --input-key query`,
        "",
        "Piped input handling:",
        "  - If --input-key is set, piped stdin is assigned to that key in args",
        "  - If stdin is JSON, it is merged into tool args (--args wins on conflict)",
        "  - Otherwise stdin is ignored unless --input-key is specified",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const serverName = resolveServerName(args);
      const toolName = resolveToolName(args);
      const config = resolveServer(serverName, getServers());
      const timeout = typeof config.timeout === "number" ? config.timeout * 1000 : undefined;

      // Parse explicit args
      let toolArgs: Record<string, unknown> = {};
      if (typeof args.args === "string") {
        try {
          toolArgs = JSON.parse(args.args);
        } catch {
          throw new Error("--args must be valid JSON");
        }
      }

      // Collect piped input
      const inputParts: unknown[] = [];
      for await (const item of input) {
        inputParts.push(item);
      }

      // Merge piped input into args
      if (inputParts.length > 0) {
        const inputKey = typeof args["input-key"] === "string" ? args["input-key"] : undefined;

        if (inputKey) {
          // Assign all input to the specified key
          const collapsed =
            inputParts.length === 1
              ? typeof inputParts[0] === "string"
                ? inputParts[0]
                : inputParts[0]
              : inputParts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\n");
          toolArgs = { [inputKey]: collapsed, ...toolArgs }; // --args wins on conflict
        } else {
          // Try to merge if input is a JSON object
          for (const item of inputParts) {
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              toolArgs = { ...(item as Record<string, unknown>), ...toolArgs };
            } else if (typeof item === "string") {
              try {
                const parsed = JSON.parse(item);
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                  toolArgs = { ...parsed, ...toolArgs };
                }
              } catch {
                // Non-JSON string input without --input-key: skip
              }
            }
          }
        }
      }

      const result = await callTool(config, toolName, toolArgs, timeout);

      if (result.isError) {
        const errorText = result.content
          .map((c: any) => c?.text ?? JSON.stringify(c))
          .join("\n");
        throw new Error(`MCP tool error: ${errorText}`);
      }

      // Emit each content item
      const items = result.content.map((c: any) => {
        if (c?.type === "text" && typeof c.text === "string") {
          // Try to parse as JSON for downstream consumption
          try {
            return JSON.parse(c.text);
          } catch {
            return c.text;
          }
        }
        return c;
      });

      return { output: asStream(items) };
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function resolveServerName(args: Record<string, unknown>): string {
  if (typeof args.server === "string" && args.server) return args.server;
  // First positional arg
  const positional = Array.isArray(args._) ? args._ : [];
  if (typeof positional[0] === "string" && positional[0]) return positional[0];
  throw new Error("--server is required (e.g. --server icm)");
}

function resolveToolName(args: Record<string, unknown>): string {
  if (typeof args.tool === "string" && args.tool) return args.tool;
  // Second positional arg (first is server)
  const positional = Array.isArray(args._) ? args._ : [];
  if (typeof positional[1] === "string" && positional[1]) return positional[1];
  throw new Error("--tool is required (e.g. --tool search_incidents)");
}
