import React, { useState, useEffect } from "react";
import type { RunRecord } from "../types";
import { DebugRepl } from "./DebugRepl";
import { FileEditorModal } from "./FileEditorModal";

interface Props {
  run: RunRecord;
  liveOutput: Map<string, string>;
  onBack: () => void;
  onOpenFile: (filePath: string) => void;
}

function statusBadge(status: RunRecord["status"]) {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: "badge badge-success", label: "Success" },
    error: { cls: "badge badge-error", label: "Error" },
    running: { cls: "badge badge-running", label: "Running" },
    "pending-approval": { cls: "badge badge-pending", label: "Pending Approval" },
    rejected: { cls: "badge badge-error", label: "Rejected" },
  };
  const b = map[status] || { cls: "badge", label: status };
  return <span className={b.cls}>{b.label}</span>;
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function RunDetail({ run: initialRun, liveOutput, onBack, onOpenFile }: Props) {
  const [run, setRun] = useState(initialRun);
  const [activeTab, setActiveTab] = useState<"details" | "output" | "logs" | "debug">("details");
  const [showDebug, setShowDebug] = useState(false);
  const [fileEditorPath, setFileEditorPath] = useState<string | null>(null);

  // Refresh run data periodically if running
  useEffect(() => {
    if (run.status !== "running") return;
    const interval = setInterval(async () => {
      const updated = await window.api.getRun(run.id);
      if (updated) setRun(updated);
    }, 2000);
    return () => clearInterval(interval);
  }, [run.id, run.status]);

  const output = run.output || liveOutput.get(run.id) || "";
  const logs = run.logs || "";

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back to History</button>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Run Detail</span>
          {statusBadge(run.status)}
        </div>

        <div className="detail-grid">
          <span className="detail-label">Run ID</span>
          <span className="detail-value" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {run.id}
          </span>

          <span className="detail-label">Trigger</span>
          <span className="detail-value">{run.triggeredBy}</span>

          <span className="detail-label">Started</span>
          <span className="detail-value">{new Date(run.triggeredAt).toLocaleString()}</span>

          {run.completedAt && (
            <>
              <span className="detail-label">Completed</span>
              <span className="detail-value">{new Date(run.completedAt).toLocaleString()}</span>
            </>
          )}

          <span className="detail-label">Duration</span>
          <span className="detail-value">{formatDuration(run.durationMs)}</span>

          <span className="detail-label">File</span>
          <span className="detail-value">
            <button
              className="back-link"
              style={{ margin: 0, fontSize: 13 }}
              onClick={() => setFileEditorPath(run.input.filePath)}
              title="View / edit the workflow file"
            >
              {run.input.filePath}
            </button>
          </span>

          {run.debugSnapshotPath && (
            <>
              <span className="detail-label">Debug Snapshot</span>
              <span className="detail-value" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {run.debugSnapshotPath}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "details" ? "active" : ""}`}
          onClick={() => setActiveTab("details")}
        >
          Details
        </button>
        <button
          className={`tab ${activeTab === "output" ? "active" : ""}`}
          onClick={() => setActiveTab("output")}
        >
          Output
        </button>
        <button
          className={`tab ${activeTab === "logs" ? "active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Logs
        </button>
        {run.debugSnapshotPath && (
          <button
            className={`tab ${activeTab === "debug" ? "active" : ""}`}
            onClick={() => { setActiveTab("debug"); setShowDebug(true); }}
          >
            🔍 Debug REPL
          </button>
        )}
      </div>

      {activeTab === "details" && (
        <div className="card">
          {run.error && (
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--error)", marginBottom: 8 }}>Error</h3>
              <pre className="code-block" style={{ color: "var(--error)" }}>{run.error}</pre>
            </div>
          )}
          {run.args && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Arguments</h3>
              <pre className="code-block">{JSON.stringify(run.input.args, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {activeTab === "output" && (
        <pre className="code-block">{output || "(no output)"}</pre>
      )}

      {activeTab === "logs" && (
        <pre className="code-block">{logs || "(no logs)"}</pre>
      )}

      {activeTab === "debug" && run.debugSnapshotPath && showDebug && (
        <DebugRepl snapshotPath={run.debugSnapshotPath} runId={run.id} />
      )}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button
          className="btn btn-danger btn-sm"
          onClick={async () => {
            if (confirm("Delete this run?")) {
              await window.api.deleteRun(run.id);
              onBack();
            }
          }}
        >
          🗑 Delete Run
        </button>
      </div>

      {fileEditorPath && (
        <FileEditorModal
          filePath={fileEditorPath}
          onClose={() => setFileEditorPath(null)}
        />
      )}
    </div>
  );
}
