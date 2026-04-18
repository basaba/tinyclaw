import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CopilotBridgeClient } from "../../copilot/client.js";
import type { ContextBuilder } from "../../memory/context.js";
import { CODE_REVIEW_SYSTEM_PROMPT } from "../../copilot/prompts.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("mcp:tool:code-review");

export function registerCodeReviewTool(
  server: McpServer,
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
): void {
  server.tool(
    "code_review",
    "Analyze code for bugs, security issues, and improvements using GitHub Copilot",
    {
      code: z.string(),
      language: z.string().optional(),
      focus: z.enum(["bugs", "security", "performance", "all"]).optional().default("all"),
      conversation_id: z.string().optional(),
    },
    async (args) => {
      logger.debug({ language: args.language, focus: args.focus }, "Code review tool invoked");

      let context: Array<{ role: string; content: string }> | undefined;

      if (args.conversation_id) {
        context = contextBuilder.buildContext(args.conversation_id, CODE_REVIEW_SYSTEM_PROMPT);
      }

      const langAnnotation = args.language ?? "plaintext";
      const prompt = [
        `Focus area: ${args.focus}`,
        "",
        `\`\`\`${langAnnotation}`,
        args.code,
        "```",
      ].join("\n");

      const result = await copilot.reason(prompt, context, CODE_REVIEW_SYSTEM_PROMPT);

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
