import React, { useReducer, useCallback, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { resolve } from "node:path";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { WorkflowEntry } from "../scheduler/types.js";
import { ArgsTable, argsToRows, rowsToArgs, type ArgRow } from "./args-table.js";
import { FilePicker } from "./file-picker.js";
import { YamlView } from "./yaml-view.js";

interface Props {
  client: DaemonClient;
  workflow: WorkflowEntry;
  availableHeight: number;
  onDone: () => void;
}

type Field = "name" | "filePath" | "schedule" | "scheduleNum" | "scheduleUnit" | "args" | "submit";

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
  | { type: "set_error"; error: string }
  | { type: "set_filepath"; value: string; cursor: number };

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
    ? ["name", "filePath", "schedule", "args", "submit"]
    : ["name", "filePath", "scheduleNum", "scheduleUnit", "args", "submit"];
}

function getFieldValue(state: FormState): string {
  const f = state.field;
  if (f === "scheduleNum") return state.scheduleNum;
  if (f === "schedule") return state.rawSchedule;
  if (f === "submit" || f === "scheduleUnit" || f === "args") return "";
  return state[f] as string;
}

function reducer(state: FormState, action: Action): FormState {
  const fields = getFields(state.useRawSchedule);

  switch (action.type) {
    case "next_field": {
      const idx = fields.indexOf(state.field);
      const next = fields[(idx + 1) % fields.length];
      const val = next === "scheduleNum" ? state.scheduleNum
        : next === "schedule" ? state.rawSchedule
        : next === "submit" || next === "scheduleUnit" || next === "args" ? ""
        : (state[next] as string);
      return { ...state, field: next, cursor: val.length };
    }
    case "prev_field": {
      const idx = fields.indexOf(state.field);
      const prev = fields[(idx - 1 + fields.length) % fields.length];
      const val = prev === "scheduleNum" ? state.scheduleNum
        : prev === "schedule" ? state.rawSchedule
        : prev === "submit" || prev === "scheduleUnit" || prev === "args" ? ""
        : (state[prev] as string);
      return { ...state, field: prev, cursor: val.length };
    }
    case "append": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit" || f === "args") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (f === "scheduleNum" && !/^\d$/.test(action.char)) return state;
      const updated = cur.slice(0, pos) + action.char + cur.slice(pos);
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: pos + 1 };
      if (f === "schedule") return { ...state, rawSchedule: updated, cursor: pos + 1 };
      return { ...state, [f]: updated, cursor: pos + 1 };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit" || f === "args") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (pos === 0) return state;
      const updated = cur.slice(0, pos - 1) + cur.slice(pos);
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: pos - 1 };
      if (f === "schedule") return { ...state, rawSchedule: updated, cursor: pos - 1 };
      return { ...state, [f]: updated, cursor: pos - 1 };
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
    case "set_filepath":
      return { ...state, filePath: action.value, cursor: action.cursor };
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
    cursor: 0,
    error: "",
  };
}

export function EditWorkflow({ client, workflow, availableHeight, onDone }: Props) {
  const [state, dispatch] = useReducer(reducer, buildInitialState(workflow));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [argRows, setArgRows] = useState<ArgRow[]>(() => argsToRows(workflow.args));
  const argRowsRef = useRef(argRows);
  argRowsRef.current = argRows;
  const [viewing, setViewing] = useState(false);

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

      // Ctrl+O to view file
      if (input === "o" && key.ctrl && s.filePath.trim()) {
        setViewing(true);
        return;
      }

      if (s.field === "submit") {
        if (key.return) {
          // Build patch with only changed fields
          const patch: Partial<WorkflowEntry> = {};

          const newName = s.name.trim();
          if (newName && newName !== workflow.name) patch.name = newName;

          const newFilePath = resolve(s.filePath.trim());
          if (newFilePath && newFilePath !== workflow.filePath) patch.filePath = newFilePath;

          let newSchedule: string;
          if (s.useRawSchedule) {
            newSchedule = s.rawSchedule.trim();
          } else {
            newSchedule = `every ${s.scheduleNum.trim()} ${s.scheduleUnit}`;
          }
          if (newSchedule && newSchedule !== workflow.schedule) patch.schedule = newSchedule;

          // Build args from table rows
          const newArgs = rowsToArgs(argRowsRef.current);
          const oldArgsJson = workflow.args ? JSON.stringify(workflow.args) : "";
          const newArgsJson = newArgs ? JSON.stringify(newArgs) : "";
          if (newArgsJson !== oldArgsJson) {
            patch.args = newArgs;
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
        } else if (key.tab) {
          dispatch({ type: "next_field" });
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

  useInput(handleInput, { isActive: !viewing && state.field !== "args" && state.field !== "filePath" });

  const handleArgsExit = useCallback((dir: "next" | "prev") => {
    dispatch({ type: dir === "next" ? "next_field" : "prev_field" });
  }, []);

  if (viewing) {
    return (
      <YamlView
        filePath={state.filePath.trim()}
        availableHeight={availableHeight}
        onBack={() => setViewing(false)}
      />
    );
  }

  const fields = getFields(state.useRawSchedule);
  const fieldColor = (f: Field) => (fields.includes(f) && f === state.field ? "cyan" : "gray");
  const isScheduleActive = state.field === "scheduleNum" || state.field === "scheduleUnit";

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        Edit Workflow
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={fieldColor("name")}>Name: </Text>
          <TextWithCursor value={state.name} cursor={state.cursor} active={state.field === "name"} />
        </Box>
        <FilePicker
          value={state.filePath}
          cursor={state.cursor}
          active={state.field === "filePath"}
          onChange={(v, c) => {
            dispatch({ type: "set_filepath", value: v, cursor: c });
          }}
          onNext={() => dispatch({ type: "next_field" })}
          onPrev={() => dispatch({ type: "prev_field" })}
          onView={state.filePath.trim() ? () => setViewing(true) : undefined}
        />

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

        <ArgsTable rows={argRows} onChange={setArgRows} active={state.field === "args"} onExit={handleArgsExit} />
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
