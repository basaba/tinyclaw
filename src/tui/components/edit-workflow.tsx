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

type Field = "name" | "filePath" | "schedule" | "scheduleMode" | "scheduleNum" | "scheduleUnit" | "scheduleDow" | "scheduleTime" | "debug" | "args" | "submit";

const MODES = ["interval", "daily", "weekly"] as const;
type ScheduleMode = (typeof MODES)[number];

const MODE_LABELS: Record<ScheduleMode, string> = {
  interval: "every …",
  daily: "daily at …",
  weekly: "weekly on …",
};

const UNITS = ["min", "hour", "day"] as const;
type ScheduleUnit = (typeof UNITS)[number];

const UNIT_LABELS: Record<ScheduleUnit, string> = {
  min: "min",
  hour: "hour",
  day: "day",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type DayOfWeek = number; // 0 (Sun) – 6 (Sat)

interface FormState {
  field: Field;
  name: string;
  filePath: string;
  scheduleMode: ScheduleMode;
  scheduleNum: string;
  scheduleUnit: ScheduleUnit;
  scheduleDow: DayOfWeek;
  scheduleTime: string; // HH:MM
  rawSchedule: string;
  useRawSchedule: boolean;
  debug: boolean;
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
  | { type: "cycle_mode"; dir: 1 | -1 }
  | { type: "cycle_dow"; dir: 1 | -1 }
  | { type: "toggle_debug" }
  | { type: "set_error"; error: string }
  | { type: "set_filepath"; value: string; cursor: number };

const INTERVAL_RE = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|day|days?)$/i;

const DAILY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

const NDAY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d+)\s+\*\s+\*$/;

const WEEKLY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/;

type ParsedSchedule =
  | { mode: "interval"; num: string; unit: ScheduleUnit; time?: string }
  | { mode: "daily"; time: string }
  | { mode: "weekly"; dow: number; time: string };

function parseSchedule(schedule: string): ParsedSchedule | null {
  const m = INTERVAL_RE.exec(schedule.trim());
  if (m) {
    const num = m[1];
    const u = m[2].toLowerCase();
    let unit: ScheduleUnit;
    if (u.startsWith("d")) unit = "day";
    else if (u.startsWith("h")) unit = "hour";
    else unit = "min";
    return { mode: "interval", num, unit };
  }
  // "M H */N * *" → every N days at HH:MM
  const nd = NDAY_CRON_RE.exec(schedule.trim());
  if (nd) {
    const minute = nd[1].padStart(2, "0");
    const hour = nd[2].padStart(2, "0");
    return { mode: "interval", num: nd[3], unit: "day", time: `${hour}:${minute}` };
  }
  // "M H * * DOW" → weekly on DOW at HH:MM
  const wk = WEEKLY_CRON_RE.exec(schedule.trim());
  if (wk) {
    const minute = wk[1].padStart(2, "0");
    const hour = wk[2].padStart(2, "0");
    return { mode: "weekly", dow: parseInt(wk[3], 10), time: `${hour}:${minute}` };
  }
  // "M H * * *" → daily at HH:MM
  const cm = DAILY_CRON_RE.exec(schedule.trim());
  if (cm) {
    const minute = cm[1].padStart(2, "0");
    const hour = cm[2].padStart(2, "0");
    return { mode: "daily", time: `${hour}:${minute}` };
  }
  return null;
}

function getFields(state: FormState): Field[] {
  if (state.useRawSchedule) return ["name", "filePath", "schedule", "debug", "args", "submit"];
  if (state.scheduleMode === "interval") {
    const base: Field[] = ["name", "filePath", "scheduleMode", "scheduleNum", "scheduleUnit"];
    if (state.scheduleUnit === "day") base.push("scheduleTime");
    base.push("debug", "args", "submit");
    return base;
  }
  if (state.scheduleMode === "weekly") {
    return ["name", "filePath", "scheduleMode", "scheduleDow", "scheduleTime", "debug", "args", "submit"];
  }
  return ["name", "filePath", "scheduleMode", "scheduleTime", "debug", "args", "submit"];
}

function getFieldValue(state: FormState): string {
  const f = state.field;
  if (f === "scheduleNum") return state.scheduleNum;
  if (f === "scheduleTime") return state.scheduleTime;
  if (f === "schedule") return state.rawSchedule;
  if (f === "submit" || f === "scheduleUnit" || f === "scheduleMode" || f === "scheduleDow" || f === "args" || f === "debug") return "";
  return state[f] as string;
}

function reducer(state: FormState, action: Action): FormState {
  const fields = getFields(state);

  switch (action.type) {
    case "next_field": {
      const idx = fields.indexOf(state.field);
      const next = fields[(idx + 1) % fields.length];
      const val = next === "scheduleNum" ? state.scheduleNum
        : next === "scheduleTime" ? state.scheduleTime
        : next === "schedule" ? state.rawSchedule
        : next === "submit" || next === "scheduleUnit" || next === "scheduleMode" || next === "scheduleDow" || next === "args" || next === "debug" ? ""
        : (state[next] as string);
      return { ...state, field: next, cursor: val.length };
    }
    case "prev_field": {
      const idx = fields.indexOf(state.field);
      const prev = fields[(idx - 1 + fields.length) % fields.length];
      const val = prev === "scheduleNum" ? state.scheduleNum
        : prev === "scheduleTime" ? state.scheduleTime
        : prev === "schedule" ? state.rawSchedule
        : prev === "submit" || prev === "scheduleUnit" || prev === "scheduleMode" || prev === "scheduleDow" || prev === "args" || prev === "debug" ? ""
        : (state[prev] as string);
      return { ...state, field: prev, cursor: val.length };
    }
    case "append": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit" || f === "scheduleMode" || f === "scheduleDow" || f === "args" || f === "debug") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (f === "scheduleNum" && !/^\d+$/.test(action.char)) return state;
      if (f === "scheduleTime" && !/^[\d:]+$/.test(action.char)) return state;
      const updated = cur.slice(0, pos) + action.char + cur.slice(pos);
      const newCursor = pos + action.char.length;
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: newCursor };
      if (f === "scheduleTime") return { ...state, scheduleTime: updated, cursor: newCursor };
      if (f === "schedule") return { ...state, rawSchedule: updated, cursor: newCursor };
      return { ...state, [f]: updated, cursor: newCursor };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "submit" || f === "scheduleUnit" || f === "scheduleMode" || f === "scheduleDow" || f === "args" || f === "debug") return state;
      const cur = getFieldValue(state);
      const pos = state.cursor;
      if (pos === 0) return state;
      const updated = cur.slice(0, pos - 1) + cur.slice(pos);
      if (f === "scheduleNum") return { ...state, scheduleNum: updated, cursor: pos - 1 };
      if (f === "scheduleTime") return { ...state, scheduleTime: updated, cursor: pos - 1 };
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
    case "cycle_mode": {
      const idx = MODES.indexOf(state.scheduleMode);
      const next = (idx + action.dir + MODES.length) % MODES.length;
      return { ...state, scheduleMode: MODES[next] };
    }
    case "cycle_dow": {
      const next = (state.scheduleDow + action.dir + 7) % 7;
      return { ...state, scheduleDow: next };
    }
    case "toggle_debug":
      return { ...state, debug: !state.debug };
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
  if (parsed?.mode === "interval") {
    return {
      field: "name",
      name: wf.name,
      filePath: wf.filePath,
      scheduleMode: "interval",
      scheduleNum: parsed.num,
      scheduleUnit: parsed.unit,
      scheduleDow: 1,
      scheduleTime: parsed.time ?? "",
      rawSchedule: wf.schedule,
      useRawSchedule: false,
      debug: wf.debug ?? false,
      cursor: 0,
      error: "",
    };
  }
  if (parsed?.mode === "weekly") {
    return {
      field: "name",
      name: wf.name,
      filePath: wf.filePath,
      scheduleMode: "weekly",
      scheduleNum: "",
      scheduleUnit: "min",
      scheduleDow: parsed.dow,
      scheduleTime: parsed.time,
      rawSchedule: wf.schedule,
      useRawSchedule: false,
      debug: wf.debug ?? false,
      cursor: 0,
      error: "",
    };
  }
  if (parsed?.mode === "daily") {
    return {
      field: "name",
      name: wf.name,
      filePath: wf.filePath,
      scheduleMode: "daily",
      scheduleNum: "",
      scheduleUnit: "min",
      scheduleDow: 1,
      scheduleTime: parsed.time,
      rawSchedule: wf.schedule,
      useRawSchedule: false,
      debug: wf.debug ?? false,
      cursor: 0,
      error: "",
    };
  }
  return {
    field: "name",
    name: wf.name,
    filePath: wf.filePath,
    scheduleMode: "interval",
    scheduleNum: "",
    scheduleUnit: "min",
    scheduleDow: 1,
    scheduleTime: "",
    rawSchedule: wf.schedule,
    useRawSchedule: true,
    debug: wf.debug ?? false,
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
  const [confirmingExit, setConfirmingExit] = useState(false);
  const initialStateRef = useRef(buildInitialState(workflow));
  const initialArgsRef = useRef(argsToRows(workflow.args));

  const hasChanges = useCallback(() => {
    const s = stateRef.current;
    const init = initialStateRef.current;
    if (s.name !== init.name || s.filePath !== init.filePath) return true;
    if (s.scheduleMode !== init.scheduleMode) return true;
    if (s.scheduleNum !== init.scheduleNum || s.scheduleUnit !== init.scheduleUnit) return true;
    if (s.scheduleDow !== init.scheduleDow) return true;
    if (s.scheduleTime !== init.scheduleTime) return true;
    if (s.rawSchedule !== init.rawSchedule) return true;
    if (s.debug !== init.debug) return true;
    const curArgs = JSON.stringify(rowsToArgs(argRowsRef.current) ?? {});
    const origArgs = JSON.stringify(rowsToArgs(initialArgsRef.current) ?? {});
    return curArgs !== origArgs;
  }, []);

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
        if (hasChanges()) {
          setConfirmingExit(true);
        } else {
          onDone();
        }
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
          } else if (s.scheduleMode === "weekly") {
            const [h, m] = s.scheduleTime.split(":");
            newSchedule = `${parseInt(m || "0", 10)} ${parseInt(h || "0", 10)} * * ${s.scheduleDow}`;
          } else if (s.scheduleMode === "daily") {
            const [h, m] = s.scheduleTime.split(":");
            newSchedule = `${parseInt(m || "0", 10)} ${parseInt(h || "0", 10)} * * *`;
          } else if (s.scheduleUnit === "day") {
            const [h, m] = s.scheduleTime.split(":");
            const num = parseInt(s.scheduleNum.trim(), 10);
            const dayExpr = num === 1 ? "*" : `*/${num}`;
            newSchedule = `${parseInt(m || "0", 10)} ${parseInt(h || "0", 10)} ${dayExpr} * *`;
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

          if (s.debug !== (workflow.debug ?? false)) {
            patch.debug = s.debug;
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

      if (s.field === "scheduleDow") {
        if (key.leftArrow || key.upArrow) {
          dispatch({ type: "cycle_dow", dir: -1 });
          return;
        }
        if (key.rightArrow || key.downArrow) {
          dispatch({ type: "cycle_dow", dir: 1 });
          return;
        }
      }

      if (s.field === "scheduleMode") {
        if (key.leftArrow || key.upArrow) {
          dispatch({ type: "cycle_mode", dir: -1 });
          return;
        }
        if (key.rightArrow || key.downArrow) {
          dispatch({ type: "cycle_mode", dir: 1 });
          return;
        }
      }

      if (s.field === "debug") {
        if (input === " " || key.return) {
          dispatch({ type: "toggle_debug" });
          return;
        }
        if (key.tab && key.shift) {
          dispatch({ type: "prev_field" });
          return;
        }
        if (key.tab) {
          dispatch({ type: "next_field" });
          return;
        }
        return;
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

  useInput(handleInput, { isActive: !viewing && !confirmingExit && state.field !== "args" && state.field !== "filePath" });

  useInput(
    (_input, key) => {
      if (key.escape) onDone();
      if (key.return) setConfirmingExit(false);
    },
    { isActive: confirmingExit },
  );

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

  const fields = getFields(state);
  const fieldColor = (f: Field) => (fields.includes(f) && f === state.field ? "cyan" : "gray");

  return (
    <Box flexDirection="column">
      {confirmingExit && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ You have unsaved changes. Press Esc again to discard, Enter to go back.</Text>
        </Box>
      )}
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
          <>
            <Box>
              <Text color={fieldColor("scheduleMode")}>Schedule: </Text>
              {MODES.map((mode) => (
                <Text key={mode}>
                  {state.field === "scheduleMode" && mode === state.scheduleMode ? (
                    <Text bold inverse color="cyan">{` ${MODE_LABELS[mode]} `}</Text>
                  ) : mode === state.scheduleMode ? (
                    <Text bold color="cyan">{` ${MODE_LABELS[mode]} `}</Text>
                  ) : (
                    <Text color="gray">{` ${MODE_LABELS[mode]} `}</Text>
                  )}
                </Text>
              ))}
              {state.field === "scheduleMode" && (
                <Text color="gray"> ◂/▸ to change</Text>
              )}
            </Box>
            {state.scheduleMode === "interval" ? (
              <>
                <Box>
                  <Text color={state.field === "scheduleNum" || state.field === "scheduleUnit" ? "cyan" : "gray"}>  every </Text>
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
                {state.scheduleUnit === "day" && (
                  <Box>
                    <Text color={fieldColor("scheduleTime")}>  at (HH:MM): </Text>
                    <TextWithCursor
                      value={state.scheduleTime || (state.field === "scheduleTime" ? "" : "…")}
                      cursor={state.cursor}
                      active={state.field === "scheduleTime"}
                    />
                  </Box>
                )}
              </>
            ) : state.scheduleMode === "weekly" ? (
              <>
                <Box>
                  <Text color={fieldColor("scheduleDow")}>  Day: </Text>
                  {DAYS.map((d, i) => (
                    <Text key={d}>
                      {state.field === "scheduleDow" && i === state.scheduleDow ? (
                        <Text bold inverse color="cyan">{` ${d} `}</Text>
                      ) : i === state.scheduleDow ? (
                        <Text bold color="cyan">{` ${d} `}</Text>
                      ) : (
                        <Text color="gray">{` ${d} `}</Text>
                      )}
                    </Text>
                  ))}
                  {state.field === "scheduleDow" && (
                    <Text color="gray"> ◂/▸ to change</Text>
                  )}
                </Box>
                <Box>
                  <Text color={fieldColor("scheduleTime")}>  Time (HH:MM): </Text>
                  <TextWithCursor
                    value={state.scheduleTime || (state.field === "scheduleTime" ? "" : "…")}
                    cursor={state.cursor}
                    active={state.field === "scheduleTime"}
                  />
                </Box>
              </>
            ) : (
              <Box>
                <Text color={fieldColor("scheduleTime")}>  Time (HH:MM): </Text>
                <TextWithCursor
                  value={state.scheduleTime || (state.field === "scheduleTime" ? "" : "…")}
                  cursor={state.cursor}
                  active={state.field === "scheduleTime"}
                />
              </Box>
            )}
          </>
        )}

        <Box>
          <Text color={fieldColor("debug")}>Debug:   </Text>
          <Text color={state.field === "debug" ? "cyan" : undefined} bold={state.field === "debug"} inverse={state.field === "debug"}>
            {state.debug ? " [x] enabled " : " [ ] disabled "}
          </Text>
          {state.field === "debug" && (
            <Text color="gray"> space to toggle</Text>
          )}
        </Box>
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
