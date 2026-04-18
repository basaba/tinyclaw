import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CopilotBridgeClient } from "../copilot/client.js";
import type { ContextBuilder } from "../memory/context.js";
import type { MemoryStore } from "../memory/store.js";
import { registerAllTools } from "./tools/index.js";
import { registerMemoryResources } from "./resources/memory.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("mcp:server");

export function createMcpServer(
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
  store: MemoryStore,
): McpServer {
  const server = new McpServer({
    name: "lobster-copilot",
    version: "0.1.0",
  });

  registerAllTools(server, copilot, contextBuilder);
  registerMemoryResources(server, store);

  logger.info("MCP server created with all tools and resources registered");

  return server;
}

export async function startServer(
  server: McpServer,
  transport: "stdio" | "sse",
): Promise<void> {
  if (transport === "stdio") {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    logger.info("MCP server started with stdio transport");
  } else {
    // SSE transport can be added when needed
    throw new Error("SSE transport is not yet implemented");
  }
}
