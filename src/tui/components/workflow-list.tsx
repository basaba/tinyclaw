import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { RunRecord, WorkflowEntry } from "../scheduler/types.js";
import { getRunsForWorkflow } from "../scheduler/config.js";
import { basename } from "node:path";

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

const DAILY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;
const NDAY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d+)\s+\*\s+\*$/;
const WEEKLY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cronTimeStr(minute: string, hourStr: string): string {
  const h = parseInt(hourStr, 10);
  const m = minute.padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatScheduleDisplay(schedule: string): string {
  const s = schedule.trim();
  const cm = DAILY_CRON_RE.exec(s);
  if (cm) return `daily ${cronTimeStr(cm[1], cm[2])}`;

  const nd = NDAY_CRON_RE.exec(s);
  if (nd) return `every ${nd[3]}d ${cronTimeStr(nd[1], nd[2])}`;

  const wk = WEEKLY_CRON_RE.exec(s);
  if (wk) return `${DAY_NAMES[parseInt(wk[3], 10)]} ${cronTimeStr(wk[1], wk[2])}`;

  return schedule;
}

function formatNextRun(wf: WorkflowEntry, lastRun: RunRecord | null): string {
  if (!wf.enabled) return "paused";

  const intervalMs = parseIntervalMs(wf.schedule);
  if (intervalMs) {
    if (!lastRun) return "soon";
    const lastTime = new Date(lastRun.completedAt ?? lastRun.triggeredAt).getTime();
    const nextTime = lastTime + intervalMs;
    const nowMs = Date.now();
    if (nextTime <= nowMs) return "soon";
    const next = new Date(nextTime);
    return formatNextDate(next);
  }

  // Daily cron: M H * * *
  const cm = DAILY_CRON_RE.exec(wf.schedule.trim());
  if (cm) {
    const minute = parseInt(cm[1], 10);
    const hour = parseInt(cm[2], 10);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return formatNextDate(next);
  }

  // Every N days cron: M H */N * *
  const nd = NDAY_CRON_RE.exec(wf.schedule.trim());
  if (nd) {
    const minute = parseInt(nd[1], 10);
    const hour = parseInt(nd[2], 10);
    const n = parseInt(nd[3], 10);
    if (lastRun) {
      const lastTime = new Date(lastRun.completedAt ?? lastRun.triggeredAt).getTime();
      const nextTime = lastTime + n * 86_400_000;
      if (nextTime <= Date.now()) return "soon";
      return formatNextDate(new Date(nextTime));
    }
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return formatNextDate(next);
  }

  // Weekly cron: M H * * DOW
  const wk = WEEKLY_CRON_RE.exec(wf.schedule.trim());
  if (wk) {
    const minute = parseInt(wk[1], 10);
    const hour = parseInt(wk[2], 10);
    const dow = parseInt(wk[3], 10);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    const currentDow = now.getDay();
    let daysAhead = dow - currentDow;
    if (daysAhead < 0 || (daysAhead === 0 && next <= now)) daysAhead += 7;
    next.setDate(next.getDate() + daysAhead);
    return formatNextDate(next);
  }

  return "—";
}

function formatNextDate(next: Date): string {
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

function timeSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  client: DaemonClient;
  workflows: WorkflowEntry[];
  onAdd: () => void;
  onEdit: (workflowId: string) => void;
  onHistory: (workflowId: string) => void;
  onViewOutput: (run: RunRecord, fromWorkflowId: string) => void;
  onViewYaml: (filePath: string) => void;
  onViewGraph: (filePath: string) => void;
  onGallery?: () => void;
  onRefresh: () => void;
}

export function WorkflowList({ client, workflows, onAdd, onEdit, onHistory, onViewOutput, onViewYaml, onViewGraph, onGallery, onRefresh }: Props) {
  const [cursor, setCursor] = useState(0);
  const [pane, setPane] = useState<"workflows" | "approvals">("workflows");
  const [approvalCursor, setApprovalCursor] = useState(0);
  const [approvals, setApprovals] = useState<RunRecord[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refreshApprovals = useCallback(() => {
    client.listApprovals().then(setApprovals).catch(() => {});
  }, [client]);

  useEffect(() => {
    refreshApprovals();
    client.on("change", refreshApprovals);
    return () => { client.off("change", refreshApprovals); };
  }, [client, refreshApprovals]);

  // Keep cursors in bounds
  useEffect(() => {
    if (cursor >= workflows.length && workflows.length > 0) setCursor(workflows.length - 1);
  }, [workflows.length, cursor]);
  useEffect(() => {
    if (approvalCursor >= approvals.length && approvals.length > 0) setApprovalCursor(approvals.length - 1);
    if (approvals.length === 0 && pane === "approvals") setPane("workflows");
  }, [approvals.length, approvalCursor, pane]);

  const workflowName = (wfId: string) =>
    workflows.find((w) => w.id === wfId)?.name ?? wfId;

  useInput((input, key) => {
    // Delete confirmation
    if (confirmDelete) {
      if (input === "y" || input === "Y") {
        const wf = workflows[cursor];
        if (wf) {
          client.removeWorkflow(wf.id).then(() => {
            setCursor((c) => Math.min(c, workflows.length - 2));
            onRefresh();
          }).catch(() => {});
        }
        setConfirmDelete(false);
        return;
      }
      if (input === "n" || input === "N" || key.escape) {
        setConfirmDelete(false);
        return;
      }
      return;
    }

    // Tab switches pane
    if (key.tab) {
      setPane((p) => p === "workflows" ? (approvals.length > 0 ? "approvals" : "workflows") : "workflows");
      return;
    }

    if (pane === "approvals") {
      if (key.upArrow) setApprovalCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setApprovalCursor((c) => Math.min(approvals.length - 1, c + 1));
      if (input === "y" && approvals[approvalCursor]) {
        client.resolveApproval(approvals[approvalCursor].id, true).catch(() => {});
        return;
      }
      if (input === "n" && approvals[approvalCursor]) {
        client.resolveApproval(approvals[approvalCursor].id, false).catch(() => {});
        return;
      }
      if (key.return && approvals[approvalCursor]) {
        onViewOutput(approvals[approvalCursor], "");
      }
      return;
    }

    // Workflow pane
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
    if (input === "e") {
      onEdit(wf.id);
    }
    if (input === "d") {
      setConfirmDelete(true);
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
    if (input === "g") {
      onViewGraph(wf.filePath);
    }
    if (input === "s" && onGallery) {
      onGallery();
    }
  });

  const wfFocused = pane === "workflows";
  const apFocused = pane === "approvals";

  return (
    <Box flexDirection="column">
      {/* ── Workflows pane ── */}
      <Box flexDirection="column">
        <Box>
          <Text bold color={wfFocused ? "cyan" : "gray"}>
            📋 Workflows
          </Text>
        </Box>
        {workflows.length === 0 ? (
          <Text color="gray">  No workflows configured. Press a to add one.</Text>
        ) : (
          <>
            <Box>
              <Text bold color="gray">
                {"  "}
                {"Status".padEnd(10)}
                {"Name".padEnd(25)}
                {"Schedule".padEnd(20)}
                {"Next Run".padEnd(14)}
                {"Last Run".padEnd(14)}
                {"File"}
              </Text>
            </Box>
            {workflows.map((wf, i) => {
              const selected = wfFocused && i === cursor;
              const status = wf.enabled ? "✅" : "⏸️";
              const runs = getRunsForWorkflow(wf.id);
              const lastRun = runs.length > 0 ? runs[0] : null;
              const lastRunStr = lastRun
                ? lastRun.status === "success" ? "✅ success"
                  : lastRun.status === "error" ? "❌ failed"
                  : lastRun.status === "rejected" ? "🚫 rejected"
                  : lastRun.status === "pending-approval" ? "⏳ approval"
                  : "🔄 running"
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
                    {status.padEnd(10)}
                    {wf.name.padEnd(25)}
                    {formatScheduleDisplay(wf.schedule).padEnd(20)}
                    {nextRunStr.padEnd(14)}
                    {lastRunStr.padEnd(14)}
                    {basename(wf.filePath)}
                  </Text>
                </Box>
              );
            })}
          </>
        )}
      </Box>

      {confirmDelete && workflows[cursor] && (
        <Box marginTop={1}>
          <Text bold color="red">
            Delete "{workflows[cursor].name}"? (y/n)
          </Text>
        </Box>
      )}

      {/* ── Approvals pane ── */}
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text bold color={apFocused ? "yellow" : "gray"}>
            🔔 Pending Approvals
          </Text>
          <Text color="gray"> ({approvals.length})</Text>
          {approvals.length > 0 && !apFocused && (
            <Text color="gray"> — press Tab to focus</Text>
          )}
        </Box>

        {approvals.length === 0 ? (
          <Text color="gray">  No pending approvals</Text>
        ) : (
          approvals.map((run, i) => {
            const selected = apFocused && i === approvalCursor;
            const prompt = run.approvalInfo?.prompt ?? "Approval required";
            const truncPrompt = prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt;
            const age = timeSince(run.triggeredAt);
            return (
              <Box key={run.id}>
                <Text
                  color={selected ? "yellow" : undefined}
                  bold={selected}
                  inverse={selected}
                >
                  {selected ? "▸ " : "  "}
                  <Text color="yellow">⏳</Text>
                  {" "}{workflowName(run.workflowId).padEnd(20)}
                  {truncPrompt.padEnd(52)}
                  <Text color="gray">{age}</Text>
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
