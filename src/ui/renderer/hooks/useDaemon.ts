import { useState, useEffect, useCallback, useRef } from "react";
import type { WorkflowEntry, RunRecord, DaemonEventKind } from "../types";

interface DaemonState {
  connected: boolean;
  workflows: WorkflowEntry[];
  liveOutput: Map<string, string>;
  refresh: () => void;
}

export function useDaemon(): DaemonState {
  const [connected, setConnected] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [liveOutput, setLiveOutput] = useState<Map<string, string>>(new Map());
  const cleanupRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    window.api.getWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  useEffect(() => {
    // Initial status fetch
    window.api.getStatus()
      .then((s) => {
        setConnected(s.running);
        setWorkflows(s.workflows);
      })
      .catch(() => setConnected(false));

    // Subscribe to daemon events
    const unsubscribe = window.api.onEvent((event: DaemonEventKind) => {
      if (event.kind === "run-output") {
        setLiveOutput((prev) => {
          const next = new Map(prev);
          next.set(event.runId, (prev.get(event.runId) ?? "") + event.text);
          return next;
        });
      } else if (event.kind === "config-changed") {
        refresh();
      } else if (event.kind === "run-complete" || event.kind === "run-start") {
        refresh();
      }
    });

    // Also listen for generic change events
    const unsubChange = window.api.onChange(() => refresh());

    cleanupRef.current = unsubscribe;
    return () => {
      unsubscribe();
      unsubChange();
    };
  }, [refresh]);

  return { connected, workflows, liveOutput, refresh };
}
