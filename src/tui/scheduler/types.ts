export interface WorkflowEntry {
  id: string;
  name: string;
  filePath: string;
  schedule: string; // cron expression or "every Xm/h/s"
  enabled: boolean;
  args?: Record<string, unknown>;
}

export interface ScheduleConfig {
  workflows: WorkflowEntry[];
}

export type TriggerType = "schedule" | "manual";

export interface ApprovalInfo {
  prompt: string;
  items: unknown[];
  preview?: string;
  resumeToken: string;
  approvalId: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  triggeredBy: TriggerType;
  triggeredAt: string; // ISO timestamp
  completedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error" | "pending-approval" | "rejected";
  input: {
    filePath: string;
    args?: Record<string, unknown>;
    schedule: string;
  };
  output?: string;
  logs?: string;
  error?: string;
  approvalInfo?: ApprovalInfo;
}

export interface RunHistory {
  runs: RunRecord[];
}

export type View =
  | { screen: "list" }
  | { screen: "add" }
  | { screen: "edit"; workflowId: string }
  | { screen: "history"; workflowId: string }
  | { screen: "run-detail"; run: RunRecord; fromWorkflowId?: string }
  | { screen: "yaml-view"; filePath: string }
  | { screen: "graph-view"; filePath: string };
