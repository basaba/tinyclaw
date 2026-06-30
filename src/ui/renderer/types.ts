/**
 * Types used by the renderer — mirrors the scheduler types.
 * These are duplicated here because the renderer is bundled by Vite
 * and cannot import from Node.js modules at runtime.
 * Types are compile-time only and have zero runtime cost.
 */

export interface WorkflowEntry {
  id: string;
  name: string;
  filePath: string;
  schedule: string;
  enabled: boolean;
  args?: Record<string, unknown>;
  debug?: boolean;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  triggeredBy: "schedule" | "manual";
  triggeredAt: string;
  completedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error" | "pending-approval" | "rejected";
  dryRun?: boolean;
  input: {
    filePath: string;
    args?: Record<string, unknown>;
    schedule: string;
  };
  output?: string;
  logs?: string;
  error?: string;
  debugSnapshotPath?: string;
}

export interface DaemonEventKind {
  kind: string;
  runId?: string;
  text?: string;
  run?: RunRecord;
  [key: string]: unknown;
}

export interface TinyClawAPI {
  getStatus(): Promise<{ running: boolean; pid: number; workflows: WorkflowEntry[] }>;
  getWorkflows(): Promise<WorkflowEntry[]>;
  addWorkflow(workflow: WorkflowEntry): Promise<void>;
  removeWorkflow(id: string): Promise<void>;
  toggleWorkflow(id: string): Promise<void>;
  updateWorkflow(id: string, patch: Partial<WorkflowEntry>): Promise<void>;
  runNow(id: string, dryRun?: boolean): Promise<void>;
  getHistory(workflowId: string): Promise<RunRecord[]>;
  getRun(runId: string): Promise<RunRecord | null>;
  deleteRun(runId: string): Promise<void>;
  clearHistory(workflowId: string): Promise<void>;
  listApprovals(): Promise<RunRecord[]>;
  resolveApproval(runId: string, approved: boolean): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  pickFile(options?: { defaultPath?: string }): Promise<string | null>;
  listDir(dirPath?: string): Promise<{
    cwd: string;
    parent: string | null;
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  }>;
  homeDir(): Promise<{ home: string }>;
  onEvent(callback: (event: DaemonEventKind) => void): () => void;
  onChange(callback: () => void): () => void;
  openDebugRepl(snapshotPath: string, runId?: string): Promise<number>;
  writeDebugRepl(ptyId: number, data: string): void;
  onDebugReplData(ptyId: number, callback: (data: string) => void): () => void;
  closeDebugRepl(ptyId: number): void;
}

declare global {
  interface Window {
    api: TinyClawAPI;
  }
}
