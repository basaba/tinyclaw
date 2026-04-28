import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { scanYamlFiles, fuzzyMatch, fileExists, shortenPath } from "../utils/file-scanner.js";

interface Props {
  value: string;
  cursor: number;
  active: boolean;
  /** Called when the value changes (typing or selection). */
  onChange: (value: string, cursor: number) => void;
  /** Called when user presses Tab/Enter to advance to next field. */
  onNext: () => void;
  /** Called when user presses Shift+Tab to go back. */
  onPrev: () => void;
  /** Called when user wants to view the file. Undefined if no valid file. */
  onView?: () => void;
}

const MAX_SUGGESTIONS = 5;

export function FilePicker({ value, cursor, active, onChange, onNext, onPrev, onView }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Scan once on mount
  const allFiles = useMemo(() => {
    return scanYamlFiles([process.cwd()]);
  }, []);

  // Update suggestions when value changes
  useEffect(() => {
    if (!active) {
      setShowSuggestions(false);
      return;
    }
    const matches = fuzzyMatch(value, allFiles).slice(0, MAX_SUGGESTIONS);
    setSuggestions(matches);
    setSelectedIdx(0);
    setShowSuggestions(matches.length > 0 && value.length > 0);
  }, [value, active, allFiles]);

  const exists = useMemo(() => {
    if (!value.trim()) return false;
    return fileExists(value.trim());
  }, [value]);

  useInput(
    (input, key) => {
      if (!active) return;

      if (key.escape) {
        if (showSuggestions) {
          setShowSuggestions(false);
          return;
        }
        return;
      }

      // Ctrl+O to view file
      if (input === "o" && key.ctrl && onView) {
        onView();
        return;
      }

      // Navigate suggestions
      if (showSuggestions && (key.upArrow || key.downArrow)) {
        setSelectedIdx((prev) => {
          if (key.upArrow) return Math.max(0, prev - 1);
          return Math.min(suggestions.length - 1, prev + 1);
        });
        return;
      }

      // Select suggestion or advance
      if (key.return) {
        if (showSuggestions && suggestions.length > 0) {
          const picked = suggestions[selectedIdx];
          onChange(picked, picked.length);
          setShowSuggestions(false);
          return;
        }
        onNext();
        return;
      }

      if (key.tab) {
        if (key.shift) {
          onPrev();
          return;
        }
        // Tab-complete if single match
        if (showSuggestions && suggestions.length === 1) {
          const picked = suggestions[0];
          onChange(picked, picked.length);
          setShowSuggestions(false);
          return;
        }
        onNext();
        return;
      }

      // Cursor movement
      if (key.leftArrow) {
        const newCursor = key.ctrl ? 0 : Math.max(0, cursor - 1);
        onChange(value, newCursor);
        return;
      }
      if (key.rightArrow) {
        const newCursor = key.ctrl ? value.length : Math.min(value.length, cursor + 1);
        onChange(value, newCursor);
        return;
      }

      // Delete
      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        const updated = value.slice(0, cursor - 1) + value.slice(cursor);
        onChange(updated, cursor - 1);
        return;
      }

      // Typing
      if (input && !key.ctrl && !key.meta) {
        const updated = value.slice(0, cursor) + input + value.slice(cursor);
        onChange(updated, cursor + 1);
      }
    },
    { isActive: active },
  );

  const renderInput = useCallback(() => {
    if (!active) return <Text>{value || <Text color="gray" dimColor>type to search…</Text>}</Text>;
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
  }, [value, cursor, active]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={active ? "cyan" : "gray"}>File: </Text>
        {renderInput()}
        {value.trim() && (
          <Text> {exists ? <Text color="green">✓</Text> : <Text color="red">✗</Text>}</Text>
        )}
      </Box>
      {active && showSuggestions && (
        <Box flexDirection="column" marginLeft={6}>
          {suggestions.map((s, i) => (
            <Box key={s}>
              <Text color={i === selectedIdx ? "cyan" : "gray"}>
                {i === selectedIdx ? "❯ " : "  "}
                {shortenPath(s)}
              </Text>
            </Box>
          ))}
          <Text color="gray" dimColor>↑/↓ select · Enter pick · Esc dismiss</Text>
        </Box>
      )}
    </Box>
  );
}
