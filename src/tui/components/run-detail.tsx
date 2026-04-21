import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { RunRecord } from "../scheduler/types.js";
import type { DaemonClient } from "../scheduler/daemon-client.js";

interface StepProgressInfo {
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  status: "running" | "complete" | "skipped";
}

interface Props {
  run: RunRecord;
  availableHeight: number;
  client?: DaemonClient;
  stepHistory: Map<string, StepProgressInfo[]>;
  onBack: () => void;
}

export function RunDetail({ run: initialRun, availableHeight, client, stepHistory, onBack }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null);
  const [liveRun, setLiveRun] = useState<RunRecord>(initialRun);

  // Steps come from App-level stepHistory (survives view transitions)
  const steps = stepHistory.get(initialRun.id) ?? [];

  // Listen for daemon events to update run data
  useEffect(() => {
    if (!client) return;
    const onEvent = (evt: any) => {
      if ((evt.kind === "run-complete" || evt.kind === "approval-pending") && evt.run?.id === liveRun.id) {
        setLiveRun(evt.run);
      }
    };
    client.on("event", onEvent);
    return () => { client.off("event", onEvent); };
  }, [client, liveRun.id]);

  const run = liveRun;
  const isPendingApproval = !resolved && run.status === "pending-approval" && !!run.approvalInfo;
  const isRunning = run.status === "running";
  const showSteps = steps.length > 0 || isRunning;
  // Chrome: header(1) + input(margin+hdr+4fields=6) + result(margin+hdr+3fields=5) + output(margin+hdr=2) + scroll hint(1) + approval(~5) + steps(margin+hdr+items)
  const approvalChrome = isPendingApproval ? 5 : 0;
  const stepsChrome = showSteps ? 2 + Math.min(steps.length || 1, 8) : 0;
  const VISIBLE_LINES = Math.max(3, availableHeight - 14 - approvalChrome - stepsChrome);

  const outputLines = (run.output ?? run.error ?? "No output").split("\n");

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setScrollOffset((o) => Math.max(0, o - 1));
    if (key.downArrow)
      setScrollOffset((o) => Math.min(o + 1, Math.max(0, outputLines.length - VISIBLE_LINES)));

    if (isPendingApproval && client) {
      if (input === "y") {
        setResolved("approved");
        client.resolveApproval(run.id, true).catch(() => {});
      }
      if (input === "n") {
        setResolved("rejected");
        client.resolveApproval(run.id, false).catch(() => {});
      }
    }
  });

  const dur = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—";
  const statusColor =
    run.status === "success" ? "green"
      : run.status === "error" ? "red"
      : run.status === "rejected" ? "magenta"
      : run.status === "pending-approval" ? "yellow"
      : "yellow";

  const visibleLines = outputLines.slice(
    scrollOffset,
    scrollOffset + VISIBLE_LINES,
  );

  return (
    <Box flexDirection="column">
      <Text bold>Run Detail — Esc to go back</Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">── Input ──</Text>
        <Box>
          <Text color="gray">File:      </Text>
          <Text>{run.input.filePath}</Text>
        </Box>
        <Box>
          <Text color="gray">Schedule:  </Text>
          <Text>{run.input.schedule}</Text>
        </Box>
        <Box>
          <Text color="gray">Trigger:   </Text>
          <Text>{run.triggeredBy}</Text>
        </Box>
        <Box>
          <Text color="gray">Args:      </Text>
          <Text>{run.input.args ? JSON.stringify(run.input.args) : "none"}</Text>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">── Result ──</Text>
        <Box>
          <Text color="gray">Status:    </Text>
          <Text color={statusColor}>{run.status}</Text>
        </Box>
        <Box>
          <Text color="gray">Started:   </Text>
          <Text>{new Date(run.triggeredAt).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Duration:  </Text>
          <Text>{dur}</Text>
        </Box>
      </Box>

      {showSteps && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="gray">── Steps {steps.length > 0 ? `(${steps.filter(s => s.status === "complete").length}/${steps[0]?.totalSteps ?? "?"})` : ""} ──</Text>
          {steps.length === 0 && isRunning && (
            <Text color="yellow">🔄 Starting…</Text>
          )}
          {steps.map((s) => {
            const icon = s.status === "complete" ? "✅"
              : s.status === "skipped" ? "⏭️"
              : "🔄";
            const color = s.status === "complete" ? "green"
              : s.status === "skipped" ? "gray"
              : "yellow";
            return (
              <Text key={s.stepIndex} color={color}>
                {icon} {s.stepIndex + 1}. {s.stepId}
              </Text>
            );
          })}
        </Box>
      )}

      {isPendingApproval && (
        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">⏳ Approval Required</Text>
          <Text>
            <Text color="gray">Prompt: </Text>
            {run.approvalInfo!.prompt}
          </Text>
          {run.approvalInfo!.items.length > 0 && (
            <Text>
              <Text color="gray">Items:  </Text>
              {run.approvalInfo!.items.map((item) =>
                typeof item === "string" ? item : JSON.stringify(item),
              ).join(", ")}
            </Text>
          )}
          <Text>Press y to approve, n to reject</Text>
        </Box>
      )}

      {resolved && (
        <Box marginTop={1}>
          <Text bold color={resolved === "approved" ? "green" : "magenta"}>
            {resolved === "approved" ? "✅ Approved" : "🚫 Rejected"} — press Esc to go back
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">
          ── Output ({outputLines.length} lines) ──
        </Text>
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="wrap">
            {line}
          </Text>
        ))}
        {outputLines.length > VISIBLE_LINES && (
          <Text color="gray" dimColor>
            ↑/↓ to scroll ({scrollOffset + 1}-
            {Math.min(scrollOffset + VISIBLE_LINES, outputLines.length)}/
            {outputLines.length})
          </Text>
        )}
      </Box>
    </Box>
  );
}
