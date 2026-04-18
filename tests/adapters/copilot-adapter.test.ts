import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CopilotAdapter,
  buildPrompt,
  extractJson,
} from "../../src/adapters/copilot-adapter.js";
import { createCopilotAdapters } from "../../src/adapters/index.js";

// ── Mock CopilotBridgeClient ────────────────────────────────────────

const mockReason = vi.fn();
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/copilot/client.js", () => ({
  CopilotBridgeClient: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    reason: mockReason,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── buildPrompt ─────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("includes task section", () => {
    const result = buildPrompt({ prompt: "Hello world", artifacts: [], artifactHashes: [] }, 8000);
    expect(result).toContain("<task>\nHello world\n</task>");
  });

  it("includes artifacts with metadata", () => {
    const payload = {
      prompt: "Analyze",
      artifacts: [
        { kind: "text", name: "readme", text: "Hello" },
        { kind: "json", data: { x: 1 } },
      ],
      artifactHashes: ["abcdef123456789", "fedcba987654321"],
    };
    const result = buildPrompt(payload, 8000);
    expect(result).toContain("<artifacts>");
    expect(result).toContain('kind="text"');
    expect(result).toContain('name="readme"');
    expect(result).toContain("Hello");
    expect(result).toContain('kind="json"');
    expect(result).toContain('"x": 1');
    expect(result).toContain('hash="abcdef123456…"');
  });

  it("truncates oversized artifacts", () => {
    const largeText = "x".repeat(10000);
    const payload = {
      prompt: "Analyze",
      artifacts: [{ kind: "text", text: largeText }],
      artifactHashes: [],
    };
    const result = buildPrompt(payload, 500);
    expect(result).toContain("… [truncated, 10000 chars total]");
    expect(result.length).toBeLessThan(largeText.length);
  });

  it("includes output schema section", () => {
    const payload = {
      prompt: "Get data",
      artifacts: [],
      artifactHashes: [],
      outputSchema: { type: "object", properties: { name: { type: "string" } } },
    };
    const result = buildPrompt(payload, 8000);
    expect(result).toContain("<output_schema>");
    expect(result).toContain("MUST be valid JSON");
    expect(result).toContain('"type": "object"');
  });

  it("includes retry feedback", () => {
    const payload = {
      prompt: "Get data",
      artifacts: [],
      artifactHashes: [],
      retryContext: {
        attempt: 2,
        validationErrors: ["/ must have required property 'name'"],
      },
    };
    const result = buildPrompt(payload, 8000);
    expect(result).toContain("<retry_feedback>");
    expect(result).toContain("Attempt 2");
    expect(result).toContain("must have required property 'name'");
    expect(result).toContain("corrected JSON");
  });

  it("omits sections when not needed", () => {
    const result = buildPrompt({ prompt: "Simple task", artifacts: [], artifactHashes: [] }, 8000);
    expect(result).not.toContain("<artifacts>");
    expect(result).not.toContain("<output_schema>");
    expect(result).not.toContain("<retry_feedback>");
  });
});

// ── extractJson ─────────────────────────────────────────────────────

describe("extractJson", () => {
  it("parses plain JSON object", () => {
    const result = extractJson('{"name": "test", "value": 42}');
    expect(result?.data).toEqual({ name: "test", value: 42 });
  });

  it("parses plain JSON array", () => {
    const result = extractJson('[1, 2, 3]');
    expect(result?.data).toEqual([1, 2, 3]);
  });

  it("extracts JSON from fenced code block", () => {
    const text = 'Here is the result:\n```json\n{"status": "ok"}\n```\nDone.';
    const result = extractJson(text);
    expect(result?.data).toEqual({ status: "ok" });
  });

  it("extracts JSON from unfenced code block", () => {
    const text = 'Result:\n```\n{"key": "val"}\n```';
    const result = extractJson(text);
    expect(result?.data).toEqual({ key: "val" });
  });

  it("extracts embedded JSON object from prose", () => {
    const text = 'The answer is: {"score": 95, "grade": "A"} as computed.';
    const result = extractJson(text);
    expect(result?.data).toEqual({ score: 95, grade: "A" });
  });

  it("extracts embedded JSON array from prose", () => {
    const text = 'Items: [{"id": 1}, {"id": 2}] found.';
    const result = extractJson(text);
    expect(result?.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles nested braces correctly", () => {
    const text = '{"a": {"b": {"c": 1}}, "d": [1, 2]}';
    const result = extractJson(text);
    expect(result?.data).toEqual({ a: { b: { c: 1 } }, d: [1, 2] });
  });

  it("handles strings with braces inside", () => {
    const text = '{"msg": "use {braces} here"}';
    const result = extractJson(text);
    expect(result?.data).toEqual({ msg: "use {braces} here" });
  });

  it("returns null for non-JSON text", () => {
    expect(extractJson("Just some plain text")).toBeNull();
  });

  it("returns null for empty/whitespace", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("   ")).toBeNull();
  });

  it("handles multiple fenced blocks, picks first valid", () => {
    const text = '```\nnot json\n```\n```json\n{"ok": true}\n```';
    const result = extractJson(text);
    expect(result?.data).toEqual({ ok: true });
  });
});

// ── CopilotAdapter.invoke ───────────────────────────────────────────

describe("CopilotAdapter", () => {
  it("returns text response for simple prompts", async () => {
    mockReason.mockResolvedValue("The answer is 42.");
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: { prompt: "What is the answer?", artifacts: [], artifactHashes: [] },
      ctx: {},
    });

    expect(result.ok).toBe(true);
    expect(result.result?.output?.text).toBe("The answer is 42.");
    expect(result.result?.output?.format).toBe("text");
    expect(result.result?.runId).toBeTruthy();
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("lazy-starts client only once across calls", async () => {
    mockReason.mockResolvedValue("ok");
    const adapter = new CopilotAdapter();

    await adapter.invoke({
      env: {},
      args: {},
      payload: { prompt: "First", artifacts: [], artifactHashes: [] },
      ctx: {},
    });
    await adapter.invoke({
      env: {},
      args: {},
      payload: { prompt: "Second", artifacts: [], artifactHashes: [] },
      ctx: {},
    });

    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("extracts JSON when outputSchema is present", async () => {
    mockReason.mockResolvedValue('{"name": "Alice", "age": 30}');
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: {
        prompt: "Get user",
        artifacts: [],
        artifactHashes: [],
        outputSchema: { type: "object" },
      },
      ctx: {},
    });

    expect(result.ok).toBe(true);
    expect(result.result?.output?.format).toBe("json");
    expect(result.result?.output?.data).toEqual({ name: "Alice", age: 30 });
  });

  it("extracts JSON from fenced response", async () => {
    mockReason.mockResolvedValue('Here:\n```json\n{"status": "done"}\n```');
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: {
        prompt: "Status",
        artifacts: [],
        artifactHashes: [],
        outputSchema: { type: "object" },
      },
      ctx: {},
    });

    expect(result.ok).toBe(true);
    expect(result.result?.output?.data).toEqual({ status: "done" });
  });

  it("returns text fallback when JSON extraction fails with schema", async () => {
    mockReason.mockResolvedValue("I cannot produce JSON for this.");
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: {
        prompt: "Get data",
        artifacts: [],
        artifactHashes: [],
        outputSchema: { type: "object" },
      },
      ctx: {},
    });

    expect(result.ok).toBe(true);
    expect(result.result?.output?.format).toBe("text");
    expect(result.result?.output?.data).toBeUndefined();
    expect(result.result?.warnings).toContain(
      "copilot adapter: failed to extract JSON from response",
    );
    expect(result.result?.diagnostics?.rawResponse).toBe("I cannot produce JSON for this.");
  });

  it("passes model to client and warns about unsupported temperature/maxOutputTokens", async () => {
    mockReason.mockResolvedValue("ok");
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: {
        prompt: "Test",
        artifacts: [],
        artifactHashes: [],
        model: "gpt-4",
        temperature: 0.5,
        maxOutputTokens: 1000,
      },
      ctx: {},
    });

    expect(result.ok).toBe(true);
    // Model is now passed through, not warned about
    expect(result.result?.model).toBe("gpt-4");
    expect(mockReason).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.any(String),
      expect.objectContaining({ model: "gpt-4" }),
    );
    const warnings = result.result?.warnings ?? [];
    expect(warnings.some((w) => w.includes("temperature"))).toBe(true);
    expect(warnings.some((w) => w.includes("maxOutputTokens"))).toBe(true);
  });

  it("returns error envelope on Copilot failure", async () => {
    mockReason.mockRejectedValue(new Error("Connection refused"));
    const adapter = new CopilotAdapter();

    const result = await adapter.invoke({
      env: {},
      args: {},
      payload: { prompt: "Fail", artifacts: [], artifactHashes: [] },
      ctx: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Connection refused");
  });

  it("dispose stops the client", async () => {
    mockReason.mockResolvedValue("ok");
    const adapter = new CopilotAdapter();

    await adapter.invoke({
      env: {},
      args: {},
      payload: { prompt: "Test", artifacts: [], artifactHashes: [] },
      ctx: {},
    });
    await adapter.dispose();

    expect(mockStop).toHaveBeenCalledOnce();
  });
});

// ── createCopilotAdapters factory ───────────────────────────────────

describe("createCopilotAdapters", () => {
  it("returns adapters map with copilot key and dispose function", () => {
    const bundle = createCopilotAdapters();
    expect(bundle.adapters).toHaveProperty("copilot");
    expect(typeof bundle.adapters.copilot.invoke).toBe("function");
    expect(typeof bundle.dispose).toBe("function");
  });

  it("adapter source is copilot", () => {
    const bundle = createCopilotAdapters();
    expect(bundle.adapters.copilot.source).toBe("copilot");
  });
});
