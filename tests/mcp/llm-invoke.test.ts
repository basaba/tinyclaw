import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryStore } from "../../src/memory/store.js";
import { ContextBuilder } from "../../src/memory/context.js";
import { registerLlmInvokeTool } from "../../src/mcp/tools/llm-invoke.js";

// Mock the CopilotBridgeClient
function createMockCopilot() {
  return {
    reason: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

// Helper to extract the tool handler registered on the server
function captureToolHandler(server: McpServer) {
  let capturedHandler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
  const originalTool = server.tool.bind(server);
  vi.spyOn(server, "tool").mockImplementation(
    (_name: unknown, _desc: unknown, _schema: unknown, handler: unknown) => {
      capturedHandler = handler as typeof capturedHandler;
      // Call original to preserve registration
      return originalTool(_name as string, _desc as string, _schema as Record<string, unknown>, handler as (args: Record<string, unknown>, extra: unknown) => Promise<unknown>);
    },
  );
  return () => capturedHandler!;
}

describe("llm_invoke tool", () => {
  let store: MemoryStore;
  let contextBuilder: ContextBuilder;
  let mockCopilot: ReturnType<typeof createMockCopilot>;
  let server: McpServer;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    contextBuilder = new ContextBuilder(store, 8000);
    mockCopilot = createMockCopilot();
    server = new McpServer({ name: "test", version: "0.1.0" });
  });

  describe("text action", () => {
    it("sends prompt to copilot and returns text result", async () => {
      mockCopilot.reason.mockResolvedValue("This is a thoughtful response");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      const result = (await handler(
        { prompt: "Explain quantum computing", action: "text" },
        {},
      )) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0].text).toBe("This is a thoughtful response");
      expect(mockCopilot.reason).toHaveBeenCalledOnce();
      // Prompt should contain the user prompt
      expect(mockCopilot.reason.mock.calls[0][0]).toContain("Explain quantum computing");
    });

    it("defaults to text action when not specified", async () => {
      mockCopilot.reason.mockResolvedValue("Default text response");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      const result = (await handler({ prompt: "Hello", action: "text" }, {})) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toBe("Default text response");
    });

    it("includes input data in prompt when provided", async () => {
      mockCopilot.reason.mockResolvedValue("Analyzed the input");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        {
          prompt: "Analyze this data",
          action: "text",
          input: { subject: "Hello", body: "Can you help?" },
        },
        {},
      );

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain("<input>");
      expect(sentPrompt).toContain('"subject": "Hello"');
      expect(sentPrompt).toContain("Analyze this data");
    });

    it("includes thinking instruction when specified", async () => {
      mockCopilot.reason.mockResolvedValue("Step by step answer");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        { prompt: "Complex problem", action: "text", thinking: "high" },
        {},
      );

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain("Think step by step");
    });
  });

  describe("json action", () => {
    it("parses valid JSON response and wraps in details object", async () => {
      mockCopilot.reason.mockResolvedValue('{"intent": "greeting", "draft": "Hi there!"}');
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      const result = (await handler(
        { prompt: "Classify this email", action: "json" },
        {},
      )) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.json).toEqual({ intent: "greeting", draft: "Hi there!" });
      expect(parsed.raw).toBe('{"intent": "greeting", "draft": "Hi there!"}');
      expect(result.isError).toBeUndefined();
    });

    it("includes JSON-only instruction in prompt", async () => {
      mockCopilot.reason.mockResolvedValue('{"result": true}');
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler({ prompt: "Is this valid?", action: "json" }, {});

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain("Respond with valid JSON only");
    });

    it("includes schema in prompt when provided", async () => {
      const schema = {
        type: "object",
        properties: {
          intent: { type: "string" },
          draft: { type: "string" },
        },
        required: ["intent", "draft"],
      };
      mockCopilot.reason.mockResolvedValue('{"intent": "test", "draft": "hello"}');
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        { prompt: "Classify", action: "json", schema },
        {},
      );

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain("JSON Schema");
      expect(sentPrompt).toContain('"intent"');
    });

    it("returns error when LLM output is not valid JSON", async () => {
      mockCopilot.reason.mockResolvedValue("This is not JSON at all");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      const result = (await handler(
        { prompt: "Give me JSON", action: "json" },
        {},
      )) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("LLM output was not valid JSON");
      expect(parsed.raw).toBe("This is not JSON at all");
      expect(result.isError).toBe(true);
    });
  });

  describe("memory persistence", () => {
    it("persists messages when conversation_id is provided", async () => {
      store.createConversation("conv-llm-1", "wf-1");
      mockCopilot.reason.mockResolvedValue("Persisted response");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        {
          prompt: "Remember this",
          action: "text",
          conversation_id: "conv-llm-1",
          workflow_id: "wf-1",
        },
        {},
      );

      const messages = store.getMessages("conv-llm-1");
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toContain("Remember this");
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe("Persisted response");
    });

    it("persists JSON action messages too", async () => {
      store.createConversation("conv-llm-2", "wf-2");
      mockCopilot.reason.mockResolvedValue('{"status": "ok"}');
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        {
          prompt: "Check status",
          action: "json",
          conversation_id: "conv-llm-2",
        },
        {},
      );

      const messages = store.getMessages("conv-llm-2");
      expect(messages).toHaveLength(2);
    });
  });

  describe("input handling", () => {
    it("handles string input directly", async () => {
      mockCopilot.reason.mockResolvedValue("Got it");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        { prompt: "Process", action: "text", input: "raw string input" },
        {},
      );

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain("raw string input");
    });

    it("serializes object input as JSON", async () => {
      mockCopilot.reason.mockResolvedValue("Got it");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler(
        { prompt: "Process", action: "text", input: { key: "value", nested: { a: 1 } } },
        {},
      );

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).toContain('"key": "value"');
      expect(sentPrompt).toContain('"a": 1');
    });

    it("handles no input gracefully", async () => {
      mockCopilot.reason.mockResolvedValue("No input needed");
      const getHandler = captureToolHandler(server);
      registerLlmInvokeTool(server, mockCopilot as never, contextBuilder);
      const handler = getHandler();

      await handler({ prompt: "Just a question", action: "text" }, {});

      const sentPrompt = mockCopilot.reason.mock.calls[0][0] as string;
      expect(sentPrompt).not.toContain("<input>");
      expect(sentPrompt).toContain("Just a question");
    });
  });
});
