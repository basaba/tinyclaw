import React from "react";
import type { WorkflowEntry } from "../types";

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
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

export function WorkflowList({
  workflows, onAdd, onEdit, onHistory, onRunNow, onToggle, onRemove, onViewYaml, onViewGraph,
}: Props) {
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
            <th>Debug</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((wf) => (
            <tr key={wf.id}>
              <td style={{ fontWeight: 600 }}>{wf.name}</td>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {basename(wf.filePath)}
              </td>
              <td style={{ fontSize: 13 }}>{wf.schedule || "—"}</td>
              <td>
                <span className={wf.enabled ? "badge-enabled" : "badge-disabled"}>
                  {wf.enabled ? "● Enabled" : "○ Disabled"}
                </span>
              </td>
              <td>{wf.debug ? "🔍" : "—"}</td>
              <td>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-sm" onClick={() => onRunNow(wf.id)} title="Run now">
                    ▶
                  </button>
                  <button className="btn btn-sm" onClick={() => onToggle(wf.id)} title="Toggle">
                    {wf.enabled ? "⏸" : "⏵"}
                  </button>
                  <button className="btn btn-sm" onClick={() => onHistory(wf.id)} title="History">
                    📋
                  </button>
                  <button className="btn btn-sm" onClick={() => onEdit(wf.id)} title="Edit">
                    ✏️
                  </button>
                  <button className="btn btn-sm" onClick={() => onViewYaml(wf.filePath)} title="View YAML">
                    📄
                  </button>
                  <button className="btn btn-sm" onClick={() => onViewGraph(wf.filePath)} title="View Graph">
                    🔀
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (confirm(`Remove workflow "${wf.name}"?`)) onRemove(wf.id);
                    }}
                    title="Remove"
                  >
                    🗑
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
