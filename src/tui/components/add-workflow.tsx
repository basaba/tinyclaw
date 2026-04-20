import React, { useReducer, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { randomUUID } from "node:crypto";
import type { DaemonClient } from "../scheduler/daemon-client.js";

interface Props {
  client: DaemonClient;
  onDone: () => void;
}

type Field = "name" | "filePath" | "schedule" | "confirm";
const FIELDS: Field[] = ["name", "filePath", "schedule", "confirm"];

interface FormState {
  field: Field;
  name: string;
  filePath: string;
  schedule: string;
}

type Action =
  | { type: "next_field" }
  | { type: "prev_field" }
  | { type: "append"; char: string }
  | { type: "delete_char" };

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
      if (f === "confirm") return state;
      return { ...state, [f]: state[f] + action.char };
    }
    case "delete_char": {
      const f = state.field;
      if (f === "confirm") return state;
      return { ...state, [f]: state[f].slice(0, -1) };
    }
    default:
      return state;
  }
}

const INITIAL_STATE: FormState = {
  field: "name",
  name: "",
  filePath: "",
  schedule: "",
};

export function AddWorkflow({ client, onDone }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleInput = useCallback(
    (input: string, key: { return: boolean; escape: boolean; backspace: boolean; delete: boolean; ctrl: boolean; meta: boolean; upArrow: boolean; shift: boolean; tab: boolean }) => {
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
              schedule: s.schedule.trim(),
              enabled: true,
            })
            .then(onDone)
            .catch(() => onDone());
        } else if (input === "n") {
          onDone();
        }
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

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Add New Workflow
      </Text>
      <Text color="gray">Enter/Tab to advance, Esc to cancel</Text>
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
          <Text color={fieldColor("schedule")}>Schedule: </Text>
          <Text>
            {state.schedule}
            {state.field === "schedule" ? "▋" : ""}
          </Text>
        </Box>
        {state.field === "confirm" && (
          <Box marginTop={1}>
            <Text bold color="yellow">
              Add &quot;{state.name}&quot; ({state.schedule})? (y/n)
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
