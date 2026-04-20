import cron from "node-cron";
import { randomUUID } from "node:crypto";
import type { WorkflowEntry, RunRecord, TriggerType } from "./types.js";
import {
  loadSchedules,
  saveSchedules,
  appendRun,
  updateRun,
} from "./config.js";
import { EventEmitter } from "node:events";
import { CopilotAdapter } from "../../adapters/copilot-adapter.js";
import { createCopilotCommand } from "../../commands/copilot.js";
import { createMcpCallCommand } from "../../commands/mcp.js";
import { loadMcpConfig } from "../../mcp-config/loader.js";

// ── Interval parsing ────────────────────────────────────────────────

const INTERVAL_RE = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)$/i;

function parseIntervalMs(expr: string): number | null {
  const m = INTERVAL_RE.exec(expr.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("h")) return n * 3600_000;
  if (unit.startsWith("m")) return n * 60_000;
  return n * 1000;
}

function isCron(expr: string): boolean {
  return cron.validate(expr);
}

// ── Scheduler Engine ────────────────────────────────────────────────

export type SchedulerEvent =
  | { type: "run-start"; run: RunRecord }
  | { type: "run-complete"; run: RunRecord }
  | { type: "config-changed" };

export class SchedulerEngine extends EventEmitter {
  private tasks = new Map<string, cron.ScheduledTask | ReturnType<typeof setInterval>>();
  private _running = false;

  get running(): boolean {
    return this._running;
  }

  getWorkflows(): WorkflowEntry[] {
    return loadSchedules().workflows;
  }

  addWorkflow(entry: WorkflowEntry): void {
    const config = loadSchedules();
    config.workflows.push(entry);
    saveSchedules(config);
    if (this._running && entry.enabled) {
      this.scheduleOne(entry);
    }
    this.emit("change", { type: "config-changed" } satisfies SchedulerEvent);
  }

  removeWorkflow(id: string): void {
    this.stopOne(id);
    const config = loadSchedules();
    config.workflows = config.workflows.filter((w) => w.id !== id);
    saveSchedules(config);
    this.emit("change", { type: "config-changed" } satisfies SchedulerEvent);
  }

  updateWorkflow(id: string, patch: Partial<WorkflowEntry>): void {
    const config = loadSchedules();
    const idx = config.workflows.findIndex((w) => w.id === id);
    if (idx < 0) return;
    const old = config.workflows[idx];
    config.workflows[idx] = { ...old, ...patch };
    saveSchedules(config);

    // Reschedule
    this.stopOne(id);
    if (config.workflows[idx].enabled && this._running) {
      this.scheduleOne(config.workflows[idx]);
    }
    this.emit("change", { type: "config-changed" } satisfies SchedulerEvent);
  }

  toggleWorkflow(id: string): void {
    const config = loadSchedules();
    const wf = config.workflows.find((w) => w.id === id);
    if (!wf) return;
    this.updateWorkflow(id, { enabled: !wf.enabled });
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    for (const wf of this.getWorkflows()) {
      if (wf.enabled) this.scheduleOne(wf);
    }
  }

  stop(): void {
    this._running = false;
    for (const [id] of this.tasks) {
      this.stopOne(id);
    }
  }

  async runNow(workflowId: string): Promise<RunRecord> {
    const wf = this.getWorkflows().find((w) => w.id === workflowId);
    if (!wf) throw new Error(`Workflow ${workflowId} not found`);
    return this.executeWorkflow(wf, "manual");
  }

  // ── Internal ────────────────────────────────────────────────────

  private scheduleOne(wf: WorkflowEntry): void {
    const intervalMs = parseIntervalMs(wf.schedule);
    if (intervalMs) {
      const timer = setInterval(() => {
        this.executeWorkflow(wf, "schedule").catch(() => {});
      }, intervalMs);
      this.tasks.set(wf.id, timer);
    } else if (isCron(wf.schedule)) {
      const task = cron.schedule(wf.schedule, () => {
        this.executeWorkflow(wf, "schedule").catch(() => {});
      });
      this.tasks.set(wf.id, task);
    }
  }

  private stopOne(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (typeof task === "object" && "stop" in task) {
      (task as cron.ScheduledTask).stop();
    } else {
      clearInterval(task as ReturnType<typeof setInterval>);
    }
    this.tasks.delete(id);
  }

  private async executeWorkflow(
    wf: WorkflowEntry,
    triggeredBy: TriggerType,
  ): Promise<RunRecord> {
    const run: RunRecord = {
      id: randomUUID(),
      workflowId: wf.id,
      triggeredBy,
      triggeredAt: new Date().toISOString(),
      status: "running",
      input: {
        filePath: wf.filePath,
        args: wf.args,
        schedule: wf.schedule,
      },
    };

    appendRun(run);
    this.emit("change", { type: "run-start", run } satisfies SchedulerEvent);

    const startMs = Date.now();
    const mcpServers = loadMcpConfig({});
    const adapter = new CopilotAdapter({
      cliUrl: process.env.COPILOT_CLI_URL,
      mcpServers,
    });

    try {
      const { runToolRequest, createDefaultRegistry } = await import(
        "@basaba/lobster/core"
      );

      // Build extended registry with copilot + mcp commands
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

      const result = await runToolRequest({
        filePath: wf.filePath,
        ...(wf.args ? { args: wf.args } : {}),
        ctx: {
          llmAdapters: { copilot: adapter as any },
          registry,
          env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
        },
      });

      const durationMs = Date.now() - startMs;
      const output = result.ok
        ? (result.output ?? [])
            .map((item: unknown) =>
              typeof item === "string" ? item : JSON.stringify(item, null, 2),
            )
            .join("\n")
        : undefined;
      const error = result.ok ? undefined : result.error?.message ?? "Unknown error";

      const patch: Partial<RunRecord> = {
        completedAt: new Date().toISOString(),
        durationMs,
        status: result.ok ? "success" : "error",
        output,
        error,
      };

      updateRun(run.id, patch);
      const completed = { ...run, ...patch };
      this.emit("change", { type: "run-complete", run: completed } satisfies SchedulerEvent);
      return completed;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const patch: Partial<RunRecord> = {
        completedAt: new Date().toISOString(),
        durationMs,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      updateRun(run.id, patch);
      const completed = { ...run, ...patch };
      this.emit("change", { type: "run-complete", run: completed } satisfies SchedulerEvent);
      return completed;
    } finally {
      await adapter.dispose().catch(() => {});
    }
  }
}
