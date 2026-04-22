import { CopilotAdapter, type CopilotAdapterOptions, type DirectAdapter } from "./copilot-adapter.js";

export type { CopilotAdapterOptions, DirectAdapter, LlmResponseEnvelope, AdapterParams } from "./copilot-adapter.js";
export { CopilotAdapter } from "./copilot-adapter.js";

export interface CopilotAdaptersBundle {
  adapters: Record<string, DirectAdapter>;
  dispose: () => Promise<void>;
}

/**
 * Create a Copilot adapter bundle ready to plug into Lobster's `ctx.llmAdapters`.
 *
 * The underlying Copilot SDK client is lazily initialized on first `llm.invoke` call.
 * Call `dispose()` when done to clean up resources.
 *
 * @example
 * ```typescript
 * import { createCopilotAdapters } from 'lobster-copilot/adapters';
 * import { runToolRequest } from '@basaba/lobster/tool_runtime';
 *
 * const { adapters, dispose } = createCopilotAdapters({ cliUrl: 'http://localhost:3000' });
 * try {
 *   const result = await runToolRequest({
 *     pipeline: "llm.invoke --provider copilot --prompt 'Summarize this document'",
 *     ctx: { llmAdapters: adapters },
 *   });
 *   console.log(result);
 * } finally {
 *   await dispose();
 * }
 * ```
 */
export function createCopilotAdapters(options: CopilotAdapterOptions = {}): CopilotAdaptersBundle {
  const adapter = new CopilotAdapter(options);

  return {
    adapters: { copilot: adapter },
    dispose: () => adapter.dispose(),
  };
}
