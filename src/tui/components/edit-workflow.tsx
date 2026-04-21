import React, { useReducer, useCallback, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DaemonClient } from "../scheduler/daemon-client.js";
import type { WorkflowEntry } from "../scheduler/types.js";

interface Props {
  client: DaemonClient;
  workflow: WorkflowEntry;
  onDone: () => void;
}

type Field = "name" | "filePath" | "schedule" | "scheduleNum" | "scheduleUnit" | "submit";

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
  // Structured schedule (when parseable)
  scheduleNum: string;
  scheduleUnit: ScheduleUnit;
  // Raw schedule (for cron or unparseable formats)
  rawSchedule: string;
  useRawSchedule: boolean;
}

type Action =
  | { type: "next_field" }
  | { type: "prev_field" }
  | { type: "append"; char: string }
  | { type: "delete_char" }
  | { type: "cycle_unit"; dir: 1 | -1 };

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
    ? ["name", "filePath", "schedule", "submit"]
    : ["name", "filePath", "scheduleNum", "scheduleUnit", "submit"];
}

function reducer(state: FormState, action: Action): FormState {
  const fields = getFields(state.useRawSchedule);

  switch (action.type) {
    case "next_field": {
      const idx = fields.indexOf(state.field);
      if (idx < fields.length - 1) {
        return { ...state, field: fields[idx + 1] };
      }
      return state;
    }
    case "prev_field": {
      const idx = fields.indexOf(state.field);
      if (idx > 0) {
        return { ...state, field: fields[idx - 1] };
      }
      return state;
    }
    case "append": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit") return state;
      if (f === "scheduleNum") {
        if (!/^\d$/.test(action.char)) return state;
        return { ...state, scheduleNum: state.scheduleNum + action.char };
      }
      if (f === "schedule") {
        return { ...state, rawSchedule: state.rawSchedule + action.char };
      }
      return { ...state, [f]: (state[f] as string) + action.char };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit") return state;
      if (f === "scheduleNum") {
        return { ...state, scheduleNum: state.scheduleNum.slice(0, -1) };
      }
      if (f === "schedule") {
        return { ...state, rawSchedule: state.rawSchedule.slice(0, -1) };
      }
      return { ...state, [f]: (state[f] as string).slice(0, -1) };
    }
    case "cycle_unit": {
      const idx = UNITS.indexOf(state.scheduleUnit);
      const next = (idx + action.dir + UNITS.length) % UNITS.length;
      return { ...state, scheduleUnit: UNITS[next] };
    }
    default:
      return state;
  }
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
  };
}

export function EditWorkflow({ client, workflow, onDone }: Props) {
  const [state, dispatch] = useReducer(reducer, buildInitialState(workflow));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [error, setError] = useState<string | null>(null);

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

          if (Object.keys(patch).length === 0) {
            // Nothing changed
            onDone();
            return;
          }

          setError(null);
          client
            .updateWorkflow(workflow.id, patch)
            .then(onDone)
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Failed to update workflow");
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
          <Text>
            {state.name}
            {state.field === "name" ? "▋" : ""}
          </Text>
        </Box>
        <Box>
          <Text color={fieldColor("filePath")}>File: </Text>
          <Text>
            {state.filePath}
            {state.field === "filePath" ? "▋" : ""}
          </Text>
        </Box>

        {state.useRawSchedule ? (
          <Box>
            <Text color={fieldColor("schedule")}>Schedule: </Text>
            <Text>
              {state.rawSchedule}
              {state.field === "schedule" ? "▋" : ""}
            </Text>
          </Box>
        ) : (
          <Box>
            <Text color={isScheduleActive ? "cyan" : "gray"}>Schedule: </Text>
            <Text color={fieldColor("scheduleNum")}>every </Text>
            <Text>
              {state.scheduleNum || (state.field === "scheduleNum" ? "" : "…")}
              {state.field === "scheduleNum" ? "▋" : ""}
            </Text>
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

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
