import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CopilotBridgeClient } from "../../copilot/client.js";
import type { ContextBuilder } from "../../memory/context.js";
import { LLM_INVOKE_SYSTEM_PROMPT } from "../../copilot/prompts.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("mcp:tool:llm_invoke");

/**
 * Registers the `llm_invoke` MCP tool, compatible with Lobster's built-in
 * `llm-task` step type. Supports both "json" and "text" actions.
 */
export function registerLlmInvokeTool(
  server: McpServer,
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
): void {
  server.tool(
    "llm_invoke",
    "Invoke LLM reasoning compatible with Lobster llm-task. Supports structured JSON and freeform text actions.",
    {
      prompt: z.string().describe("The prompt text to send to the LLM"),
      action: z
        .enum(["json", "text"])
        .optional()
        .default("text")
        .describe("Output action: 'json' for structured JSON output, 'text' for freeform"),
      input: z
        .any()
        .optional()
        .describe("Structured input data to include as context for the prompt"),
      schema: z
        .record(z.any())
        .optional()
        .describe("JSON Schema to validate structured output (used with action='json')"),
      model: z.string().optional().describe("Model name override"),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Sampling temperature (0-2)"),
      maxTokens: z
        .number()
        .int()
        .positive()
        .optional()
        .default(800)
        .describe("Maximum tokens for the LLM output"),
      thinking: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Reasoning depth preset"),
      conversation_id: z.string().optional().describe("Conversation ID for memory persistence"),
      workflow_id: z.string().optional().describe("Workflow ID for namespace isolation"),
    },
    async (args) => {
      logger.debug(
        { action: args.action, conversation_id: args.conversation_id },
        "llm_invoke tool invoked",
      );

      let context: Array<{ role: string; content: string }> | undefined;

      if (args.conversation_id) {
        context = contextBuilder.buildContext(args.conversation_id, LLM_INVOKE_SYSTEM_PROMPT);
      }

      // Build the full prompt with input data and action-specific instructions
      const parts: string[] = [];

      if (args.input !== undefined) {
        const inputStr =
          typeof args.input === "string" ? args.input : JSON.stringify(args.input, null, 2);
        parts.push(`<input>\n${inputStr}\n</input>`);
      }

      if (args.action === "json") {
        parts.push(
          "IMPORTANT: Respond with valid JSON only. No markdown code fences, no explanatory text outside the JSON.",
        );
        if (args.schema) {
          parts.push(
            `The output MUST conform to this JSON Schema:\n${JSON.stringify(args.schema, null, 2)}`,
          );
        }
      }

      if (args.thinking) {
        const thinkingMap = {
          low: "Be concise and direct. Minimal reasoning steps.",
          medium: "Show moderate reasoning. Balance depth and brevity.",
          high: "Think step by step. Show detailed reasoning before concluding.",
        };
        parts.push(thinkingMap[args.thinking]);
      }

      parts.push(args.prompt);

      const fullPrompt = parts.join("\n\n");

      const result = await copilot.reason(fullPrompt, context, LLM_INVOKE_SYSTEM_PROMPT);

      // For JSON action, attempt to parse and validate the output
      if (args.action === "json") {
        try {
          const parsed = JSON.parse(result);

          // Persist messages if conversation tracking is enabled
          if (args.conversation_id) {
            persistMessages(contextBuilder, args.conversation_id, fullPrompt, result);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  json: parsed,
                  raw: result,
                }),
              },
            ],
          };
        } catch {
          logger.warn("LLM output was not valid JSON, returning raw text");
          // Fall through to return raw text with an error flag
          if (args.conversation_id) {
            persistMessages(contextBuilder, args.conversation_id, fullPrompt, result);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "LLM output was not valid JSON",
                  raw: result,
                }),
              },
            ],
            isError: true,
          };
        }
      }

      // Text action — return as-is
      if (args.conversation_id) {
        persistMessages(contextBuilder, args.conversation_id, fullPrompt, result);
      }

      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}

function persistMessages(
  contextBuilder: ContextBuilder,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): void {
  try {
    const store = (
      contextBuilder as unknown as {
        store: { addMessage: (id: string, role: string, content: string) => void };
      }
    ).store;
    store.addMessage(conversationId, "user", userMessage);
    store.addMessage(conversationId, "assistant", assistantMessage);
  } catch (err) {
    logger.warn({ err, conversation_id: conversationId }, "Failed to persist messages");
  }
}
