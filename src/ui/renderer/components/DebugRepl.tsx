import React, { useEffect, useRef, useState } from "react";

interface Props {
  snapshotPath: string;
}

export function DebugRepl({ snapshotPath }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const termInstanceRef = useRef<any>(null);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let destroyed = false;

    async function init() {
      try {
        // Dynamically import xterm
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");

        if (destroyed) return;

        const term = new Terminal({
          theme: {
            background: "#1a1a2e",
            foreground: "#e0e0e0",
            cursor: "#00d2ff",
            selectionBackground: "#253255",
          },
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
          fontSize: 13,
          cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        if (termRef.current) {
          term.open(termRef.current);
          fitAddon.fit();
          termInstanceRef.current = term;
        }

        // Start the debug REPL process
        const id = await window.api.openDebugRepl(snapshotPath);
        if (destroyed) {
          window.api.closeDebugRepl(id);
          return;
        }
        setPtyId(id);

        // Pipe output from process to terminal
        const unsubData = window.api.onDebugReplData(id, (data: string) => {
          term.write(data);
        });

        // Pipe input from terminal to process
        const inputDisposable = term.onData((data: string) => {
          window.api.writeDebugRepl(id, data);
        });

        // Handle resize
        const resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
        });
        if (termRef.current) resizeObserver.observe(termRef.current);

        cleanup = () => {
          inputDisposable.dispose();
          unsubData();
          resizeObserver.disconnect();
          term.dispose();
          window.api.closeDebugRepl(id);
        };
      } catch (err: any) {
        setError(err.message || "Failed to start debug REPL");
      }
    }

    init();

    return () => {
      destroyed = true;
      cleanup?.();
    };
  }, [snapshotPath]);

  if (error) {
    return (
      <div className="card" style={{ color: "var(--error)" }}>
        Failed to start Debug REPL: {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        Debug REPL — {snapshotPath}
      </div>
      <div className="debug-repl-container" ref={termRef} />
    </div>
  );
}
