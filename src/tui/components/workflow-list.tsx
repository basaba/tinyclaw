import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { RunRecord, WorkflowEntry } from "../scheduler/types.js";
import { getRunsForWorkflow } from "../scheduler/config.js";

const INTERVAL_RE = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?)$/i;

function parseIntervalMs(expr: string): number | null {
  const m = INTERVAL_RE.exec(expr.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("d")) return n * 86_400_000;
  if (unit.startsWith("h")) return n * 3_600_000;
  if (unit.startsWith("m")) return n * 60_000;
  return n * 1000;
}

function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatNextRun(wf: WorkflowEntry, lastRun: RunRecord | null): string {
  if (!wf.enabled) return "paused";

  const intervalMs = parseIntervalMs(wf.schedule);
  if (!intervalMs) return "—";

  if (!lastRun) return "soon";

  const lastTime = new Date(lastRun.completedAt ?? lastRun.triggeredAt).getTime();
  const nextTime = lastTime + intervalMs;
  const nowMs = Date.now();

  if (nextTime <= nowMs) return "soon";

  const next = new Date(nextTime);
  const today = new Date();
  const isToday = next.getFullYear() === today.getFullYear()
    && next.getMonth() === today.getMonth()
    && next.getDate() === today.getDate();

  if (isToday) return formatTime(next);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = next.getFullYear() === tomorrow.getFullYear()
    && next.getMonth() === tomorrow.getMonth()
    && next.getDate() === tomorrow.getDate();

  if (isTomorrow) return `tmrw ${formatTime(next)}`;

  return `${next.getMonth() + 1}/${next.getDate()} ${formatTime(next)}`;
}

interface Props {
  client: DaemonClient;
  workflows: WorkflowEntry[];
  onAdd: () => void;
  onHistory: (workflowId: string) => void;
  onViewOutput: (run: RunRecord, fromWorkflowId: string) => void;
  onViewYaml: (filePath: string) => void;
  onRefresh: () => void;
}

export function WorkflowList({ client, workflows, onAdd, onHistory, onViewOutput, onViewYaml, onRefresh }: Props) {
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
    if (input === "v") {
      onViewYaml(wf.filePath);
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
          {"Next Run".padEnd(14)}
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
          ? lastRun.status === "success" ? "✅ success" : lastRun.status === "error" ? "❌ failed" : "🔄 running"
          : "—";
        const nextRunStr = formatNextRun(wf, lastRun);
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
              {nextRunStr.padEnd(14)}
              {lastRunStr.padEnd(14)}
              {wf.filePath}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
