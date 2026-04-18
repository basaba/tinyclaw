import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CopilotBridgeClient } from "../../copilot/client.js";
import type { ContextBuilder } from "../../memory/context.js";
import { registerReasonTool } from "./reason.js";
import { registerSummarizeTool } from "./summarize.js";
import { registerCodeReviewTool } from "./code-review.js";
import { registerLlmInvokeTool } from "./llm-invoke.js";

export function registerAllTools(
  server: McpServer,
  copilot: CopilotBridgeClient,
  contextBuilder: ContextBuilder,
): void {
  registerReasonTool(server, copilot, contextBuilder);
  registerSummarizeTool(server, copilot, contextBuilder);
  registerCodeReviewTool(server, copilot, contextBuilder);
  registerLlmInvokeTool(server, copilot, contextBuilder);
}
