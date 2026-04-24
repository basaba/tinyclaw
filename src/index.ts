// Library exports — no side effects on import
export { CopilotBridgeClient, type CopilotBridgeConfig } from "./copilot/client.js";
export {
  CopilotAdapter,
  createCopilotAdapters,
  type CopilotAdapterOptions,
  type CopilotAdaptersBundle,
  type DirectAdapter,
  type LlmResponseEnvelope,
  type AdapterParams,
} from "./adapters/index.js";
export {
  loadMcpConfig,
  filterMcpServers,
  parseMcpFilter,
  type McpServerConfig,
  type McpLocalServer,
  type McpRemoteServer,
  type McpConfigFile,
  type LoadMcpConfigOptions,
} from "./mcp-config/index.js";
export {
  REASON_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  CODE_REVIEW_SYSTEM_PROMPT,
  LLM_INVOKE_SYSTEM_PROMPT,
} from "./copilot/prompts.js";
export { createCopilotCommand, createMcpCallCommand, type LobsterCommand } from "./commands/index.js";
export { loadPlugins, resolvePluginDir, type PluginContext } from "./plugins/loader.js";
export { buildRegistry, type Registry, type BuildRegistryOptions } from "./registry.js";
export {
  resolveServer,
  withMcpClient,
  listTools,
  callTool,
  type McpToolInfo,
  type McpCallResult,
} from "./mcp-client/index.js";
