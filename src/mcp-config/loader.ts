import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

// ── Types (matching Copilot SDK's MCPServerConfig) ──────────────────

export interface McpServerBase {
  tools: string[];
  type?: string;
  timeout?: number;
}

export interface McpLocalServer extends McpServerBase {
  type?: "local" | "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpRemoteServer extends McpServerBase {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpLocalServer | McpRemoteServer;

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface LoadMcpConfigOptions {
  /** Explicit path to config file (highest priority) */
  configPath?: string;
  /** Working directory for relative resolution (defaults to process.cwd()) */
  cwd?: string;
  /** Filter to only include these server names */
  filter?: string[];
}

// ── Config file resolution ──────────────────────────────────────────

const CONFIG_FILENAMES = ["mcp.json", ".mcp.json"];

function resolveConfigPath(options: LoadMcpConfigOptions = {}): string | undefined {
  // 1. Explicit path
  if (options.configPath) {
    const abs = resolve(options.configPath);
    if (existsSync(abs)) return abs;
    throw new Error(`MCP config file not found: ${abs}`);
  }

  // 2. MCP_CONFIG env var
  const envPath = process.env.MCP_CONFIG;
  if (envPath) {
    const abs = resolve(envPath);
    if (existsSync(abs)) return abs;
    throw new Error(`MCP config file from MCP_CONFIG not found: ${abs}`);
  }

  // 3. CWD-relative files
  const cwd = options.cwd ?? process.cwd();
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }

  // 4. User config directory
  const userConfig = join(homedir(), ".config", "lobster-copilot", "mcp.json");
  if (existsSync(userConfig)) return userConfig;

  return undefined;
}

// ── Loader ──────────────────────────────────────────────────────────

/**
 * Load MCP server configurations from a standard mcp.json config file.
 *
 * Resolution order (first found wins):
 * 1. `options.configPath` (explicit)
 * 2. `MCP_CONFIG` env var
 * 3. `mcp.json` in CWD
 * 4. `.mcp.json` in CWD
 * 5. `~/.config/lobster-copilot/mcp.json`
 *
 * Returns empty record if no config file exists.
 */
export function loadMcpConfig(
  options: LoadMcpConfigOptions = {},
): Record<string, McpServerConfig> {
  const configPath = resolveConfigPath(options);
  if (!configPath) return {};

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read MCP config file ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in MCP config file: ${configPath}`);
  }

  const config = parsed as Record<string, unknown>;

  // Support both { mcpServers: {...} } and bare { serverName: {...} }
  const servers = (
    config.mcpServers && typeof config.mcpServers === "object"
      ? config.mcpServers
      : config
  ) as Record<string, McpServerConfig>;

  // Validate each entry has minimum required fields
  const validated: Record<string, McpServerConfig> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object") continue;

    const e = entry as unknown as Record<string, unknown>;

    if (e.type === "http" || e.type === "sse") {
      if (typeof e.url !== "string") {
        throw new Error(
          `MCP server "${name}" has type "${e.type}" but is missing required "url" field`,
        );
      }
      validated[name] = {
        type: e.type,
        url: e.url,
        tools: normalizeTools(e.tools),
        ...(e.headers ? { headers: e.headers as Record<string, string> } : {}),
        ...(e.timeout ? { timeout: e.timeout as number } : {}),
      };
    } else {
      // Local/stdio server
      if (typeof e.command !== "string") {
        throw new Error(
          `MCP server "${name}" is missing required "command" field`,
        );
      }
      validated[name] = {
        type: (e.type as "local" | "stdio") ?? "local",
        command: e.command,
        args: Array.isArray(e.args) ? e.args : [],
        tools: normalizeTools(e.tools),
        ...(e.env ? { env: e.env as Record<string, string> } : {}),
        ...(e.cwd ? { cwd: e.cwd as string } : {}),
        ...(e.timeout ? { timeout: e.timeout as number } : {}),
      };
    }
  }

  // Apply filter if provided
  if (options.filter && options.filter.length > 0) {
    return filterMcpServers(validated, options.filter);
  }

  return validated;
}

/**
 * Filter a set of MCP server configs to only include named servers.
 * Warns on stderr if a filter name doesn't match any server.
 */
export function filterMcpServers(
  servers: Record<string, McpServerConfig>,
  names: string[],
): Record<string, McpServerConfig> {
  const filtered: Record<string, McpServerConfig> = {};
  for (const name of names) {
    if (servers[name]) {
      filtered[name] = servers[name];
    } else {
      process.stderr.write(
        `⚠️  MCP server "${name}" not found in config file (available: ${Object.keys(servers).join(", ")})\n`,
      );
    }
  }
  return filtered;
}

/**
 * Parse a comma-separated filter string into server names.
 * e.g. "teams,mail,calendar" → ["teams", "mail", "calendar"]
 */
export function parseMcpFilter(input: string): string[] {
  if (!input.trim()) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeTools(tools: unknown): string[] {
  if (Array.isArray(tools)) return tools;
  if (tools === "*") return ["*"];
  return ["*"];
}
