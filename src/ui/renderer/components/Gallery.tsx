import React, { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";

interface GallerySample {
  id: string;
  name: string;
  description: string;
  category: string;
  file: string;
  args: string[];
  tags: string[];
  installed: boolean;
}

interface Props {
  onBack: () => void;
}

export function Gallery({ onBack }: Props) {
  const [samples, setSamples] = useState<GallerySample[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [preview, setPreview] = useState<{ sample: GallerySample; content: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadSamples = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/galleryList", { method: "POST", body: "[]" });
      const data = await res.json();
      setSamples(data.result.samples);
    } catch {
      setMessage({ text: "Failed to load gallery", type: "error" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSamples(); }, [loadSamples]);

  const handleInstall = async (id: string, overwrite = false) => {
    setInstalling(id);
    setMessage(null);
    try {
      const res = await fetch("/api/galleryInstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([id, overwrite]),
      });
      const data = await res.json();
      const result = data.result;
      if (result.success) {
        setMessage({ text: `Installed to ${result.filePath}`, type: "success" });
        setSamples((prev) =>
          prev.map((s) => (s.id === id ? { ...s, installed: true } : s)),
        );
      } else if (result.alreadyExists) {
        if (confirm(`${result.filePath} already exists. Overwrite?`)) {
          await handleInstall(id, true);
          return;
        }
      } else {
        setMessage({ text: result.error ?? "Install failed", type: "error" });
      }
    } catch (err) {
      setMessage({ text: "Network error during install", type: "error" });
    }
    setInstalling(null);
  };

  const handleView = async (id: string) => {
    setLoadingPreview(true);
    try {
      const res = await fetch("/api/galleryView", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([id]),
      });
      const data = await res.json();
      setPreview({ sample: data.result.sample, content: data.result.content });
    } catch {
      setMessage({ text: "Failed to load workflow preview", type: "error" });
    }
    setLoadingPreview(false);
  };

  const filtered = samples.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const categories = [...new Set(filtered.map((s) => s.category))].sort();

  return (
    <div className="gallery-view">
      <div className="gallery-header">
        <button className="btn-back" onClick={onBack}>
          ← Back
        </button>
        <h2>📦 Sample Gallery</h2>
        <input
          type="text"
          className="gallery-search"
          placeholder="Search samples..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {message && (
        <div className={`gallery-message ${message.type}`}>
          {message.text}
          <button onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="gallery-loading">Loading gallery...</div>
      ) : filtered.length === 0 ? (
        <div className="gallery-empty">
          No samples match{search ? ` "${search}"` : ""}
        </div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="gallery-category">
            <h3 className="category-title">{cat}</h3>
            <div className="gallery-grid">
              {filtered
                .filter((s) => s.category === cat)
                .map((sample) => (
                  <div key={sample.id} className="gallery-card">
                    <div className="card-header">
                      <span className="card-name">{sample.name}</span>
                      {sample.installed && (
                        <span className="card-badge installed">✓ Installed</span>
                      )}
                    </div>
                    <p className="card-description">{sample.description}</p>

                    <div className="card-tags">
                      {sample.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="card-actions">
                      <button
                        className="btn-view"
                        onClick={() => handleView(sample.id)}
                        disabled={loadingPreview}
                      >
                        View
                      </button>
                      <button
                        className="btn-install"
                        onClick={() => handleInstall(sample.id)}
                        disabled={installing === sample.id}
                      >
                        {installing === sample.id
                          ? "Installing..."
                          : sample.installed
                            ? "Reinstall"
                            : "Install"}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}

      {/* Preview modal */}
      {preview && (
        <div className="gallery-preview-overlay" onClick={() => setPreview(null)}>
          <div className="gallery-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <h3>{preview.sample.name}</h3>
              <div className="preview-header-actions">
                <button
                  className="btn-install"
                  onClick={() => {
                    handleInstall(preview.sample.id);
                    setPreview(null);
                  }}
                >
                  {preview.sample.installed ? "Reinstall" : "Install"}
                </button>
                <button className="btn-back" onClick={() => setPreview(null)}>✕</button>
              </div>
            </div>
            <div className="preview-editor">
              <Editor
                height="100%"
                language="yaml"
                value={preview.content}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  tabSize: 2,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: "on",
                  lineNumbers: "on",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
