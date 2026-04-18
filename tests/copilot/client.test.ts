import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the @github/copilot-sdk before importing the client
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({
      sendAndWait: vi.fn().mockResolvedValue({
        data: { content: "mocked response" },
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  })),
  approveAll: vi.fn(),
}));

import { CopilotBridgeClient } from "../../src/copilot/client.js";

describe("CopilotBridgeClient", () => {
  let client: CopilotBridgeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CopilotBridgeClient({});
  });

  describe("constructor", () => {
    it("initializes without error", () => {
      expect(client).toBeInstanceOf(CopilotBridgeClient);
    });

    it("accepts config with cliUrl", () => {
      const c = new CopilotBridgeClient({ cliUrl: "http://localhost:3000" });
      expect(c).toBeInstanceOf(CopilotBridgeClient);
    });

    it("accepts config with apiKey", () => {
      const c = new CopilotBridgeClient({ apiKey: "test-key" });
      expect(c).toBeInstanceOf(CopilotBridgeClient);
    });
  });

  describe("expected methods", () => {
    it("has a reason method", () => {
      expect(typeof client.reason).toBe("function");
    });

    it("has a start method", () => {
      expect(typeof client.start).toBe("function");
    });

    it("has a stop method", () => {
      expect(typeof client.stop).toBe("function");
    });
  });

  describe("start", () => {
    it("starts without error", async () => {
      await expect(client.start()).resolves.toBeUndefined();
    });
  });

  describe("stop", () => {
    it("stop before start is a no-op", async () => {
      await expect(client.stop()).resolves.toBeUndefined();
    });

    it("stops after start without error", async () => {
      await client.start();
      await expect(client.stop()).resolves.toBeUndefined();
    });
  });

  describe("reason", () => {
    it("throws if client is not started", async () => {
      await expect(client.reason("test")).rejects.toThrow(
        "Copilot client is not started",
      );
    });

    it("returns response after start", async () => {
      await client.start();
      const result = await client.reason("What is 2+2?");
      expect(result).toBe("mocked response");
    });

    it("passes context to the session", async () => {
      await client.start();
      const context = [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
      ];
      const result = await client.reason("Follow-up", context);
      expect(result).toBe("mocked response");
    });
  });
});
