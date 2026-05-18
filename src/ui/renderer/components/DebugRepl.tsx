import React, { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

interface Props {
  snapshotPath: string;
  runId?: string;
}

export function DebugRepl({ snapshotPath, runId }: Props) {
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
          scrollback: 10000,
          convertEol: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        const safeFit = () => {
          const el = termRef.current;
          if (!el) return;
          // Skip when hidden or zero-sized — fit() with zero dims produces a
          // broken viewport that goes blank once content arrives.
          if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
          try { fitAddon.fit(); } catch {/* ignore transient layout issues */}
        };

        if (termRef.current) {
          term.open(termRef.current);
          // Defer initial fit to next frame so the container has real dims.
          requestAnimationFrame(safeFit);
          termInstanceRef.current = term;
        }

        // Start the debug REPL process
        const id = await window.api.openDebugRepl(snapshotPath, runId);
        if (destroyed) {
          window.api.closeDebugRepl(id);
          return;
        }
        setPtyId(id);

        // Pipe output from process to terminal — chunk huge bursts so the
        // renderer doesn't choke and leave the viewport blank.
        const MAX_CHUNK = 64 * 1024;
        const writeChunked = (data: string) => {
          if (data.length <= MAX_CHUNK) {
            term.write(data);
            return;
          }
          for (let i = 0; i < data.length; i += MAX_CHUNK) {
            term.write(data.slice(i, i + MAX_CHUNK));
          }
        };
        const unsubData = window.api.onDebugReplData(id, writeChunked);

        // Pipe input from terminal to process
        const inputDisposable = term.onData((data: string) => {
          window.api.writeDebugRepl(id, data);
        });

        // Handle resize — debounce so rapid layout shifts don't thrash fit().
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(safeFit, 50);
        });
        if (termRef.current) resizeObserver.observe(termRef.current);

        cleanup = () => {
          if (resizeTimer) clearTimeout(resizeTimer);
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
  }, [snapshotPath, runId]);

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
