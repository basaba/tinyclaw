import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDiffKeyCommand } from "../../src/commands/diff-key.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

function streamOf(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function collect(output: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const item of output) result.push(item);
  return result;
}

describe("diff.key command", () => {
  let tmpDir: string;
  let cmd: ReturnType<typeof createDiffKeyCommand>;
  let env: Record<string, string>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "lobster-diff-key-"));
    env = { LOBSTER_STATE_DIR: tmpDir };
    cmd = createDiffKeyCommand();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(items: unknown[], args: Record<string, unknown> = {}) {
    return cmd.run({
      input: streamOf(items),
      args: { key: "test-key", field: "id", _: [], ...args },
      ctx: {
        env,
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      },
    });
  }

  it("marks all items as changed on first run", async () => {
    const result = await run([
      { id: "a", subject: "Hello" },
      { id: "b", subject: "World" },
    ]);
    const items = await collect(result.output);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "a", changed: true });
    expect(items[1]).toMatchObject({ id: "b", changed: true });
  });

  it("marks seen items as unchanged on second run", async () => {
    await run([{ id: "a" }, { id: "b" }]);
    const result = await run([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const items = await collect(result.output);
    expect(items).toEqual([
      expect.objectContaining({ id: "a", changed: false }),
      expect.objectContaining({ id: "b", changed: false }),
      expect.objectContaining({ id: "c", changed: true }),
    ]);
  });

  it("updates state — removed items are forgotten", async () => {
    // Run 1: see a, b
    await run([{ id: "a" }, { id: "b" }]);
    // Run 2: only b, c (a is gone)
    await run([{ id: "b" }, { id: "c" }]);
    // Run 3: a comes back — should be marked as changed again
    const result = await run([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const items = await collect(result.output);
    expect(items[0]).toMatchObject({ id: "a", changed: true });
    expect(items[1]).toMatchObject({ id: "b", changed: false });
    expect(items[2]).toMatchObject({ id: "c", changed: false });
  });

  it("uses custom field name", async () => {
    await run([{ email_id: "x1" }], { field: "email_id" });
    const result = await run(
      [{ email_id: "x1" }, { email_id: "x2" }],
      { field: "email_id" },
    );
    const items = await collect(result.output);
    expect(items[0]).toMatchObject({ email_id: "x1", changed: false });
    expect(items[1]).toMatchObject({ email_id: "x2", changed: true });
  });

  it("defaults field to 'id'", async () => {
    const result = await run([{ id: "abc", name: "test" }], { field: undefined });
    const items = await collect(result.output);
    expect(items[0]).toMatchObject({ id: "abc", changed: true });
  });

  it("stores state as JSON array of key strings", async () => {
    await run([{ id: "m1" }, { id: "m2" }]);
    const stateFile = join(tmpDir, "test-key.json");
    const stored = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(stored).toEqual(["m1", "m2"]);
  });

  it("preserves original item fields", async () => {
    const result = await run([
      { id: "z", subject: "Important", from: "alice@example.com" },
    ]);
    const items = await collect(result.output);
    expect(items[0]).toMatchObject({
      id: "z",
      subject: "Important",
      from: "alice@example.com",
      changed: true,
    });
  });

  it("throws when --key is missing", async () => {
    await expect(
      cmd.run({
        input: streamOf([]),
        args: { _: [] },
        ctx: { env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
      }),
    ).rejects.toThrow("diff.key requires --key");
  });

  it("handles empty input", async () => {
    const result = await run([]);
    const items = await collect(result.output);
    expect(items).toEqual([]);
  });
});
