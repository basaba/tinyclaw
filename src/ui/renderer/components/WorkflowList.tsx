import React, { useState, useEffect, useRef } from "react";
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
              <td style={{ fontSize: 13 }}>{wf.schedule || "—"}</td>
              <td>
                <span className={wf.enabled ? "badge-enabled" : "badge-disabled"}>
                  {wf.enabled ? "● Enabled" : "○ Disabled"}
                </span>
              </td>
              <td>{wf.debug ? "Debug" : "—"}</td>
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
