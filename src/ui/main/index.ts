/**
 * Electron main process — manages BrowserWindow, reuses the existing
 * TinyClaw DaemonClient, and exposes IPC handlers for the renderer.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "../../tui/scheduler/daemon-client.js";
import { spawnDaemon } from "../../tui/scheduler/spawn.js";
import type { WorkflowEntry } from "../../tui/scheduler/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let client: DaemonClient | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "🦞 TinyClaw",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererPath = join(__dirname, "..", "renderer", "index.html");

  // In dev, use Vite dev server if VITE_DEV_SERVER is set
  if (!app.isPackaged && process.env.VITE_DEV_SERVER) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER);
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  } else {
    await mainWindow.loadFile(rendererPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function connectDaemon(): Promise<void> {
  client = new DaemonClient();

  // Spawn daemon if not running
  if (!DaemonClient.isDaemonRunning()) {
    console.error("Daemon not running, starting…");
    const pid = spawnDaemon();
    if (pid) console.error(`Daemon started (pid ${pid}).`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Retry connection
  let connected = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await client.connect();
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!connected) {
    console.error("Cannot connect to daemon after multiple attempts.");
    return;
  }

  console.error("Connected to TinyClaw daemon");

  // Forward daemon events to renderer
  client.on("event", (event: any) => {
    mainWindow?.webContents.send("daemon-event", event);
  });

  client.on("change", () => {
    mainWindow?.webContents.send("daemon-change");
  });
}

function registerIpcHandlers(): void {
  const d = () => {
    if (!client?.connected) throw new Error("Not connected to daemon");
    return client;
  };

  ipcMain.handle("get-status", () => d().getStatus());
  ipcMain.handle("get-workflows", () => d().getWorkflows());
  ipcMain.handle("add-workflow", (_, workflow: WorkflowEntry) => d().addWorkflow(workflow));
  ipcMain.handle("remove-workflow", (_, id: string) => d().removeWorkflow(id));
  ipcMain.handle("toggle-workflow", (_, id: string) => d().toggleWorkflow(id));
  ipcMain.handle("update-workflow", (_, id: string, patch: Partial<WorkflowEntry>) =>
    d().updateWorkflow(id, patch));
  ipcMain.handle("run-now", (_, id: string) => d().runNow(id));
  ipcMain.handle("get-history", (_, workflowId: string) => d().getHistory(workflowId));
  ipcMain.handle("get-run", (_, runId: string) => d().getRun(runId));
  ipcMain.handle("delete-run", (_, runId: string) => d().deleteRun(runId));
  ipcMain.handle("clear-history", (_, workflowId: string) => d().clearHistory(workflowId));
  ipcMain.handle("list-approvals", () => d().listApprovals());
  ipcMain.handle("resolve-approval", (_, runId: string, approved: boolean) =>
    d().resolveApproval(runId, approved));
  ipcMain.handle("read-file", async (_, filePath: string) => {
    const fs = await import("node:fs/promises");
    return fs.readFile(filePath, "utf-8");
  });

  // Debug REPL — spawn child process
  let ptyCounter = 0;
  const ptyProcesses = new Map<number, import("node:child_process").ChildProcess>();

  ipcMain.handle("open-debug-repl", async (_, snapshotPath: string) => {
    const { spawn } = await import("node:child_process");
    const ptyId = ++ptyCounter;

    // Use the current node + tinyclaw CLI
    const tinyClawBin = process.platform === "win32" ? "tinyclaw.cmd" : "tinyclaw";
    const child = spawn(tinyClawBin, ["debug", snapshotPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    ptyProcesses.set(ptyId, child);

    child.stdout?.on("data", (data: Buffer) => {
      mainWindow?.webContents.send(`pty-data-${ptyId}`, data.toString());
    });
    child.stderr?.on("data", (data: Buffer) => {
      mainWindow?.webContents.send(`pty-data-${ptyId}`, data.toString());
    });
    child.on("exit", () => {
      mainWindow?.webContents.send(`pty-data-${ptyId}`, "\r\n[Process exited]\r\n");
      ptyProcesses.delete(ptyId);
    });

    return ptyId;
  });

  ipcMain.on("write-debug-repl", (_, ptyId: number, data: string) => {
    ptyProcesses.get(ptyId)?.stdin?.write(data);
  });

  ipcMain.on("close-debug-repl", (_, ptyId: number) => {
    ptyProcesses.get(ptyId)?.kill();
    ptyProcesses.delete(ptyId);
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await connectDaemon();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  client?.disconnect();
  if (process.platform !== "darwin") app.quit();
});
