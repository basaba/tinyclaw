/**
 * TinyClaw web server — serves the React renderer over HTTP and bridges
 * daemon calls + events for browsers (so the UI can be used remotely
 * via SSH port-forwarding).
 *
 * Routes:
 *   GET  /                    -> dist/ui/renderer/index.html
 *   GET  /assets/*            -> static files
 *   POST /api/<method>        -> DaemonClient method (body = JSON args array)
 *   POST /api/read-file       -> { filePath } -> string
 *   POST /api/write-file      -> { filePath, content }
 *   POST /api/list-dir        -> { dirPath } -> { entries, parent, cwd }
 *   POST /api/home-dir        -> {} -> { home }
 *   WS   /ws                  -> { type:"event"|"change", event? }
 *   WS   /pty?runId=<id>      -> bidirectional debug REPL stream
 */
import http from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, extname, dirname, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { connectToDaemon } from "../shared/daemon.js";
import type { DaemonClient } from "../../tui/scheduler/daemon-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATIC_ROOT = pathResolve(__dirname, "..", "renderer");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface WebServerOptions {
  port?: number;
  host?: string;
}

export async function startWebServer(opts: WebServerOptions = {}): Promise<http.Server> {
  const port = opts.port ?? 7777;
  const host = opts.host ?? "127.0.0.1";

  const client = await connectToDaemon();

  const server = http.createServer(async (req, res) => {
    try {
      await handleHttp(req, res, client);
    } catch (err: any) {
      sendJson(res, 500, { error: err?.message ?? String(err) });
    }
  });

  // ── WebSocket: events ─────────────────────────────────────────────
  const wssEvents = new WebSocketServer({ noServer: true });
  wssEvents.on("connection", (ws) => {
    const onEvent = (event: any) => safeSend(ws, { type: "event", event });
    const onChange = () => safeSend(ws, { type: "change" });
    client.on("event", onEvent);
    client.on("change", onChange);
    ws.on("close", () => {
      client.off("event", onEvent);
      client.off("change", onChange);
    });
  });

  // ── WebSocket: PTY (debug REPL) ───────────────────────────────────
  const wssPty = new WebSocketServer({ noServer: true });
  wssPty.on("connection", async (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const runId = url.searchParams.get("runId");
    if (!runId) {
      ws.close(1008, "missing runId");
      return;
    }

    let snapshotPath: string | undefined;
    try {
      const run = await client.getRun(runId);
      snapshotPath = run?.debugSnapshotPath;
    } catch (err) {
      ws.close(1011, "failed to look up run");
      return;
    }
    if (!snapshotPath) {
      ws.close(1008, "run has no debug snapshot");
      return;
    }

    const tinyClawBin = process.platform === "win32" ? "tinyclaw.cmd" : "tinyclaw";
    const child = spawn(tinyClawBin, ["debug", snapshotPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    child.stdout?.on("data", (data: Buffer) => safeSend(ws, data.toString()));
    child.stderr?.on("data", (data: Buffer) => safeSend(ws, data.toString()));
    child.on("exit", () => {
      safeSend(ws, "\r\n[Process exited]\r\n");
      try { ws.close(); } catch {}
    });

    ws.on("message", (msg) => {
      try { child.stdin?.write(typeof msg === "string" ? msg : msg.toString()); } catch {}
    });
    ws.on("close", () => {
      try { child.kill(); } catch {}
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ws") {
      wssEvents.handleUpgrade(req, socket, head, (ws) => wssEvents.emit("connection", ws, req));
    } else if (url.pathname === "/pty") {
      wssPty.handleUpgrade(req, socket, head, (ws) => wssPty.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  return new Promise((resolveServer) => {
    server.listen(port, host, () => {
      console.error(`TinyClaw web UI listening on http://${host}:${port}`);
      console.error(`(Bind: ${host} — for remote access use:  ssh -L ${port}:localhost:${port} <host>)`);
      resolveServer(server);
    });
  });
}

// ── HTTP request handling ───────────────────────────────────────────

async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  client: DaemonClient,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    const method = url.pathname.slice("/api/".length);
    const body = await readBody(req);
    const args = body ? JSON.parse(body) : [];
    const result = await invokeApi(client, method, Array.isArray(args) ? args : [args]);
    sendJson(res, 200, { result });
    return;
  }

  if (req.method === "GET") {
    await serveStatic(url.pathname, res);
    return;
  }

  res.writeHead(404).end();
}

async function invokeApi(client: DaemonClient, method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "getStatus":       return client.getStatus();
    case "getWorkflows":    return client.getWorkflows();
    case "addWorkflow":     return client.addWorkflow(args[0] as any);
    case "removeWorkflow":  return client.removeWorkflow(args[0] as string);
    case "toggleWorkflow":  return client.toggleWorkflow(args[0] as string);
    case "updateWorkflow":  return client.updateWorkflow(args[0] as string, args[1] as any);
    case "runNow":          return client.runNow(args[0] as string);
    case "getHistory":      return client.getHistory(args[0] as string);
    case "getRun":          return client.getRun(args[0] as string);
    case "deleteRun":       return client.deleteRun(args[0] as string);
    case "clearHistory":    return client.clearHistory(args[0] as string);
    case "listApprovals":   return client.listApprovals();
    case "resolveApproval": return client.resolveApproval(args[0] as string, args[1] as boolean);

    case "readFile":        return readFile(args[0] as string, "utf-8");
    case "writeFile": {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args[0] as string, args[1] as string, "utf-8");
      return null;
    }
    case "listDir":         return listDir((args[0] as { dirPath?: string })?.dirPath);
    case "homeDir":         return { home: homedir() };
    default:
      throw new Error(`Unknown API method: ${method}`);
  }
}

async function listDir(dirPath?: string): Promise<{
  cwd: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; isDirectory: boolean }>;
}> {
  const cwd = dirPath ? pathResolve(dirPath) : homedir();
  const items = await readdir(cwd, { withFileTypes: true });
  const entries = items
    .filter((i) => !i.name.startsWith("."))
    .map((i) => ({
      name: i.name,
      path: join(cwd, i.name),
      isDirectory: i.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const parent = dirname(cwd);
  return { cwd, parent: parent === cwd ? null : parent, entries };
}

// ── Static files ────────────────────────────────────────────────────

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  // prevent directory traversal
  const fullPath = pathResolve(STATIC_ROOT, "." + filePath);
  if (!fullPath.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(fullPath);
    const mime = MIME[extname(fullPath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    // SPA fallback to index.html for non-asset paths
    if (!pathname.startsWith("/assets/") && !extname(pathname)) {
      try {
        const data = await readFile(join(STATIC_ROOT, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
        return;
      } catch {
        // fall through
      }
    }
    res.writeHead(404).end();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rejectBody);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function safeSend(ws: WebSocket, msg: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}
