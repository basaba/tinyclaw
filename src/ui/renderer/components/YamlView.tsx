import React, { useState, useEffect } from "react";

interface Props {
  filePath: string;
  onBack: () => void;
}

export function YamlView({ filePath, onBack }: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.api.readFile(filePath)
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to read file");
        setLoading(false);
      });
  }, [filePath]);

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <div className="toolbar">
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>YAML View</h2>
        <div className="spacer" />
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {filePath}
        </span>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 20 }}>Loading...</div>
      ) : error ? (
        <div style={{ color: "var(--error)", padding: 20 }}>{error}</div>
      ) : (
        <pre className="code-block" style={{ maxHeight: "calc(100vh - 200px)" }}>
          {content}
        </pre>
      )}
    </div>
  );
}
