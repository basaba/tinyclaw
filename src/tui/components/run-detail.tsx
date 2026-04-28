import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { RunRecord } from "../scheduler/types.js";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import { shortenPath } from "../utils/file-scanner.js";

interface Props {
  run: RunRecord;
  availableHeight: number;
  client?: DaemonClient;
  liveOutput: Map<string, string>;
  onBack: () => void;
  onOpenFile: (filePath: string) => void;
}

// Format a value for display without raw JSON
function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "(none)";
    // Array of primitives: join with commas
    if (v.every((item) => typeof item === "string" || typeof item === "number"))
      return v.join(", ");
    return `${v.length} items`;
  }
  if (typeof v === "object") {
    // Flat object: show as "key: val, key: val"
    const entries = Object.entries(v as Record<string, unknown>);
    const parts = entries.map(([k, val]) =>
      `${k}: ${typeof val === "string" || typeof val === "number" || typeof val === "boolean" ? String(val) : "…"}`,
    );
    return parts.join(", ");
  }
  return String(v);
}

// Format a single approval item for display.
// Renders known fields on labeled lines, falls back to readable format for unknowns.
function formatApprovalItem(item: unknown, index: number): string[] {
  if (typeof item === "string") return [`${item}`];
  if (item == null) return ["(empty)"];
  if (typeof item !== "object") return [String(item)];

  const obj = item as Record<string, unknown>;
  const lines: string[] = [];

  // Title line: use subject, name, title, or id as the heading
  const heading = obj.subject ?? obj.title ?? obj.name ?? obj.id;
  if (heading) {
    lines.push(`#${index + 1}: ${String(heading)}`);
  } else {
    lines.push(`#${index + 1}`);
  }

  // Render well-known fields with labels
  const knownFields: Array<[string, string]> = [
    ["from", "From"],
    ["to", "To"],
    ["category", "Category"],
    ["summary", "Summary"],
    ["replyText", "Reply"],
    ["bodyPreview", "Preview"],
    ["status", "Status"],
    ["description", "Desc"],
    ["message", "Message"],
    ["url", "URL"],
  ];

  const rendered = new Set<string>(["subject", "title", "name", "id"]);
  for (const [key, label] of knownFields) {
    if (key in obj && obj[key] != null) {
      const val = formatValue(obj[key]);
      if (val.length > 80) {
        lines.push(`  ${label}: ${val.slice(0, 77)}...`);
      } else {
        lines.push(`  ${label}: ${val}`);
      }
      rendered.add(key);
    }
  }

  // Show remaining fields compactly, formatting nested values readably
  const remaining = Object.entries(obj).filter(([k]) => !rendered.has(k));
  if (remaining.length > 0) {
    for (const [k, v] of remaining) {
      const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
      const val = formatValue(v);
      if (val.length > 60) {
        lines.push(`  ${label}: ${val.slice(0, 57)}...`);
      } else {
        lines.push(`  ${label}: ${val}`);
      }
    }
  }

  return lines;
}

export function RunDetail({ run: initialRun, availableHeight, client, liveOutput, onBack, onOpenFile }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [itemScrollOffset, setItemScrollOffset] = useState(0);
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null);
  const [liveRun, setLiveRun] = useState<RunRecord>(initialRun);

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

  // Format approval items into displayable lines
  const approvalItemLines: string[] = isPendingApproval && run.approvalInfo!.items.length > 0
    ? run.approvalInfo!.items.flatMap((item, i) => [
        ...formatApprovalItem(item, i),
        "",  // blank separator between items
      ]).slice(0, -1)  // remove trailing blank
    : [];

  // Chrome: header(1) + input(margin+hdr+4fields=6) + result(margin+hdr+3-4fields=5-6) + output(margin+hdr=2) + scroll hint(1) + steps(margin+hdr+items)
  // Approval section: border(2) + prompt(1) + preview?(1) + header(1) + visible items + hint(1) + action(1)
  const MAX_APPROVAL_ITEM_LINES = 8;
  const visibleApprovalItemCount = Math.min(approvalItemLines.length, MAX_APPROVAL_ITEM_LINES);
  const approvalChrome = isPendingApproval
    ? 2 + 1 + (run.approvalInfo!.preview && approvalItemLines.length === 0 ? 1 : 0) + (approvalItemLines.length > 0 ? 1 + visibleApprovalItemCount + (approvalItemLines.length > MAX_APPROVAL_ITEM_LINES ? 1 : 0) : 0) + 1
    : 0;
  const VISIBLE_LINES = Math.max(3, availableHeight - 14 - approvalChrome);

  const isRunning = run.status === "running";
  const streamingText = liveOutput.get(run.id);

  // Logs: stored logs from engine, or accumulated live output
  const logsText = run.logs || (liveOutput.get(run.id) || null);
  const logsLines = logsText ? logsText.split("\n") : [];

  // Output: workflow result (only after completion)
  const outputText = !isRunning
    ? (run.output ?? run.error ?? "No output")
    : "⏳ Workflow is running…";
  const outputLines = outputText.split("\n");

  // Split available height: give logs up to 1/3, rest to output
  const hasLogs = logsLines.length > 0;
  const LOG_LINES = hasLogs ? Math.min(Math.max(3, Math.floor(VISIBLE_LINES / 3)), logsLines.length) : 0;
  const OUTPUT_LINES = Math.max(3, VISIBLE_LINES - LOG_LINES - (hasLogs ? 1 : 0));

  const [logsScrollOffset, setLogsScrollOffset] = useState(0);

  // Auto-scroll logs to bottom when new live output arrives
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (isRunning && autoScroll && logsLines.length > LOG_LINES) {
      setLogsScrollOffset(Math.max(0, logsLines.length - LOG_LINES));
    }
  }, [logsLines.length, isRunning, autoScroll, LOG_LINES]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (isPendingApproval) {
      // In approval mode, arrows scroll the items list
      if (key.upArrow) setItemScrollOffset((o) => Math.max(0, o - 1));
      if (key.downArrow)
        setItemScrollOffset((o) => Math.min(o + 1, Math.max(0, approvalItemLines.length - MAX_APPROVAL_ITEM_LINES)));
    } else if (isRunning && hasLogs) {
      // While running, scroll the logs section
      if (key.upArrow) {
        setAutoScroll(false);
        setLogsScrollOffset((o) => Math.max(0, o - 1));
      }
      if (key.downArrow) {
        setLogsScrollOffset((o) => {
          const next = Math.min(o + 1, Math.max(0, logsLines.length - LOG_LINES));
          if (next >= logsLines.length - LOG_LINES) setAutoScroll(true);
          return next;
        });
      }
    } else {
      // Scroll the output section
      if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      }
      if (key.downArrow) {
        setScrollOffset((o) => Math.min(o + 1, Math.max(0, outputLines.length - OUTPUT_LINES)));
      }
    }

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

    if (input === "o" || input === "v") {
      onOpenFile(run.input.filePath);
    }
  });

  const dur = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—";
  const statusColor =
    run.status === "success" ? "green"
      : run.status === "error" ? "red"
      : run.status === "rejected" ? "magenta"
      : run.status === "pending-approval" ? "yellow"
      : "yellow";

  return (
    <Box flexDirection="column">
      <Text bold>Run Detail — Esc to go back | o: open file</Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">── Input ──</Text>
        <Box>
          <Text color="gray">File:      </Text>
          <Text>{shortenPath(run.input.filePath)}</Text>
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

      {isPendingApproval && (
        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">⏳ Approval Required</Text>
          <Text>
            <Text color="gray">Prompt: </Text>
            {run.approvalInfo!.prompt}
          </Text>
          {run.approvalInfo!.preview && approvalItemLines.length === 0 && (
            <Text wrap="wrap">
              <Text color="gray">Preview: </Text>
              {run.approvalInfo!.preview}
            </Text>
          )}
          {approvalItemLines.length > 0 && (
            <Box flexDirection="column" marginTop={0}>
              <Text bold color="gray">── Items ({run.approvalInfo!.items.length}) ──</Text>
              {approvalItemLines
                .slice(itemScrollOffset, itemScrollOffset + MAX_APPROVAL_ITEM_LINES)
                .map((line, i) => (
                  <Text key={i} color={line.startsWith("#") ? "white" : "gray"} bold={line.startsWith("#")} wrap="truncate">
                    {line}
                  </Text>
                ))}
              {approvalItemLines.length > MAX_APPROVAL_ITEM_LINES && (
                <Text color="gray" dimColor>
                  ↑/↓ to scroll ({itemScrollOffset + 1}-
                  {Math.min(itemScrollOffset + MAX_APPROVAL_ITEM_LINES, approvalItemLines.length)}/
                  {approvalItemLines.length})
                </Text>
              )}
            </Box>
          )}
          <Text>Press <Text bold color="green">y</Text> to approve, <Text bold color="red">n</Text> to reject</Text>
        </Box>
      )}

      {resolved && (
        <Box marginTop={1}>
          <Text bold color={resolved === "approved" ? "green" : "magenta"}>
            {resolved === "approved" ? "✅ Approved" : "🚫 Rejected"} — press Esc to go back
          </Text>
        </Box>
      )}

      {hasLogs && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="gray">
            ── Logs{isRunning && streamingText ? " 🔴 Live" : ""} ──
          </Text>
          {logsLines
            .slice(logsScrollOffset, logsScrollOffset + LOG_LINES)
            .map((line, i) => (
              <Text key={i} wrap="wrap">{line}</Text>
            ))}
          {logsLines.length > LOG_LINES && (
            <Text color="gray" dimColor>
              ↑/↓ to scroll ({logsScrollOffset + 1}-
              {Math.min(logsScrollOffset + LOG_LINES, logsLines.length)}/
              {logsLines.length})
            </Text>
          )}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">── Output ──</Text>
        {outputLines
          .slice(scrollOffset, scrollOffset + OUTPUT_LINES)
          .map((line, i) => (
            <Text key={i} wrap="wrap">{line}</Text>
          ))}
        {outputLines.length > OUTPUT_LINES && (
          <Text color="gray" dimColor>
            ↑/↓ to scroll ({scrollOffset + 1}-
            {Math.min(scrollOffset + OUTPUT_LINES, outputLines.length)}/
            {outputLines.length})
          </Text>
        )}
      </Box>
    </Box>
  );
}
