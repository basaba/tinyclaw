#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { MemoryStore } from "./memory/store.js";
import { ContextBuilder } from "./memory/context.js";
import { CopilotBridgeClient } from "./copilot/client.js";
import { createMcpServer, startServer } from "./mcp/server.js";
import { createCopilotAdapters } from "./adapters/index.js";
import { parseMcpString } from "./agency/mcps.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "run") {
  runWorkflow(args.slice(1));
} else if (command === "serve" || !command) {
  serveMcp();
} else if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else {
  // Treat as a pipeline string
  runPipeline(args.join(" "));
}

function printHelp(): void {
  console.log(`lobster-copilot — Run Lobster workflows with Copilot as the LLM engine

Usage:
  lobster-copilot run <file> [--args-json '{}'] [--mcps teams,mail]
  lobster-copilot run -p '<pipeline>' [--mcps calendar]
  lobster-copilot serve                            Start the MCP bridge server (default)
  lobster-copilot help                             Show this help

Options:
  --mcps <list>            Comma-separated Agency MCPs to attach (e.g. teams,mail,calendar)
  --args-json <json>       JSON object of workflow arguments

Environment:
  COPILOT_CLI_URL          Copilot CLI server URL (optional, auto-discovers)
  AGENCY_MCPS              Default Agency MCPs to attach (e.g. teams,mail,calendar)
  LOBSTER_LLM_PROVIDER     Default LLM provider (set to "copilot" automatically)
  LOG_LEVEL                Log level: debug, info, warn, error (default: info)

Examples:
  lobster-copilot run workflow.yaml
  lobster-copilot run -p "llm.invoke --prompt 'Hello'"
  lobster-copilot run -p "llm.invoke --prompt 'What meetings today?'" --mcps calendar
  lobster-copilot run workflow.yaml --mcps teams,mail --args-json '{"topic": "standup"}'
  AGENCY_MCPS=teams,calendar lobster-copilot run workflow.yaml
  lobster-copilot serve
`);
}

async function runWorkflow(runArgs: string[]): Promise<void> {
  const { runToolRequest } = await import("@clawdbot/lobster/core");

  // Parse flags
  let filePath: string | undefined;
  let pipeline: string | undefined;
  let argsJson: Record<string, unknown> | undefined;
  let mcpsRaw: string | undefined;

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
    } else if (arg === "--mcps") {
      mcpsRaw = runArgs[++i];
    } else if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  if (!filePath && !pipeline) {
    console.error("❌ Provide a workflow file or --pipeline '<commands>'");
    process.exit(1);
  }

  // Resolve Agency MCPs from --mcps flag and AGENCY_MCPS env var
  const envMcps = process.env.AGENCY_MCPS ?? "";
  const combinedMcps = [mcpsRaw, envMcps].filter(Boolean).join(",");
  const agencyMcps = parseMcpString(combinedMcps);

  if (agencyMcps.length > 0) {
    const names = agencyMcps.map((m) => (typeof m === "string" ? m : m.name));
    process.stderr.write(`🔌 Attaching Agency MCPs: ${names.join(", ")}\n`);
  }

  const { adapters, dispose } = createCopilotAdapters({
    cliUrl: process.env.COPILOT_CLI_URL,
    agencyMcps,
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
      if (result.status === "needs_approval") {
        console.log("⏸️  Workflow needs approval:");
        console.log(`   ${result.requiresApproval?.prompt}`);
        if (result.requiresApproval?.preview) {
          console.log(`   Preview: ${result.requiresApproval.preview}`);
        }
        if (result.requiresApproval?.resumeToken) {
          console.log(`   Resume token: ${result.requiresApproval.resumeToken}`);
        }
      } else if (result.status === "needs_input") {
        console.log("⏸️  Workflow needs input:");
        console.log(`   ${result.requiresInput?.prompt}`);
      } else {
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
      }
    } else {
      console.error("❌ Error:", result.error?.message ?? "Unknown error");
      process.exit(1);
    }
  } finally {
    await dispose();
  }
}

async function runPipeline(pipeline: string): Promise<void> {
  // Convenience: treat bare args as a pipeline
  await runWorkflow(["-p", pipeline]);
}

function serveMcp(): void {
  const config = loadConfig();
  const logger = createLogger("lobster-copilot", config.LOG_LEVEL);

  const store = new MemoryStore(config.SQLITE_PATH);
  const contextBuilder = new ContextBuilder(store, config.CONTEXT_TOKEN_BUDGET);
  const copilot = new CopilotBridgeClient({
    cliUrl: config.COPILOT_CLI_URL,
    apiKey: config.COPILOT_API_KEY,
  });

  async function main(): Promise<void> {
    logger.info("Starting lobster-copilot bridge service");
    await copilot.start();
    logger.info("Copilot client started");

    const server = createMcpServer(copilot, contextBuilder, store);
    await startServer(server, config.MCP_TRANSPORT);
    logger.info({ transport: config.MCP_TRANSPORT }, "lobster-copilot is running");
  }

  function shutdown(): void {
    logger.info("Shutting down gracefully...");
    copilot.stop().catch((err) => {
      logger.error({ err }, "Error stopping Copilot client");
    });
    store.close();
    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  main().catch((err) => {
    logger.fatal({ err }, "Fatal error during startup");
    process.exit(1);
  });
}
