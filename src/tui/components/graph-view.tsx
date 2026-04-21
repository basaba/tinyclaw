import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  parseWorkflowFile,
  computeLayout,
  renderCanvas,
  type GraphLayout,
  type LayoutNode,
} from "../utils/workflow-graph.js";
interface Props {
  filePath: string;
  onBack: () => void;
}

export function GraphView({ filePath, onBack }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [viewportRow, setViewportRow] = useState(0);
  const [viewportCol, setViewportCol] = useState(0);
  const VISIBLE_ROWS = 24;
  const VISIBLE_COLS = 100;
  const DETAIL_HEIGHT = 6;

  // Compute layout
  const layout = useMemo<GraphLayout | null>(() => {
    try {
      const workflow = parseWorkflowFile(filePath);
      return computeLayout(workflow);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to render graph");
      return null;
    }
  }, [filePath]);

  // Select first node on initial load
  useEffect(() => {
    if (layout && layout.nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(layout.nodes[0].id);
    }
  }, [layout]);

  // Render canvas with current selection
  const canvasLines = useMemo(() => {
    if (!layout) return [];
    return renderCanvas(layout, selectedNodeId ?? undefined);
  }, [layout, selectedNodeId]);

  // Navigate nodes
  useInput((_input, key) => {
    if (key.escape) {
      if (expandedNodeId) {
        setExpandedNodeId(null);
        return;
      }
      onBack();
      return;
    }

    if (!layout || layout.nodes.length === 0) return;

    if (key.return) {
      // Toggle expand
      if (expandedNodeId === selectedNodeId) {
        setExpandedNodeId(null);
      } else {
        setExpandedNodeId(selectedNodeId);
      }
      return;
    }

    // Navigation: up/down follow topology, left/right spatial
    const currentNode = layout.nodes.find((n) => n.id === selectedNodeId);
    if (!currentNode) {
      setSelectedNodeId(layout.nodes[0].id);
      return;
    }

    const adj = layout.adjacency.get(currentNode.id);

    if (key.downArrow) {
      // Move to successor (topology-first)
      const successors = adj?.successors ?? [];
      if (successors.length > 0) {
        // Pick the successor closest spatially below
        const candidates = layout.nodes.filter((n) => successors.includes(n.id));
        const next = pickClosest(currentNode, candidates, "down");
        if (next) selectAndFollow(next);
      }
    } else if (key.upArrow) {
      // Move to predecessor (topology-first)
      const predecessors = adj?.predecessors ?? [];
      if (predecessors.length > 0) {
        const candidates = layout.nodes.filter((n) => predecessors.includes(n.id));
        const next = pickClosest(currentNode, candidates, "up");
        if (next) selectAndFollow(next);
      }
    } else if (key.leftArrow) {
      // Move spatially left among all nodes at similar rank
      const sameRank = layout.nodes.filter(
        (n) => n.id !== currentNode.id && n.col < currentNode.col,
      );
      const closest = pickClosest(currentNode, sameRank, "left");
      if (closest) selectAndFollow(closest);
    } else if (key.rightArrow) {
      // Move spatially right among all nodes at similar rank
      const sameRank = layout.nodes.filter(
        (n) => n.id !== currentNode.id && n.col > currentNode.col,
      );
      const closest = pickClosest(currentNode, sameRank, "right");
      if (closest) selectAndFollow(closest);
    } else if (key.tab) {
      // Tab cycles through all nodes sequentially
      const idx = layout.nodes.findIndex((n) => n.id === selectedNodeId);
      const next = layout.nodes[(idx + 1) % layout.nodes.length];
      selectAndFollow(next);
    }
  });

  function selectAndFollow(node: LayoutNode) {
    setSelectedNodeId(node.id);
    // Auto-scroll viewport to keep node visible
    setViewportRow((vr) => {
      if (node.row < vr + 2) return Math.max(0, node.row - 2);
      if (node.row + node.height > vr + VISIBLE_ROWS - 2) {
        return Math.max(0, node.row + node.height - VISIBLE_ROWS + 2);
      }
      return vr;
    });
    setViewportCol((vc) => {
      if (node.col < vc + 2) return Math.max(0, node.col - 2);
      if (node.col + node.width > vc + VISIBLE_COLS - 2) {
        return Math.max(0, node.col + node.width - VISIBLE_COLS + 2);
      }
      return vc;
    });
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text bold>Graph View — Esc to go back</Text>
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  if (!layout) {
    return (
      <Box flexDirection="column">
        <Text bold>Graph View — loading…</Text>
      </Box>
    );
  }

  // Get visible portion of canvas
  const graphRows = expandedNodeId ? VISIBLE_ROWS - DETAIL_HEIGHT : VISIBLE_ROWS;
  const visibleLines = canvasLines.slice(viewportRow, viewportRow + graphRows);

  // Find edges connected to selected node for highlighting
  const connectedEdges = new Set<string>();
  if (selectedNodeId) {
    for (const edge of layout.edges) {
      if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
        connectedEdges.add(`${edge.from}->${edge.to}:${edge.label}`);
      }
    }
  }

  // Build set of highlighted cells (cells on edges connected to selected node)
  const highlightedCells = new Set<string>();
  if (selectedNodeId) {
    for (const edge of layout.edges) {
      if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
        for (const cell of edge.cells) {
          highlightedCells.add(`${cell.row},${cell.col}`);
        }
      }
    }
  }

  // Get expanded node details for single-expand panel
  const expandedNode = expandedNodeId
    ? layout.nodes.find((n) => n.id === expandedNodeId)
    : null;

  return (
    <Box flexDirection="column">
      <Text bold>
        Graph View — <Text color="cyan">{filePath}</Text>
      </Text>
      <Text color="gray">
        ↑↓←→:navigate Tab:cycle Enter:expand Esc:back
      </Text>

      <Box marginTop={1} flexDirection="column">
        {visibleLines.map((line, i) => {
          const lineIdx = viewportRow + i;
          return (
            <Box key={lineIdx}>
              <Text>
                {colorCanvasLine(
                  line,
                  lineIdx,
                  viewportCol,
                  VISIBLE_COLS,
                  layout,
                  selectedNodeId,
                  highlightedCells,
                )}
              </Text>
            </Box>
          );
        })}
      </Box>

      {expandedNode && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">
            {expandedNode.id} [{expandedNode.type}]
          </Text>
          {Object.entries(expandedNode.details).map(([key, value]) => (
            <Text key={key}>
              <Text color="yellow">{key}</Text>
              <Text>: </Text>
              <Text color="white">{String(value)}</Text>
            </Text>
          ))}
          {Object.keys(expandedNode.details).length === 0 && (
            <Text color="gray">(no additional details)</Text>
          )}
        </Box>
      )}

      {canvasLines.length > VISIBLE_ROWS && (
        <Box>
          <Text color="gray" dimColor>
            {selectedNodeId ? `Selected: ${selectedNodeId}` : ""}{" "}
            [{viewportRow + 1}-{Math.min(viewportRow + graphRows, canvasLines.length)}/{canvasLines.length}]
          </Text>
        </Box>
      )}
    </Box>
  );
}

/** Pick the closest node in a direction */
function pickClosest(
  current: LayoutNode,
  candidates: LayoutNode[],
  direction: "up" | "down" | "left" | "right",
): LayoutNode | null {
  if (candidates.length === 0) return null;

  const cx = current.col + current.width / 2;
  const cy = current.row + current.height / 2;

  let best: LayoutNode | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    const nx = c.col + c.width / 2;
    const ny = c.row + c.height / 2;
    let dist: number;

    switch (direction) {
      case "down":
        dist = Math.abs(nx - cx) + Math.max(0, ny - cy) * 0.1;
        break;
      case "up":
        dist = Math.abs(nx - cx) + Math.max(0, cy - ny) * 0.1;
        break;
      case "left":
        dist = Math.abs(ny - cy) + Math.max(0, cx - nx) * 0.1;
        break;
      case "right":
        dist = Math.abs(ny - cy) + Math.max(0, nx - cx) * 0.1;
        break;
    }

    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best;
}

/** Color a canvas line with semantic highlighting */
function colorCanvasLine(
  line: string,
  _row: number,
  colOffset: number,
  maxCols: number,
  layout: GraphLayout,
  selectedNodeId: string | null,
  highlightedCells: Set<string>,
): React.ReactNode {
  // Viewport-clip the line
  const clipped = line.slice(colOffset, colOffset + maxCols);
  if (clipped.trim() === "") return <Text>{clipped}</Text>;

  // Build segments with color info
  const segments: React.ReactNode[] = [];
  let i = 0;

  while (i < clipped.length) {
    const absCol = colOffset + i;
    const ch = clipped[i];

    // Check if this cell is a highlighted edge cell
    const isHighlighted = highlightedCells.has(`${_row},${absCol}`);

    // Check if this position is inside a node box
    const ownerNode = findNodeAt(layout, _row, absCol);

    if (ownerNode) {
      // Collect consecutive chars belonging to this node
      let j = i;
      while (j < clipped.length && findNodeAt(layout, _row, colOffset + j)?.id === ownerNode.id) {
        j++;
      }
      const text = clipped.slice(i, j);
      const isSelected = ownerNode.id === selectedNodeId;

      // Determine what kind of content this is
      if (/^[┌┐└┘◇─]+$/.test(text)) {
        // Border
        segments.push(
          <Text key={i} color={isSelected ? "cyan" : "gray"} bold={isSelected}>
            {text}
          </Text>,
        );
      } else if (text.includes("[") && text.includes("]")) {
        // Type tag line
        const typeMatch = text.match(/\[(\w+)\]/);
        if (typeMatch) {
          const type = typeMatch[1];
          const typeColor =
            type === "approval" ? "red"
            : type === "parallel" ? "magenta"
            : type === "pipeline" ? "blue"
            : type === "for_each" ? "magenta"
            : type === "run" ? "green"
            : type === "workflow" ? "blue"
            : "white";
          segments.push(
            <Text key={i} color={isSelected ? "cyan" : typeColor}>
              {text}
            </Text>,
          );
        } else {
          segments.push(
            <Text key={i} color={isSelected ? "cyan" : "white"}>
              {text}
            </Text>,
          );
        }
      } else {
        // Node ID or padding
        const trimmed = text.trim();
        if (trimmed && !trimmed.match(/^[│ ]+$/)) {
          segments.push(
            <Text key={i} bold color={isSelected ? "cyan" : "white"}>
              {text}
            </Text>,
          );
        } else {
          segments.push(
            <Text key={i} color={isSelected ? "cyan" : "gray"}>
              {text}
            </Text>,
          );
        }
      }
      i = j;
    } else if (isHighlighted && /[│─▼▲▶◀┌┐└┘├┤┬┴┼]/.test(ch)) {
      // Highlighted edge cell
      let j = i;
      while (
        j < clipped.length &&
        highlightedCells.has(`${_row},${colOffset + j}`) &&
        !findNodeAt(layout, _row, colOffset + j)
      ) {
        j++;
      }
      segments.push(
        <Text key={i} color="yellow" bold>
          {clipped.slice(i, j)}
        </Text>,
      );
      i = j;
    } else if (/[│─▼▲▶◀]/.test(ch)) {
      // Unhighlighted edge
      let j = i;
      while (
        j < clipped.length &&
        /[│─▼▲▶◀]/.test(clipped[j]) &&
        !findNodeAt(layout, _row, colOffset + j)
      ) {
        j++;
      }
      segments.push(
        <Text key={i} color="gray" dimColor>
          {clipped.slice(i, j)}
        </Text>,
      );
      i = j;
    } else {
      // Regular whitespace or unknown char
      let j = i;
      while (
        j < clipped.length &&
        !/[│─▼▲▶◀┌┐└┘◇]/.test(clipped[j]) &&
        !findNodeAt(layout, _row, colOffset + j)
      ) {
        j++;
      }
      segments.push(<Text key={i}>{clipped.slice(i, j)}</Text>);
      i = j;
    }
  }

  return <Text>{segments}</Text>;
}

/** Find which node owns a given cell position */
function findNodeAt(layout: GraphLayout, row: number, col: number): LayoutNode | null {
  for (const node of layout.nodes) {
    if (
      row >= node.row &&
      row < node.row + node.height &&
      col >= node.col &&
      col < node.col + node.width
    ) {
      return node;
    }
  }
  return null;
}
