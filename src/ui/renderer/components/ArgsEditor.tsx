import React, { useState } from "react";

export type ArgKind = "string" | "number" | "boolean" | "json";

export interface ArgRow {
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

export function argsToRows(args: Record<string, unknown> | undefined): ArgRow[] {
  if (!args) return [];
  return Object.entries(args).map(([key, value]) => {
    const kind = detectKind(value);
    return { key, kind, value: valueToString(value, kind) };
  });
}

export function rowsToArgs(rows: ArgRow[]): {
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

interface Props {
  initialArgs: Record<string, unknown> | undefined;
  onChange: (
    result: { args?: Record<string, unknown>; error?: string; raw?: string },
  ) => void;
}

/**
 * Reusable args editor with Table/JSON mode toggle.
 * Calls onChange whenever the underlying value changes; parent stores result.
 */
export function ArgsEditor({ initialArgs, onChange }: Props) {
  const [mode, setMode] = useState<"table" | "json">("table");
  const [rows, setRows] = useState<ArgRow[]>(() => argsToRows(initialArgs));
  const [argsText, setArgsText] = useState(
    initialArgs ? JSON.stringify(initialArgs, null, 2) : "",
  );
  const [switchError, setSwitchError] = useState("");

  const emitFromRows = (next: ArgRow[]) => {
    const r = rowsToArgs(next);
    onChange({ args: r.args, error: r.error });
  };
  const emitFromJson = (text: string) => {
    if (!text.trim()) {
      onChange({ args: undefined, raw: text });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      onChange({ args: parsed, raw: text });
    } catch {
      onChange({ error: "Args must be valid JSON", raw: text });
    }
  };

  const updateRow = (i: number, patch: Partial<ArgRow>) => {
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      emitFromRows(next);
      return next;
    });
  };
  const addRow = () =>
    setRows((prev) => {
      const next = [...prev, { key: "", kind: "string" as ArgKind, value: "" }];
      emitFromRows(next);
      return next;
    });
  const removeRow = (i: number) =>
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      emitFromRows(next);
      return next;
    });

  const switchMode = (next: "table" | "json") => {
    if (next === mode) return;
    setSwitchError("");
    if (next === "json") {
      const r = rowsToArgs(rows);
      if (r.error) {
        setSwitchError(r.error);
        return;
      }
      const text = r.args ? JSON.stringify(r.args, null, 2) : "";
      setArgsText(text);
      emitFromJson(text);
    } else {
      if (argsText.trim()) {
        try {
          const parsed = JSON.parse(argsText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const newRows = argsToRows(parsed as Record<string, unknown>);
            setRows(newRows);
            emitFromRows(newRows);
          } else {
            setSwitchError("JSON must be an object to switch to table mode");
            return;
          }
        } catch {
          setSwitchError("Args JSON is invalid");
          return;
        }
      } else {
        setRows([]);
        emitFromRows([]);
      }
    }
    setMode(next);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="mode-toggle">
          <button
            type="button"
            className={`btn btn-sm${mode === "table" ? " btn-primary" : ""}`}
            onClick={() => switchMode("table")}
          >
            Table
          </button>
          <button
            type="button"
            className={`btn btn-sm${mode === "json" ? " btn-primary" : ""}`}
            onClick={() => switchMode("json")}
          >
            JSON
          </button>
        </div>
      </div>

      {switchError && (
        <div style={{ color: "var(--error)", marginBottom: 8, fontSize: 12 }}>
          {switchError}
        </div>
      )}

      {mode === "table" ? (
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
          onChange={(e) => {
            setArgsText(e.target.value);
            emitFromJson(e.target.value);
          }}
          rows={8}
          placeholder='{"key": "value"}'
        />
      )}
    </div>
  );
}
