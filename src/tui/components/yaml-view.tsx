import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

interface Props {
  filePath: string;
  availableHeight: number;
  onBack: () => void;
}

export function YamlView({ filePath, availableHeight, onBack }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Own chrome: header(1) + hint(1) + margin(1) + scroll hint(1) = 4
  const VISIBLE_LINES = Math.max(5, availableHeight - 4);

  useEffect(() => {
    const resolved = resolve(filePath);
    const readFile = () => {
      try {
        const content = readFileSync(resolved, "utf-8");
        setLines(content.split("\n"));
        setError(null);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to read file",
        );
      }
    };

    readFile();

    const watcher = watch(resolved, { persistent: false }, (event) => {
      if (event === "change") readFile();
    });
    return () => watcher.close();
  }, [filePath]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setScrollOffset((o) => Math.max(0, o - 1));
    if (key.downArrow)
      setScrollOffset((o) => Math.min(o + 1, Math.max(0, lines.length - VISIBLE_LINES)));
    if (key.pageUp) setScrollOffset((o) => Math.max(0, o - VISIBLE_LINES));
    if (key.pageDown)
      setScrollOffset((o) =>
        Math.min(o + VISIBLE_LINES, Math.max(0, lines.length - VISIBLE_LINES)),
      );
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text bold>YAML View — Esc to go back</Text>
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  const visibleLines = lines.slice(scrollOffset, scrollOffset + VISIBLE_LINES);
  const gutterWidth = String(lines.length).length;

  return (
    <Box flexDirection="column">
      <Text bold>
        YAML View — <Text color="cyan">{filePath}</Text>
      </Text>
      <Text color="gray">↑/↓ to scroll, PgUp/PgDn for pages, Esc to go back</Text>

      <Box marginTop={1} flexDirection="column">
        {visibleLines.map((line, i) => {
          const lineNum = scrollOffset + i + 1;
          return (
            <Box key={lineNum}>
              <Text color="gray">
                {String(lineNum).padStart(gutterWidth, " ")} │ 
              </Text>
              <Text>{colorYamlLine(line)}</Text>
            </Box>
          );
        })}
      </Box>

      {lines.length > VISIBLE_LINES && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Lines {scrollOffset + 1}-
            {Math.min(scrollOffset + VISIBLE_LINES, lines.length)}/{lines.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function colorYamlLine(line: string): React.ReactNode {
  // Comment lines
  if (/^\s*#/.test(line)) {
    return <Text color="gray" dimColor>{line}</Text>;
  }

  // Key-value lines
  const kvMatch = line.match(/^(\s*)([\w-]+)(:)(.*)/);
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch;
    return (
      <Text>
        {indent}
        <Text color="cyan">{key}</Text>
        <Text>{colon}</Text>
        <Text color="white">{value}</Text>
      </Text>
    );
  }

  // List item lines
  const listMatch = line.match(/^(\s*)(- )(.*)/);
  if (listMatch) {
    const [, indent, dash, rest] = listMatch;
    return (
      <Text>
        {indent}
        <Text color="yellow">{dash}</Text>
        <Text>{rest}</Text>
      </Text>
    );
  }

  return <Text>{line}</Text>;
}
