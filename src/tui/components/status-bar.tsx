import React from "react";
import { Box, Text } from "ink";
import type { View } from "../scheduler/types.js";

interface Props {
  view: View;
  schedulerRunning: boolean;
}

export function StatusBar({ view, schedulerRunning }: Props) {
  const status = schedulerRunning ? "🟢 Running" : "🔴 Stopped";

  const keys: Record<string, string> = {
    list: "a:Add  e:Edit  d:Delete  r:Run  o:Output  v:YAML  g:Graph  space:Enable/Disable  enter:History  q:Quit",
    add: "enter:Next  esc:Cancel",
    edit: "enter:Next  esc:Cancel",
    history: "enter:Detail  esc:Back",
    "run-detail": "↑↓:Scroll  esc:Back",
    "yaml-view": "↑↓:Scroll  PgUp/PgDn:Page  esc:Back",
    "graph-view": "↑↓←→:Navigate  Tab:Cycle  Enter:Expand  esc:Back",
  };

  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color="gray">─────────────────────────────────────────</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color="gray">{keys[view.screen] ?? ""}</Text>
        <Text color="gray">Scheduler: {status}</Text>
      </Box>
    </Box>
  );
}
