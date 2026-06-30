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
    list: "a:Add  e:Edit  d:Delete  r:Run  D:DryRun  o:Output  v:YAML  g:Graph  s:Samples  Tab:Approvals  space:Enable/Disable  enter:History  q:Quit",
    add: "Tab:Next  Shift+Tab:Back  esc:Cancel  Ctrl+O:View file",
    edit: "Tab:Next  Shift+Tab:Back  esc:Cancel  Ctrl+O:View file",
    history: "enter:Detail  d:Delete  c:Clear  v:View file  esc:Back",
    "run-detail": "↑↓:Scroll  v:View file  y:Approve  n:Reject  esc:Back",
    "yaml-view": "↑↓:Scroll  PgUp/PgDn:Page  esc:Back",
    "graph-view": "↑↓←→:Navigate  Tab:Cycle  Enter:Expand  esc:Back",
    gallery: "↑↓:Navigate  /:Search  v:View  Enter:Install  esc:Back",
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
