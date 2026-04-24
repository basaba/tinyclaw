import React, { useReducer, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { randomUUID } from "node:crypto";
import type { DaemonClient } from "../scheduler/daemon-client.js";

interface Props {
  client: DaemonClient;
  onDone: () => void;
}

type Field = "name" | "filePath" | "scheduleNum" | "scheduleUnit" | "argsJson" | "submit";
const FIELDS: Field[] = ["name", "filePath", "scheduleNum", "scheduleUnit", "argsJson", "submit"];

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

/** Get the text value of the currently focused text field. */
function getFieldValue(state: FormState): string {
  const f = state.field;
  if (f === "scheduleNum") return state.scheduleNum;
  if (f === "argsJson") return state.argsJson;
  if (f === "submit" || f === "scheduleUnit") return "";
  return state[f] as string;
}

/** Insert text at cursor, delete at cursor, and move cursor. */
function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case "next_field": {
      const idx = FIELDS.indexOf(state.field);
      if (idx < FIELDS.length - 1) {
        const next = FIELDS[idx + 1];
        const val = next === "scheduleNum" ? state.scheduleNum
          : next === "argsJson" ? state.argsJson
          : next === "submit" || next === "scheduleUnit" ? ""
          : (state[next] as string);
        return { ...state, field: next, cursor: val.length };
      }
      return state;
    }
    case "prev_field": {
      const idx = FIELDS.indexOf(state.field);
      if (idx > 0) {
        const prev = FIELDS[idx - 1];
        const val = prev === "scheduleNum" ? state.scheduleNum
          : prev === "argsJson" ? state.argsJson
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

/** Render text with a visible cursor block at the given position. */
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

const INITIAL_STATE: FormState = {
  field: "name",
  name: "",
  filePath: "",
  scheduleNum: "",
  scheduleUnit: "min",
  argsJson: "",
  cursor: 0,
  error: "",
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

      if (s.field === "submit") {
        if (key.return) {
          let wfArgs: Record<string, unknown> | undefined;
          if (s.argsJson.trim()) {
            try {
              wfArgs = JSON.parse(s.argsJson.trim());
            } catch {
              dispatch({ type: "set_error", error: `Invalid JSON in Args: ${s.argsJson.trim()}` });
              return;
            }
          }
          client
            .addWorkflow({
              id: randomUUID().slice(0, 8),
              name: s.name.trim(),
              filePath: s.filePath.trim(),
              schedule: formatSchedule(s.scheduleNum.trim(), s.scheduleUnit),
              enabled: true,
              ...(wfArgs ? { args: wfArgs } : {}),
            })
            .then(onDone)
            .catch(() => onDone());
        }
        // Allow Shift+Tab to go back from submit
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
          <TextWithCursor value={state.name} cursor={state.cursor} active={state.field === "name"} />
        </Box>
        <Box>
          <Text color={fieldColor("filePath")}>File: </Text>
          <TextWithCursor value={state.filePath} cursor={state.cursor} active={state.field === "filePath"} />
        </Box>
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
              {" [ Add ] "}
            </Text>
          ) : (
            <Text color="gray">
              {" [ Add ] "}
            </Text>
          )}
          {state.field === "submit" && (
            <Text color="gray"> press Enter to submit</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
