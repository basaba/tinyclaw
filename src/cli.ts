#!/usr/bin/env node
// Suppress Node.js experimental warnings (e.g. SQLite) in this process and subprocesses
process.env.NODE_NO_WARNINGS = "1";

import { CopilotAdapter } from "./adapters/copilot-adapter.js";
import { createCopilotAdapters } from "./adapters/index.js";
import { loadMcpConfig, parseMcpFilter } from "./mcp-config/loader.js";
import { createCopilotCommand } from "./commands/copilot.js";
import { createMcpCallCommand } from "./commands/mcp.js";

const args = process.argv.slice(2);

if (args[0] === "help" || args[0] === "--help" || args[0] === "-h" || !args.length) {
  printHelp();
  process.exit(0);
}

if (args[0] === "copilot") {
  copilot(args.slice(1));
} else if (args[0] === "tui") {
  const { startTui } = await import("./tui/index.js");
  await startTui();
} else if (args[0] === "daemon") {
  await handleDaemon(args[1]);
} else {
  run(args);
}

function printHelp(): void {
  console.log(`lobster-copilot — Run Lobster workflows with Copilot as the LLM engine

Usage:
  lobster-copilot <file> [options]
  lobster-copilot -p '<pipeline>' [options]
  lobster-copilot copilot '<prompt>' [options]
  lobster-copilot help

Commands:
  copilot                  Send a prompt directly to Copilot (shortcut)
  tui                      Launch the workflow scheduler TUI (connects to daemon)
  daemon start             Start the scheduler daemon in the background
  daemon stop              Stop the running scheduler daemon
  daemon status            Check if the daemon is running

Options:
  -p, --pipeline <text>    Run a pipeline string instead of a file
  --model <model>          Model to use (e.g. gpt-4o, claude-sonnet-4)
  --system <prompt>        System prompt override
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
  lobster-copilot copilot 'Explain async/await in TypeScript'
  lobster-copilot copilot 'Review this code' --model gpt-4o < file.ts
  lobster-copilot examples/piped-steps.yaml
  lobster-copilot -p "llm.invoke --provider copilot --prompt 'Hello'"
  lobster-copilot workflow.yaml --mcp-config ./mcp.json
`);
}

// ── copilot shortcut ────────────────────────────────────────────────

async function copilot(copilotArgs: string[]): Promise<void> {
  let prompt: string | undefined;
  let model: string | undefined;
  let systemPrompt: string | undefined;
  let mcpConfigPath: string | undefined;
  let mcpsFilter: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < copilotArgs.length; i++) {
    const arg = copilotArgs[i];
    if (arg === "--model") {
      model = copilotArgs[++i];
    } else if (arg === "--system") {
      systemPrompt = copilotArgs[++i];
    } else if (arg === "--mcp-config") {
      mcpConfigPath = copilotArgs[++i];
    } else if (arg === "--mcps") {
      mcpsFilter = copilotArgs[++i];
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  prompt = positional.join(" ");

  // Read stdin if piped
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const stdinText = Buffer.concat(chunks).toString("utf-8").trim();
    if (stdinText) {
      prompt = prompt ? `${stdinText}\n\n${prompt}` : stdinText;
    }
  }

  if (!prompt) {
    console.error("❌ Provide a prompt: lobster-copilot copilot 'your question'");
    process.exit(1);
  }

  const filter = mcpsFilter ? parseMcpFilter(mcpsFilter) : undefined;
  const mcpServers = loadMcpConfig({ configPath: mcpConfigPath, filter });

  const adapter = new CopilotAdapter({
    cliUrl: process.env.COPILOT_CLI_URL,
    mcpServers,
  });

  try {
    await adapter.ensureStarted();
    const response = await adapter.client.reason(prompt, undefined, systemPrompt, {
      model,
      mcpServers,
    });
    console.log(response);
  } catch (err) {
    console.error("❌", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await adapter.dispose();
  }
}

// ── workflow runner ─────────────────────────────────────────────────

async function run(runArgs: string[]): Promise<void> {
  const { runToolRequest } = await import("@basaba/lobster/core");

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

  const adapter = new CopilotAdapter({
    cliUrl: process.env.COPILOT_CLI_URL,
    mcpServers,
  });
  const adapters = { copilot: adapter as any };
  const dispose = () => adapter.dispose();

  // Build extended registry with copilot + mcp commands
  const { createDefaultRegistry } = await import("@basaba/lobster/core");
  const defaultRegistry = createDefaultRegistry();
  const copilotCmd = createCopilotCommand(
    () => adapter.client,
    () => adapter.ensureStarted(),
  );
  const mcpCallCmd = createMcpCallCommand(() => mcpServers);
  const extraCommands = new Map(
    [copilotCmd, mcpCallCmd].map((c) => [c.name, c]),
  );
  const registry = {
    get(name: string) {
      return extraCommands.get(name) ?? defaultRegistry.get(name);
    },
    list() {
      return [...defaultRegistry.list(), ...extraCommands.keys()].sort();
    },
  };

  try {
    const result = await runToolRequest({
      ...(filePath ? { filePath } : { pipeline }),
      ...(argsJson ? { args: argsJson } : {}),
      ctx: {
        llmAdapters: adapters,
        registry,
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
    process.exit(0);
  }
}

// ── daemon management ───────────────────────────────────────────────

async function handleDaemon(subCmd: string | undefined): Promise<void> {
  const { DaemonClient } = await import("./tui/scheduler/daemon-client.js");

  switch (subCmd) {
    case "start": {
      if (DaemonClient.isDaemonRunning()) {
        const pid = DaemonClient.getDaemonPid();
        console.log(`🦞 Daemon is already running (pid ${pid})`);
        return;
      }

      const { spawnDaemon } = await import("./tui/scheduler/spawn.js");
      const pid = spawnDaemon();
      if (pid) {
        console.log(`🦞 Daemon started (pid ${pid})`);
      } else {
        console.error("❌ Failed to start daemon");
        process.exit(1);
      }
      return;
    }

    case "stop": {
      if (!DaemonClient.isDaemonRunning()) {
        console.log("🦞 Daemon is not running");
        return;
      }
      const client = new DaemonClient();
      try {
        await client.connect();
        await client.stopDaemon();
        console.log("🦞 Daemon stopped");
      } catch {
        // Fall back to kill
        const pid = DaemonClient.getDaemonPid();
        if (pid) {
          try {
            process.kill(pid, "SIGTERM");
            console.log(`🦞 Daemon stopped (pid ${pid})`);
          } catch {
            console.error("❌ Failed to stop daemon");
          }
        }
      }
      return;
    }

    case "status": {
      if (DaemonClient.isDaemonRunning()) {
        const pid = DaemonClient.getDaemonPid();
        console.log(`🦞 Daemon is running (pid ${pid})`);
      } else {
        console.log("🦞 Daemon is not running");
      }
      return;
    }

    default:
      console.error("Usage: lobster-copilot daemon <start|stop|status>");
      process.exit(1);
  }
}
