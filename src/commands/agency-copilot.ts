import type { LobsterCommand } from "./copilot.js";

/**
 * `agency.copilot` — Convenience wrapper for running Agency Copilot CLI.
 *
 * Delegates to the built-in `exec` command using the same proven pattern
 * as build-investigate.yaml:
 *   exec --stdin-file raw agency copilot -p "<prompt>. ... $LOBSTER_STDIN_FILE" ...flags
 *
 * When piped input exists it is written to a temp file via exec's --stdin-file
 * mechanism and the file path is appended to the prompt so agency can read it.
 */
export function createAgencyCopilotCommand(): LobsterCommand {
  return {
    name: "agency.copilot",
    meta: {
      description: "Run Agency Copilot CLI — first arg is the prompt, piped input is appended automatically",
      argsSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          _: { type: "array", items: { type: "string" }, description: "First positional arg is the prompt; rest are passed through" },
        },
      },
      sideEffects: ["network", "subprocess"],
    },
    help() {
      return [
        "agency.copilot — passthrough wrapper for the Agency Copilot CLI",
        "",
        "Usage:",
        `  agency.copilot "Summarize this"`,
        `  <input> | agency.copilot "Summarize the above data"`,
        `  agency.copilot "Review" --model gpt-4.1`,
        "",
        "The first positional argument is the prompt.",
        "Piped input is written to a temp file and referenced in the prompt",
        "via $LOBSTER_STDIN_FILE (same mechanism as exec --stdin-file).",
        "All other flags are passed through to `agency copilot`.",
      ].join("\n");
    },
    async run({ input, args, rawArgs, ctx }: { input: AsyncIterable<unknown>; args: Record<string, unknown>; rawArgs?: string[]; ctx?: any }) {
      const execCmd = ctx?.registry?.get("exec");
      if (!execCmd) throw new Error("exec command not found in registry");

      // Buffer piped input to check if any exists
      const inputItems: unknown[] = [];
      for await (const item of input) inputItems.push(item);
      const hasPipedInput = inputItems.length > 0;

      // Extract prompt and passthrough flags
      const { prompt, flags } = extractPromptAndFlags(rawArgs, args);

      // When piped input exists, reference $LOBSTER_STDIN_FILE in the prompt
      // so agency reads the data from the temp file created by exec --stdin-file.
      const finalPrompt = hasPipedInput
        ? `${prompt} Read the data from the file at $LOBSTER_STDIN_FILE.`
        : prompt;

      const execPositional = ["agency", "copilot"];
      if (finalPrompt) execPositional.push("-sp", finalPrompt);
      execPositional.push(...flags);

      const execArgs: Record<string, unknown> = { _: execPositional };
      if (hasPipedInput) execArgs["stdin-file"] = "raw";

      // Re-wrap collected items as an async iterable for exec
      const inputStream = (async function* () {
        for (const item of inputItems) yield item;
      })();

      const result = await execCmd.run({ input: inputStream, args: execArgs, ctx });

      // Collect exec output lines into a single string so we return the same
      // { output: AsyncIterable<string> } shape that the `copilot` command uses,
      // rather than an opaque exec result.
      const lines: string[] = [];
      const out: AsyncIterable<unknown> | undefined = result?.output ?? result;
      if (out && typeof out === "object" && Symbol.asyncIterator in out) {
        for await (const chunk of out as AsyncIterable<unknown>) {
          if (typeof chunk === "string") lines.push(chunk);
          else if (chunk != null) lines.push(String(chunk));
        }
      }

      const response = lines.join("\n");
      return {
        output: (async function* () {
          yield response;
        })(),
      };
    },
  };
}

/**
 * Extract the prompt and passthrough flags from CLI args.
 * The prompt is the first positional arg or the value of --prompt/-sp/-p.
 * Everything else is returned as passthrough flags.
 */
export function extractPromptAndFlags(
  rawArgs: string[] | undefined,
  args: Record<string, unknown>,
): { prompt: string; flags: string[] } {
  if (rawArgs && rawArgs.length > 0) {
    return extractFromRawArgs(rawArgs);
  }
  return extractFromParsedArgs(args);
}

function extractFromRawArgs(rawArgs: string[]): { prompt: string; flags: string[] } {
  const promptFlags = new Set(["--prompt", "-sp", "-p"]);

  // Check for flag-based prompt first
  for (let i = 0; i < rawArgs.length; i++) {
    if (promptFlags.has(rawArgs[i]) && i + 1 < rawArgs.length) {
      const prompt = rawArgs[i + 1];
      const flags = [...rawArgs.slice(0, i), ...rawArgs.slice(i + 2)];
      return { prompt, flags };
    }
  }

  // Build a set of indices that are flag values (not positional args)
  const flagValueIndices = new Set<number>();
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith("-") && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith("-")) {
      flagValueIndices.add(i + 1);
    }
  }

  // Find the first truly positional arg as the prompt
  for (let i = 0; i < rawArgs.length; i++) {
    if (!rawArgs[i].startsWith("-") && !flagValueIndices.has(i)) {
      const prompt = rawArgs[i];
      const flags = [...rawArgs.slice(0, i), ...rawArgs.slice(i + 1)];
      return { prompt, flags };
    }
  }

  return { prompt: "", flags: [...rawArgs] };
}

function extractFromParsedArgs(args: Record<string, unknown>): { prompt: string; flags: string[] } {
  const flags: string[] = [];
  let prompt = "";

  for (const [key, value] of Object.entries(args)) {
    if (key === "_") {
      if (Array.isArray(value) && value.length > 0) {
        prompt = String(value[0]);
        for (let i = 1; i < value.length; i++) flags.push(String(value[i]));
      }
      continue;
    }
    if (key === "input") continue;

    if ((key === "prompt" || key === "sp") && typeof value === "string" && !prompt) {
      prompt = value;
      continue;
    }

    const flag = key.length === 1 ? `-${key}` : `--${key}`;
    if (typeof value === "boolean") {
      if (value) flags.push(flag);
    } else if (Array.isArray(value)) {
      for (const v of value) flags.push(flag, String(v));
    } else if (value != null) {
      flags.push(flag, String(value));
    }
  }

  return { prompt, flags };
}

