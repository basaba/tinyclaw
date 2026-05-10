import React, { useState, useEffect } from "react";
import type { RunRecord } from "../types";

const PAGE_SIZE = 15;

interface Props {
  workflowId: string;
  workflowName?: string;
  onBack: () => void;
  onSelectRun: (run: RunRecord) => void;
}

function statusBadge(status: RunRecord["status"]) {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: "badge badge-success", label: "Success" },
    error: { cls: "badge badge-error", label: "Error" },
    running: { cls: "badge badge-running", label: "Running" },
    "pending-approval": { cls: "badge badge-pending", label: "Pending" },
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function RunHistory({ workflowId, workflowName, onBack, onSelectRun }: Props) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.api.getHistory(workflowId).then((r) => {
      setRuns(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [workflowId]);

  const totalPages = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const pageRuns = runs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back to Workflows</button>
      <div className="toolbar">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Run History{workflowName ? ` — ${workflowName}` : ""}
        </h2>
        <div className="spacer" />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 20 }}>Loading...</div>
      ) : runs.length === 0 ? (
        <div className="empty-state">
          <span className="icon">📋</span>
          <span className="message">No runs yet</span>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Debug</th>
              </tr>
            </thead>
            <tbody>
              {pageRuns.map((run, i) => (
                <tr
                  key={run.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectRun(run)}
                >
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                    {runs.length - (page * PAGE_SIZE + i)}
                  </td>
                  <td>{statusBadge(run.status)}</td>
                  <td style={{ fontSize: 13 }}>{run.triggeredBy}</td>
                  <td style={{ fontSize: 13 }}>{formatTime(run.triggeredAt)}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {formatDuration(run.durationMs)}
                  </td>
                  <td>{run.debugSnapshotPath ? "🔍" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ← Prev
              </button>
              <span className="page-info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
