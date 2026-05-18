import React, { useEffect, useState } from "react";

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface Props {
  initialPath?: string;
  /** Filter file extensions (lowercase, no dot). If empty, all files shown. */
  extensions?: string[];
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export function DirectoryPickerModal({ initialPath, extensions = [], onSelect, onClose }: Props) {
  const [cwd, setCwd] = useState<string | null>(initialPath ?? null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(extensions.length === 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const res = await window.api.listDir(cwd ?? undefined);
        if (cancelled) return;
        setCwd(res.cwd);
        setParent(res.parent);
        setEntries(res.entries);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || "Failed to list directory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  const visibleEntries = showAll || extensions.length === 0
    ? entries
    : entries.filter((e) => {
        if (e.isDirectory) return true;
        const dot = e.name.lastIndexOf(".");
        if (dot < 0) return false;
        return extensions.includes(e.name.slice(dot + 1).toLowerCase());
      });

  const handleConfirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-content" style={{ width: 640, maxHeight: "80vh" }}>
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Select File</h3>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={handleConfirm}
            disabled={!selected}
          >
            Open
          </button>
        </div>

        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => parent && setCwd(parent)}
            disabled={!parent}
            title="Up one directory"
          >
            ↑ Up
          </button>
          <input
            className="form-input mono"
            value={cwd ?? ""}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ flex: 1, fontSize: 12 }}
            placeholder="/path/to/dir"
          />
          {extensions.length > 0 && (
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              All files
            </label>
          )}
        </div>

        {error && (
          <div style={{ padding: "8px 12px", color: "var(--error)", fontSize: 12 }}>{error}</div>
        )}

        <div className="modal-body" style={{ padding: 0, overflow: "auto", maxHeight: "55vh" }}>
          {loading ? (
            <div style={{ padding: 16, color: "var(--text-muted)" }}>Loading…</div>
          ) : visibleEntries.length === 0 ? (
            <div style={{ padding: 16, color: "var(--text-muted)" }}>No items</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {visibleEntries.map((entry) => {
                const isSelected = selected === entry.path;
                return (
                  <li
                    key={entry.path}
                    onClick={() => {
                      if (entry.isDirectory) setSelected(null);
                      else setSelected(entry.path);
                    }}
                    onDoubleClick={() => {
                      if (entry.isDirectory) setCwd(entry.path);
                      else onSelect(entry.path);
                    }}
                    style={{
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      background: isSelected ? "var(--accent)" : "transparent",
                      color: isSelected ? "white" : "var(--text-primary)",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ width: 16, textAlign: "center" }}>
                      {entry.isDirectory ? "📁" : "📄"}
                    </span>
                    <span>{entry.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
