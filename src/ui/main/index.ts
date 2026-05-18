/**
 * Electron main process — manages BrowserWindow, reuses the existing
 * TinyClaw DaemonClient, and exposes IPC handlers for the renderer.
 */
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "../../tui/scheduler/daemon-client.js";
import { connectToDaemon } from "../shared/daemon.js";
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
  try {
    client = await connectToDaemon();
  } catch (err: any) {
    console.error(err.message ?? String(err));
    return;
  }

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
  ipcMain.handle("write-file", async (_, filePath: string, content: string) => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(filePath, content, "utf-8");
  });
  ipcMain.handle("pick-file", async (_, options?: { defaultPath?: string }) => {
    if (!mainWindow) return null;
    let defaultPath = options?.defaultPath;
    if (defaultPath) {
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      try {
        const stat = await fs.stat(defaultPath);
        if (stat.isFile()) defaultPath = path.dirname(defaultPath);
      } catch {
        defaultPath = undefined;
      }
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      defaultPath,
      filters: [
        { name: "Workflow", extensions: ["yaml", "yml"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("list-dir", async (_, dirPath?: string) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const cwd = dirPath ? path.resolve(dirPath) : os.homedir();
    const items = await fs.readdir(cwd, { withFileTypes: true });
    const entries = items
      .filter((i) => !i.name.startsWith("."))
      .map((i) => ({
        name: i.name,
        path: path.join(cwd, i.name),
        isDirectory: i.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const parent = path.dirname(cwd);
    return { cwd, parent: parent === cwd ? null : parent, entries };
  });
  ipcMain.handle("home-dir", async () => {
    const os = await import("node:os");
    return { home: os.homedir() };
  });

  // Debug REPL — spawn child process
  let ptyCounter = 0;
  const ptyProcesses = new Map<number, import("node:child_process").ChildProcess>();

  ipcMain.handle("open-debug-repl", async (_, snapshotPath: string) => {
    const { spawn } = await import("node:child_process");
    const ptyId = ++ptyCounter;

    // Run the bundled CLI directly via the current binary.
    // In Electron, ELECTRON_RUN_AS_NODE makes process.execPath behave as Node.
    const cliPath = join(__dirname, "..", "..", "cli.js");
    const child = spawn(process.execPath, [cliPath, "debug", snapshotPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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
