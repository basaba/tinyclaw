import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { CopilotError } from "../utils/errors.js";
import { REASON_SYSTEM_PROMPT } from "./prompts.js";

export interface CopilotBridgeConfig {
  cliUrl?: string;
  apiKey?: string;
  /** Default model ID (e.g. "gpt-4o", "claude-sonnet-4") */
  model?: string;
  /** Reasoning effort level for models that support it */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** Auto-discover .mcp.json / .vscode/mcp.json from workingDirectory (default: true) */
  enableConfigDiscovery?: boolean;
  /** Working directory for config discovery and tool operations */
  workingDirectory?: string;
  /** Timeout in milliseconds for sendAndWait (default: 60 000) */
  timeoutMs?: number;
}

export class CopilotBridgeClient {
  private client: CopilotClient | null = null;
  private config: CopilotBridgeConfig;

  constructor(config: CopilotBridgeConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    try {
      this.client = this.config.cliUrl
        ? new CopilotClient({ cliUrl: this.config.cliUrl })
        : new CopilotClient();
      await this.client.start();
    } catch (err) {
      throw new CopilotError(
        `Failed to start Copilot client: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.stop();
      this.client = null;
    } catch (err) {
      throw new CopilotError(
        `Failed to stop Copilot client: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async reason(
    prompt: string,
    context?: Array<{ role: string; content: string }>,
    systemPrompt?: string,
    options?: {
      model?: string;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    },
  ): Promise<string> {
    if (!this.client) {
      throw new CopilotError("Copilot client is not started. Call start() first.");
    }

    const model = options?.model ?? this.config.model;
    const reasoningEffort = options?.reasoningEffort ?? this.config.reasoningEffort;
    const enableConfigDiscovery = this.config.enableConfigDiscovery ?? true;
    const workingDirectory = this.config.workingDirectory ?? process.cwd();

    const session = await this.client.createSession({
      onPermissionRequest: approveAll,
      enableConfigDiscovery,
      workingDirectory,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });

    try {
      const system = systemPrompt ?? REASON_SYSTEM_PROMPT;

      // Build the full prompt with context
      let fullPrompt = "";

      if (context && context.length > 0) {
        const contextParts = context
          .filter((msg) => msg.role !== "system")
          .map((msg) => `[${msg.role}]: ${msg.content}`);

        const systemMessages = context.filter((msg) => msg.role === "system");
        if (systemMessages.length > 0) {
          fullPrompt += systemMessages.map((m) => m.content).join("\n") + "\n\n";
        }

        if (contextParts.length > 0) {
          fullPrompt += "Previous conversation:\n" + contextParts.join("\n") + "\n\n";
        }
      }

      fullPrompt += `${system}\n\n${prompt}`;

      const response = await session.sendAndWait({ prompt: fullPrompt }, this.config.timeoutMs);
      const content = response?.data?.content;

      if (typeof content !== "string") {
        throw new CopilotError("Received empty or invalid response from Copilot");
      }

      return content;
    } catch (err) {
      if (err instanceof CopilotError) throw err;
      throw new CopilotError(
        `Reasoning request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await session.disconnect();
    }
  }
}
