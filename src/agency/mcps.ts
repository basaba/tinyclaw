import { execFileSync } from "node:child_process";

// ── Types ───────────────────────────────────────────────────────────

/** Configuration for an Agency MCP server to attach to Copilot sessions. */
export type AgencyMcpEntry =
  | string
  | {
      name: string;
      args?: string[];
      env?: Record<string, string>;
      tools?: string[];
    };

/** Resolved MCP server config compatible with Copilot SDK's MCPLocalServerConfig. */
export interface ResolvedMcpConfig {
  type: "local";
  command: string;
  args: string[];
  env?: Record<string, string>;
  tools: string[];
}

/** Known Agency MCP metadata for validation and documentation. */
interface AgencyMcpMeta {
  description: string;
  extraArgs?: string[];
}

// ── Known MCPs (for validation hints, not a hard gate) ──────────────

const KNOWN_MCPS: Record<string, AgencyMcpMeta> = {
  ado: { description: "Azure DevOps — repos, PRs, work items, wiki", extraArgs: ["--organization"] },
  bluebird: { description: "Engineering Copilot Mini" },
  calendar: { description: "Microsoft Calendar" },
  cloudbuild: { description: "CloudBuild" },
  enghub: { description: "EngineeringHub — docs, TSGs, ServiceTree" },
  "es-chat": { description: "ES Chat" },
  icm: { description: "Incident management" },
  kusto: { description: "Kusto/KQL queries via Fabric RTI" },
  "m365-copilot": { description: "M365 content search — docs, emails, sites, files, chats" },
  "m365-user": { description: "User details, manager, team from Microsoft Graph" },
  mail: { description: "Microsoft Mail" },
  "msft-learn": { description: "Microsoft Learn documentation" },
  planner: { description: "Microsoft Planner" },
  "s360-breeze": { description: "S360 Breeze" },
  "security-context": { description: "Azure Security Context" },
  sharepoint: { description: "Microsoft SharePoint" },
  teams: { description: "Microsoft Teams — chats, channels, messages" },
  word: { description: "Microsoft Word" },
  workiq: { description: "WorkIQ" },
};

// ── Builder ─────────────────────────────────────────────────────────

/**
 * Resolve a list of Agency MCP entries into Copilot SDK MCPLocalServerConfig objects.
 * Validates that the `agency` binary is available and MCP names are recognized.
 */
export function resolveAgencyMcps(
  entries: AgencyMcpEntry[],
): Record<string, ResolvedMcpConfig> {
  if (entries.length === 0) return {};

  validateAgencyBinary();

  const configs: Record<string, ResolvedMcpConfig> = {};

  for (const entry of entries) {
    const { name, args, env, tools } = normalizeEntry(entry);

    if (!KNOWN_MCPS[name]) {
      // Warn but don't block — Agency may have newer MCPs we don't know about
      process.stderr.write(
        `⚠️  Unknown Agency MCP "${name}" — proceeding anyway (may fail at runtime)\n`,
      );
    }

    const mcpArgs = ["mcp", name, ...args];

    configs[`agency-${name}`] = {
      type: "local" as const,
      command: "agency",
      args: mcpArgs,
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
      tools: tools.length > 0 ? tools : ["*"],
    };
  }

  return configs;
}

/**
 * List known Agency MCP names and descriptions.
 */
export function listKnownMcps(): Array<{ name: string; description: string }> {
  return Object.entries(KNOWN_MCPS).map(([name, meta]) => ({
    name,
    description: meta.description,
  }));
}

/**
 * Parse a comma-separated MCP string into entries.
 * Supports: "teams,mail,calendar" or "teams,ado:--organization=myorg"
 */
export function parseMcpString(input: string): AgencyMcpEntry[] {
  if (!input.trim()) return [];

  return input.split(",").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return "";

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) return trimmed;

    const name = trimmed.slice(0, colonIdx);
    const argsStr = trimmed.slice(colonIdx + 1);
    const args = argsStr.split(/\s+/).filter(Boolean);

    return { name, args };
  }).filter((e) => e !== "") as AgencyMcpEntry[];
}

// ── Internal helpers ────────────────────────────────────────────────

function normalizeEntry(entry: AgencyMcpEntry): {
  name: string;
  args: string[];
  env: Record<string, string>;
  tools: string[];
} {
  if (typeof entry === "string") {
    return { name: entry, args: [], env: {}, tools: [] };
  }
  return {
    name: entry.name,
    args: entry.args ?? [],
    env: entry.env ?? {},
    tools: entry.tools ?? [],
  };
}

let agencyValidated = false;

function validateAgencyBinary(): void {
  if (agencyValidated) return;
  try {
    execFileSync("agency", ["--version"], {
      stdio: "pipe",
      timeout: 5000,
    });
    agencyValidated = true;
  } catch {
    throw new Error(
      'Agency CLI not found. Install it from https://aka.ms/agency or ensure "agency" is in your PATH.',
    );
  }
}
