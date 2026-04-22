/**
 * Client that connects to the scheduler daemon via Unix socket.
 * Provides the same API surface as SchedulerEngine so the TUI
 * can use either one transparently.
 */
import net from "node:net";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import type { WorkflowEntry, RunRecord } from "./types.js";
import {
  SOCKET_PATH,
  PID_FILE,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

export class DaemonClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = "";
  private pending: Array<(resp: DaemonResponse) => void> = [];
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  // ── Connection ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        this._connected = true;
        resolve();
      });

      sock.on("data", (chunk) => {
        this.buffer += chunk.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as DaemonResponse;
            if (msg.type === "event") {
              // Push event — emit for TUI to react
              this.emit("event", msg.event);
              // Skip generic refresh for high-frequency run-output events
              if ((msg.event as any).kind !== "run-output") {
                this.emit("change"); // generic refresh trigger
              }
            } else {
              // Response to a pending request
              const cb = this.pending.shift();
              if (cb) cb(msg);
            }
          } catch {}
        }
      });

      sock.on("close", () => {
        this._connected = false;
        this.emit("disconnected");
      });

      sock.on("error", (err) => {
        this._connected = false;
        reject(err);
      });

      this.socket = sock;
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
    this._connected = false;
  }

  // ── Send request and wait for response ────────────────────────

  private send(req: DaemonRequest): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this._connected) {
        reject(new Error("Not connected to daemon"));
        return;
      }
      this.pending.push(resolve);
      this.socket.write(JSON.stringify(req) + "\n");
    });
  }

  // ── High-level API (mirrors SchedulerEngine) ──────────────────

  async getStatus(): Promise<{
    running: boolean;
    pid: number;
    workflows: WorkflowEntry[];
  }> {
    const resp = await this.send({ cmd: "status" });
    if (resp.type === "status") return resp;
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }

  async getWorkflows(): Promise<WorkflowEntry[]> {
    const resp = await this.send({ cmd: "list-workflows" });
    if (resp.type === "workflows") return resp.workflows;
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }

  async addWorkflow(entry: WorkflowEntry): Promise<void> {
    const resp = await this.send({ cmd: "add-workflow", workflow: entry });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async removeWorkflow(id: string): Promise<void> {
    const resp = await this.send({ cmd: "remove-workflow", id });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async toggleWorkflow(id: string): Promise<void> {
    const resp = await this.send({ cmd: "toggle-workflow", id });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async updateWorkflow(id: string, patch: Partial<WorkflowEntry>): Promise<void> {
    const resp = await this.send({ cmd: "update-workflow", id, patch });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async runNow(id: string): Promise<void> {
    const resp = await this.send({ cmd: "run-now", id });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async getHistory(workflowId: string): Promise<RunRecord[]> {
    const resp = await this.send({ cmd: "get-history", workflowId });
    if (resp.type === "history") return resp.runs;
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }

  async listApprovals(): Promise<RunRecord[]> {
    const resp = await this.send({ cmd: "list-approvals" });
    if (resp.type === "approvals") return resp.runs;
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }

  async resolveApproval(runId: string, approved: boolean): Promise<void> {
    const resp = await this.send({ cmd: "resolve-approval", runId, approved });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async deleteRun(runId: string): Promise<void> {
    const resp = await this.send({ cmd: "delete-run", runId });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const resp = await this.send({ cmd: "get-run", runId });
    if (resp.type === "run") return resp.run;
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }

  async clearHistory(workflowId: string): Promise<void> {
    const resp = await this.send({ cmd: "clear-history", workflowId });
    if (resp.type === "error") throw new Error(resp.message);
  }

  async stopDaemon(): Promise<void> {
    try {
      await this.send({ cmd: "stop-daemon" });
    } catch {
      // Daemon closes connection on shutdown — that's expected
    }
  }

  // ── Static helpers ────────────────────────────────────────────

  static isDaemonRunning(): boolean {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      process.kill(pid, 0); // Check if process exists (signal 0)
      return true;
    } catch {
      return false;
    }
  }

  static getDaemonPid(): number | null {
    try {
      return parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    } catch {
      return null;
    }
  }
}
