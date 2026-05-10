import React, { useState } from "react";
import type { WorkflowEntry } from "../types";

interface Props {
  workflow: WorkflowEntry;
  onDone: () => void;
}

export function EditWorkflow({ workflow, onDone }: Props) {
  const [name, setName] = useState(workflow.name);
  const [filePath, setFilePath] = useState(workflow.filePath);
  const [schedule, setSchedule] = useState(workflow.schedule);
  const [argsText, setArgsText] = useState(
    workflow.args ? JSON.stringify(workflow.args, null, 2) : "",
  );
  const [debug, setDebug] = useState(workflow.debug ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let args: Record<string, unknown> | undefined;
    if (argsText.trim()) {
      try {
        args = JSON.parse(argsText);
      } catch {
        setError("Args must be valid JSON");
        return;
      }
    }

    const patch: Partial<WorkflowEntry> = {};
    if (name.trim() !== workflow.name) patch.name = name.trim();
    if (filePath.trim() !== workflow.filePath) patch.filePath = filePath.trim();
    if (schedule.trim() !== workflow.schedule) patch.schedule = schedule.trim();
    if (JSON.stringify(args) !== JSON.stringify(workflow.args)) patch.args = args;
    if (debug !== (workflow.debug ?? false)) patch.debug = debug;

    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }

    setSaving(true);
    try {
      await window.api.updateWorkflow(workflow.id, patch);
      onDone();
    } catch (err: any) {
      setError(err.message || "Failed to update workflow");
      setSaving(false);
    }
  };

  return (
    <div>
      <button className="back-link" onClick={onDone}>← Back</button>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>
        Edit: {workflow.name}
      </h2>

      <form onSubmit={handleSubmit} style={{ maxWidth: 500 }}>
        <div className="form-group">
          <label>Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>File Path</label>
          <input className="form-input mono" value={filePath} onChange={(e) => setFilePath(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Schedule</label>
          <input className="form-input mono" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Args (JSON)</label>
          <textarea
            className="form-input mono"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-toggle">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            Debug Mode
          </label>
        </div>

        {error && <div style={{ color: "var(--error)", marginBottom: 12, fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button type="button" className="btn" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
