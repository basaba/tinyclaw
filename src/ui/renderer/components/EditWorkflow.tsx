import React, { useState } from "react";
import type { WorkflowEntry } from "../types";
import { ScheduleEditor } from "./ScheduleEditor";
import { ArgsEditor } from "./ArgsEditor";
import { FileEditorModal } from "./FileEditorModal";
import { pickFile } from "../api/picker";

interface Props {
  workflow: WorkflowEntry;
  onDone: () => void;
}

export function EditWorkflow({ workflow, onDone }: Props) {
  const [name, setName] = useState(workflow.name);
  const [filePath, setFilePath] = useState(workflow.filePath);
  const [schedule, setSchedule] = useState(workflow.schedule);
  const [args, setArgs] = useState<Record<string, unknown> | undefined>(workflow.args);
  const [argsError, setArgsError] = useState<string | undefined>();
  const [debug, setDebug] = useState(workflow.debug ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileEditorOpen, setFileEditorOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (argsError) {
      setError(argsError);
      return;
    }
    setError("");

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

      <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
        <div className="form-group">
          <label>Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>File Path</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="form-input mono"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
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
            initialArgs={workflow.args}
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
            {saving ? "Saving..." : "Save Changes"}
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
