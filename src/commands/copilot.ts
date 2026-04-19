import type { CopilotBridgeClient } from "../copilot/client.js";

export type LobsterCommand = {
  name: string;
  help: () => string;
  run: (params: any) => Promise<any>;
  meta?: {
    description?: string;
    argsSchema?: unknown;
    sideEffects?: string[];
  };
};

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/**
 * `copilot` — Direct Copilot reasoning command for Lobster pipelines.
 *
 * Usage in workflows:
 *   copilot --prompt "Explain this code"
 *   cat file.ts | copilot --prompt "Review this"
 *   copilot --prompt "Summarize" --model claude-sonnet-4
 */
export function createCopilotCommand(
  getClient: () => CopilotBridgeClient,
  ensureStarted: () => Promise<void>,
): LobsterCommand {
  return {
    name: "copilot",
    meta: {
      description: "Send a prompt to Copilot and get a response",
      argsSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The prompt to send" },
          model: { type: "string", description: "Model ID (e.g. claude-sonnet-4, gpt-4.1)" },
          system: { type: "string", description: "System prompt override" },
          _: { type: "array", items: { type: "string" } },
        },
        required: [],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "copilot — send a prompt directly to GitHub Copilot",
        "",
        "Usage:",
        `  copilot --prompt "Explain this"`,
        `  <input> | copilot --prompt "Summarize the above"`,
        `  copilot --prompt "Review" --model gpt-4.1`,
        `  copilot "What is 2+2?"`,
        "",
        "The prompt can also be passed as positional text.",
        "Piped input is prepended to the prompt.",
      ].join("\n");
    },
    async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, unknown> }) {
      await ensureStarted();
      const client = getClient();

      // Collect piped input
      const inputParts: string[] = [];
      for await (const item of input) {
        if (typeof item === "string") inputParts.push(item);
        else if (item != null) inputParts.push(JSON.stringify(item));
      }

      // Build prompt from --prompt flag and/or positional args
      const explicitPrompt = typeof args.prompt === "string" ? args.prompt : "";
      const positional = Array.isArray(args._) ? args._.join(" ") : "";
      const promptText = [explicitPrompt, positional].filter(Boolean).join(" ");

      let fullPrompt = "";
      if (inputParts.length > 0) {
        fullPrompt += inputParts.join("\n") + "\n\n";
      }
      fullPrompt += promptText;

      if (!fullPrompt.trim()) {
        throw new Error("copilot requires a --prompt or piped input");
      }

      const systemPrompt = typeof args.system === "string" ? args.system : undefined;
      const model = typeof args.model === "string" ? args.model : undefined;

      const response = await client.reason(fullPrompt, undefined, systemPrompt, { model });

      return { output: asStream([response]) };
    },
  };
}
