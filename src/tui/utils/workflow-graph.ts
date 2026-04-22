/**
 * Workflow graph utilities — parse a Lobster YAML workflow and render
 * an ASCII step-dependency graph.
 *
 * Self-contained reimplementation of the graph logic from
 * @basaba/lobster (whose exports map blocks deep imports).
 */
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";

// ── Types ───────────────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  run?: string;
  command?: string;
  pipeline?: string;
  approval?: unknown;
  input?: unknown;
  parallel?: { wait?: string };
  for_each?: string;
  when?: string;
  condition?: string;
  workflow?: string;
  stdin?: unknown;
  steps?: WorkflowStep[];
  [key: string]: unknown;
}

interface Workflow {
  name?: string;
  steps: WorkflowStep[];
  args?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

// ── Workflow parsing ────────────────────────────────────────────────

export function parseWorkflowFile(filePath: string): Workflow {
  const resolved = resolve(filePath);
  const text = readFileSync(resolved, "utf-8");
  const ext = extname(resolved).toLowerCase();

  let parsed: unknown;
  if (ext === ".json") {
    parsed = JSON.parse(text);
  } else {
    // yaml is available as a transitive dependency via lobster
    const require = createRequire(import.meta.url);
    const { parse: parseYaml } = require("yaml") as { parse: (s: string) => unknown };
    parsed = parseYaml(text);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workflow file must be a YAML/JSON object");
  }

  const wf = parsed as Record<string, unknown>;
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    throw new Error("Workflow file requires a non-empty steps array");
  }

  return parsed as Workflow;
}

// ── Step classification ─────────────────────────────────────────────

function isApprovalStep(step: WorkflowStep): boolean {
  if (step.approval === true) return true;
  if (typeof step.approval === "string" && step.approval.trim().length > 0) return true;
  if (step.approval && typeof step.approval === "object" && !Array.isArray(step.approval))
    return true;
  return false;
}

function isInputStep(step: WorkflowStep): boolean {
  return Boolean(step.input && typeof step.input === "object" && !Array.isArray(step.input));
}

function stepType(step: WorkflowStep): string {
  if (step.parallel) return "parallel";
  if (typeof step.for_each === "string") return "for_each";
  if (typeof step.workflow === "string" && step.workflow.trim()) return "workflow";
  if (typeof step.pipeline === "string" && step.pipeline.trim()) return "pipeline";
  if (typeof step.run === "string" || typeof step.command === "string") return "run";
  if (isApprovalStep(step)) return "approval";
  if (isInputStep(step)) return "input";
  return "step";
}

// ── Reference extraction ────────────────────────────────────────────

function extractStepRefsFromString(value: string): string[] {
  const refs = new Set<string>();
  const rx = /\$([A-Za-z0-9_-]+)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/g;
  for (const m of value.matchAll(rx)) {
    if (m[1]) refs.add(m[1]);
  }
  return [...refs];
}

function extractStepRefs(value: unknown): string[] {
  if (typeof value === "string") return extractStepRefsFromString(value);
  if (Array.isArray(value)) {
    const refs = new Set<string>();
    for (const item of value) {
      for (const ref of extractStepRefs(item)) refs.add(ref);
    }
    return [...refs];
  }
  if (value && typeof value === "object") {
    const refs = new Set<string>();
    for (const v of Object.values(value)) {
      for (const ref of extractStepRefs(v)) refs.add(ref);
    }
    return [...refs];
  }
  return [];
}

// ── Graph construction ──────────────────────────────────────────────

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function stepDetails(step: WorkflowStep): string {
  if (step.parallel) return `parallel (${step.parallel.wait ?? "all"})`;
  if (typeof step.for_each === "string") return `for_each: ${step.for_each}`;
  if (typeof step.workflow === "string" && step.workflow.trim()) return `workflow: ${step.workflow}`;
  if (typeof step.pipeline === "string" && step.pipeline.trim()) return `pipeline: ${step.pipeline}`;
  const shell = typeof step.run === "string" ? step.run : step.command;
  if (typeof shell === "string" && shell.trim()) return `run: ${shell}`;
  if (isApprovalStep(step)) return "approval gate";
  if (isInputStep(step)) return "input request";
  return "";
}

/** Collect all step IDs (including nested sub-steps) for reference resolution */
function collectAllStepIds(steps: WorkflowStep[], prefix = ""): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    const fullId = prefix ? `${prefix}.${step.id}` : step.id;
    ids.add(step.id);
    ids.add(fullId);
    if (step.steps) {
      for (const id of collectAllStepIds(step.steps, fullId)) ids.add(id);
    }
  }
  return ids;
}

export function collectGraph(workflow: Workflow): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const knownStepIds = collectAllStepIds(workflow.steps);
  const seenEdgeKeys = new Set<string>();

  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}|${edge.to}|${edge.label ?? ""}`;
    if (seenEdgeKeys.has(key)) return;
    seenEdgeKeys.add(key);
    edges.push(edge);
  };

  /**
   * Process a list of steps, returning the last step ID in the chain.
   * `prefix` is used to namespace sub-step IDs (e.g. "failures.failed-tests").
   */
  function processSteps(steps: WorkflowStep[], prevId: string | null, prefix = ""): string | null {
    let prevStepId = prevId;

    for (const step of steps) {
      const fullId = prefix ? `${prefix}.${step.id}` : step.id;
      const type = stepType(step);
      const details = stepDetails(step);
      const label = details ? `${fullId} (${truncate(details, 60)})` : fullId;

      nodes.push({ id: fullId, type, label });

      if (prevStepId) {
        addEdge({ from: prevStepId, to: fullId, label: "next" });
      }

      // stdin data dependencies
      for (const ref of extractStepRefs(step.stdin)) {
        const resolvedRef = prefix ? `${prefix}.${ref}` : ref;
        if (knownStepIds.has(resolvedRef)) addEdge({ from: resolvedRef, to: fullId, label: "stdin" });
        else if (knownStepIds.has(ref)) addEdge({ from: ref, to: fullId, label: "stdin" });
      }

      // for_each iteration source
      if (typeof step.for_each === "string") {
        for (const ref of extractStepRefs(step.for_each)) {
          if (knownStepIds.has(ref)) addEdge({ from: ref, to: fullId, label: "for_each" });
        }
      }

      // conditional edges
      const condition = step.when ?? step.condition;
      if (typeof condition === "string" && condition.trim()) {
        for (const ref of extractStepRefs(condition)) {
          const resolvedRef = prefix ? `${prefix}.${ref}` : ref;
          if (knownStepIds.has(resolvedRef))
            addEdge({ from: resolvedRef, to: fullId, label: `when: ${truncate(condition.trim(), 50)}` });
          else if (knownStepIds.has(ref))
            addEdge({ from: ref, to: fullId, label: `when: ${truncate(condition.trim(), 50)}` });
        }
      }

      // Recurse into sub-steps (for_each, parallel, etc.)
      if (step.steps && step.steps.length > 0) {
        const lastSubId = processSteps(step.steps, fullId, fullId);
        prevStepId = lastSubId ?? fullId;
      } else {
        prevStepId = fullId;
      }
    }

    return prevStepId;
  }

  processSteps(workflow.steps, null);

  return { nodes, edges };
}

// ── dagre-based layout engine ───────────────────────────────────────

import * as dagre from "@dagrejs/dagre";

/** Positioned node after layout */
export interface LayoutNode {
  id: string;
  type: string;
  label: string;
  /** Row of the top-left corner on the canvas */
  row: number;
  /** Column of the top-left corner on the canvas */
  col: number;
  /** Width in terminal columns */
  width: number;
  /** Height in terminal rows (always 4: border, id, type, border) */
  height: number;
  /** Step details for expand panel */
  details: Record<string, unknown>;
}

/** Routed edge after layout */
export interface LayoutEdge {
  from: string;
  to: string;
  label: string;
  /** Rasterised (row,col) cells the edge occupies */
  cells: Array<{ row: number; col: number; char: string }>;
}

/** Full layout result for interactive rendering */
export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Total canvas dimensions */
  width: number;
  height: number;
  /** Adjacency: nodeId → { successors, predecessors } */
  adjacency: Map<string, { successors: string[]; predecessors: string[] }>;
}

const NODE_HEIGHT = 4; // ┌─┐ id [type] └─┘
const NODE_PAD = 2;    // inner padding on each side
const RANK_SEP = 2;    // rows between ranks (dagre units, scaled by height)
const NODE_SEP = 6;    // cols between nodes (dagre units, scaled by width)

/** Build a dagre layout and return structured positions */
export function computeLayout(workflow: Workflow): GraphLayout {
  const { nodes, edges } = collectGraph(workflow);

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, adjacency: new Map() };
  }

  // Build adjacency map
  const adjacency = new Map<string, { successors: string[]; predecessors: string[] }>();
  for (const n of nodes) {
    adjacency.set(n.id, { successors: [], predecessors: [] });
  }
  for (const e of edges) {
    adjacency.get(e.from)?.successors.push(e.to);
    adjacency.get(e.to)?.predecessors.push(e.from);
  }
  // Deduplicate
  for (const [, adj] of adjacency) {
    adj.successors = [...new Set(adj.successors)];
    adj.predecessors = [...new Set(adj.predecessors)];
  }

  // Compute node widths
  const nodeWidths = new Map<string, number>();
  const stepMap = new Map<string, WorkflowStep>();
  const buildStepMap = (steps: WorkflowStep[], prefix = "") => {
    for (const s of steps) {
      const fullId = prefix ? `${prefix}.${s.id}` : s.id;
      stepMap.set(fullId, s);
      if (s.steps) buildStepMap(s.steps, fullId);
    }
  };
  buildStepMap(workflow.steps);
  for (const node of nodes) {
    const line1 = node.id;
    const line2 = `[${node.type}]`;
    const contentWidth = Math.max(line1.length, line2.length);
    nodeWidths.set(node.id, contentWidth + NODE_PAD * 2 + 2); // +2 for borders
  }

  // Build dagre graph (multigraph for multiple edges between same nodes)
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const w = nodeWidths.get(node.id) ?? 16;
    g.setNode(node.id, { label: node.id, width: w, height: NODE_HEIGHT });
  }

  let edgeIdx = 0;
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to, { label: edge.label ?? "" }, `e${edgeIdx++}`);
  }

  dagre.layout(g);

  // Extract positioned nodes — dagre gives center coordinates
  // Shift everything so minimum x,y is at (1,1)
  let minX = Infinity;
  let minY = Infinity;
  for (const nid of g.nodes()) {
    const nd = g.node(nid);
    minX = Math.min(minX, Math.round(nd.x) - Math.floor(nd.width / 2));
    minY = Math.min(minY, Math.round(nd.y) - Math.floor(nd.height / 2));
  }
  const offsetX = 1 - minX;
  const offsetY = 1 - minY;

  const layoutNodes: LayoutNode[] = [];
  const nodeById = new Map<string, GraphNode>();
  for (const node of nodes) nodeById.set(node.id, node);

  for (const nid of g.nodes()) {
    const nd = g.node(nid);
    const gn = nodeById.get(nid)!;
    const col = Math.round(nd.x) - Math.floor(nd.width / 2) + offsetX;
    const row = Math.round(nd.y) - Math.floor(nd.height / 2) + offsetY;
    const step = stepMap.get(nid);

    layoutNodes.push({
      id: nid,
      type: gn.type,
      label: gn.label,
      row,
      col,
      width: Math.round(nd.width),
      height: NODE_HEIGHT,
      details: step ? extractStepDetails(step) : {},
    });
  }

  // Build occupied cells map (cells inside node boxes)
  const occupiedByNode = new Set<string>();
  const nodeByPos = new Map<string, LayoutNode>(); // row,col -> node
  for (const ln of layoutNodes) {
    for (let r = ln.row; r < ln.row + ln.height; r++) {
      for (let c = ln.col; c < ln.col + ln.width; c++) {
        occupiedByNode.add(`${r},${c}`);
        nodeByPos.set(`${r},${c}`, ln);
      }
    }
  }

  // Route edges: use node centers for start/end, connect bottom of source
  // to top of target with simple Manhattan routing
  const layoutEdges: LayoutEdge[] = [];
  const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

  for (const e of g.edges()) {
    const ed = g.edge(e);
    const sourceNode = nodeMap.get(e.v);
    const targetNode = nodeMap.get(e.w);
    if (!sourceNode || !targetNode) continue;

    const cells: Array<{ row: number; col: number; char: string }> = [];

    // Start from bottom-center of source node
    const startCol = Math.round(sourceNode.col + sourceNode.width / 2);
    const startRow = sourceNode.row + sourceNode.height; // just below bottom border

    // End at top-center of target node
    const endCol = Math.round(targetNode.col + targetNode.width / 2);
    const endRow = targetNode.row - 1; // just above top border

    if (startRow <= endRow) {
      // Use dagre's midpoint for routing if available
      const midPoints = (ed.points ?? []).map((p: { x: number; y: number }) => ({
        col: Math.round(p.x) + offsetX,
        row: Math.round(p.y) + offsetY,
      }));

      // Find a midpoint that's between source and target vertically
      const midRow = Math.round((startRow + endRow) / 2);
      let midCol = startCol; // default: straight down

      // Use dagre's middle bend point if it suggests a horizontal offset
      if (midPoints.length >= 2) {
        const mid = midPoints[Math.floor(midPoints.length / 2)];
        if (mid.row > startRow && mid.row < endRow) {
          midCol = mid.col;
        }
      }

      if (startCol === endCol && midCol === startCol) {
        // Straight vertical line
        for (let r = startRow; r < endRow; r++) {
          if (!occupiedByNode.has(`${r},${startCol}`)) {
            cells.push({ row: r, col: startCol, char: "│" });
          }
        }
        if (!occupiedByNode.has(`${endRow},${endCol}`)) {
          cells.push({ row: endRow, col: endCol, char: "▼" });
        }
      } else {
        // Manhattan route: down from source, horizontal, down to target
        // Vertical segment from source
        for (let r = startRow; r <= midRow; r++) {
          if (!occupiedByNode.has(`${r},${startCol}`)) {
            cells.push({ row: r, col: startCol, char: "│" });
          }
        }
        // Horizontal segment
        const hDir = Math.sign(endCol - startCol);
        for (let c = startCol + hDir; c !== endCol; c += hDir) {
          if (!occupiedByNode.has(`${midRow},${c}`)) {
            cells.push({ row: midRow, col: c, char: "─" });
          }
        }
        // Corner/junction at endCol
        if (!occupiedByNode.has(`${midRow},${endCol}`)) {
          cells.push({ row: midRow, col: endCol, char: "│" });
        }
        // Vertical segment to target
        for (let r = midRow + 1; r < endRow; r++) {
          if (!occupiedByNode.has(`${r},${endCol}`)) {
            cells.push({ row: r, col: endCol, char: "│" });
          }
        }
        if (!occupiedByNode.has(`${endRow},${endCol}`)) {
          cells.push({ row: endRow, col: endCol, char: "▼" });
        }
      }
    }

    // Deduplicate cells
    const seenCells = new Set<string>();
    const dedupedCells = cells.filter((c) => {
      const key = `${c.row},${c.col}`;
      if (seenCells.has(key)) return false;
      seenCells.add(key);
      return true;
    });

    const matchingEdge = edges.find(
      (ge) => ge.from === e.v && ge.to === e.w && (ge.label ?? "") === (ed.label ?? ""),
    ) ?? edges.find((ge) => ge.from === e.v && ge.to === e.w);

    layoutEdges.push({
      from: e.v,
      to: e.w,
      label: matchingEdge?.label ?? ed.label ?? "",
      cells: dedupedCells,
    });
  }

  // Compute canvas bounds
  let maxRow = 0;
  let maxCol = 0;
  for (const n of layoutNodes) {
    maxRow = Math.max(maxRow, n.row + n.height);
    maxCol = Math.max(maxCol, n.col + n.width);
  }
  for (const e of layoutEdges) {
    for (const c of e.cells) {
      maxRow = Math.max(maxRow, c.row + 1);
      maxCol = Math.max(maxCol, c.col + 1);
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxCol + 2,
    height: maxRow + 2,
    adjacency,
  };
}

/** Extract step details for the expand panel */
function extractStepDetails(step: WorkflowStep): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (step.run) details.run = step.run;
  if (step.command) details.command = step.command;
  if (step.pipeline) details.pipeline = step.pipeline;
  if (step.workflow) details.workflow = step.workflow;
  if (step.stdin) details.stdin = step.stdin;
  if (step.for_each) details.for_each = step.for_each;
  if (step.when) details.when = step.when;
  if (step.condition) details.condition = step.condition;
  if (step.approval) details.approval = step.approval;
  if (step.input) details.input = step.input;
  if (step.parallel) details.parallel = step.parallel;
  if (step.steps) details.steps = `${step.steps.length} sub-steps`;
  return details;
}

/** Render the layout to a canvas of tagged cells for the TUI */
export function renderCanvas(
  layout: GraphLayout,
  selectedNodeId?: string,
): string[] {
  // Create 2D char grid
  const grid: string[][] = [];
  for (let r = 0; r < layout.height; r++) {
    grid.push(new Array(layout.width).fill(" "));
  }

  // Draw edges first (nodes overdraw edges)
  for (const edge of layout.edges) {
    for (const cell of edge.cells) {
      if (cell.row >= 0 && cell.row < layout.height && cell.col >= 0 && cell.col < layout.width) {
        grid[cell.row][cell.col] = cell.char;
      }
    }
  }

  // Draw nodes as boxes
  for (const node of layout.nodes) {
    drawNodeBox(grid, node, node.id === selectedNodeId);
  }

  return grid.map((row) => row.join(""));
}

/** Draw a single node box on the grid */
function drawNodeBox(
  grid: string[][],
  node: LayoutNode,
  selected: boolean,
): void {
  const { row, col, width } = node;
  const innerWidth = width - 2;
  const isApproval = node.type === "approval";

  // Ensure grid is big enough
  if (row + NODE_HEIGHT > grid.length) return;
  if (col + width > (grid[0]?.length ?? 0)) return;

  const selMark = selected ? "»" : " ";

  // Top border
  const tl = isApproval ? "◇" : "┌";
  const tr = isApproval ? "◇" : "┐";
  grid[row][col] = tl;
  for (let c = 1; c <= innerWidth; c++) grid[row][col + c] = "─";
  grid[row][col + width - 1] = tr;

  // Line 1: step id (centered)
  const line1 = node.id;
  const padL1 = Math.floor((innerWidth - line1.length) / 2);
  grid[row + 1][col] = "│";
  if (selected && col > 0) grid[row + 1][col - 1] = selMark;
  for (let c = 1; c <= innerWidth; c++) grid[row + 1][col + c] = " ";
  for (let c = 0; c < line1.length && padL1 + c < innerWidth; c++) {
    grid[row + 1][col + 1 + padL1 + c] = line1[c];
  }
  grid[row + 1][col + width - 1] = "│";

  // Line 2: [type] (centered)
  const line2 = `[${node.type}]`;
  const padL2 = Math.floor((innerWidth - line2.length) / 2);
  grid[row + 2][col] = "│";
  for (let c = 1; c <= innerWidth; c++) grid[row + 2][col + c] = " ";
  for (let c = 0; c < line2.length && padL2 + c < innerWidth; c++) {
    grid[row + 2][col + 1 + padL2 + c] = line2[c];
  }
  grid[row + 2][col + width - 1] = "│";

  // Bottom border
  const bl = isApproval ? "◇" : "└";
  const br = isApproval ? "◇" : "┘";
  grid[row + 3][col] = bl;
  for (let c = 1; c <= innerWidth; c++) grid[row + 3][col + c] = "─";
  grid[row + 3][col + width - 1] = br;
}

// ── Legacy renderer (kept for backward compatibility) ───────────────

export function renderAsciiGraph(workflow: Workflow): string {
  const layout = computeLayout(workflow);
  if (layout.nodes.length === 0) return "(empty workflow)";

  const lines = renderCanvas(layout);

  const output: string[] = [];
  if (workflow.name) {
    output.push(`  Workflow: ${workflow.name}`, "");
  }
  output.push(...lines);

  // Data dependency summary
  const dataEdges = layout.edges.filter((e) => e.label !== "next");
  if (dataEdges.length > 0) {
    output.push("");
    output.push("  Data dependencies:");
    for (const edge of dataEdges) {
      output.push(`    ${edge.from} ──▶ ${edge.to}  (${edge.label})`);
    }
  }

  return output.join("\n");
}
