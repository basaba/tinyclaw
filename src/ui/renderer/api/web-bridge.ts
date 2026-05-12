/**
 * When running in a plain browser (no Electron preload), install a shim
 * that maps every TinyClawAPI method to fetch/WebSocket against the
 * built-in TinyClaw web server.
 *
 * No-op when running inside Electron (window.api already exists).
 */
import type { TinyClawAPI, DaemonEventKind } from "../types";

interface DebugReplCallbacks {
  ws: WebSocket;
  callbacks: Set<(data: string) => void>;
  sendQueue: string[];
}

export function installWebBridge(): void {
  if (typeof window === "undefined") return;
  // Electron preload sets window.api — leave it alone.
  if ((window as any).api) return;

  let eventSocket: WebSocket | null = null;
  const eventCallbacks = new Set<(event: DaemonEventKind) => void>();
  const changeCallbacks = new Set<() => void>();

  function ensureEventSocket(): WebSocket {
    if (eventSocket && eventSocket.readyState <= 1) return eventSocket;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === "event") {
          for (const cb of eventCallbacks) cb(parsed.event);
        } else if (parsed.type === "change") {
          for (const cb of changeCallbacks) cb();
        }
      } catch {/* ignore */}
    });
    ws.addEventListener("close", () => {
      eventSocket = null;
      // simple reconnect
      setTimeout(() => {
        if (eventCallbacks.size || changeCallbacks.size) ensureEventSocket();
      }, 1000);
    });
    eventSocket = ws;
    return ws;
  }

  async function call(method: string, ...args: unknown[]): Promise<any> {
    const res = await fetch(`/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} failed: ${res.status} ${text}`);
    }
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  // ── Debug REPL: one WS per ptyId ───────────────────────────────────
  let ptyCounter = 0;
  const ptyMap = new Map<number, DebugReplCallbacks>();

  const api: TinyClawAPI = {
    getStatus: () => call("getStatus"),
    getWorkflows: () => call("getWorkflows"),
    addWorkflow: (wf) => call("addWorkflow", wf),
    removeWorkflow: (id) => call("removeWorkflow", id),
    toggleWorkflow: (id) => call("toggleWorkflow", id),
    updateWorkflow: (id, patch) => call("updateWorkflow", id, patch),
    runNow: (id) => call("runNow", id),
    getHistory: (wfId) => call("getHistory", wfId),
    getRun: (runId) => call("getRun", runId),
    deleteRun: (runId) => call("deleteRun", runId),
    clearHistory: (wfId) => call("clearHistory", wfId),
    listApprovals: () => call("listApprovals"),
    resolveApproval: (runId, approved) => call("resolveApproval", runId, approved),
    readFile: (fp) => call("readFile", fp),
    writeFile: (fp, content) => call("writeFile", fp, content),
    pickFile: async () => {
      // Browser cannot show a native dialog. The renderer is expected
      // to use the wrapper in `picker.ts` which renders a directory
      // browser modal — but if anything still calls window.api.pickFile
      // directly we resolve to null.
      console.warn("window.api.pickFile() called in browser; returning null. Use the picker wrapper.");
      return null;
    },

    onEvent: (cb) => {
      eventCallbacks.add(cb);
      ensureEventSocket();
      return () => { eventCallbacks.delete(cb); };
    },
    onChange: (cb) => {
      changeCallbacks.add(cb);
      ensureEventSocket();
      return () => { changeCallbacks.delete(cb); };
    },

    openDebugRepl: async (_snapshotPath: string, runId?: string) => {
      if (!runId) throw new Error("Web mode requires runId for debug REPL");
      const ptyId = ++ptyCounter;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/pty?runId=${encodeURIComponent(runId)}`);
      ws.binaryType = "arraybuffer";
      const decoder = new TextDecoder("utf-8");
      const callbacks = new Set<(data: string) => void>();
      const sendQueue: string[] = [];
      ws.addEventListener("open", () => {
        for (const m of sendQueue) ws.send(m);
        sendQueue.length = 0;
      });
      ws.addEventListener("message", (msg) => {
        let text = "";
        if (typeof msg.data === "string") text = msg.data;
        else if (msg.data instanceof ArrayBuffer) text = decoder.decode(msg.data);
        for (const cb of callbacks) cb(text);
      });
      ws.addEventListener("close", () => {
        for (const cb of callbacks) cb("\r\n[Connection closed]\r\n");
      });
      ptyMap.set(ptyId, { ws, callbacks, sendQueue });
      return ptyId;
    },
    writeDebugRepl: (ptyId, data) => {
      const e = ptyMap.get(ptyId);
      if (!e) return;
      if (e.ws.readyState === WebSocket.OPEN) e.ws.send(data);
      else if (e.ws.readyState === WebSocket.CONNECTING) e.sendQueue.push(data);
    },
    onDebugReplData: (ptyId, cb) => {
      const e = ptyMap.get(ptyId);
      if (!e) return () => {};
      e.callbacks.add(cb);
      return () => { e.callbacks.delete(cb); };
    },
    closeDebugRepl: (ptyId) => {
      const e = ptyMap.get(ptyId);
      if (e) { try { e.ws.close(); } catch {} ptyMap.delete(ptyId); }
    },
  };

  (window as any).api = api;
}
