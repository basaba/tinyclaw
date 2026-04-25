import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LobsterCommand } from "./copilot.js";

/**
 * Resolve the Lobster state directory.
 */
function getStateDir(env: Record<string, string | undefined>): string {
  const fromEnv = env.LOBSTER_STATE_DIR?.trim();
  return fromEnv || path.join(os.homedir(), ".lobster", "state");
}

/**
 * Sanitise a state key into a safe filename.
 */
function keyToPath(stateDir: string, key: string): string {
  const safe = key
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!safe) throw new Error("state key is empty/invalid");
  return path.join(stateDir, `${safe}.json`);
}

/**
 * Read a stored JSON set (array of strings) from state.
 */
async function readKeySet(
  stateDir: string,
  stateKey: string,
): Promise<Set<string>> {
  const filePath = keyToPath(stateDir, stateKey);
  try {
    const text = await fsp.readFile(filePath, "utf8");
    const arr = JSON.parse(text);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (err: any) {
    if (err?.code === "ENOENT") return new Set();
    throw err;
  }
}

/**
 * Write the key set back to state.
 */
async function writeKeySet(
  stateDir: string,
  stateKey: string,
  keys: Set<string>,
): Promise<void> {
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(
    keyToPath(stateDir, stateKey),
    JSON.stringify([...keys], null, 2) + "\n",
    "utf8",
  );
}

/**
 * diff.key — mark each item as changed/unchanged based on a key field.
 *
 * Usage:
 *   <items> | diff.key --key <stateKey> --field <fieldName>
 *
 * For each input item, checks whether item[field] was seen in the previous run.
 * Adds `changed: true` (new) or `changed: false` (seen before) to each item.
 * Stores the full set of current keys for the next run.
 *
 * Chain with `| where changed==true` to process only new items.
 */
export function createDiffKeyCommand(): LobsterCommand {
  return {
    name: "diff.key",
    meta: {
      description:
        "Mark items as new/seen by comparing a key field against stored state",
      argsSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "State key to track seen values",
          },
          field: {
            type: "string",
            description: "Field name to use as the unique key (default: id)",
          },
          _: { type: "array", items: { type: "string" } },
        },
        required: ["key"],
      },
      sideEffects: ["writes_state"],
    },
    help() {
      return [
        "diff.key — mark items as new/seen by comparing a key field against stored state",
        "",
        "Usage:",
        "  <items> | diff.key --key <stateKey> [--field <fieldName>]",
        "",
        "Options:",
        "  --key    State key to track seen values (required)",
        "  --field  Field name to use as the unique key (default: id)",
        "",
        "Output:",
        "  Each input item with changed: true (new) or false (seen before)",
        "",
        "Example:",
        "  mail.search --unread | diff.key --key inbox --field id | where changed==true",
      ].join("\n");
    },
    async run({ input, args, ctx }: any) {
      const stateKey: string = args.key ?? args._?.[0];
      if (!stateKey) throw new Error("diff.key requires --key");
      const field: string = args.field ?? "id";

      const stateDir = getStateDir(ctx.env ?? process.env);
      const previousKeys = await readKeySet(stateDir, stateKey);

      const items: any[] = [];
      for await (const item of input) {
        items.push(item);
      }

      const currentKeys = new Set<string>();
      const output = items.map((item) => {
        const keyValue =
          item != null && typeof item === "object" ? item[field] : item;
        const keyStr = String(keyValue ?? "");
        currentKeys.add(keyStr);
        const changed = !previousKeys.has(keyStr);
        return { ...item, changed };
      });

      await writeKeySet(stateDir, stateKey, currentKeys);

      return {
        output: (async function* () {
          for (const item of output) yield item;
        })(),
      };
    },
  };
}
