import type { CopilotBridgeClient } from "../copilot/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/**
 * mcp.call — Invoke an MCP tool through Copilot's MCP integration.
 *
 * Usage in workflows:
 *   mcp.call --server teams --tool ListChats
 *   mcp.call --server msft-learn --tool SearchDocs --input '{"query": "AKS"}'
 *   mcp.call --tool SearchDocs --input '{"query": "AKS"}'
 *
 * This works by asking Copilot to use the specified MCP tool, since MCP servers
 * are attached to the Copilot session and Copilot orchestrates tool calls.
 */
export function createMcpCallCommand(
  getClient: () => CopilotBridgeClient,
  getMcpServers: () => Record<string, McpServerConfig>,
  ensureStarted?: () => Promise<void>,
) {
  return {
    name: "mcp.call",
    meta: {
      description: "Call an MCP tool through Copilot",
      argsSchema: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name from config" },
          tool: { type: "string", description: "Tool name to invoke" },
          input: { type: "string", description: "JSON input for the tool" },
          prompt: { type: "string", description: "Additional instructions for Copilot" },
          _: { type: "array", items: { type: "string" } },
        },
        required: [],
      },
      sideEffects: ["network"],
    },
    help() {
      return (
        `mcp.call — call an MCP tool through Copilot\n\n` +
        `Usage:\n` +
        `  mcp.call --tool <tool_name>\n` +
        `  mcp.call --server <server> --tool <tool_name>\n` +
        `  mcp.call --tool <tool_name> --input '{"key": "value"}'\n` +
        `  mcp.call --tool <tool_name> --prompt "Additional context"\n\n` +
        `Notes:\n` +
        `  MCP servers must be configured in mcp.json.\n` +
        `  Copilot orchestrates the actual tool call.\n`
      );
    },
    async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, unknown> }) {
      if (ensureStarted) await ensureStarted();
      const client = getClient();
      const servers = getMcpServers();

      const tool = typeof args.tool === "string" ? args.tool : undefined;
      const server = typeof args.server === "string" ? args.server : undefined;
      const inputJson = typeof args.input === "string" ? args.input : undefined;
      const extraPrompt = typeof args.prompt === "string" ? args.prompt : "";

      if (!tool) {
        throw new Error("mcp.call requires --tool <name>");
      }

      // Validate server exists if specified
      if (server && !servers[server]) {
        const available = Object.keys(servers).join(", ");
        throw new Error(
          `MCP server "${server}" not found in config. Available: ${available || "none (configure mcp.json)"}`,
        );
      }

      // Collect piped input
      const inputParts: string[] = [];
      for await (const item of input) {
        if (typeof item === "string") inputParts.push(item);
        else if (item != null) inputParts.push(JSON.stringify(item));
      }

      // Build instruction prompt for Copilot
      let prompt = `Use the MCP tool "${tool}"`;
      if (server) prompt += ` from the "${server}" server`;
      prompt += `.`;

      if (inputJson) {
        prompt += `\n\nTool input:\n${inputJson}`;
      }

      if (inputParts.length > 0) {
        prompt += `\n\nContext from pipeline:\n${inputParts.join("\n")}`;
      }

      if (extraPrompt) {
        prompt += `\n\n${extraPrompt}`;
      }

      prompt += `\n\nReturn the tool's result directly without additional commentary.`;

      // Pass only the relevant MCP servers to this session
      const mcpServers = server
        ? { [server]: servers[server] }
        : servers;

      const response = await client.reason(prompt, undefined, undefined, { mcpServers });

      // Try to parse as JSON if it looks like JSON
      let result: unknown = response;
      const trimmed = response.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          result = JSON.parse(trimmed);
        } catch {
          // Keep as string
        }
      }

      return { output: asStream([result]) };
    },
  };
}
