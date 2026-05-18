import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import {
  fetchManifest,
  filterSamples,
  fetchSampleContent,
  installSample,
  isSampleInstalled,
  type GallerySample,
} from "../../gallery/index.js";

import type { DaemonClient } from "../scheduler/daemon-client.js";

interface Props {
  availableHeight?: number;
  client: DaemonClient;
  onBack: () => void;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "installing"; sample: GallerySample }
  | { kind: "installed"; sample: GallerySample; filePath: string }
  | { kind: "error"; message: string }
  | { kind: "confirm-overwrite"; sample: GallerySample }
  | { kind: "viewing"; sample: GallerySample; content: string; scroll: number };

export function Gallery({ availableHeight, client, onBack }: Props) {
  const [samples, setSamples] = useState<GallerySample[]>([]);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [searchMode, setSearchMode] = useState(false);

  // Load manifest
  useEffect(() => {
    fetchManifest()
      .then((manifest) => {
        setSamples(manifest.samples);
        const installedSet = new Set<string>();
        for (const s of manifest.samples) {
          if (isSampleInstalled(s)) installedSet.add(s.id);
        }
        setInstalled(installedSet);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  const filtered = filterSamples(samples, search);
  const maxVisible = Math.max(5, (availableHeight ?? 20) - 8);

  const handleInstall = useCallback(
    async (sample: GallerySample, overwrite = false) => {
      setStatus({ kind: "installing", sample });
      const result = await installSample(sample, overwrite);
      if (result.success) {
        setInstalled((prev) => new Set([...prev, sample.id]));
        // Register with daemon so it appears in the workflow list
        try {
          const argsMap: Record<string, unknown> = {};
          if (result.argDefaults) {
            for (const [k, v] of Object.entries(result.argDefaults)) argsMap[k] = v;
          }
          await client.addWorkflow({
            id: sample.id,
            name: sample.name,
            filePath: result.filePath,
            schedule: "",
            enabled: false,
            args: Object.keys(argsMap).length > 0 ? argsMap : undefined,
          });
        } catch {
          // May already be registered
        }
        setStatus({ kind: "installed", sample, filePath: result.filePath });
      } else if (result.alreadyExists) {
        setStatus({ kind: "confirm-overwrite", sample });
      } else {
        setStatus({ kind: "error", message: result.error ?? "Unknown error" });
      }
    },
    [client],
  );

  const handleView = useCallback(
    async (sample: GallerySample) => {
      setStatus({ kind: "loading" });
      try {
        const content = await fetchSampleContent(sample);
        setStatus({ kind: "viewing", sample, content, scroll: 0 });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  useInput((input, key) => {
    // Viewing mode: scroll or dismiss
    if (status.kind === "viewing") {
      if (key.escape || input === "q") {
        setStatus({ kind: "ready" });
        return;
      }
      if (key.upArrow) {
        setStatus({ ...status, scroll: Math.max(0, status.scroll - 1) });
        return;
      }
      if (key.downArrow) {
        setStatus({ ...status, scroll: status.scroll + 1 });
        return;
      }
      // Install from preview
      if (input === "i") {
        handleInstall(status.sample);
        return;
      }
      return;
    }

    // Search mode: capture typed characters
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        return;
      }
      if (key.return) {
        setSearchMode(false);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        setSearch((s) => s.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearch((s) => s + input);
        setCursor(0);
      }
      return;
    }

    // Confirm overwrite
    if (status.kind === "confirm-overwrite") {
      if (input === "y" || input === "Y") {
        handleInstall(status.sample, true);
      } else {
        setStatus({ kind: "ready" });
      }
      return;
    }

    // Dismiss installed message
    if (status.kind === "installed") {
      setStatus({ kind: "ready" });
      return;
    }

    // Navigation
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }

    // Actions
    if (input === "/" || input === "f") {
      setSearchMode(true);
      return;
    }
    if (key.return && filtered[cursor]) {
      handleInstall(filtered[cursor]);
      return;
    }
    if ((input === "v" || input === "V") && filtered[cursor]) {
      handleView(filtered[cursor]);
      return;
    }
  });

  // Ensure cursor is within bounds
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  // Scrolling
  const scrollOffset = Math.max(
    0,
    Math.min(safeCursor - Math.floor(maxVisible / 2), filtered.length - maxVisible),
  );
  const visible = filtered.slice(scrollOffset, scrollOffset + maxVisible);

  // Preview mode rendering
  if (status.kind === "viewing") {
    const lines = status.content.split("\n");
    const previewHeight = Math.max(5, (availableHeight ?? 20) - 6);
    const viewLines = lines.slice(status.scroll, status.scroll + previewHeight);
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            📄 {status.sample.name}
          </Text>
          <Text color="gray"> [{status.sample.category}]</Text>
        </Box>
        <Box flexDirection="column">
          {viewLines.map((line, i) => (
            <Text key={status.scroll + i} color="white">
              {line}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">
            ↑↓:scroll  i:install  esc/q:back
            {lines.length > previewHeight
              ? `  (${status.scroll + 1}-${Math.min(status.scroll + previewHeight, lines.length)}/${lines.length})`
              : ""}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          📦 Sample Gallery
        </Text>
        <Text color="gray"> — {samples.length} workflows available</Text>
      </Box>

      {/* Search bar */}
      <Box>
        <Text color={searchMode ? "yellow" : "gray"}>
          🔍 {search || (searchMode ? "type to search..." : "press / to search")}
        </Text>
      </Box>

      {/* Sample list */}
      {status.kind === "loading" ? (
        <Text color="gray">Loading gallery...</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {filtered.length === 0 ? (
            <Text color="gray">
              No samples match{search ? ` "${search}"` : ""}. Press / to search.
            </Text>
          ) : (
            visible.map((sample, i) => {
              const realIndex = scrollOffset + i;
              const isCurrent = realIndex === safeCursor;
              const isInstalled = installed.has(sample.id);
              return (
                <Box key={sample.id}>
                  <Text color={isCurrent ? "cyan" : "white"}>
                    {isCurrent ? "❯ " : "  "}
                  </Text>
                  <Text bold={isCurrent} color={isCurrent ? "cyan" : "white"}>
                    {sample.name}
                  </Text>
                  <Text color="gray"> [{sample.category}]</Text>
                  {isInstalled && <Text color="green"> ✓</Text>}
                  <Text color="gray"> — {sample.description}</Text>
                </Box>
              );
            })
          )}
        </Box>
      )}

      {/* Status messages */}
      {status.kind === "installing" && (
        <Box marginTop={1}>
          <Text color="yellow">Installing {status.sample.name}...</Text>
        </Box>
      )}
      {status.kind === "installed" && (
        <Box marginTop={1}>
          <Text color="green">
            ✓ Installed to {status.filePath} — press any key to continue
          </Text>
        </Box>
      )}
      {status.kind === "confirm-overwrite" && (
        <Box marginTop={1}>
          <Text color="yellow">
            File already exists. Overwrite? (y/n)
          </Text>
        </Box>
      )}
      {status.kind === "error" && (
        <Box marginTop={1}>
          <Text color="red">Error: {status.message}</Text>
        </Box>
      )}
    </Box>
  );
}
