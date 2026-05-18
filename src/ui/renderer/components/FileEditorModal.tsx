import React, { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

interface Props {
  filePath: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditorModal({ filePath, readOnly = false, onClose, onSaved }: Props) {
  const [content, setContent] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.api.readFile(filePath)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to read file");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const dirty = content !== original;

  const handleSave = async () => {
    if (!dirty || readOnly) return;
    setSaving(true);
    setError("");
    try {
      await window.api.writeFile(filePath, content);
      setOriginal(content);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !readOnly) {
      if (!confirm("Discard unsaved changes?")) return;
    }
    onClose();
  };

  const language = filePath.match(/\.ya?ml$/i)
    ? "yaml"
    : filePath.match(/\.json$/i)
      ? "json"
      : filePath.match(/\.(ts|tsx)$/i)
        ? "typescript"
        : filePath.match(/\.(js|jsx)$/i)
          ? "javascript"
          : filePath.match(/\.md$/i)
            ? "markdown"
            : "plaintext";

  return (
    <div className="modal-overlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div className="modal-content modal-large">
        <div className="modal-header">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              {readOnly ? "View File" : "Edit File"}
              {dirty && <span style={{ color: "var(--text-secondary)", marginLeft: 6 }}>•</span>}
            </h3>
            <span style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {filePath}
            </span>
          </div>
          <div className="spacer" style={{ flex: 1 }} />
          {!readOnly && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={handleClose}>
            Close
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--error)", padding: "6px 12px", fontSize: 12 }}>{error}</div>
        )}

        <div className="modal-body" style={{ padding: 0, minHeight: 0, flex: 1 }}>
          {loading ? (
            <div style={{ padding: 20, color: "var(--text-muted)" }}>Loading…</div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={content}
              theme="vs-dark"
              onChange={(v) => setContent(v ?? "")}
              options={{
                readOnly,
                minimap: { enabled: false },
                fontSize: 13,
                tabSize: 2,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
