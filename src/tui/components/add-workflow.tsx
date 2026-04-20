import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { randomUUID } from "node:crypto";
import type { DaemonClient } from "../scheduler/daemon-client.js";

interface Props {
  client: DaemonClient;
  onDone: () => void;
}

type Field = "name" | "filePath" | "schedule" | "confirm";
const FIELDS: Field[] = ["name", "filePath", "schedule", "confirm"];

export function AddWorkflow({ client, onDone }: Props) {
  const [field, setField] = useState<Field>("name");
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [schedule, setSchedule] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onDone();
      return;
    }

    if (field === "confirm") {
      if (input === "y" || key.return) {
        client.addWorkflow({
          id: randomUUID().slice(0, 8),
          name: name.trim(),
          filePath: filePath.trim(),
          schedule: schedule.trim(),
          enabled: true,
        }).then(onDone).catch(() => onDone());
      } else if (input === "n") {
        onDone();
      }
      return;
    }

    if (key.return) {
      const idx = FIELDS.indexOf(field);
      if (idx < FIELDS.length - 1) {
        setField(FIELDS[idx + 1]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (field === "name") setName((v) => v.slice(0, -1));
      if (field === "filePath") setFilePath((v) => v.slice(0, -1));
      if (field === "schedule") setSchedule((v) => v.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      if (field === "name") setName((v) => v + input);
      if (field === "filePath") setFilePath((v) => v + input);
      if (field === "schedule") setSchedule((v) => v + input);
    }
  });

  const fieldColor = (f: Field) => (f === field ? "cyan" : "gray");

  return (
    <Box flexDirection="column">
      <Text bold color="green">Add New Workflow</Text>
      <Text color="gray">Press Enter to advance, Esc to cancel</Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={fieldColor("name")}>Name: </Text>
          <Text>{name}{field === "name" ? "▋" : ""}</Text>
        </Box>
        <Box>
          <Text color={fieldColor("filePath")}>File: </Text>
          <Text>{filePath}{field === "filePath" ? "▋" : ""}</Text>
        </Box>
        <Box>
          <Text color={fieldColor("schedule")}>Schedule: </Text>
          <Text>{schedule}{field === "schedule" ? "▋" : ""}</Text>
        </Box>
        {field === "confirm" && (
          <Box marginTop={1}>
            <Text bold color="yellow">
              Add "{name}" ({schedule})? (y/n)
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
