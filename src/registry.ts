import { createCopilotCommand, type LobsterCommand } from "./commands/copilot.js";
import { createMcpCallCommand } from "./commands/mcp.js";
import { createAdoPrMonitorCommand } from "./commands/ado-pr-monitor.js";
import { createTeamsSendCommand } from "./commands/teams.js";
import {
  createMailSendCommand,
  createMailSearchCommand,
  createMailReadCommand,
} from "./commands/mail.js";
import { createDiffKeyCommand } from "./commands/diff-key.js";
import type { CopilotBridgeClient } from "./copilot/client.js";

import type { McpServerConfig } from "./mcp-config/loader.js";

import { loadPlugins, resolvePluginDir, type PluginContext } from "./plugins/loader.js";

export type Registry = {
  get(name: string): LobsterCommand | undefined;
  list(): string[];
};

export type BuildRegistryOptions = {
  getClient: () => CopilotBridgeClient;
  ensureStarted: () => Promise<void>;
  getMcpServers: () => Record<string, McpServerConfig>;
  /** Extra commands to layer on top (e.g. from plugins) */
  extraCommands?: LobsterCommand[];
  /** Plugin directory path (overrides env/default) */
  pluginDir?: string;
  /** Adapter instance for plugin context */
  getAdapter?: () => unknown;
};

/**
 * Build the full layered command registry used by CLI and scheduler engine.
 * Merges lobster's default commands with copilot-specific and MCP commands.
 */
export async function buildRegistry(
  opts: BuildRegistryOptions,
): Promise<Registry> {
  const lobsterCore: any = await import("@basaba/lobster/core");
  const { createDefaultRegistry } = lobsterCore;

  const defaultRegistry = createDefaultRegistry();

  // Load file-based plugins
  const pluginDir = resolvePluginDir(opts.pluginDir);
  const pluginCtx: PluginContext = {
    mcpServers: opts.getMcpServers(),
    getAdapter: opts.getAdapter ?? (() => null),
  };
  const pluginCommands = await loadPlugins(pluginDir, pluginCtx);

  const commands: LobsterCommand[] = [
    createCopilotCommand(opts.getClient, opts.ensureStarted),
    createMcpCallCommand(opts.getMcpServers),
    createAdoPrMonitorCommand(),
    createTeamsSendCommand(opts.getMcpServers),
    createMailSendCommand(opts.getMcpServers),
    createMailSearchCommand(opts.getMcpServers),
    createMailReadCommand(opts.getMcpServers),
    createDiffKeyCommand(),
    ...(opts.extraCommands ?? []),
    ...pluginCommands,
  ];

  const extraMap = new Map(commands.map((c) => [c.name, c]));

  return {
    get(name: string) {
      return extraMap.get(name) ?? defaultRegistry.get(name);
    },
    list() {
      return [...defaultRegistry.list(), ...extraMap.keys()].sort();
    },
  };
}
