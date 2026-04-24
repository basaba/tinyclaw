import React, { useReducer, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { WorkflowEntry } from "../scheduler/types.js";

interface Props {
  client: DaemonClient;
  workflow: WorkflowEntry;
  onDone: () => void;
}

type Field = "name" | "filePath" | "schedule" | "scheduleNum" | "scheduleUnit" | "argsJson" | "submit";

const UNITS = ["min", "hour", "day"] as const;
type ScheduleUnit = (typeof UNITS)[number];

const UNIT_LABELS: Record<ScheduleUnit, string> = {
  min: "min",
  hour: "hour",
  day: "day",
};

interface FormState {
  field: Field;
  name: string;
  filePath: string;
  scheduleNum: string;
  scheduleUnit: ScheduleUnit;
  rawSchedule: string;
  useRawSchedule: boolean;
  argsJson: string;
  cursor: number;
  error: string;
}

type Action =
  | { type: "next_field" }
  | { type: "prev_field" }
  | { type: "append"; char: string }
  | { type: "delete_char" }
  | { type: "move_cursor"; dir: "left" | "right" | "home" | "end" }
  | { type: "cycle_unit"; dir: 1 | -1 }
  | { type: "set_error"; error: string };

const INTERVAL_RE = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?)$/i;

function parseSchedule(schedule: string): { num: string; unit: ScheduleUnit } | null {
  const m = INTERVAL_RE.exec(schedule.trim());
  if (!m) return null;
  const num = m[1];
  const u = m[2].toLowerCase();
  let unit: ScheduleUnit;
  if (u.startsWith("d")) unit = "day";
  else if (u.startsWith("h")) unit = "hour";
  else unit = "min";
  return { num, unit };
}

function getFields(useRaw: boolean): Field[] {
  return useRaw
    ? ["name", "filePath", "schedule", "argsJson", "submit"]
    : ["name", "filePath", "scheduleNum", "scheduleUnit", "argsJson", "submit"];
}

function getFieldValue(state: FormState): string {
  const f = state.field;
  if (f === "scheduleNum") return state.scheduleNum;
  if (f === "argsJson") return state.argsJson;
  if (f === "schedule") return state.rawSchedule;
  if (f === "submit" || f === "scheduleUnit") return "";
  return state[f] as string;
}

function reducer(state: FormState, action: Action): FormState {
  const fields = getFields(state.useRawSchedule);

  switch (action.type) {
    case "next_field": {
      const idx = fields.indexOf(state.field);
      if (idx < fields.length - 1) {
        const next = fields[idx + 1];
        const val = next === "scheduleNum" ? state.scheduleNum
          : next === "argsJson" ? state.argsJson
          : next === "schedule" ? state.rawSchedule
          : next === "submit" || next === "scheduleUnit" ? ""
          : (state[next] as string);
        return { ...state, field: next, cursor: val.length };
      }
      return state;
    }
    case "prev_field": {
      const idx = fields.indexOf(state.field);
      if (idx > 0) {
        const prev = fields[idx - 1];
        const val = prev === "scheduleNum" ? state.scheduleNum
          : prev === "argsJson" ? state.argsJson
          : prev === "schedule" ? state.rawSchedule
          : prev === "submit" || prev === "scheduleUnit" ? ""
          : (state[prev] as string);
        return { ...state, field: prev, cursor: val.length };
      }
      return state;
    }
    case "append": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (f === "scheduleNum" && !/^\d$/.test(action.char)) return state;
      const updated = cur.slice(0, pos) + action.char + cur.slice(pos);
      const extra = f === "argsJson" ? { error: "" } : {};
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: pos + 1, ...extra };
      if (f === "argsJson") return { ...state, argsJson: updated, cursor: pos + 1, ...extra };
      if (f === "schedule") return { ...state, rawSchedule: updated, cursor: pos + 1 };
      return { ...state, [f]: updated, cursor: pos + 1, ...extra };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (pos === 0) return state;
      const updated = cur.slice(0, pos - 1) + cur.slice(pos);
      const extra = f === "argsJson" ? { error: "" } : {};
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: pos - 1, ...extra };
      if (f === "argsJson") return { ...state, argsJson: updated, cursor: pos - 1, ...extra };
      if (f === "schedule") return { ...state, rawSchedule: updated, cursor: pos - 1 };
      return { ...state, [f]: updated, cursor: pos - 1, ...extra };
    }
    case "move_cursor": {
      const cur = getFieldValue(state);
      let pos = state.cursor;
      if (action.dir === "left") pos = Math.max(0, pos - 1);
      else if (action.dir === "right") pos = Math.min(cur.length, pos + 1);
      else if (action.dir === "home") pos = 0;
      else if (action.dir === "end") pos = cur.length;
      return { ...state, cursor: pos };
    }
    case "cycle_unit": {
      const idx = UNITS.indexOf(state.scheduleUnit);
      const next = (idx + action.dir + UNITS.length) % UNITS.length;
      return { ...state, scheduleUnit: UNITS[next] };
    }
    case "set_error":
      return { ...state, error: action.error };
    default:
      return state;
  }
}

function TextWithCursor({ value, cursor, active }: { value: string; cursor: number; active: boolean }) {
  if (!active) return <Text>{value}</Text>;
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

function buildInitialState(wf: WorkflowEntry): FormState {
  const argsJson = wf.args ? JSON.stringify(wf.args) : "";
  const parsed = parseSchedule(wf.schedule);
  if (parsed) {
    return {
      field: "name",
      name: wf.name,
      filePath: wf.filePath,
      scheduleNum: parsed.num,
      scheduleUnit: parsed.unit,
      rawSchedule: wf.schedule,
      useRawSchedule: false,
      argsJson,
      cursor: 0,
      error: "",
    };
  }
  return {
    field: "name",
    name: wf.name,
    filePath: wf.filePath,
    scheduleNum: "",
    scheduleUnit: "min",
    rawSchedule: wf.schedule,
    useRawSchedule: true,
    argsJson,
    cursor: 0,
    error: "",
  };
}

export function EditWorkflow({ client, workflow, onDone }: Props) {
  const [state, dispatch] = useReducer(reducer, buildInitialState(workflow));
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleInput = useCallback(
    (
      input: string,
      key: {
        return: boolean;
        escape: boolean;
        backspace: boolean;
        delete: boolean;
        ctrl: boolean;
        meta: boolean;
        upArrow: boolean;
        downArrow: boolean;
        leftArrow: boolean;
        rightArrow: boolean;
        shift: boolean;
        tab: boolean;
      },
    ) => {
      if (key.escape) {
        onDone();
        return;
      }

      const s = stateRef.current;

      if (s.field === "submit") {
        if (key.return) {
          // Build patch with only changed fields
          const patch: Partial<WorkflowEntry> = {};

          const newName = s.name.trim();
          if (newName && newName !== workflow.name) patch.name = newName;

          const newFilePath = s.filePath.trim();
          if (newFilePath && newFilePath !== workflow.filePath) patch.filePath = newFilePath;

          let newSchedule: string;
          if (s.useRawSchedule) {
            newSchedule = s.rawSchedule.trim();
          } else {
            newSchedule = `every ${s.scheduleNum.trim()} ${s.scheduleUnit}`;
          }
          if (newSchedule && newSchedule !== workflow.schedule) patch.schedule = newSchedule;

          // Parse args JSON
          const trimmedArgs = s.argsJson.trim();
          const oldArgsJson = workflow.args ? JSON.stringify(workflow.args) : "";
          if (trimmedArgs !== oldArgsJson) {
            if (trimmedArgs) {
              try {
                patch.args = JSON.parse(trimmedArgs);
              } catch {
                dispatch({ type: "set_error", error: "Invalid JSON in Args" });
                return;
              }
            } else {
              patch.args = undefined;
            }
          }

          if (Object.keys(patch).length === 0) {
            // Nothing changed
            onDone();
            return;
          }

          dispatch({ type: "set_error", error: "" });
          client
            .updateWorkflow(workflow.id, patch)
            .then(onDone)
            .catch((err: unknown) => {
              dispatch({ type: "set_error", error: err instanceof Error ? err.message : "Failed to update workflow" });
            });
        }
        if (key.tab && key.shift) {
          dispatch({ type: "prev_field" });
        }
        return;
      }

      if (s.field === "scheduleUnit") {
        if (key.leftArrow || key.upArrow) {
          dispatch({ type: "cycle_unit", dir: -1 });
          return;
        }
        if (key.rightArrow || key.downArrow) {
          dispatch({ type: "cycle_unit", dir: 1 });
          return;
        }
      }

      // Cursor movement within text fields
      if (key.leftArrow) {
        dispatch({ type: "move_cursor", dir: key.ctrl ? "home" : "left" });
        return;
      }
      if (key.rightArrow) {
        dispatch({ type: "move_cursor", dir: key.ctrl ? "end" : "right" });
        return;
      }

      if (key.tab && key.shift) {
        dispatch({ type: "prev_field" });
        return;
      }

      if (key.return || key.tab) {
        dispatch({ type: "next_field" });
        return;
      }

      if (key.backspace || key.delete) {
        dispatch({ type: "delete_char" });
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        dispatch({ type: "append", char: input });
      }
    },
    [client, workflow, onDone],
  );

  useInput(handleInput);

  const fields = getFields(state.useRawSchedule);
  const fieldColor = (f: Field) => (fields.includes(f) && f === state.field ? "cyan" : "gray");
  const isScheduleActive = state.field === "scheduleNum" || state.field === "scheduleUnit";

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        Edit Workflow
      </Text>
      <Text color="gray">Enter/Tab to advance, Shift+Tab to go back, Esc to cancel</Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={fieldColor("name")}>Name: </Text>
          <TextWithCursor value={state.name} cursor={state.cursor} active={state.field === "name"} />
        </Box>
        <Box>
          <Text color={fieldColor("filePath")}>File: </Text>
          <TextWithCursor value={state.filePath} cursor={state.cursor} active={state.field === "filePath"} />
        </Box>

        {state.useRawSchedule ? (
          <Box>
            <Text color={fieldColor("schedule")}>Schedule: </Text>
            <TextWithCursor value={state.rawSchedule} cursor={state.cursor} active={state.field === "schedule"} />
          </Box>
        ) : (
          <Box>
            <Text color={isScheduleActive ? "cyan" : "gray"}>Schedule: </Text>
            <Text color={fieldColor("scheduleNum")}>every </Text>
            <TextWithCursor
              value={state.scheduleNum || (state.field === "scheduleNum" ? "" : "…")}
              cursor={state.cursor}
              active={state.field === "scheduleNum"}
            />
            <Text> </Text>
            {UNITS.map((u) => (
              <Text key={u}>
                {state.field === "scheduleUnit" && u === state.scheduleUnit ? (
                  <Text bold inverse color="cyan">{` ${UNIT_LABELS[u]} `}</Text>
                ) : u === state.scheduleUnit ? (
                  <Text bold color="cyan">{` ${UNIT_LABELS[u]} `}</Text>
                ) : (
                  <Text color="gray">{` ${UNIT_LABELS[u]} `}</Text>
                )}
              </Text>
            ))}
            {state.field === "scheduleUnit" && (
              <Text color="gray"> ◂/▸ to change</Text>
            )}
          </Box>
        )}

        <Box>
          <Text color={fieldColor("argsJson")}>Args (JSON): </Text>
          <TextWithCursor value={state.argsJson} cursor={state.cursor} active={state.field === "argsJson"} />
        </Box>
        {state.error ? (
          <Box>
            <Text color="red">⚠ {state.error}</Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          {state.field === "submit" ? (
            <Text bold inverse color="green">
              {" [ Save ] "}
            </Text>
          ) : (
            <Text color="gray">
              {" [ Save ] "}
            </Text>
          )}
          {state.field === "submit" && (
            <Text color="gray"> press Enter to save</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
