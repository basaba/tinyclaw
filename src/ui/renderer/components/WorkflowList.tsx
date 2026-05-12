import React, { useState, useEffect, useRef } from "react";
import type { WorkflowEntry, RunRecord } from "../types";
import { formatScheduleDisplay } from "../utils/schedule";

interface Props {
  workflows: WorkflowEntry[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onHistory: (id: string) => void;
  onRunNow: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onViewYaml: (filePath: string) => void;
  onViewGraph: (filePath: string) => void;
  onSelectRun?: (run: RunRecord, fromWorkflowId: string) => void;
  refreshSignal?: unknown;
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

const STATUS_LABEL: Record<RunRecord["status"], string> = {
  success: "Success",
  error: "Failed",
  rejected: "Rejected",
  "pending-approval": "Approval",
  running: "Running",
};

const STATUS_CLASS: Record<RunRecord["status"], string> = {
  success: "badge-success",
  error: "badge-error",
  rejected: "badge-error",
  "pending-approval": "badge-warning",
  running: "badge-info",
};

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function LastRunCell({ run, onClick }: { run: RunRecord | null | undefined; onClick: () => void }) {
  if (run === undefined) return <td style={{ fontSize: 13, color: "var(--muted)" }}>…</td>;
  if (run === null) return <td style={{ fontSize: 13, color: "var(--muted)" }}>—</td>;
  const when = run.completedAt ?? run.triggeredAt;
  return (
    <td>
      <button
        className="link-button"
        onClick={onClick}
        title={when ? new Date(when).toLocaleString() : ""}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span className={STATUS_CLASS[run.status]}>{STATUS_LABEL[run.status]}</span>
        {when && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatRelativeTime(when)}</span>
        )}
      </button>
    </td>
  );
}

function MoreMenu({
  wf,
  onHistory,
  onToggle,
  onViewYaml,
  onViewGraph,
  onRemove,
}: {
  wf: WorkflowEntry;
  onHistory: (id: string) => void;
  onToggle: (id: string) => void;
  onViewYaml: (filePath: string) => void;
  onViewGraph: (filePath: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const item = (label: string, fn: () => void, danger = false) => (
    <button
      className={`menu-item${danger ? " menu-item-danger" : ""}`}
      onClick={() => {
        setOpen(false);
        fn();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="more-menu" ref={ref}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div className="menu-dropdown" role="menu">
          {item("History", () => onHistory(wf.id))}
          {item(wf.enabled ? "Disable" : "Enable", () => onToggle(wf.id))}
          {item("View YAML", () => onViewYaml(wf.filePath))}
          {item("View Graph", () => onViewGraph(wf.filePath))}
          {item(
            "Remove",
            () => {
              if (confirm(`Remove workflow "${wf.name}"?`)) onRemove(wf.id);
            },
            true
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowList({
  workflows, onAdd, onEdit, onHistory, onRunNow, onToggle, onRemove, onViewYaml, onViewGraph, onSelectRun, refreshSignal,
}: Props) {
  const [lastRuns, setLastRuns] = useState<Record<string, RunRecord | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        workflows.map(async (wf) => {
          try {
            const runs = await window.api.getHistory(wf.id);
            return [wf.id, runs.length > 0 ? runs[0] : null] as const;
          } catch {
            return [wf.id, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, RunRecord | null> = {};
      for (const [id, run] of entries) map[id] = run;
      setLastRuns(map);
    })();
    return () => { cancelled = true; };
  }, [workflows, refreshSignal]);

  if (workflows.length === 0) {
    return (
      <div className="empty-state">
        <span className="icon">🦞</span>
        <span className="message">No workflows configured</span>
        <button className="btn btn-primary" onClick={onAdd}>+ Add Workflow</button>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Workflows</h2>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={onAdd}>+ Add Workflow</button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>File</th>
            <th>Schedule</th>
            <th>Status</th>
            <th>Last Run</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((wf) => (
            <tr key={wf.id}>
              <td style={{ fontWeight: 600 }}>
                <button
                  className="link-button"
                  onClick={() => onHistory(wf.id)}
                  title="View history"
                >
                  {wf.name}
                </button>
              </td>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {basename(wf.filePath)}
              </td>
              <td style={{ fontSize: 13 }} title={wf.schedule || ""}>{formatScheduleDisplay(wf.schedule)}</td>
              <td>
                <span className={wf.enabled ? "badge-enabled" : "badge-disabled"}>
                  {wf.enabled ? "● Enabled" : "○ Disabled"}
                </span>
              </td>
              <LastRunCell
                run={lastRuns[wf.id]}
                onClick={() => {
                  const r = lastRuns[wf.id];
                  if (r && onSelectRun) onSelectRun(r, wf.id);
                  else onHistory(wf.id);
                }}
              />
              <td>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-sm" onClick={() => onRunNow(wf.id)}>
                    Run
                  </button>
                  <button className="btn btn-sm" onClick={() => onEdit(wf.id)}>
                    Edit
                  </button>
                  <MoreMenu
                    wf={wf}
                    onHistory={onHistory}
                    onToggle={onToggle}
                    onViewYaml={onViewYaml}
                    onViewGraph={onViewGraph}
                    onRemove={onRemove}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
