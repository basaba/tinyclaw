import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { RunRecord } from "../scheduler/types.js";

interface Props {
  client: DaemonClient;
  workflowId: string;
  onBack: () => void;
  onSelectRun: (run: RunRecord, workflowId: string) => void;
  onViewFile?: () => void;
}

export function RunHistory({ client, workflowId, onBack, onSelectRun, onViewFile }: Props) {
  const PAGE_SIZE = 15;
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);

  const totalPages = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRuns = runs.slice(pageStart, pageStart + PAGE_SIZE);

  const refresh = () => client.getHistory(workflowId).then(setRuns).catch(() => {});

  useEffect(() => {
    refresh();
    const onEvent = (evt: any) => {
      if (evt.kind === "run-complete" || evt.kind === "run-start" || evt.kind === "approval-pending") {
        refresh();
      }
    };
    client.on("event", onEvent);
    return () => { client.off("event", onEvent); };
  }, [client, workflowId]);

  useInput((input, key) => {
    if (confirmClear) {
      if (input === "y") {
        client.clearHistory(workflowId).then(() => { setRuns([]); setCursor(0); setPage(0); }).catch(() => {});
      }
      setConfirmClear(false);
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(pageRuns.length - 1, c + 1));
    if (key.leftArrow || input === "[") {
      setPage((p) => { const np = Math.max(0, p - 1); setCursor(0); return np; });
    }
    if (key.rightArrow || input === "]") {
      setPage((p) => { const np = Math.min(totalPages - 1, p + 1); setCursor(0); return np; });
    }
    if (key.return && pageRuns[cursor]) {
      onSelectRun(pageRuns[cursor], workflowId);
    }
    if (key.delete || input === "d") {
      const run = pageRuns[cursor];
      if (run && run.status !== "running") {
        client.deleteRun(run.id).then(() => {
          refresh();
          setCursor((c) => Math.min(c, pageRuns.length - 2));
        }).catch(() => {});
      }
    }
    if (input === "c") {
      setConfirmClear(true);
    }
    if (input === "v" && onViewFile) {
      onViewFile();
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
      <Text bold>Run History ({runs.length} runs) — Page {page + 1}/{totalPages} — Esc to go back</Text>
      <Box marginTop={1}>
        <Text bold>
          {"  "}
          {"Status".padEnd(10)}
          {"Trigger".padEnd(12)}
          {"Started".padEnd(26)}
          {"Duration"}
        </Text>
      </Box>
      {pageRuns.map((run, i) => {
        const selected = i === cursor;
        const statusIcon =
          run.status === "success" ? "✅"
            : run.status === "error" ? "❌"
            : run.status === "rejected" ? "🚫"
            : run.status === "pending-approval" ? "⏳"
            : "🔄";
        const dur = run.durationMs
          ? run.durationMs >= 60_000
            ? `${(run.durationMs / 60_000).toFixed(1)}m`
            : `${(run.durationMs / 1000).toFixed(1)}s`
          : "—";
        const debugIcon = run.debugSnapshotPath ? "🔍" : "  ";
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
              {dur.padEnd(10)}
              {debugIcon}
            </Text>
          </Box>
        );
      })}
      {totalPages > 1 && (
        <Text color="gray">← / → or [ / ] to change page</Text>
      )}
      {confirmClear && (
        <Text color="red" bold>Clear all history? Press y to confirm, any other key to cancel</Text>
      )}
    </Box>
  );
}
