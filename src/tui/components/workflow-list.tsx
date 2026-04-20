import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { RunRecord, WorkflowEntry } from "../scheduler/types.js";
import { getRunsForWorkflow } from "../scheduler/config.js";

interface Props {
  client: DaemonClient;
  workflows: WorkflowEntry[];
  onAdd: () => void;
  onHistory: (workflowId: string) => void;
  onViewOutput: (run: RunRecord, fromWorkflowId: string) => void;
  onRefresh: () => void;
}

export function WorkflowList({ client, workflows, onAdd, onHistory, onViewOutput, onRefresh }: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(workflows.length - 1, c + 1));

    if (input === "a") onAdd();

    if (workflows.length === 0) return;
    const wf = workflows[cursor];
    if (!wf) return;

    if (key.return) onHistory(wf.id);
    if (input === " ") {
      client.toggleWorkflow(wf.id).then(onRefresh).catch(() => {});
    }
    if (input === "d") {
      client.removeWorkflow(wf.id).then(() => {
        setCursor((c) => Math.min(c, workflows.length - 2));
        onRefresh();
      }).catch(() => {});
    }
    if (input === "r") {
      client.runNow(wf.id).catch(() => {});
      onRefresh();
    }
    if (input === "o") {
      client.getHistory(wf.id).then((runs) => {
        if (runs.length > 0) {
          onViewOutput(runs[0], wf.id);
        }
      }).catch(() => {});
    }
  });

  if (workflows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No workflows configured. Press </Text>
        <Text bold color="green">a</Text>
        <Text color="gray"> to add one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {"  "}
          {"Status".padEnd(8)}
          {"Name".padEnd(25)}
          {"Schedule".padEnd(20)}
          {"Last Run".padEnd(14)}
          {"File"}
        </Text>
      </Box>
      {workflows.map((wf, i) => {
        const selected = i === cursor;
        const status = wf.enabled ? "✅" : "⏸️";
        const runs = getRunsForWorkflow(wf.id);
        const lastRun = runs.length > 0 ? runs[0] : null;
        const lastRunStr = lastRun
          ? `${lastRun.status === "success" ? "✅" : lastRun.status === "error" ? "❌" : "🔄"} ${lastRun.durationMs ? (lastRun.durationMs / 1000).toFixed(0) + "s" : "..."}`
          : "—";
        return (
          <Box key={wf.id}>
            <Text
              color={selected ? "cyan" : undefined}
              bold={selected}
              inverse={selected}
            >
              {selected ? "▸ " : "  "}
              {status.padEnd(8)}
              {wf.name.padEnd(25)}
              {wf.schedule.padEnd(20)}
              {lastRunStr.padEnd(14)}
              {wf.filePath}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
