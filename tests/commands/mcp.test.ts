import { describe, it, expect, vi } from "vitest";
import { createMcpCallCommand } from "../../src/commands/mcp.js";
import type { McpServerConfig } from "../../src/mcp-config/loader.js";

// Mock mcp-client
vi.mock("../../src/mcp-client/client.js", () => ({
  resolveServer: vi.fn((name: string) => ({
    command: "agency",
    args: ["mcp", name],
    tools: ["*"],
  })),
  listTools: vi.fn(async () => [
    { name: "search", description: "Search for things", inputSchema: { type: "object" } },
    { name: "create", description: "Create a thing" },
  ]),
  callTool: vi.fn(async (_config: any, _tool: string, args: Record<string, unknown>) => ({
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ result: "ok", args }) }],
  })),
}));

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

describe("agency.mcp.call command", () => {
  const cmd = createMcpCallCommand(() => ({}));

  it("has correct name and meta", () => {
    expect(cmd.name).toBe("agency.mcp.call");
    expect(cmd.meta?.description).toContain("Call a tool");
  });

  it("calls a tool with --args JSON", async () => {
    const result = await cmd.run({
      input: emptyInput,
      args: {
        server: "icm",
        tool: "search",
        args: '{"query": "sev1"}',
      },
    });
    const items = await collect(result.output);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ result: "ok", args: { query: "sev1" } }),
    );
  });

  it("accepts positional server and tool", async () => {
    const result = await cmd.run({
      input: emptyInput,
      args: { _: ["icm", "search"], args: '{"q": "test"}' },
    });
    const items = await collect(result.output);
    expect(items).toHaveLength(1);
  });

  it("merges piped JSON object into args", async () => {
    const result = await cmd.run({
      input: inputOf({ query: "from-pipe" }),
      args: { server: "icm", tool: "search" },
    });
    const items = await collect(result.output);
    // piped args are used since no explicit --args
    expect(items[0]).toEqual(
      expect.objectContaining({ args: { query: "from-pipe" } }),
    );
  });

  it("--args wins over piped input on conflict", async () => {
    const result = await cmd.run({
      input: inputOf({ query: "piped" }),
      args: { server: "icm", tool: "search", args: '{"query": "explicit"}' },
    });
    const items = await collect(result.output);
    expect(items[0]).toEqual(
      expect.objectContaining({ args: { query: "explicit" } }),
    );
  });

  it("uses --input-key to assign piped text", async () => {
    const result = await cmd.run({
      input: inputOf("SELECT * FROM logs"),
      args: { server: "kusto", tool: "execute_query", "input-key": "query" },
    });
    const items = await collect(result.output);
    expect(items[0]).toEqual(
      expect.objectContaining({ args: { query: "SELECT * FROM logs" } }),
    );
  });

  it("throws without server", async () => {
    await expect(
      cmd.run({ input: emptyInput, args: { tool: "search" } }),
    ).rejects.toThrow("--server is required");
  });

  it("throws without tool", async () => {
    await expect(
      cmd.run({ input: emptyInput, args: { server: "icm" } }),
    ).rejects.toThrow("--tool is required");
  });

  it("throws on invalid --args JSON", async () => {
    await expect(
      cmd.run({
        input: emptyInput,
        args: { server: "icm", tool: "search", args: "not json" },
      }),
    ).rejects.toThrow("--args must be valid JSON");
  });
});
