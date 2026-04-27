#!/usr/bin/env node
// Suppress Node.js experimental warnings (e.g. SQLite) in this process and subprocesses
process.env.NODE_NO_WARNINGS = "1";

import { PassThrough } from "node:stream";
import * as readline from "node:readline/promises";
import { CopilotAdapter } from "./adapters/copilot-adapter.js";
import { createCopilotAdapters } from "./adapters/index.js";
import { loadMcpConfig } from "./mcp-config/loader.js";
import { buildRegistry } from "./registry.js";

/**
 * Attempt to parse a string as JSON, falling back to a relaxed parser
 * that handles unquoted keys/values (common when PowerShell strips inner
 * double-quotes, e.g. {org:value, project:One}).
 */
function parseJsonRelaxed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Try fixing unquoted keys and string values in a flat object:
    //   {org:https://dev.azure.com/msazure, project:One}
    // → {"org":"https://dev.azure.com/msazure","project":"One"}
    const relaxed = text
      .replace(/^\{/, "{")
      .replace(/\}$/, "}")
      .replace(/([{,])\s*([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      .replace(/:\s*([^",{}\[\]\s][^,}]*?)\s*(?=[,}])/g, (_, v) => `:"${v.trim()}"`);
    return JSON.parse(relaxed); // let this throw if it still fails
  }
}

const args = process.argv.slice(2);

if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

if (!args.length) {
  const { startTui } = await import("./tui/index.js");
  await startTui();
} else if (args[0] === "tui") {
  const { startTui } = await import("./tui/index.js");
  await startTui();
} else if (args[0] === "sched") {
  const { handleScheduler } = await import("./commands/scheduler.js");
  await handleScheduler(args.slice(1));
} else if (args[0] === "daemon") {
  await handleDaemon(args[1]);
} else {
  run(args);
}

function printHelp(): void {
  console.log(`tinyclaw — Run Lobster workflows with Copilot as the LLM engine

Usage:
  tinyclaw                         Launch the TUI (default)
  tinyclaw <file> [options]
  tinyclaw -p '<pipeline>' [options]
  tinyclaw sched <command> [options]
  tinyclaw help

Commands:
  tui                      Launch the workflow scheduler TUI (connects to daemon)
  sched                    Scheduler management CLI (non-interactive)
  sched help               Show all scheduler subcommands
  daemon start             Start the scheduler daemon in the background
  daemon stop              Stop the running scheduler daemon
  daemon status            Check if the daemon is running

Options:
  -p, --pipeline <text>    Run a pipeline string instead of a file
  --dry-run                Validate and print the execution plan without running
  --model <model>          Model to use (e.g. gpt-4o, claude-sonnet-4)
  --system <prompt>        System prompt override
  --args-json <json>       JSON object of workflow arguments
  --plugins <dir>          Plugin directory (or set LOBSTER_PLUGINS env var)

MCP Server Discovery:
  Copilot LLM sessions discover MCP servers automatically via the SDK
  (e.g. .mcp.json, .vscode/mcp.json).
  Direct MCP commands (mcp.call, teams.send, mail.*) auto-discover from:
    mcp.json / .mcp.json in CWD, MCP_CONFIG env var, or ~/.config/tinyclaw/mcp.json

Examples:
  tinyclaw examples/piped-steps.yaml
  tinyclaw examples/piped-steps.yaml --dry-run
  tinyclaw -p "llm.invoke --provider copilot --prompt 'Hello'"
  tinyclaw -p "ado.pr.monitor --org myorg --project proj" --dry-run
  tinyclaw sched list
  tinyclaw sched run wf-abc123
`);
}

// ── approval / input display ────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "(none)";
    if (v.every((item) => typeof item === "string" || typeof item === "number"))
      return v.join(", ");
    return `${v.length} items`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries
      .map(([k, val]) =>
        `${k}: ${typeof val === "string" || typeof val === "number" || typeof val === "boolean" ? String(val) : "…"}`,
      )
      .join(", ");
  }
  return String(v);
}

function formatApprovalItem(item: unknown, index: number): string[] {
  if (typeof item === "string") return [`  ${item}`];
  if (item == null) return ["  (empty)"];
  if (typeof item !== "object") return [`  ${String(item)}`];

  const obj = item as Record<string, unknown>;
  const lines: string[] = [];

  const heading = obj.subject ?? obj.title ?? obj.name ?? obj.id;
  lines.push(heading ? `  #${index + 1}: ${String(heading)}` : `  #${index + 1}`);

  const knownFields: Array<[string, string]> = [
    ["from", "From"], ["to", "To"], ["category", "Category"],
    ["summary", "Summary"], ["replyText", "Reply"], ["bodyPreview", "Preview"],
    ["status", "Status"], ["description", "Desc"], ["message", "Message"], ["url", "URL"],
  ];

  const rendered = new Set<string>(["subject", "title", "name", "id"]);
  for (const [key, label] of knownFields) {
    if (key in obj && obj[key] != null) {
      const val = formatValue(obj[key]);
      lines.push(`    ${label}: ${val.length > 80 ? val.slice(0, 77) + "..." : val}`);
      rendered.add(key);
    }
  }

  const remaining = Object.entries(obj).filter(([k]) => !rendered.has(k));
  for (const [k, v] of remaining) {
    const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
    const val = formatValue(v);
    lines.push(`    ${label}: ${val.length > 60 ? val.slice(0, 57) + "..." : val}`);
  }

  return lines;
}

function renderApprovalBox(approval: { prompt: string; items?: unknown[]; preview?: string }): void {
  const w = process.stderr;

  w.write(`\n⏳ Approval Required\n`);
  w.write(`${approval.prompt}\n`);

  if (approval.preview) {
    w.write(`\n── Preview ──\n`);
    const previewLines = approval.preview.split("\n").slice(0, 20);
    for (const line of previewLines) {
      w.write(`${line}\n`);
    }
    if (approval.preview.split("\n").length > 20) {
      w.write(`... (truncated)\n`);
    }
  }

  if (approval.items && approval.items.length > 0) {
    w.write(`\n── Items (${approval.items.length}) ──\n`);
    for (let i = 0; i < approval.items.length; i++) {
      const itemLines = formatApprovalItem(approval.items[i], i);
      for (const line of itemLines) {
        w.write(`${line}\n`);
      }
      if (i < approval.items.length - 1) {
        w.write(`\n`);
      }
    }
  }

  w.write(`\n`);
}

async function promptApproval(approval: { prompt: string; items?: unknown[]; preview?: string }): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // Non-interactive: dump structured info and reject
    process.stderr.write(JSON.stringify({ status: "needs_approval", approval }, null, 2) + "\n");
    return false;
  }

  renderApprovalBox(approval);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("  Approve? (y/N) ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function promptInput(input: { prompt: string; responseSchema?: unknown }): Promise<unknown | null> {
  if (!process.stdin.isTTY) {
    process.stderr.write(JSON.stringify({ status: "needs_input", input }, null, 2) + "\n");
    return null;
  }

  process.stderr.write(`\n📝 Input Required\n`);
  process.stderr.write(`   ${input.prompt}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("  > ");
    if (!answer.trim()) return null;
    try { return JSON.parse(answer); } catch { return answer; }
  } finally {
    rl.close();
  }
}

// ── workflow runner ─────────────────────────────────────────────────

async function run(runArgs: string[]): Promise<void> {
  const lobsterCore: any = await import("@basaba/lobster/core");
  const { runPipeline, parsePipeline, runToolRequest, resumeToolRequest } = lobsterCore;

  let filePath: string | undefined;
  let pipeline: string | undefined;
  let argsJson: Record<string, unknown> | undefined;
  let dryRun = false;
  let pluginsDir: string | undefined;

  for (let i = 0; i < runArgs.length; i++) {
    const arg = runArgs[i];
    if (arg === "-p" || arg === "--pipeline") {
      pipeline = runArgs[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--args-json") {
      // On Windows, shells may split JSON across multiple argv entries.
      // Collect and rejoin until we get valid JSON.
      const parts: string[] = [];
      while (i + 1 < runArgs.length) {
        parts.push(runArgs[++i]);
        try {
          argsJson = parseJsonRelaxed(parts.join(" ")) as Record<string, unknown>;
          break;
        } catch {
          // keep collecting
        }
      }
      if (!argsJson) {
        console.error(`❌ --args-json must be valid JSON, got: ${parts.join(" ")}`);
        process.exit(1);
      }
    } else if (arg === "--plugins") {
      pluginsDir = runArgs[++i];
    } else if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  if (!filePath && !pipeline) {
    console.error("❌ Provide a workflow file or --pipeline '<commands>'");
    process.exit(1);
  }

  const mcpServers = loadMcpConfig({});

  const serverNames = Object.keys(mcpServers);
  if (serverNames.length > 0) {
    process.stderr.write(`🔌 MCP servers: ${serverNames.join(", ")}\n`);
  }

  const adapter = new CopilotAdapter({
    cliUrl: process.env.COPILOT_CLI_URL,
    defaultModel: "claude-opus-4.7",
    timeoutMs: 20 * 60_000,
  });
  const dispose = () => adapter.dispose();

  // Build extended registry with copilot + mcp commands + plugins
  const registry = await buildRegistry({
    getClient: () => adapter.client,
    ensureStarted: () => adapter.ensureStarted(),
    getMcpServers: () => mcpServers,
    pluginDir: pluginsDir,
  });

  try {
    if (filePath) {
      // Use tool-mode API so approval gates return structured data
      // instead of prompting inline — enables rich CLI display.
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      // Stream logs to the real stderr in real-time
      stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      stdout.on("data", (chunk: Buffer) => process.stderr.write(chunk));

      const toolCtx = {
        cwd: process.cwd(),
        env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
        llmAdapters: { copilot: adapter as any },
        registry,
        stdout,
        stderr,
        dryRun,
      };

      let result: any = await runToolRequest({ filePath, args: argsJson, ctx: toolCtx });

      // Loop: handle approval/input gates, resume until terminal status
      while (result.ok && (result.status === "needs_approval" || result.status === "needs_input")) {
        if (result.status === "needs_approval" && result.requiresApproval) {
          const approval = result.requiresApproval;
          const approved = await promptApproval(approval);

          result = await resumeToolRequest({
            token: approval.resumeToken,
            approved,
            cancel: !approved,
            ctx: toolCtx,
          });
        } else if (result.status === "needs_input" && result.requiresInput) {
          const input = result.requiresInput;
          const response = await promptInput(input);

          if (response === null) {
            result = await resumeToolRequest({
              token: input.resumeToken,
              cancel: true,
              ctx: toolCtx,
            });
          } else {
            result = await resumeToolRequest({
              token: input.resumeToken,
              response,
              ctx: toolCtx,
            });
          }
        } else {
          break;
        }
      }

      if (!result.ok) {
        console.error("❌", result.error?.message ?? "Unknown error");
        process.exit(1);
      }

      if (result.status === "cancelled") {
        process.stderr.write("🚫 Cancelled\n");
        process.exit(0);
      }

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
      // Pipeline mode
      const parsed = parsePipeline(pipeline!);
      const result = await runPipeline({
        pipeline: parsed,
        registry,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
        mode: "human",
        cwd: process.cwd(),
        llmAdapters: { copilot: adapter as any },
        dryRun,
      });

      for (const item of result.items ?? []) {
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
  } catch (err) {
    console.error("❌", err instanceof Error ? err.message : String(err));
    process.exit(1);
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
      console.error("Usage: tinyclaw daemon <start|stop|status>");
      process.exit(1);
  }
}
