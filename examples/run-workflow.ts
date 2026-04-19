/**
 * Run a Lobster workflow with the Copilot adapter programmatically.
 *
 * Usage:
 *   npx tsx examples/run-workflow.ts
 */
import { createCopilotAdapters } from "../src/adapters/index.js";

async function main() {
  const { adapters, dispose } = createCopilotAdapters();

  try {
    // Dynamic import — @clawdbot/lobster must be installed separately
    const { runToolRequest } = await import("@clawdbot/lobster/core");

    const result = await runToolRequest({
      filePath: "examples/hello.yaml",
      ctx: {
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
