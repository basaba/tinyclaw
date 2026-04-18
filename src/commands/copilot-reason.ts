import type { CopilotBridgeClient } from "../copilot/client.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/**
 * copilot.reason — Direct Copilot reasoning command for Lobster pipelines.
 *
 * Usage in workflows:
 *   copilot.reason --prompt "Explain this code"
 *   cat file.ts | copilot.reason --prompt "Review this"
 *   copilot.reason --prompt "Summarize" --model claude-sonnet-4
 *
 * Simpler than `llm.invoke --provider copilot` — no envelope overhead,
 * returns raw text directly.
 */
export function createCopilotReasonCommand(
  getClient: () => CopilotBridgeClient,
  ensureStarted?: () => Promise<void>,
) {
  return {
    name: "copilot.reason",
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
      return (
        `copilot.reason — send a prompt to Copilot\n\n` +
        `Usage:\n` +
        `  copilot.reason --prompt "Explain this"\n` +
        `  <input> | copilot.reason --prompt "Summarize the above"\n` +
        `  copilot.reason --prompt "Review" --model gpt-4.1\n`
      );
    },
    async run({ input, args }: { input: AsyncIterable<unknown>; args: Record<string, unknown> }) {
      if (ensureStarted) await ensureStarted();
      const client = getClient();

      // Collect stdin if present
      const inputParts: string[] = [];
      for await (const item of input) {
        if (typeof item === "string") inputParts.push(item);
        else if (item != null) inputParts.push(JSON.stringify(item));
      }

      // Build prompt
      const explicitPrompt = typeof args.prompt === "string" ? args.prompt : "";
      const positional = Array.isArray(args._) ? args._.join(" ") : "";
      const promptText = [explicitPrompt, positional].filter(Boolean).join(" ");

      let fullPrompt = "";
      if (inputParts.length > 0) {
        fullPrompt += inputParts.join("\n") + "\n\n";
      }
      fullPrompt += promptText;

      if (!fullPrompt.trim()) {
        throw new Error("copilot.reason requires a --prompt or piped input");
      }

      const systemPrompt = typeof args.system === "string" ? args.system : undefined;
      const model = typeof args.model === "string" ? args.model : undefined;

      const response = await client.reason(fullPrompt, undefined, systemPrompt, { model });

      return { output: asStream([response]) };
    },
  };
}
