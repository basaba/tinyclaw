import React, { useState } from "react";
import type { WorkflowEntry } from "../types";
import { ScheduleEditor } from "./ScheduleEditor";
import { ArgsEditor } from "./ArgsEditor";
import { FileEditorModal } from "./FileEditorModal";
import { pickFile } from "../api/picker";

interface Props {
  onDone: () => void;
}

export function AddWorkflow({ onDone }: Props) {
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [schedule, setSchedule] = useState("");
  const [args, setArgs] = useState<Record<string, unknown> | undefined>();
  const [argsError, setArgsError] = useState<string | undefined>();
  const [debug, setDebug] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileEditorOpen, setFileEditorOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !filePath.trim()) {
      setError("Name and file path are required");
      return;
    }
    if (argsError) {
      setError(argsError);
      return;
    }
    setError("");

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

      <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
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
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="form-input mono"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="C:\path\to\workflow.yaml"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                const picked = await pickFile({ defaultPath: filePath || undefined });
                if (picked) setFilePath(picked);
              }}
              title="Browse for a workflow file"
            >
              Browse…
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setFileEditorOpen(true)}
              disabled={!filePath.trim()}
              title="View or edit the workflow file"
            >
              View / Edit
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Schedule</label>
          <ScheduleEditor value={schedule} onChange={setSchedule} />
        </div>

        <div className="form-group">
          <label>Args</label>
          <ArgsEditor
            initialArgs={undefined}
            onChange={({ args, error }) => {
              setArgs(args);
              setArgsError(error);
            }}
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

      {fileEditorOpen && (
        <FileEditorModal
          filePath={filePath.trim()}
          onClose={() => setFileEditorOpen(false)}
        />
      )}
    </div>
  );
}
