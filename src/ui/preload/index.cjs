/**
 * Preload script — exposes the TinyClaw API to the renderer via contextBridge.
 * This file is plain CommonJS because Electron preload scripts don't support ESM.
 */
const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getStatus: () => ipcRenderer.invoke("get-status"),
  getWorkflows: () => ipcRenderer.invoke("get-workflows"),
  addWorkflow: (wf) => ipcRenderer.invoke("add-workflow", wf),
  removeWorkflow: (id) => ipcRenderer.invoke("remove-workflow", id),
  toggleWorkflow: (id) => ipcRenderer.invoke("toggle-workflow", id),
  updateWorkflow: (id, patch) => ipcRenderer.invoke("update-workflow", id, patch),
  runNow: (id) => ipcRenderer.invoke("run-now", id),
  getHistory: (wfId) => ipcRenderer.invoke("get-history", wfId),
  getRun: (runId) => ipcRenderer.invoke("get-run", runId),
  deleteRun: (runId) => ipcRenderer.invoke("delete-run", runId),
  clearHistory: (wfId) => ipcRenderer.invoke("clear-history", wfId),
  listApprovals: () => ipcRenderer.invoke("list-approvals"),
  resolveApproval: (runId, approved) => ipcRenderer.invoke("resolve-approval", runId, approved),
  readFile: (fp) => ipcRenderer.invoke("read-file", fp),
  writeFile: (fp, content) => ipcRenderer.invoke("write-file", fp, content),
  pickFile: (opts) => ipcRenderer.invoke("pick-file", opts),
  listDir: (dirPath) => ipcRenderer.invoke("list-dir", dirPath),
  homeDir: () => ipcRenderer.invoke("home-dir"),

  onEvent: (cb) => {
    const handler = (_, event) => cb(event);
    ipcRenderer.on("daemon-event", handler);
    return () => ipcRenderer.removeListener("daemon-event", handler);
  },
  onChange: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("daemon-change", handler);
    return () => ipcRenderer.removeListener("daemon-change", handler);
  },

  openDebugRepl: (path, runId) => ipcRenderer.invoke("open-debug-repl", path, runId),
  writeDebugRepl: (id, data) => ipcRenderer.send("write-debug-repl", id, data),
  onDebugReplData: (id, cb) => {
    const ch = `pty-data-${id}`;
    const handler = (_, data) => cb(data);
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
  closeDebugRepl: (id) => ipcRenderer.send("close-debug-repl", id),
};

contextBridge.exposeInMainWorld("api", api);
