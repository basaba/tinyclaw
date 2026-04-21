#!/usr/bin/env node
/**
 * Daemon process — runs the scheduler engine and exposes a Unix socket
 * for TUI clients to connect, send commands, and receive push events.
 *
 * Usage:
 *   lobster-copilot daemon start   — start in background
 *   lobster-copilot daemon stop    — stop running daemon
 *   lobster-copilot daemon status  — check if daemon is running
 */
import net from "node:net";
import fs from "node:fs";
import { SchedulerEngine } from "./engine.js";
import { getRunsForWorkflow } from "./config.js";
import {
  SOCKET_PATH,
  PID_FILE,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonEvent,
} from "./protocol.js";

const engine = new SchedulerEngine();
const clients = new Set<net.Socket>();

function broadcast(msg: DaemonResponse): void {
  const line = JSON.stringify(msg) + "\n";
  for (const sock of clients) {
    try {
      sock.write(line);
    } catch {
      clients.delete(sock);
    }
  }
}

function handleRequest(req: DaemonRequest): DaemonResponse | Promise<DaemonResponse> {
  switch (req.cmd) {
    case "status":
      return {
        type: "status",
        running: engine.running,
        pid: process.pid,
        workflows: engine.getWorkflows(),
      };

    case "list-workflows":
      return { type: "workflows", workflows: engine.getWorkflows() };

    case "add-workflow":
      engine.addWorkflow(req.workflow);
      return { type: "ok", message: "added" };

    case "remove-workflow":
      engine.removeWorkflow(req.id);
      return { type: "ok", message: "removed" };

    case "toggle-workflow":
      engine.toggleWorkflow(req.id);
      return { type: "ok", message: "toggled" };

    case "update-workflow":
      engine.updateWorkflow(req.id, req.patch);
      return { type: "ok", message: "updated" };

    case "run-now":
      engine.runNow(req.id).catch(() => {});
      return { type: "ok", message: "triggered" };

    case "get-history":
      return { type: "history", runs: getRunsForWorkflow(req.workflowId) };

    case "list-approvals":
      return { type: "approvals", runs: engine.listPendingApprovals() };

    case "resolve-approval":
      // Fire-and-forget — result comes via events
      engine.resolveApproval(req.runId, req.approved).catch(() => {});
      return { type: "ok", message: req.approved ? "approving" : "rejecting" };

    case "stop-daemon":
      cleanup();
      process.exit(0);

    default:
      return { type: "error", message: `Unknown command: ${(req as any).cmd}` };
  }
}

// ── Socket server ───────────────────────────────────────────────────

const server = net.createServer((socket) => {
  clients.add(socket);
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as DaemonRequest;
        const result = handleRequest(req);
        Promise.resolve(result).then((resp) => {
          socket.write(JSON.stringify(resp) + "\n");
        }).catch((err) => {
          socket.write(
            JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            } satisfies DaemonResponse) + "\n",
          );
        });
      } catch (err) {
        socket.write(
          JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          } satisfies DaemonResponse) + "\n",
        );
      }
    }
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

// Forward engine events to all connected TUI clients
engine.on("change", (evt: { type: string; run?: any }) => {
  const event: DaemonEvent =
    evt.type === "run-start"
      ? { kind: "run-start", run: evt.run }
      : evt.type === "run-complete"
        ? { kind: "run-complete", run: evt.run }
        : evt.type === "approval-pending"
          ? { kind: "approval-pending", run: evt.run }
          : { kind: "config-changed" };

  broadcast({ type: "event", event });
});

// ── Lifecycle ───────────────────────────────────────────────────────

function cleanup(): void {
  engine.stop();
  server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

export function startDaemon(): void {
  // Remove stale socket
  try { fs.unlinkSync(SOCKET_PATH); } catch {}

  server.listen(SOCKET_PATH, () => {
    // Write PID file
    const dir = SOCKET_PATH.replace(/\/[^/]+$/, "");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");

    engine.start();
    process.stderr.write(
      `🦞 Daemon started (pid ${process.pid}), socket: ${SOCKET_PATH}\n`,
    );
  });

  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
}

// If run directly (not imported)
const isMainModule =
  process.argv[1]?.endsWith("daemon.js") ||
  process.argv[1]?.endsWith("daemon.ts");
if (isMainModule) {
  startDaemon();
}
