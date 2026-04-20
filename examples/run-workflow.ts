/**
 * Run a Lobster workflow with the Copilot adapter programmatically.
 *
 * Usage:
 *   npx tsx examples/run-workflow.ts
 */
import { createCopilotAdapters } from "../src/adapters/index.js";
import { createCopilotCommand } from "../src/commands/index.js";
import { CopilotBridgeClient } from "../src/copilot/client.js";

async function main() {
  const { adapters, dispose } = createCopilotAdapters();

  try {
    const { createDefaultRegistry, runToolRequest } = await import("@basaba/lobster/core");

    // Build a registry that includes default commands + copilot
    const baseRegistry = createDefaultRegistry();
    let client: CopilotBridgeClient | null = null;
    let started = false;

    const copilotCmd = createCopilotCommand(
      () => {
        if (!client) client = new CopilotBridgeClient({});
        return client;
      },
      async () => {
        if (!started) {
          if (!client) client = new CopilotBridgeClient({});
          await client.start();
          started = true;
        }
      },
    );

    const registry = {
      get(name: string) {
        if (name === "copilot") return copilotCmd;
        return baseRegistry.get(name);
      },
      list() {
        return [...baseRegistry.list(), "copilot"].sort();
      },
    };

    const result = await runToolRequest({
      filePath: "examples/ado-build-investigate.yaml",
      ctx: {
        registry,
        llmAdapters: adapters,
        env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
      },
    });

    if (result.ok) {
      for (const item of result.output ?? []) {
        console.log(typeof item === "string" ? item : JSON.stringify(item, null, 2));
      }
    } else {
      console.error("Error:", result.error?.message);
    }
  } finally {
    await dispose();
  }
}

main();
