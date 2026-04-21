import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RunRecord } from "../scheduler/types.js";

interface Props {
  run: RunRecord;
  availableHeight: number;
  onBack: () => void;
}

export function RunDetail({ run, availableHeight, onBack }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  // Own chrome: header(1) + input(margin+hdr+4fields=6) + result(margin+hdr+3fields=5) + output(margin+hdr=2) + scroll hint(1) = 15
  const VISIBLE_LINES = Math.max(5, availableHeight - 14);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setScrollOffset((o) => Math.max(0, o - 1));
    if (key.downArrow)
      setScrollOffset((o) => Math.min(o + 1, Math.max(0, outputLines.length - VISIBLE_LINES)));
  });

  const dur = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—";
  const statusColor =
    run.status === "success" ? "green" : run.status === "error" ? "red" : "yellow";

  const outputLines = (run.output ?? run.error ?? "No output").split("\n");
  const visibleLines = outputLines.slice(
    scrollOffset,
    scrollOffset + VISIBLE_LINES,
  );

  return (
    <Box flexDirection="column">
      <Text bold>Run Detail — Esc to go back</Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">── Input ──</Text>
        <Box>
          <Text color="gray">File:      </Text>
          <Text>{run.input.filePath}</Text>
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

      <Box marginTop={1} flexDirection="column">
        <Text bold color="gray">
          ── Output ({outputLines.length} lines) ──
        </Text>
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">
            {line}
          </Text>
        ))}
        {outputLines.length > VISIBLE_LINES && (
          <Text color="gray" dimColor>
            ↑/↓ to scroll ({scrollOffset + 1}-
            {Math.min(scrollOffset + VISIBLE_LINES, outputLines.length)}/
            {outputLines.length})
          </Text>
        )}
      </Box>
    </Box>
  );
}
