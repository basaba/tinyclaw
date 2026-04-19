import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpLocalServer } from "../mcp-config/loader.js";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  isError: boolean;
  content: unknown[];
}

/**
 * Resolves a server name to a McpLocalServer config.
 *
 * Resolution order:
 * 1. If `servers` map has the name, use it.
 * 2. If it looks like an agency server name, build config for `agency mcp <name>`.
 */
export function resolveServer(
  name: string,
  servers: Record<string, McpServerConfig>,
): McpLocalServer {
  const existing = servers[name];
  if (existing) {
    if ("command" in existing) return existing as McpLocalServer;
    throw new Error(
      `MCP server "${name}" is an HTTP/SSE server — only stdio servers are supported for direct calls`,
    );
  }

  // Fallback: treat as `agency mcp <name>`
  return {
    command: "agency",
    args: ["mcp", name],
    tools: ["*"],
  };
}

/**
 * Connect to a stdio MCP server, run a callback, and close.
 */
export async function withMcpClient<T>(
  config: McpLocalServer,
  fn: (client: Client) => Promise<T>,
  timeoutMs = 60_000,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env
      ? { ...process.env, ...config.env } as Record<string, string>
      : undefined,
    cwd: config.cwd,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "lobster-copilot", version: "0.1.0" },
    { capabilities: {} },
  );

  // Capture stderr for diagnostics
  let stderrChunks: string[] = [];
  const stderrStream = transport.stderr;
  if (stderrStream && "on" in stderrStream) {
    (stderrStream as any).on("data", (chunk: Buffer | string) => {
      stderrChunks.push(String(chunk));
    });
  }

  try {
    await client.connect(transport);

    // Run the callback with a timeout
    const result = await Promise.race([
      fn(client),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP call timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    return result;
  } catch (err) {
    const stderr = stderrChunks.join("").trim();
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      stderr ? `${base}\n[server stderr] ${stderr.slice(-500)}` : base,
    );
  } finally {
    try {
      await client.close();
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * List tools available on an MCP server, filtered by config allowlist.
 */
export async function listTools(
  config: McpLocalServer,
  timeoutMs?: number,
): Promise<McpToolInfo[]> {
  return withMcpClient(
    config,
    async (client) => {
      const { tools } = await client.listTools();
      const allowlist = config.tools;
      const allowAll = !allowlist || allowlist.includes("*");

      return tools
        .filter((t) => allowAll || allowlist.includes(t.name))
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }));
    },
    timeoutMs,
  );
}

/**
 * Call a tool on an MCP server.
 */
export async function callTool(
  config: McpLocalServer,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number,
): Promise<McpCallResult> {
  // Check allowlist
  const allowlist = config.tools;
  const allowAll = !allowlist || allowlist.includes("*");
  if (!allowAll && !allowlist.includes(toolName)) {
    throw new Error(
      `Tool "${toolName}" is not in the allowlist for this server (allowed: ${allowlist.join(", ")})`,
    );
  }

  return withMcpClient(
    config,
    async (client) => {
      const result = await client.callTool({ name: toolName, arguments: args });
      return {
        isError: result.isError === true,
        content: Array.isArray(result.content) ? result.content : [],
      };
    },
    timeoutMs,
  );
}
