import { describe, it, expect, vi } from "vitest";
import { createExtendedRegistry } from "../../src/commands/registry.js";
import { createCopilotReasonCommand } from "../../src/commands/copilot-reason.js";
import { createMcpCallCommand } from "../../src/commands/mcp-call.js";

function asyncStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("createExtendedRegistry", () => {
  it("includes default Lobster commands", () => {
    const registry = createExtendedRegistry();
    expect(registry.get("head")).toBeDefined();
    expect(registry.get("json")).toBeDefined();
    expect(registry.get("exec")).toBeDefined();
    expect(registry.get("llm.invoke")).toBeDefined();
  });

  it("includes custom commands", () => {
    const custom = {
      name: "my.cmd",
      help: () => "help",
      run: async () => ({ output: asyncStream(["ok"]) }),
    };
    const registry = createExtendedRegistry({ commands: [custom] });
    expect(registry.get("my.cmd")).toBe(custom);
  });

  it("custom commands override defaults", () => {
    const customHead = {
      name: "head",
      help: () => "custom head",
      run: async () => ({ output: asyncStream(["custom"]) }),
    };
    const registry = createExtendedRegistry({ commands: [customHead] });
    expect(registry.get("head")).toBe(customHead);
  });

  it("list() includes both default and custom commands", () => {
    const custom = {
      name: "zzz.custom",
      help: () => "help",
      run: async () => ({ output: asyncStream([]) }),
    };
    const registry = createExtendedRegistry({ commands: [custom] });
    const list = registry.list();
    expect(list).toContain("head");
    expect(list).toContain("llm.invoke");
    expect(list).toContain("zzz.custom");
    // Should be sorted
    expect(list).toEqual([...list].sort());
  });
});

describe("createCopilotReasonCommand", () => {
  function mockClient() {
    return {
      reason: vi.fn().mockResolvedValue("Copilot says hello"),
      start: vi.fn(),
      stop: vi.fn(),
    } as any;
  }

  it("has correct name and metadata", () => {
    const cmd = createCopilotReasonCommand(() => mockClient());
    expect(cmd.name).toBe("copilot.reason");
    expect(cmd.meta.description).toContain("Copilot");
    expect(cmd.help()).toContain("copilot.reason");
  });

  it("calls client.reason with prompt", async () => {
    const client = mockClient();
    const cmd = createCopilotReasonCommand(() => client);

    const result = await cmd.run({
      input: asyncStream([]),
      args: { prompt: "What is 2+2?", _: [] },
    });

    expect(client.reason).toHaveBeenCalledWith(
      "What is 2+2?",
      undefined,
      undefined,
      { model: undefined },
    );

    const items: unknown[] = [];
    for await (const item of result.output) items.push(item);
    expect(items).toEqual(["Copilot says hello"]);
  });

  it("includes piped input in prompt", async () => {
    const client = mockClient();
    const cmd = createCopilotReasonCommand(() => client);

    await cmd.run({
      input: asyncStream(["line1", "line2"]),
      args: { prompt: "Summarize", _: [] },
    });

    const call = client.reason.mock.calls[0];
    expect(call[0]).toContain("line1");
    expect(call[0]).toContain("line2");
    expect(call[0]).toContain("Summarize");
  });

  it("passes model option", async () => {
    const client = mockClient();
    const cmd = createCopilotReasonCommand(() => client);

    await cmd.run({
      input: asyncStream([]),
      args: { prompt: "Hi", model: "gpt-4.1", _: [] },
    });

    expect(client.reason).toHaveBeenCalledWith(
      "Hi",
      undefined,
      undefined,
      { model: "gpt-4.1" },
    );
  });

  it("passes system prompt", async () => {
    const client = mockClient();
    const cmd = createCopilotReasonCommand(() => client);

    await cmd.run({
      input: asyncStream([]),
      args: { prompt: "Hi", system: "You are a pirate", _: [] },
    });

    expect(client.reason).toHaveBeenCalledWith(
      "Hi",
      undefined,
      "You are a pirate",
      { model: undefined },
    );
  });

  it("throws when no prompt or input", async () => {
    const client = mockClient();
    const cmd = createCopilotReasonCommand(() => client);

    await expect(
      cmd.run({ input: asyncStream([]), args: { _: [] } }),
    ).rejects.toThrow("requires a --prompt or piped input");
  });
});

describe("createMcpCallCommand", () => {
  function mockClient() {
    return {
      reason: vi.fn().mockResolvedValue('{"result": "data"}'),
      start: vi.fn(),
      stop: vi.fn(),
    } as any;
  }

  const servers = {
    teams: { type: "local" as const, command: "agency", args: ["mcp", "teams"], tools: ["*"] },
    mail: { type: "local" as const, command: "agency", args: ["mcp", "mail"], tools: ["*"] },
  };

  it("has correct name and metadata", () => {
    const cmd = createMcpCallCommand(() => mockClient(), () => servers);
    expect(cmd.name).toBe("mcp.call");
    expect(cmd.help()).toContain("mcp.call");
  });

  it("calls client.reason with tool instruction", async () => {
    const client = mockClient();
    const cmd = createMcpCallCommand(() => client, () => servers);

    await cmd.run({
      input: asyncStream([]),
      args: { tool: "ListChats", server: "teams", _: [] },
    });

    const prompt = client.reason.mock.calls[0][0];
    expect(prompt).toContain("ListChats");
    expect(prompt).toContain("teams");

    // Should pass only the teams server
    const opts = client.reason.mock.calls[0][3];
    expect(opts.mcpServers).toEqual({ teams: servers.teams });
  });

  it("passes all servers when no --server specified", async () => {
    const client = mockClient();
    const cmd = createMcpCallCommand(() => client, () => servers);

    await cmd.run({
      input: asyncStream([]),
      args: { tool: "SearchDocs", _: [] },
    });

    const opts = client.reason.mock.calls[0][3];
    expect(opts.mcpServers).toEqual(servers);
  });

  it("throws when tool not specified", async () => {
    const client = mockClient();
    const cmd = createMcpCallCommand(() => client, () => servers);

    await expect(
      cmd.run({ input: asyncStream([]), args: { _: [] } }),
    ).rejects.toThrow("requires --tool");
  });

  it("throws when server not in config", async () => {
    const client = mockClient();
    const cmd = createMcpCallCommand(() => client, () => servers);

    await expect(
      cmd.run({ input: asyncStream([]), args: { tool: "X", server: "unknown", _: [] } }),
    ).rejects.toThrow('not found in config');
  });

  it("parses JSON response", async () => {
    const client = mockClient();
    client.reason.mockResolvedValue('{"count": 5}');
    const cmd = createMcpCallCommand(() => client, () => servers);

    const result = await cmd.run({
      input: asyncStream([]),
      args: { tool: "ListChats", _: [] },
    });

    const items: unknown[] = [];
    for await (const item of result.output) items.push(item);
    expect(items[0]).toEqual({ count: 5 });
  });

  it("includes --input in prompt", async () => {
    const client = mockClient();
    const cmd = createMcpCallCommand(() => client, () => servers);

    await cmd.run({
      input: asyncStream([]),
      args: { tool: "Search", input: '{"query": "AKS"}', _: [] },
    });

    const prompt = client.reason.mock.calls[0][0];
    expect(prompt).toContain('{"query": "AKS"}');
  });
});
