import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { View, RunRecord, WorkflowEntry } from "./scheduler/types.js";
import type { DaemonEvent } from "./scheduler/protocol.js";
import { DaemonClient } from "./scheduler/daemon-client.js";
import { WorkflowList } from "./components/workflow-list.js";
import { AddWorkflow } from "./components/add-workflow.js";
import { EditWorkflow } from "./components/edit-workflow.js";
import { YamlView } from "./components/yaml-view.js";
import { GraphView } from "./components/graph-view.js";
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
  // Live output per runId — accumulated from run-output events
  const [liveOutput, setLiveOutput] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const handler = (evt: DaemonEvent) => {
      if (evt.kind === "run-output") {
        setLiveOutput((prev) => {
          const next = new Map(prev);
          next.set(evt.runId, (prev.get(evt.runId) ?? "") + evt.text);
          return next;
        });
      } else if (evt.kind === "run-complete") {
        // Keep liveOutput for the run — run-detail uses it for the Logs section
        // even after completion. Old entries are cleaned up on navigation.
      }
    };
    client.on("event", handler);
    return () => { client.off("event", handler); };
  }, [client]);

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
  const goEdit = useCallback(
    (workflowId: string) => setView({ screen: "edit", workflowId }),
    [],
  );
  const goYamlView = useCallback(
    (filePath: string, fromView?: View) => setView({ screen: "yaml-view", filePath, fromView }),
    [],
  );
  const goGraphView = useCallback(
    (filePath: string) => setView({ screen: "graph-view", filePath }),
    [],
  );

  // Available height for content area: total rows - padding(2) - header+margin(2) - statusbar(1)
  const contentHeight = Math.max(10, termSize.rows - 5);

  return (
    <Box flexDirection="column" width={termSize.columns} height={termSize.rows} padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🦞 TinyClaw
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
            onEdit={goEdit}
            onHistory={goHistory}
            onViewOutput={goRunDetail}
            onViewYaml={goYamlView}
            onViewGraph={goGraphView}
            onRefresh={refresh}
          />
        )}

        {view.screen === "add" && (
          <AddWorkflow client={client} onDone={goList} />
        )}

        {view.screen === "edit" && (() => {
          const wf = workflows.find((w) => w.id === view.workflowId);
          if (!wf) {
            // Workflow was deleted while we were trying to edit — go back
            setTimeout(goList, 0);
            return (
              <Box flexDirection="column">
                <Text color="red">Workflow not found — it may have been deleted.</Text>
              </Box>
            );
          }
          return (
            <EditWorkflow client={client} workflow={wf} onDone={goList} />
          );
        })()}

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
            availableHeight={contentHeight}
            client={client}
            liveOutput={liveOutput}
            onBack={
              view.fromWorkflowId
                ? () => goHistory(view.fromWorkflowId!)
                : goList
            }
            onOpenFile={(filePath) => goYamlView(filePath, view)}
          />
        )}

        {view.screen === "yaml-view" && (
          <YamlView filePath={view.filePath} availableHeight={contentHeight} onBack={
            view.fromView ? () => setView(view.fromView!) : goList
          } />
        )}

        {view.screen === "graph-view" && (
          <GraphView filePath={view.filePath} availableHeight={contentHeight} onBack={goList} />
        )}
      </Box>

      <StatusBar view={view} schedulerRunning={daemonRunning} />
    </Box>
  );
}
