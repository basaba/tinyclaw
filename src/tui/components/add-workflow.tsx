import React, { useReducer, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { randomUUID } from "node:crypto";
import type { DaemonClient } from "../scheduler/daemon-client.js";

interface Props {
  client: DaemonClient;
  onDone: () => void;
}

type Field = "name" | "filePath" | "scheduleNum" | "scheduleUnit" | "confirm";
const FIELDS: Field[] = ["name", "filePath", "scheduleNum", "scheduleUnit", "confirm"];

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
}

type Action =
  | { type: "next_field" }
  | { type: "prev_field" }
  | { type: "append"; char: string }
  | { type: "delete_char" }
  | { type: "cycle_unit"; dir: 1 | -1 };

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case "next_field": {
      const idx = FIELDS.indexOf(state.field);
      if (idx < FIELDS.length - 1) {
        return { ...state, field: FIELDS[idx + 1] };
      }
      return state;
    }
    case "prev_field": {
      const idx = FIELDS.indexOf(state.field);
      if (idx > 0) {
        return { ...state, field: FIELDS[idx - 1] };
      }
      return state;
    }
    case "append": {
      const f = state.field;
      if (f === "confirm" || f === "scheduleUnit") return state;
      if (f === "scheduleNum") {
        if (!/^\d$/.test(action.char)) return state;
        return { ...state, scheduleNum: state.scheduleNum + action.char };
      }
      return { ...state, [f]: (state[f] as string) + action.char };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "confirm" || f === "scheduleUnit") return state;
      if (f === "scheduleNum") {
        return { ...state, scheduleNum: state.scheduleNum.slice(0, -1) };
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

const INITIAL_STATE: FormState = {
  field: "name",
  name: "",
  filePath: "",
  scheduleNum: "",
  scheduleUnit: "min",
};

function formatSchedule(num: string, unit: ScheduleUnit): string {
  return `every ${num} ${unit}`;
}

export function AddWorkflow({ client, onDone }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleInput = useCallback(
    (input: string, key: { return: boolean; escape: boolean; backspace: boolean; delete: boolean; ctrl: boolean; meta: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; shift: boolean; tab: boolean }) => {
      if (key.escape) {
        onDone();
        return;
      }

      const s = stateRef.current;

      if (s.field === "confirm") {
        if (input === "y" || key.return) {
          client
            .addWorkflow({
              id: randomUUID().slice(0, 8),
              name: s.name.trim(),
              filePath: s.filePath.trim(),
              schedule: formatSchedule(s.scheduleNum.trim(), s.scheduleUnit),
              enabled: true,
            })
            .then(onDone)
            .catch(() => onDone());
        } else if (input === "n") {
          onDone();
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
    [client, onDone],
  );

  useInput(handleInput);

  const fieldColor = (f: Field) => (f === state.field ? "cyan" : "gray");
  const isScheduleActive = state.field === "scheduleNum" || state.field === "scheduleUnit";

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Add New Workflow
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
        {state.field === "confirm" && (
          <Box marginTop={1}>
            <Text bold color="yellow">
              Add &quot;{state.name}&quot; ({formatSchedule(state.scheduleNum, state.scheduleUnit)})? (y/n)
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
