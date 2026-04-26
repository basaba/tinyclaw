/**
 * Example tinyclaw plugin — "hello.world"
 *
 * Drop this file in your plugins directory and it's auto-discovered on startup:
 *   ~/.config/tinyclaw/plugins/hello-world.js
 *
 * Or specify a custom dir:
 *   tinyclaw workflow.yaml --plugins ./my-plugins
 *   LOBSTER_PLUGINS=./my-plugins tinyclaw workflow.yaml
 *
 * Plugin contract:
 *   - Export a `createCommand(ctx)` function (or use `export default`)
 *   - It receives { mcpServers, getAdapter } context
 *   - Return a single LobsterCommand or an array of them
 *
 * LobsterCommand shape:
 *   {
 *     name: string,            — command name (used in pipelines: "hello.world --name Alice")
 *     help: () => string,      — one-liner shown in help/list output
 *     run: (params) => any,    — async function receiving { input, args }
 *                                 input is an AsyncIterable from the previous stage
 *                                 args is a parsed key-value object of flags
 *                                 return { output: AsyncIterable } to pass data downstream
 *     meta?: {                 — optional metadata for the scheduler/TUI
 *       description?: string,
 *       argsSchema?: object,
 *       sideEffects?: string[],
 *     },
 *   }
 */

// @ts-check

/**
 * @param {{ mcpServers: Record<string, unknown>, getAdapter: () => unknown }} ctx
 */
export function createCommand(ctx) {
  return {
    name: "hello.world",

    help: () => "hello.world [--name <name>] — Example plugin that greets the user",

    meta: {
      description: "A minimal example plugin",
      argsSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name to greet" },
        },
      },
    },

    async run({ input, args }) {
      // Parse --name flag from args (array of strings)
      let name = "World";
      if (args) {
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--name" && args[i + 1]) {
            name = args[i + 1];
          }
        }
      }

      // If there's piped input from a previous stage, include it
      const pieces = [];
      if (input) {
        for await (const chunk of input) {
          if (chunk) pieces.push(String(chunk));
        }
      }
      const piped = pieces.join("");
      const greeting = `👋 Hello, ${name}!`;
      const message = piped ? `${greeting}\n\nReceived input:\n${piped}` : greeting;

      // Return as async iterable — this is how lobster pipeline stages pass data
      return {
        output: (async function* () {
          yield { text: message };
        })(),
      };
    },
  };
}
