import React, { useState, useEffect, useMemo } from "react";

interface Props {
  filePath: string;
  onBack: () => void;
}

interface Step {
  name: string;
  needs?: string[];
}

/**
 * Simple YAML parser for workflow files — extracts step names and dependencies.
 */
function parseSteps(yaml: string): Step[] {
  const steps: Step[] = [];
  const lines = yaml.split("\n");
  let currentStep: Step | null = null;
  let inNeeds = false;

  for (const line of lines) {
    // Top-level step (e.g. "  step_name:")
    const stepMatch = line.match(/^  (\w[\w-]*)\s*:/);
    if (stepMatch && !line.match(/^\s{4,}/)) {
      if (currentStep) steps.push(currentStep);
      currentStep = { name: stepMatch[1] };
      inNeeds = false;
      continue;
    }

    if (!currentStep) continue;

    // needs: [a, b] or needs:
    const needsMatch = line.match(/^\s+needs:\s*\[([^\]]*)\]/);
    if (needsMatch) {
      currentStep.needs = needsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      inNeeds = false;
      continue;
    }

    if (line.match(/^\s+needs:\s*$/)) {
      inNeeds = true;
      currentStep.needs = [];
      continue;
    }

    if (inNeeds) {
      const itemMatch = line.match(/^\s+-\s+(.+)/);
      if (itemMatch) {
        currentStep.needs = currentStep.needs || [];
        currentStep.needs.push(itemMatch[1].trim());
      } else {
        inNeeds = false;
      }
    }
  }
  if (currentStep) steps.push(currentStep);
  return steps;
}

export function GraphView({ filePath, onBack }: Props) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    window.api.readFile(filePath)
      .then((text) => { setContent(text); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [filePath]);

  const steps = useMemo(() => parseSteps(content), [content]);

  // Simple layout: vertical arrangement
  const nodeWidth = 160;
  const nodeHeight = 40;
  const gapX = 60;
  const gapY = 60;
  const paddingX = 40;
  const paddingY = 40;

  // Topological layers
  const layers = useMemo(() => {
    const layerMap = new Map<string, number>();
    const stepNames = new Set(steps.map((s) => s.name));

    function getLayer(name: string, visited = new Set<string>()): number {
      if (layerMap.has(name)) return layerMap.get(name)!;
      if (visited.has(name)) return 0; // cycle
      visited.add(name);
      const step = steps.find((s) => s.name === name);
      if (!step?.needs?.length) {
        layerMap.set(name, 0);
        return 0;
      }
      const maxDep = Math.max(...step.needs.filter((n) => stepNames.has(n)).map((n) => getLayer(n, visited)));
      const layer = maxDep + 1;
      layerMap.set(name, layer);
      return layer;
    }

    for (const s of steps) getLayer(s.name);

    const result: string[][] = [];
    for (const [name, layer] of layerMap) {
      while (result.length <= layer) result.push([]);
      result[layer].push(name);
    }
    return result;
  }, [steps]);

  // Calculate positions
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    for (let layer = 0; layer < layers.length; layer++) {
      const nodes = layers[layer];
      const totalWidth = nodes.length * nodeWidth + (nodes.length - 1) * gapX;
      const startX = paddingX + (layers.reduce((max, l) => Math.max(max, l.length), 0) * (nodeWidth + gapX) - totalWidth) / 2;
      for (let i = 0; i < nodes.length; i++) {
        pos.set(nodes[i], {
          x: startX + i * (nodeWidth + gapX),
          y: paddingY + layer * (nodeHeight + gapY),
        });
      }
    }
    return pos;
  }, [layers]);

  const svgWidth = Math.max(400, (positions.size > 0 ? Math.max(...Array.from(positions.values()).map((p) => p.x)) : 0) + nodeWidth + paddingX * 2);
  const svgHeight = Math.max(200, (positions.size > 0 ? Math.max(...Array.from(positions.values()).map((p) => p.y)) : 0) + nodeHeight + paddingY * 2);

  if (loading) return <div style={{ color: "var(--text-muted)", padding: 20 }}>Loading...</div>;
  if (error) return <div style={{ color: "var(--error)", padding: 20 }}>{error}</div>;

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back</button>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Workflow Graph</h2>

      <div className="graph-container" style={{ maxHeight: "calc(100vh - 200px)", overflow: "auto" }}>
        <svg width={svgWidth} height={svgHeight}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-muted)" />
            </marker>
          </defs>

          {/* Edges */}
          {steps.map((step) =>
            (step.needs || []).map((dep) => {
              const from = positions.get(dep);
              const to = positions.get(step.name);
              if (!from || !to) return null;
              return (
                <line
                  key={`${dep}-${step.name}`}
                  className="graph-edge"
                  x1={from.x + nodeWidth / 2}
                  y1={from.y + nodeHeight}
                  x2={to.x + nodeWidth / 2}
                  y2={to.y}
                  stroke="var(--text-muted)"
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                />
              );
            }),
          )}

          {/* Nodes */}
          {steps.map((step) => {
            const pos = positions.get(step.name);
            if (!pos) return null;
            return (
              <g key={step.name} className="graph-node">
                <rect x={pos.x} y={pos.y} width={nodeWidth} height={nodeHeight} rx={6} />
                <text
                  x={pos.x + nodeWidth / 2}
                  y={pos.y + nodeHeight / 2 + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fill="var(--text-primary)"
                  fontFamily="var(--font-mono)"
                >
                  {step.name.length > 18 ? step.name.slice(0, 16) + "…" : step.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
