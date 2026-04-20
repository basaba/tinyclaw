import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { View, RunRecord, WorkflowEntry } from "./scheduler/types.js";
import { DaemonClient } from "./scheduler/daemon-client.js";
import { WorkflowList } from "./components/workflow-list.js";
import { AddWorkflow } from "./components/add-workflow.js";
import { YamlView } from "./components/yaml-view.js";
import { RunHistory } from "./components/run-history.js";
import { RunDetail } from "./components/run-detail.js";
import { StatusBar } from "./components/status-bar.js";

interface AppProps {
  client: DaemonClient;
}

export function App({ client }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<View>({ screen: "list" });
  const [workflows, setWorkflows] = useState<WorkflowEntry[]>([]);
  const [daemonRunning, setDaemonRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [termSize, setTermSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });

  useEffect(() => {
    const onResize = () => setTermSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    client.getWorkflows().then(setWorkflows).catch(() => {});
  }, [client]);

  useEffect(() => {
    client.getStatus().then((s) => {
      setWorkflows(s.workflows);
      setDaemonRunning(s.running);
    }).catch(() => {});

    client.on("change", refresh);
    client.on("disconnected", () => setDaemonRunning(false));
    return () => {
      client.removeListener("change", refresh);
    };
  }, [client, refresh]);

  useInput((input) => {
    if (view.screen !== "list") return;
    if (input === "q") {
      client.disconnect();
      exit();
    }
  });

  const goList = useCallback(() => { refresh(); setView({ screen: "list" }); }, [refresh]);
  const goAdd = useCallback(() => setView({ screen: "add" }), []);
  const goHistory = useCallback(
    (workflowId: string) => setView({ screen: "history", workflowId }),
    [],
  );
  const goRunDetail = useCallback(
    (run: RunRecord, fromWorkflowId?: string) =>
      setView({ screen: "run-detail", run, fromWorkflowId }),
    [],
  );
  const goYamlView = useCallback(
    (filePath: string) => setView({ screen: "yaml-view", filePath }),
    [],
  );

  return (
    <Box flexDirection="column" width={termSize.columns} height={termSize.rows} padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🦞 Lobster Workflow Scheduler
        </Text>
        <Text color="gray">
          {" "}(daemon {daemonRunning ? "connected" : "disconnected"})
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {view.screen === "list" && (
          <WorkflowList
            client={client}
            workflows={workflows}
            onAdd={goAdd}
            onHistory={goHistory}
            onViewOutput={goRunDetail}
            onViewYaml={goYamlView}
            onRefresh={refresh}
          />
        )}

        {view.screen === "add" && (
          <AddWorkflow client={client} onDone={goList} />
        )}

        {view.screen === "history" && (
          <RunHistory
            client={client}
            workflowId={view.workflowId}
            onBack={goList}
            onSelectRun={goRunDetail}
          />
        )}

        {view.screen === "run-detail" && (
          <RunDetail
            run={view.run}
            onBack={
              view.fromWorkflowId
                ? () => goHistory(view.fromWorkflowId!)
                : goList
            }
          />
        )}

        {view.screen === "yaml-view" && (
          <YamlView filePath={view.filePath} onBack={goList} />
        )}
      </Box>

      <StatusBar view={view} schedulerRunning={daemonRunning} />
    </Box>
  );
}
