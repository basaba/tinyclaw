import { readdir } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { LobsterCommand } from "../commands/copilot.js";
import type { McpServerConfig } from "../mcp-config/loader.js";

/**
 * Context provided to plugin `createCommand()` functions.
 * Plugins use this to access MCP servers and the Copilot adapter.
 */
export type PluginContext = {
  mcpServers: Record<string, McpServerConfig>;
  getAdapter: () => unknown;
};

/**
 * Scan a directory for `.js` plugin files and load them.
 * Each file should export `createCommand(ctx)` returning a LobsterCommand or array of them.
 * Returns an empty array if the directory doesn't exist.
 */
export async function loadPlugins(
  dir: string,
  ctx: PluginContext,
): Promise<LobsterCommand[]> {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) return [];

  const entries = await readdir(absDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((e) => e.isFile() && extname(e.name) === ".js")
    .map((e) => join(absDir, e.name));

  const commands: LobsterCommand[] = [];

  for (const file of jsFiles) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const factory = mod.createCommand ?? mod.default;
      if (typeof factory !== "function") {
        process.stderr.write(`⚠️  Plugin ${file}: no createCommand export, skipping\n`);
        continue;
      }
      const result = await factory(ctx);
      if (Array.isArray(result)) {
        commands.push(...result);
      } else if (result && typeof result.name === "string") {
        commands.push(result);
      } else {
        process.stderr.write(`⚠️  Plugin ${file}: createCommand returned invalid result, skipping\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`⚠️  Plugin ${file} failed to load: ${msg}\n`);
    }
  }

  return commands;
}

/**
 * Resolve the plugin directory from CLI flag, env var, or platform default.
 */
export function resolvePluginDir(cliFlag?: string): string {
  if (cliFlag) return cliFlag;
  if (process.env.LOBSTER_PLUGINS) return process.env.LOBSTER_PLUGINS;

  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".config", "lobster-copilot", "plugins");
}
