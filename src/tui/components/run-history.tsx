import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { RunRecord } from "../scheduler/types.js";

interface Props {
  client: DaemonClient;
  workflowId: string;
  onBack: () => void;
  onSelectRun: (run: RunRecord, workflowId: string) => void;
}

export function RunHistory({ client, workflowId, onBack, onSelectRun }: Props) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    client.getHistory(workflowId).then(setRuns).catch(() => {});
    const onEvent = (evt: any) => {
      if (evt.kind === "run-complete" || evt.kind === "run-start" || evt.kind === "approval-pending") {
        client.getHistory(workflowId).then(setRuns).catch(() => {});
      }
    };
    client.on("event", onEvent);
    return () => { client.off("event", onEvent); };
  }, [client, workflowId]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(runs.length - 1, c + 1));
    if (key.return && runs[cursor]) {
      onSelectRun(runs[cursor], workflowId);
    }
  });

  if (runs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Run History</Text>
        <Text color="gray">No runs yet. Press Esc to go back.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Run History ({runs.length} runs) — Esc to go back</Text>
      <Box marginTop={1}>
        <Text bold>
          {"  "}
          {"Status".padEnd(10)}
          {"Trigger".padEnd(12)}
          {"Started".padEnd(26)}
          {"Duration".padEnd(12)}
          {"Failed Step"}
        </Text>
      </Box>
      {runs.map((run, i) => {
        const selected = i === cursor;
        const statusIcon =
          run.status === "success" ? "✅"
            : run.status === "error" ? "❌"
            : run.status === "rejected" ? "🚫"
            : run.status === "pending-approval" ? "⏳"
            : "🔄";
        const dur = run.durationMs
          ? `${(run.durationMs / 1000).toFixed(1)}s`
          : "—";
        const time = new Date(run.triggeredAt).toLocaleString();
        return (
          <Box key={run.id}>
            <Text
              color={selected ? "cyan" : undefined}
              bold={selected}
              inverse={selected}
            >
              {selected ? "▸ " : "  "}
              {statusIcon.padEnd(10)}
              {run.triggeredBy.padEnd(12)}
              {time.padEnd(26)}
              {dur.padEnd(12)}
              {run.failedStepId ?? ""}
            </Text>
          </Box>
        );
      })}
      <Text color="gray" dimColor>
        Press Enter to view input/output details
      </Text>
    </Box>
  );
}
