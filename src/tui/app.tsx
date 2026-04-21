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

export interface StepProgressEntry {
  stepId: string;
  stepIndex: number;
  totalSteps: number;
}

// Accumulated step-by-step history per run
interface StepHistoryEntry {
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  status: "running" | "complete" | "skipped" | "failed";
}

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
  // Step progress lives here so it survives view transitions
  const [stepProgress, setStepProgress] = useState<Map<string, StepProgressEntry>>(new Map());
  // Full step history per runId — accumulated across view transitions
  const [stepHistory, setStepHistory] = useState<Map<string, StepHistoryEntry[]>>(new Map());

  useEffect(() => {
    const handler = (evt: DaemonEvent) => {
      if (evt.kind === "step-progress") {
        setStepProgress((prev) => {
          const next = new Map(prev);
          next.set(evt.workflowId, {
            stepId: evt.stepId,
            stepIndex: evt.stepIndex,
            totalSteps: evt.totalSteps,
          });
          return next;
        });
        setStepHistory((prev) => {
          const next = new Map(prev);
          const list = [...(prev.get(evt.runId) ?? [])];
          // Mark any previous running steps as complete
          for (let i = 0; i < list.length; i++) {
            if (list[i].status === "running") {
              list[i] = { ...list[i], status: "complete" };
            }
          }
          const existing = list.findIndex((s) => s.stepIndex === evt.stepIndex);
          const entry: StepHistoryEntry = {
            stepId: evt.stepId,
            stepIndex: evt.stepIndex,
            totalSteps: evt.totalSteps,
            status: evt.status,
          };
          if (existing >= 0) {
            list[existing] = entry;
          } else {
            list.push(entry);
          }
          next.set(evt.runId, list);
          return next;
        });
      } else if (evt.kind === "run-complete") {
        setStepProgress((prev) => {
          const next = new Map(prev);
          next.delete(evt.run.workflowId);
          return next;
        });
        // Mark any still-running steps as failed if the run errored
        if (evt.run.status === "error") {
          setStepHistory((prev) => {
            const next = new Map(prev);
            const list = [...(prev.get(evt.run.id) ?? [])];
            for (let i = 0; i < list.length; i++) {
              if (list[i].status === "running") {
                list[i] = { ...list[i], status: "failed" };
              }
            }
            next.set(evt.run.id, list);
            return next;
          });
        } else {
          // Clean up step history for successful runs
          setStepHistory((prev) => {
            const next = new Map(prev);
            next.delete(evt.run.id);
            return next;
          });
        }
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
    (filePath: string) => setView({ screen: "yaml-view", filePath }),
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
            stepProgress={stepProgress}
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
            stepHistory={stepHistory}
            onBack={
              view.fromWorkflowId
                ? () => goHistory(view.fromWorkflowId!)
                : goList
            }
          />
        )}

        {view.screen === "yaml-view" && (
          <YamlView filePath={view.filePath} availableHeight={contentHeight} onBack={goList} />
        )}

        {view.screen === "graph-view" && (
          <GraphView filePath={view.filePath} availableHeight={contentHeight} onBack={goList} />
        )}
      </Box>

      <StatusBar view={view} schedulerRunning={daemonRunning} />
    </Box>
  );
}
