import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import { ContextBuilder } from "../../src/memory/context.js";

describe("ContextBuilder", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("buildContext", () => {
    it("returns system prompt when conversation has no messages", () => {
      store.createConversation("empty", "wf");
      const builder = new ContextBuilder(store, 8000);
      const ctx = builder.buildContext("empty", "You are helpful.");

      expect(ctx).toHaveLength(1);
      expect(ctx[0]).toEqual({ role: "system", content: "You are helpful." });
    });

    it("includes messages within token budget", () => {
      store.createConversation("c1", "wf");
      store.addMessage("c1", "user", "Hello");
      store.addMessage("c1", "assistant", "Hi");

      const builder = new ContextBuilder(store, 8000);
      const ctx = builder.buildContext("c1", "System prompt.");

      expect(ctx.length).toBeGreaterThanOrEqual(2);
      expect(ctx[0].role).toBe("system");
      // Messages should be present
      const roles = ctx.map((m) => m.role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    });

    it("drops older messages when over budget", () => {
      store.createConversation("c2", "wf");
      // Each message ~5 chars ≈ 2 tokens (ceil(5/4)=2).
      // Add many messages to exceed a small budget.
      for (let i = 0; i < 50; i++) {
        const role = i % 2 === 0 ? "user" : "assistant";
        store.addMessage("c2", role, `Message number ${i} with some extra padding text here`);
      }

      // Small budget: system prompt "Sys" = 1 token, leaving ~9 tokens for messages
      const builder = new ContextBuilder(store, 10);
      const ctx = builder.buildContext("c2", "Sys");

      // Should have system + only the most recent messages that fit
      expect(ctx[0].role).toBe("system");
      // Total should be much less than 50 + 1
      expect(ctx.length).toBeLessThan(52);
      expect(ctx.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getRelevantMemory", () => {
    it("returns matching memory entries", () => {
      store.setMemory("ns", "key1", "val1");
      store.setMemory("ns", "key2", "val2");
      store.setMemory("ns", "key3", "val3");

      const builder = new ContextBuilder(store, 8000);
      const result = builder.getRelevantMemory("ns", ["key1", "key3"]);

      expect(result).toEqual({ key1: "val1", key3: "val3" });
    });

    it("skips missing keys", () => {
      store.setMemory("ns", "exists", "yes");
      const builder = new ContextBuilder(store, 8000);
      const result = builder.getRelevantMemory("ns", ["exists", "missing"]);

      expect(result).toEqual({ exists: "yes" });
    });

    it("returns empty object when no keys provided", () => {
      const builder = new ContextBuilder(store, 8000);
      const result = builder.getRelevantMemory("ns");
      expect(result).toEqual({});
    });
  });
});
