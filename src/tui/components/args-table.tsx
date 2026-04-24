import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface ArgRow {
  key: string;
  value: string;
}

interface Props {
  rows: ArgRow[];
  onChange: (rows: ArgRow[]) => void;
  active: boolean;
  onExit?: (dir: "next" | "prev") => void;
}

type Col = "key" | "value";

/** Convert a Record to editable rows. */
export function argsToRows(args: Record<string, unknown> | undefined): ArgRow[] {
  if (!args || typeof args !== "object") return [];
  return Object.entries(args).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

/** Convert editable rows back to a Record (skips empty keys). */
export function rowsToArgs(rows: ArgRow[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) result[k] = r.value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Render text with a visible cursor block at the given position. */
function CellEditor({ value, cursor, active }: { value: string; cursor: number; active: boolean }) {
  if (!active) return <Text>{value || " "}</Text>;
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}

const KEY_WIDTH = 20;
const VAL_WIDTH = 40;

export function ArgsTable({ rows, onChange, active, onExit }: Props) {
  const [rowIdx, setRowIdx] = useState(0);
  const [col, setCol] = useState<Col>("key");
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);

  const safeRowIdx = Math.min(rowIdx, Math.max(0, rows.length - 1));

  const handleInput = useCallback(
    (input: string, key: {
      return: boolean; escape: boolean; backspace: boolean; delete: boolean;
      ctrl: boolean; meta: boolean; upArrow: boolean; downArrow: boolean;
      leftArrow: boolean; rightArrow: boolean; shift: boolean; tab: boolean;
    }) => {
      if (!active) return;

      // Enter to start/stop editing a cell
      if (key.return && rows.length > 0) {
        if (editing) {
          setEditing(false);
        } else {
          setEditing(true);
          const val = col === "key" ? rows[safeRowIdx].key : rows[safeRowIdx].value;
          setCursor(val.length);
        }
        return;
      }

      // When editing, handle text input
      if (editing && rows.length > 0) {
        if (key.escape) {
          setEditing(false);
          return;
        }
        if (key.tab) {
          // Switch column while staying in edit mode
          setEditing(false);
          if (col === "key") {
            setCol("value");
            setCursor(rows[safeRowIdx].value.length);
          } else {
            setCol("key");
            setCursor(rows[safeRowIdx].key.length);
          }
          setEditing(true);
          return;
        }
        if (key.leftArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.rightArrow) {
          const val = col === "key" ? rows[safeRowIdx].key : rows[safeRowIdx].value;
          setCursor((c) => Math.min(val.length, c + 1));
          return;
        }
        if (key.backspace || key.delete) {
          if (cursor === 0) return;
          const updated = [...rows];
          const r = { ...updated[safeRowIdx] };
          const val = col === "key" ? r.key : r.value;
          const newVal = val.slice(0, cursor - 1) + val.slice(cursor);
          if (col === "key") r.key = newVal; else r.value = newVal;
          updated[safeRowIdx] = r;
          onChange(updated);
          setCursor(cursor - 1);
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          const updated = [...rows];
          const r = { ...updated[safeRowIdx] };
          const val = col === "key" ? r.key : r.value;
          const newVal = val.slice(0, cursor) + input + val.slice(cursor);
          if (col === "key") r.key = newVal; else r.value = newVal;
          updated[safeRowIdx] = r;
          onChange(updated);
          setCursor(cursor + input.length);
          return;
        }
        return;
      }

      // Navigation mode (not editing)
      if (key.tab && key.shift) {
        onExit?.("prev");
        return;
      }
      if (key.escape || key.tab) {
        onExit?.("next");
        return;
      }
      if (key.upArrow) {
        setRowIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setRowIdx((i) => Math.min(rows.length - 1, i + 1));
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        setCol((c) => (c === "key" ? "value" : "key"));
        return;
      }

      // Add row
      if (input === "a") {
        const updated = [...rows];
        const insertAt = rows.length === 0 ? 0 : safeRowIdx + 1;
        updated.splice(insertAt, 0, { key: "", value: "" });
        onChange(updated);
        setRowIdx(insertAt);
        setCol("key");
        setCursor(0);
        setEditing(true);
        return;
      }

      // Delete row
      if (input === "d" && rows.length > 0) {
        const updated = rows.filter((_, i) => i !== safeRowIdx);
        onChange(updated);
        setRowIdx(Math.min(safeRowIdx, Math.max(0, updated.length - 1)));
        return;
      }
    },
    [active, rows, onChange, onExit, safeRowIdx, col, cursor, editing],
  );

  useInput(handleInput, { isActive: active });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={active ? "cyan" : "gray"}>Args: </Text>
        {active && (
          <Text color="gray">
            {editing ? "Esc to stop editing, Tab to switch column" : "Enter to edit, ↑/↓ rows, ◂/▸ cols, a add, d delete"}
          </Text>
        )}
      </Box>
      {/* Header */}
      <Box>
        <Box width={4}>
          <Text color="gray"> </Text>
        </Box>
        <Box width={KEY_WIDTH}>
          <Text bold color="gray">Key</Text>
        </Box>
        <Box width={3}>
          <Text color="gray"> │ </Text>
        </Box>
        <Box width={VAL_WIDTH}>
          <Text bold color="gray">Value</Text>
        </Box>
      </Box>
      <Box>
        <Text color="gray">{"─".repeat(KEY_WIDTH + VAL_WIDTH + 7)}</Text>
      </Box>
      {rows.length === 0 ? (
        <Box>
          <Text color="gray" italic>  (no args — press &apos;a&apos; to add)</Text>
        </Box>
      ) : (
        rows.map((row, i) => {
          const isSelected = active && i === safeRowIdx;
          const keyActive = isSelected && col === "key" && editing;
          const valActive = isSelected && col === "value" && editing;
          return (
            <Box key={i}>
              <Box width={4}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? " ▸ " : "   "}</Text>
              </Box>
              <Box width={KEY_WIDTH}>
                {keyActive ? (
                  <CellEditor value={row.key} cursor={cursor} active />
                ) : (
                  <Text color={isSelected && col === "key" ? "cyan" : undefined}>
                    {row.key || (isSelected && col === "key" ? " " : "")}
                  </Text>
                )}
              </Box>
              <Box width={3}>
                <Text color="gray"> │ </Text>
              </Box>
              <Box width={VAL_WIDTH}>
                {valActive ? (
                  <CellEditor value={row.value} cursor={cursor} active />
                ) : (
                  <Text color={isSelected && col === "value" ? "cyan" : undefined}>
                    {row.value || (isSelected && col === "value" ? " " : "")}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
