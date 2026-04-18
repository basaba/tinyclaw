import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CopilotBridgeClient } from "../../copilot/client.js";
import type { ContextBuilder } from "../../memory/context.js";
import { REASON_SYSTEM_PROMPT } from "../../copilot/prompts.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("mcp:tool:reason");

export function registerReasonTool(
  server: McpServer,
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
): void {
  server.tool(
    "reason",
    "General-purpose LLM reasoning powered by GitHub Copilot",
    {
      prompt: z.string(),
      conversation_id: z.string().optional(),
      workflow_id: z.string().optional(),
      namespace: z.string().optional(),
    },
    async (args) => {
      logger.debug({ conversation_id: args.conversation_id }, "Reason tool invoked");

      let context: Array<{ role: string; content: string }> | undefined;

      if (args.conversation_id) {
        context = contextBuilder.buildContext(args.conversation_id, REASON_SYSTEM_PROMPT);
      }

      const result = await copilot.reason(args.prompt, context, REASON_SYSTEM_PROMPT);

      if (args.conversation_id) {
        try {
          const store = (contextBuilder as unknown as { store: { addMessage: (id: string, role: string, content: string) => void } }).store;
          store.addMessage(args.conversation_id, "user", args.prompt);
          store.addMessage(args.conversation_id, "assistant", result);
        } catch (err) {
          logger.warn({ err, conversation_id: args.conversation_id }, "Failed to persist messages");
        }
      }

      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}
