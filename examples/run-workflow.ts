#!/usr/bin/env node
/**
 * Run a simple Lobster workflow with the Copilot adapter.
 *
 * Usage:
 *   npx tsx examples/run-workflow.ts                          # text mode
 *   npx tsx examples/run-workflow.ts --json                   # JSON extraction mode
 *   npx tsx examples/run-workflow.ts --pipeline 'echo hello'  # custom pipeline
 *
 * Prerequisites:
 *   - GitHub Copilot CLI running (or set COPILOT_CLI_URL)
 *   - @clawdbot/lobster installed (npm install @clawdbot/lobster)
 */

import { createCopilotAdapters } from "../src/adapters/index.js";
import { runToolRequest } from "@clawdbot/lobster/core";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const customIdx = args.indexOf("--pipeline");
const customPipeline = customIdx >= 0 ? args[customIdx + 1] : null;

// ── Create the adapter bundle ───────────────────────────────────────

const { adapters, dispose } = createCopilotAdapters({
  cliUrl: process.env.COPILOT_CLI_URL,
});

try {
  // ── Example 1: Simple text reasoning ────────────────────────────

  if (!jsonMode && !customPipeline) {
    console.log("━━━ Example 1: Simple text reasoning ━━━\n");

    const result = await runToolRequest({
      pipeline: `llm.invoke --provider copilot --prompt 'What are the 3 most important principles of clean code? Be concise.'`,
      ctx: { llmAdapters: adapters },
    });

    if (result.ok) {
      console.log("✅ Output:\n");
      for (const item of result.output ?? []) {
        console.log(item.output?.text ?? JSON.stringify(item, null, 2));
      }
    } else {
      console.error("❌ Error:", result.error?.message);
    }
  }

  // ── Example 2: JSON extraction with output schema ───────────────

  if (jsonMode) {
    console.log("━━━ Example 2: JSON extraction with schema ━━━\n");

    const schema = JSON.stringify({
      type: "object",
      properties: {
        languages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              paradigm: { type: "string" },
              yearCreated: { type: "number" },
            },
            required: ["name", "paradigm"],
          },
        },
      },
      required: ["languages"],
    });

    const result = await runToolRequest({
      pipeline: `llm.invoke --provider copilot --prompt 'List 3 programming languages with their paradigm and year created' --output-schema '${schema}'`,
      ctx: { llmAdapters: adapters },
    });

    if (result.ok) {
      console.log("✅ Structured output:\n");
      for (const item of result.output ?? []) {
        if (item.output?.data) {
          console.log(JSON.stringify(item.output.data, null, 2));
        } else {
          console.log("(text fallback):", item.output?.text);
        }
        if (item.warnings?.length) {
          console.log("\n⚠️  Warnings:", item.warnings);
        }
      }
    } else {
      console.error("❌ Error:", result.error?.message);
    }
  }

  // ── Example 3: Custom pipeline ──────────────────────────────────

  if (customPipeline) {
    console.log(`━━━ Custom pipeline: ${customPipeline} ━━━\n`);

    const result = await runToolRequest({
      pipeline: customPipeline,
      ctx: { llmAdapters: adapters },
    });

    if (result.ok) {
      console.log("✅ Output:\n");
      for (const item of result.output ?? []) {
        console.log(typeof item === "string" ? item : JSON.stringify(item, null, 2));
      }
    } else {
      console.error("❌ Error:", result.error?.message);
    }
  }
} finally {
  await dispose();
  console.log("\n🧹 Adapter disposed.");
}
