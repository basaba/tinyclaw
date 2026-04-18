import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @github/copilot-sdk
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({
      sendAndWait: vi.fn().mockResolvedValue({
        data: { content: "Mocked reasoning result" },
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  })),
  approveAll: vi.fn(),
}));

import { MemoryStore } from "../../src/memory/store.js";
import { ContextBuilder } from "../../src/memory/context.js";
import { CopilotBridgeClient } from "../../src/copilot/client.js";
import { createMcpServer } from "../../src/mcp/server.js";

describe("Integration: workflow simulation", () => {
  let store: MemoryStore;
  let contextBuilder: ContextBuilder;
  let copilotClient: CopilotBridgeClient;

  beforeEach(async () => {
    store = new MemoryStore(":memory:");
    contextBuilder = new ContextBuilder(store, 8000);
    copilotClient = new CopilotBridgeClient({});
    await copilotClient.start();
  });

  afterEach(async () => {
    await copilotClient.stop();
    store.close();
  });

  it("creates MCP server with tools registered", () => {
    const server = createMcpServer(copilotClient, contextBuilder, store);
    expect(server).toBeDefined();
  });

  it("simulates a full reasoning workflow with memory", async () => {
    // Step 1: Create a conversation for the workflow
    store.createConversation("wf-conv-1", "test-workflow");

    // Step 2: Build context (empty conversation)
    const ctx = contextBuilder.buildContext("wf-conv-1", "You are a test assistant.");
    expect(ctx).toHaveLength(1);
    expect(ctx[0].role).toBe("system");

    // Step 3: Call reason via the copilot client
    const result = await copilotClient.reason("Analyze this data", ctx);
    expect(result).toBe("Mocked reasoning result");

    // Step 4: Persist messages
    store.addMessage("wf-conv-1", "user", "Analyze this data");
    store.addMessage("wf-conv-1", "assistant", result);

    // Step 5: Verify messages are persisted
    const messages = store.getMessages("wf-conv-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Mocked reasoning result");

    // Step 6: Build context again — should include prior messages
    const ctx2 = contextBuilder.buildContext("wf-conv-1", "You are a test assistant.");
    expect(ctx2.length).toBeGreaterThan(1);
  });

  it("simulates multi-step workflow with shared conversation", async () => {
    store.createConversation("multi-step", "multi-workflow");

    // Step 1: Summarize
    const step1Result = await copilotClient.reason("Summarize the data");
    store.addMessage("multi-step", "user", "Summarize the data");
    store.addMessage("multi-step", "assistant", step1Result);

    // Step 2: Deep analysis (building on prior context)
    const ctx = contextBuilder.buildContext("multi-step", "Analyze deeply.");
    expect(ctx.length).toBeGreaterThan(1);

    const step2Result = await copilotClient.reason("Identify top issues", ctx);
    store.addMessage("multi-step", "user", "Identify top issues");
    store.addMessage("multi-step", "assistant", step2Result);

    // Verify full conversation
    const allMessages = store.getMessages("multi-step");
    expect(allMessages).toHaveLength(4);
  });

  it("uses memory store for cross-step key-value data", () => {
    store.setMemory("workflow-ns", "step1-output", "important-data");

    const retrieved = store.getMemory("workflow-ns", "step1-output");
    expect(retrieved).toBe("important-data");

    const memory = contextBuilder.getRelevantMemory("workflow-ns", ["step1-output"]);
    expect(memory).toEqual({ "step1-output": "important-data" });
  });
});
