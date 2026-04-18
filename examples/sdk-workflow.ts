#!/usr/bin/env node
/**
 * Use the Lobster SDK programmatically with Copilot as the LLM provider.
 *
 * Usage:
 *   npx tsx examples/sdk-workflow.ts
 */

import { Lobster } from "@clawdbot/lobster";
import { createCopilotAdapters } from "../src/adapters/index.js";
import { createDefaultRegistry } from "@clawdbot/lobster/core";

const { adapters, dispose } = createCopilotAdapters({
  cliUrl: process.env.COPILOT_CLI_URL,
});

try {
  // ── SDK-style pipeline: pipe stages together ──────────────────

  console.log("━━━ Lobster SDK + Copilot Adapter ━━━\n");

  const workflow = new Lobster({
    env: { ...process.env, LOBSTER_LLM_PROVIDER: "copilot" },
    llmAdapters: adapters,
  } as any);

  // Stage 1: Generate seed data
  workflow.pipe(async function* () {
    yield { topic: "TypeScript", question: "What is the biggest advantage?" };
    yield { topic: "Rust", question: "What is the biggest advantage?" };
  });

  // Stage 2: Transform each item — here you'd normally pipe to llm.invoke
  // but since SDK stages are functions, we can call the adapter directly
  workflow.pipe(async function* (items) {
    for await (const item of items) {
      const result = await adapters.copilot.invoke({
        env: process.env,
        args: {},
        payload: {
          prompt: `For ${item.topic}: ${item.question}. Answer in one sentence.`,
          artifacts: [],
          artifactHashes: [],
        },
        ctx: {},
      });

      yield {
        topic: item.topic,
        answer: result.ok
          ? result.result?.output?.text ?? "(no text)"
          : `Error: ${result.error?.message}`,
      };
    }
  });

  const result = await workflow.run();

  if (result.ok) {
    console.log("✅ Workflow completed:\n");
    for (const item of result.output) {
      console.log(`  ${item.topic}: ${item.answer}\n`);
    }
  } else {
    console.error("❌ Error:", result.error?.message);
  }
} finally {
  await dispose();
  console.log("🧹 Adapter disposed.");
}
