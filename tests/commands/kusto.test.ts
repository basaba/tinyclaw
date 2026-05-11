import { describe, it, expect, vi } from "vitest";
import {
  createKustoQueryCommand,
  type KustoQueryClient,
} from "../../src/commands/kusto.js";

const emptyInput: AsyncIterable<unknown> = {
  async *[Symbol.asyncIterator]() {},
};

function inputOf(...items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function makeClient(
  data: unknown[],
  columns: Array<{ name: string }> = [
    { name: "Service" },
    { name: "Count" },
  ],
): { client: KustoQueryClient; execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    primaryResults: [
      {
        toJSON: () => ({ columns, data }),
      },
    ],
  }));
  const close = vi.fn();
  return {
    client: { execute, close },
    execute,
    close,
  };
}

describe("kusto.query command", () => {
  it("has correct name and meta", () => {
    const cmd = createKustoQueryCommand(() => makeClient([]).client);
    expect(cmd.name).toBe("kusto.query");
    expect(cmd.meta?.description).toContain("Kusto");
    expect(cmd.meta?.sideEffects).toContain("network");
  });

  it("runs a query and emits one item per row by default", async () => {
    const { client, execute, close } = makeClient([
      ["api", 5],
      ["web", 3],
    ]);
    const cmd = createKustoQueryCommand(() => client);

    const result = await cmd.run({
      input: emptyInput,
      args: {
        cluster: "https://x.kusto.windows.net",
        database: "Logs",
        query: "Errors | summarize count() by Service",
      },
    });

    expect(execute).toHaveBeenCalledWith(
      "Logs",
      "Errors | summarize count() by Service",
    );
    expect(close).toHaveBeenCalled();

    const items = await collect(result.output);
    expect(items).toEqual([
      { Service: "api", Count: 5 },
      { Service: "web", Count: 3 },
    ]);
  });

  it("uses piped KQL when --query is omitted", async () => {
    const { client, execute } = makeClient([["api", 1]]);
    const cmd = createKustoQueryCommand(() => client);

    await cmd.run({
      input: inputOf("StormEvents | count"),
      args: {
        cluster: "https://x.kusto.windows.net",
        database: "Samples",
      },
    });

    expect(execute).toHaveBeenCalledWith("Samples", "StormEvents | count");
  });

  it("supports --format table output", async () => {
    const { client } = makeClient([
      ["api", 5],
      ["web", 3],
    ]);
    const cmd = createKustoQueryCommand(() => client);

    const result = await cmd.run({
      input: emptyInput,
      args: {
        cluster: "https://x.kusto.windows.net",
        database: "Logs",
        query: "T | take 2",
        format: "table",
      },
    });

    const items = await collect(result.output);
    expect(items).toEqual([
      {
        columns: ["Service", "Count"],
        rows: [
          ["api", 5],
          ["web", 3],
        ],
      },
    ]);
  });

  it("returns an empty stream when there are no primary results", async () => {
    const cmd = createKustoQueryCommand(() => ({
      execute: async () => ({ primaryResults: [] }),
    }));

    const result = await cmd.run({
      input: emptyInput,
      args: {
        cluster: "https://x.kusto.windows.net",
        database: "Logs",
        query: "T | take 0",
      },
    });

    expect(await collect(result.output)).toEqual([]);
  });

  it("throws without a query", async () => {
    const cmd = createKustoQueryCommand(() => makeClient([]).client);
    await expect(
      cmd.run({
        input: emptyInput,
        args: {
          cluster: "https://x.kusto.windows.net",
          database: "Logs",
        },
      }),
    ).rejects.toThrow("missing --query");
  });

  it("throws without a database", async () => {
    const cmd = createKustoQueryCommand(() => makeClient([]).client);
    await expect(
      cmd.run({
        input: emptyInput,
        args: {
          cluster: "https://x.kusto.windows.net",
          query: "T | take 1",
        },
      }),
    ).rejects.toThrow("--database is required");
  });

  it("throws without a cluster (default factory)", async () => {
    const cmd = createKustoQueryCommand();
    await expect(
      cmd.run({
        input: emptyInput,
        args: { database: "Logs", query: "T | take 1" },
      }),
    ).rejects.toThrow("--cluster is required");
  });

  it("closes the client even when execute throws", async () => {
    const close = vi.fn();
    const client: KustoQueryClient = {
      execute: async () => {
        throw new Error("boom");
      },
      close,
    };
    const cmd = createKustoQueryCommand(() => client);

    await expect(
      cmd.run({
        input: emptyInput,
        args: {
          cluster: "https://x.kusto.windows.net",
          database: "Logs",
          query: "T | take 1",
        },
      }),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalled();
  });
});
