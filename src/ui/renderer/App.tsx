import React, { useState, useCallback } from "react";
import type { RunRecord } from "../shared/types";
import { useDaemon } from "./hooks/useDaemon";
import { WorkflowList } from "./components/WorkflowList";
import { AddWorkflow } from "./components/AddWorkflow";
import { EditWorkflow } from "./components/EditWorkflow";
import { RunHistory } from "./components/RunHistory";
import { RunDetail } from "./components/RunDetail";
import { YamlView } from "./components/YamlView";
import { GraphView } from "./components/GraphView";

type View =
  | { screen: "list" }
  | { screen: "add" }
  | { screen: "edit"; workflowId: string }
  | { screen: "history"; workflowId: string }
  | { screen: "run-detail"; run: RunRecord; fromWorkflowId?: string }
  | { screen: "yaml-view"; filePath: string; fromView?: View }
  | { screen: "graph-view"; filePath: string };

export function App() {
  const { connected, workflows, liveOutput, refresh } = useDaemon();
  const [view, setView] = useState<View>({ screen: "list" });

  const goList = useCallback(() => { refresh(); setView({ screen: "list" }); }, [refresh]);
  const goAdd = useCallback(() => setView({ screen: "add" }), []);
  const goEdit = useCallback((id: string) => setView({ screen: "edit", workflowId: id }), []);
  const goHistory = useCallback((id: string) => setView({ screen: "history", workflowId: id }), []);
  const goRunDetail = useCallback(
    (run: RunRecord, fromWorkflowId?: string) =>
      setView({ screen: "run-detail", run, fromWorkflowId }),
    [],
  );
  const goYaml = useCallback(
    (filePath: string, fromView?: View) => setView({ screen: "yaml-view", filePath, fromView }),
    [],
  );
  const goGraph = useCallback(
    (filePath: string) => setView({ screen: "graph-view", filePath }),
    [],
  );

  const renderView = () => {
    switch (view.screen) {
      case "list":
        return (
          <WorkflowList
            workflows={workflows}
            onAdd={goAdd}
            onEdit={goEdit}
            onHistory={goHistory}
            onRunNow={(id) => window.api.runNow(id).then(refresh)}
            onToggle={(id) => window.api.toggleWorkflow(id).then(refresh)}
            onRemove={(id) => window.api.removeWorkflow(id).then(refresh)}
            onViewYaml={goYaml}
            onViewGraph={goGraph}
          />
        );
      case "add":
        return <AddWorkflow onDone={goList} />;
      case "edit": {
        const wf = workflows.find((w) => w.id === view.workflowId);
        if (!wf) return <div className="empty-state"><span className="message">Workflow not found</span></div>;
        return <EditWorkflow workflow={wf} onDone={goList} />;
      }
      case "history":
        return (
          <RunHistory
            workflowId={view.workflowId}
            workflowName={workflows.find((w) => w.id === view.workflowId)?.name}
            onBack={goList}
            onSelectRun={(run) => goRunDetail(run, view.workflowId)}
          />
        );
      case "run-detail":
        return (
          <RunDetail
            run={view.run}
            liveOutput={liveOutput}
            onBack={
              view.fromWorkflowId
                ? () => goHistory(view.fromWorkflowId!)
                : goList
            }
            onOpenFile={(fp) => goYaml(fp, view)}
          />
        );
      case "yaml-view":
        return (
          <YamlView
            filePath={view.filePath}
            onBack={view.fromView ? () => setView(view.fromView!) : goList}
          />
        );
      case "graph-view":
        return <GraphView filePath={view.filePath} onBack={goList} />;
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🦞 TinyClaw</h1>
        <span className={`status ${connected ? "connected" : ""}`}>
          {connected ? "● Connected" : "○ Disconnected"}
        </span>
      </header>
      <main className="app-content">
        {renderView()}
      </main>
      <footer className="app-footer">
        TinyClaw Desktop — Lobster Workflow Manager
      </footer>
    </div>
  );
}
