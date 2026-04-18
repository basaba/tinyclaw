import { createDefaultRegistry } from "@clawdbot/lobster/core";
import type { CopilotBridgeClient } from "../copilot/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";

export type LobsterCommand = {
  name: string;
  help: () => string;
  run: (params: any) => Promise<any>;
  meta?: {
    description?: string;
    argsSchema?: unknown;
    examples?: Array<{ args: Record<string, unknown>; description?: string }>;
    sideEffects?: string[];
  };
};

export type CommandRegistry = {
  get(name: string): LobsterCommand | undefined;
  list(): string[];
};

export interface ExtendedRegistryOptions {
  /** Custom commands to add alongside defaults */
  commands?: LobsterCommand[];
  /** Copilot client instance (for copilot.* commands) */
  copilotClient?: CopilotBridgeClient;
  /** MCP server configs (for mcp.call command context) */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Create an extended command registry that includes Lobster's defaults
 * plus custom lobster-copilot commands.
 */
export function createExtendedRegistry(options: ExtendedRegistryOptions = {}): CommandRegistry {
  const defaults = createDefaultRegistry();
  const custom = new Map<string, LobsterCommand>();

  // Add any explicitly provided custom commands
  for (const cmd of options.commands ?? []) {
    custom.set(cmd.name, cmd);
  }

  return {
    get(name: string) {
      return custom.get(name) ?? defaults.get(name);
    },
    list() {
      const all = new Set([...custom.keys(), ...defaults.list()]);
      return [...all].sort();
    },
  };
}
