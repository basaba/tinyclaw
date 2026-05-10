import React, { useState } from "react";
import type { WorkflowEntry } from "../types";

interface Props {
  onDone: () => void;
}

export function AddWorkflow({ onDone }: Props) {
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [schedule, setSchedule] = useState("");
  const [argsText, setArgsText] = useState("");
  const [debug, setDebug] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !filePath.trim()) {
      setError("Name and file path are required");
      return;
    }

    let args: Record<string, unknown> | undefined;
    if (argsText.trim()) {
      try {
        args = JSON.parse(argsText);
      } catch {
        setError("Args must be valid JSON");
        return;
      }
    }

    const workflow: WorkflowEntry = {
      id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: name.trim(),
      filePath: filePath.trim(),
      schedule: schedule.trim(),
      enabled: true,
      args,
      debug,
    };

    setSaving(true);
    try {
      await window.api.addWorkflow(workflow);
      onDone();
    } catch (err: any) {
      setError(err.message || "Failed to add workflow");
      setSaving(false);
    }
  };

  return (
    <div>
      <button className="back-link" onClick={onDone}>← Back</button>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Add Workflow</h2>

      <form onSubmit={handleSubmit} style={{ maxWidth: 500 }}>
        <div className="form-group">
          <label>Name</label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workflow"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>File Path</label>
          <input
            className="form-input mono"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="C:\path\to\workflow.yaml"
          />
        </div>

        <div className="form-group">
          <label>Schedule (cron or "every Xm/h")</label>
          <input
            className="form-input mono"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="every 30m"
          />
        </div>

        <div className="form-group">
          <label>Args (JSON, optional)</label>
          <textarea
            className="form-input mono"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder='{"key": "value"}'
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
            {saving ? "Saving..." : "Add Workflow"}
          </button>
          <button type="button" className="btn" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
