/**
 * `format.md2html` — Convert markdown to HTML in a Lobster pipeline.
 *
 * Usage in workflows:
 *   copilot --prompt "Summarize these emails" | format.md2html | teams.send --self --content-type html
 */

import { marked } from "marked";
import type { LobsterCommand } from "./copilot.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** Collect piped input into a single markdown string. */
async function collectInput(input: AsyncIterable<unknown>): Promise<string> {
  const parts: string[] = [];
  for await (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const text = obj.text ?? obj.content ?? obj.message ?? obj.output;
      if (typeof text === "string") {
        parts.push(text);
      } else {
        parts.push(JSON.stringify(item, null, 2));
      }
    }
  }
  return parts.join("\n");
}

export function createFormatMd2HtmlCommand(): LobsterCommand {
  return {
    name: "format.md2html",
    meta: {
      description: "Convert markdown input to HTML",
      argsSchema: {
        type: "object",
        properties: {},
      },
    },
    help() {
      return [
        "format.md2html — Convert markdown to HTML",
        "",
        "Usage:",
        "  copilot --prompt '...' | format.md2html | teams.send --self --content-type html",
        "",
        "Reads piped markdown text and outputs HTML.",
        "Useful for sending copilot output to Teams as a rich HTML message.",
      ].join("\n");
    },
    async run({
      input,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const md = await collectInput(input);
      if (!md.trim()) {
        return { output: asStream([]) };
      }
      const html = await marked(md);
      return { output: asStream([{ text: html }]) };
    },
  };
}
