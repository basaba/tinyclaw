import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CopilotBridgeClient } from "../../copilot/client.js";
import type { ContextBuilder } from "../../memory/context.js";
import { SUMMARIZE_SYSTEM_PROMPT } from "../../copilot/prompts.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("mcp:tool:summarize");

export function registerSummarizeTool(
  server: McpServer,
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
): void {
  server.tool(
    "summarize",
    "Summarize data from workflow steps using GitHub Copilot",
    {
      data: z.string(),
      format: z.enum(["brief", "detailed", "bullet_points"]).optional().default("brief"),
      conversation_id: z.string().optional(),
    },
    async (args) => {
      logger.debug({ format: args.format, conversation_id: args.conversation_id }, "Summarize tool invoked");

      let context: Array<{ role: string; content: string }> | undefined;

      if (args.conversation_id) {
        context = contextBuilder.buildContext(args.conversation_id, SUMMARIZE_SYSTEM_PROMPT);
      }

      const formatInstruction = `Output format: ${args.format}${
        args.format === "bullet_points" ? " (use bullet points)" : ""
      }`;
      const prompt = `${formatInstruction}\n\nData to summarize:\n${args.data}`;

      const result = await copilot.reason(prompt, context, SUMMARIZE_SYSTEM_PROMPT);

      if (args.conversation_id) {
        try {
          const store = (contextBuilder as unknown as { store: { addMessage: (id: string, role: string, content: string) => void } }).store;
          store.addMessage(args.conversation_id, "user", prompt);
          store.addMessage(args.conversation_id, "assistant", result);
        } catch (err) {
          logger.warn({ err, conversation_id: args.conversation_id }, "Failed to persist messages");
        }
      }

      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}
