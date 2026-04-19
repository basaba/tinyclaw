#!/usr/bin/env node
import { createCopilotAdapters } from "./adapters/index.js";
import { loadMcpConfig, parseMcpFilter } from "./mcp-config/loader.js";

const args = process.argv.slice(2);

if (args[0] === "help" || args[0] === "--help" || args[0] === "-h" || !args.length) {
  printHelp();
  process.exit(0);
}

run(args);

function printHelp(): void {
  console.log(`lobster-copilot — Run Lobster workflows with Copilot as the LLM engine

Usage:
  lobster-copilot <file> [options]
  lobster-copilot -p '<pipeline>' [options]
  lobster-copilot help

Options:
  -p, --pipeline <text>    Run a pipeline string instead of a file
  --mcp-config <path>      Path to mcp.json config file
  --mcps <list>            Filter MCP servers from config (comma-separated)
  --args-json <json>       JSON object of workflow arguments

MCP Config Resolution (first found wins):
  1. --mcp-config <path>
  2. MCP_CONFIG env var
  3. mcp.json in current directory
  4. .mcp.json in current directory
  5. ~/.config/lobster-copilot/mcp.json

Examples:
  lobster-copilot examples/piped-steps.yaml
  lobster-copilot -p "llm.invoke --provider copilot --prompt 'Hello'"
  lobster-copilot workflow.yaml --mcp-config ./mcp.json
  lobster-copilot workflow.yaml --mcps teams,calendar
`);
}

async function run(runArgs: string[]): Promise<void> {
  const { runToolRequest } = await import("@clawdbot/lobster/core");

  let filePath: string | undefined;
  let pipeline: string | undefined;
  let argsJson: Record<string, unknown> | undefined;
  let mcpConfigPath: string | undefined;
  let mcpsFilter: string | undefined;

  for (let i = 0; i < runArgs.length; i++) {
    const arg = runArgs[i];
    if (arg === "-p" || arg === "--pipeline") {
      pipeline = runArgs[++i];
    } else if (arg === "--args-json") {
      try {
        argsJson = JSON.parse(runArgs[++i]);
      } catch {
        console.error("❌ --args-json must be valid JSON");
        process.exit(1);
      }
    } else if (arg === "--mcp-config") {
      mcpConfigPath = runArgs[++i];
    } else if (arg === "--mcps") {
      mcpsFilter = runArgs[++i];
    } else if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  if (!filePath && !pipeline) {
    console.error("❌ Provide a workflow file or --pipeline '<commands>'");
    process.exit(1);
  }

  const filter = mcpsFilter ? parseMcpFilter(mcpsFilter) : undefined;
  const mcpServers = loadMcpConfig({ configPath: mcpConfigPath, filter });

  const serverNames = Object.keys(mcpServers);
  if (serverNames.length > 0) {
    process.stderr.write(`🔌 MCP servers: ${serverNames.join(", ")}\n`);
  }

  const { adapters, dispose } = createCopilotAdapters({
    cliUrl: process.env.COPILOT_CLI_URL,
    mcpServers,
  });

  try {
    const result = await runToolRequest({
      ...(filePath ? { filePath } : { pipeline }),
      ...(argsJson ? { args: argsJson } : {}),
      ctx: {
        llmAdapters: adapters,
        env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
      },
    });

    if (result.ok) {
      for (const item of result.output ?? []) {
        if (typeof item === "string") {
          console.log(item);
        } else if (item?.output?.data) {
          console.log(JSON.stringify(item.output.data, null, 2));
        } else if (item?.output?.text) {
          console.log(item.output.text);
        } else {
          console.log(JSON.stringify(item, null, 2));
        }
      }
    } else {
      console.error("❌ Error:", result.error?.message ?? "Unknown error");
      process.exit(1);
    }
  } finally {
    await dispose();
  }
}
