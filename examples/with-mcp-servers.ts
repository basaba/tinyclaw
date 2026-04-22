/**
 * Run a workflow with MCP servers auto-loaded from mcp.json.
 *
 * Place a mcp.json next to this file or in your home config:
 *   ~/.config/lobster-copilot/mcp.json
 *
 * Usage:
 *   npx tsx examples/with-mcp-servers.ts
 */
import { createCopilotAdapters } from "../src/adapters/index.js";
import { loadMcpConfig } from "../src/mcp-config/index.js";

async function main() {
  // Auto-discover mcp.json (cwd → env → home config)
  const mcpServers = loadMcpConfig();

  const serverNames = Object.keys(mcpServers);
  if (serverNames.length > 0) {
    console.log(`🔌 MCP servers loaded: ${serverNames.join(", ")}`);
  } else {
    console.log("ℹ️  No mcp.json found — running without MCP servers");
  }

  const { adapters, dispose } = createCopilotAdapters({ mcpServers });

  try {
    const { runToolRequest } = await import("@basaba/lobster/core");

    const result = await runToolRequest({
      pipeline: `llm.invoke --provider copilot --prompt "What tools do you have available?"`,
      ctx: {
        llmAdapters: adapters,
        env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
      },
    });

    if (result.ok) {
      for (const item of result.output ?? []) {
        console.log(typeof item === "string" ? item : JSON.stringify(item, null, 2));
      }
    } else {
      console.error("Error:", result.error?.message);
    }
  } finally {
    await dispose();
  }
}

main();
