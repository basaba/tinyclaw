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
  resolveAgencyMcps,
  listKnownMcps,
  parseMcpString,
  type AgencyMcpEntry,
  type ResolvedMcpConfig,
} from "./agency/index.js";
export { MemoryStore } from "./memory/store.js";
export { ContextBuilder } from "./memory/context.js";
export { loadConfig } from "./config.js";
export { createLogger } from "./utils/logger.js";
export { createMcpServer, startServer } from "./mcp/server.js";
export {
  REASON_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  CODE_REVIEW_SYSTEM_PROMPT,
  LLM_INVOKE_SYSTEM_PROMPT,
} from "./copilot/prompts.js";
