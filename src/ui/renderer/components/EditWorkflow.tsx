import React, { useState } from "react";
import type { WorkflowEntry } from "../types";

interface Props {
  workflow: WorkflowEntry;
  onDone: () => void;
}

type ArgKind = "string" | "number" | "boolean" | "json";

interface ArgRow {
  key: string;
  kind: ArgKind;
  value: string;
}

function detectKind(v: unknown): ArgKind {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  return "json";
}

function valueToString(v: unknown, kind: ArgKind): string {
  if (kind === "boolean") return v ? "true" : "false";
  if (kind === "string") return String(v ?? "");
  if (kind === "number") return v == null ? "" : String(v);
  return JSON.stringify(v ?? null, null, 2);
}

function argsToRows(args: Record<string, unknown> | undefined): ArgRow[] {
  if (!args) return [];
  return Object.entries(args).map(([key, value]) => {
    const kind = detectKind(value);
    return { key, kind, value: valueToString(value, kind) };
  });
}

function rowsToArgs(rows: ArgRow[]): {
  args?: Record<string, unknown>;
  error?: string;
} {
  const out: Record<string, unknown> = {};
  for (const [i, r] of rows.entries()) {
    const key = r.key.trim();
    if (!key) {
      if (r.value.trim() === "") continue;
      return { error: `Row ${i + 1}: missing key` };
    }
    if (key in out) return { error: `Duplicate key "${key}"` };
    switch (r.kind) {
      case "string":
        out[key] = r.value;
        break;
      case "number": {
        if (r.value.trim() === "") {
          out[key] = null;
          break;
        }
        const n = Number(r.value);
        if (Number.isNaN(n)) return { error: `"${key}": not a number` };
        out[key] = n;
        break;
      }
      case "boolean":
        out[key] = r.value === "true";
        break;
      case "json": {
        const t = r.value.trim();
        if (t === "") {
          out[key] = null;
          break;
        }
        try {
          out[key] = JSON.parse(t);
        } catch {
          return { error: `"${key}": invalid JSON` };
        }
        break;
      }
    }
  }
  return { args: Object.keys(out).length ? out : undefined };
}

export function EditWorkflow({ workflow, onDone }: Props) {
  const [name, setName] = useState(workflow.name);
  const [filePath, setFilePath] = useState(workflow.filePath);
  const [schedule, setSchedule] = useState(workflow.schedule);
  const [argsMode, setArgsMode] = useState<"table" | "json">("table");
  const [rows, setRows] = useState<ArgRow[]>(() => argsToRows(workflow.args));
  const [argsText, setArgsText] = useState(
    workflow.args ? JSON.stringify(workflow.args, null, 2) : "",
  );
  const [debug, setDebug] = useState(workflow.debug ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const updateRow = (i: number, patch: Partial<ArgRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () =>
    setRows((prev) => [...prev, { key: "", kind: "string", value: "" }]);
  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const switchMode = (next: "table" | "json") => {
    if (next === argsMode) return;
    setError("");
    if (next === "json") {
      const { args, error: err } = rowsToArgs(rows);
      if (err) {
        setError(err);
        return;
      }
      setArgsText(args ? JSON.stringify(args, null, 2) : "");
    } else {
      if (argsText.trim()) {
        try {
          const parsed = JSON.parse(argsText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            setRows(argsToRows(parsed as Record<string, unknown>));
          } else {
            setError("JSON must be an object to switch to table mode");
            return;
          }
        } catch {
          setError("Args JSON is invalid");
          return;
        }
      } else {
        setRows([]);
      }
    }
    setArgsMode(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    let args: Record<string, unknown> | undefined;
    if (argsMode === "table") {
      const result = rowsToArgs(rows);
      if (result.error) {
        setError(result.error);
        return;
      }
      args = result.args;
    } else if (argsText.trim()) {
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

      <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
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
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <label style={{ margin: 0 }}>Args</label>
            <div className="spacer" style={{ flex: 1 }} />
            <div className="mode-toggle">
              <button
                type="button"
                className={`btn btn-sm${argsMode === "table" ? " btn-primary" : ""}`}
                onClick={() => switchMode("table")}
              >
                Table
              </button>
              <button
                type="button"
                className={`btn btn-sm${argsMode === "json" ? " btn-primary" : ""}`}
                onClick={() => switchMode("json")}
              >
                JSON
              </button>
            </div>
          </div>

          {argsMode === "table" ? (
            <div>
              {rows.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                  No arguments. Click "+ Add row" to define one.
                </div>
              ) : (
                <table className="table args-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Key</th>
                      <th style={{ width: 110 }}>Type</th>
                      <th>Value</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            className="form-input mono"
                            value={r.key}
                            placeholder="name"
                            onChange={(e) => updateRow(i, { key: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="form-input"
                            value={r.kind}
                            onChange={(e) => updateRow(i, { kind: e.target.value as ArgKind })}
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="json">json</option>
                          </select>
                        </td>
                        <td>
                          {r.kind === "boolean" ? (
                            <select
                              className="form-input"
                              value={r.value === "true" ? "true" : "false"}
                              onChange={(e) => updateRow(i, { value: e.target.value })}
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : r.kind === "json" ? (
                            <textarea
                              className="form-input mono"
                              rows={2}
                              value={r.value}
                              placeholder='{"foo": 1}'
                              onChange={(e) => updateRow(i, { value: e.target.value })}
                            />
                          ) : (
                            <input
                              className={`form-input${r.kind === "number" ? " mono" : ""}`}
                              type={r.kind === "number" ? "number" : "text"}
                              value={r.value}
                              onChange={(e) => updateRow(i, { value: e.target.value })}
                            />
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => removeRow(i)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button type="button" className="btn btn-sm" onClick={addRow} style={{ marginTop: 8 }}>
                + Add row
              </button>
            </div>
          ) : (
            <textarea
              className="form-input mono"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={8}
            />
          )}
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
