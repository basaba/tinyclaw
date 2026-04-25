import { describe, it, expect } from "vitest";
import { formatRecipient, normaliseMailResults } from "../../src/commands/mail.js";

// ── formatRecipient ────────────────────────────────────────────────

describe("formatRecipient", () => {
  it("returns empty string for null/undefined", () => {
    expect(formatRecipient(null)).toBe("");
    expect(formatRecipient(undefined)).toBe("");
  });

  it("returns plain string as-is", () => {
    expect(formatRecipient("alice@example.com")).toBe("alice@example.com");
  });

  it("formats Graph API emailAddress object with name", () => {
    const r = { emailAddress: { name: "Alice Smith", address: "alice@example.com" } };
    expect(formatRecipient(r)).toBe("Alice Smith <alice@example.com>");
  });

  it("formats emailAddress object without name", () => {
    const r = { emailAddress: { address: "bob@example.com" } };
    expect(formatRecipient(r)).toBe("bob@example.com");
  });

  it("handles flat object with name and address", () => {
    const r = { name: "Carol", address: "carol@test.com" };
    expect(formatRecipient(r)).toBe("Carol <carol@test.com>");
  });
});

// ── normaliseMailResults ───────────────────────────────────────────

describe("normaliseMailResults", () => {
  const graphMessage = {
    id: "msg-1",
    subject: "Hello",
    from: { emailAddress: { name: "Alice", address: "alice@example.com" } },
    toRecipients: [
      { emailAddress: { name: "Bob", address: "bob@example.com" } },
    ],
    receivedDateTime: "2026-04-22T10:00:00Z",
    isRead: true,
    hasAttachments: false,
    bodyPreview: "Hi Bob, just checking in.",
  };

  it("normalises a single MCP text content item containing a Graph message", () => {
    const content = [{ type: "text", text: JSON.stringify(graphMessage) }];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "msg-1",
      from: "Alice <alice@example.com>",
      to: ["Bob <bob@example.com>"],
      subject: "Hello",
      date: "2026-04-22T10:00:00Z",
      isRead: true,
      hasAttachments: false,
      preview: "Hi Bob, just checking in.",
    });
  });

  it("normalises a Graph API response wrapper with value array", () => {
    const wrapper = { value: [graphMessage, { ...graphMessage, id: "msg-2", subject: "Follow-up" }] };
    const content = [{ type: "text", text: JSON.stringify(wrapper) }];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(2);
    expect((result[0] as any).id).toBe("msg-1");
    expect((result[1] as any).id).toBe("msg-2");
    expect((result[1] as any).subject).toBe("Follow-up");
  });

  it("normalises an array of messages in a single text item", () => {
    const content = [{ type: "text", text: JSON.stringify([graphMessage]) }];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(1);
    expect((result[0] as any).subject).toBe("Hello");
  });

  it("normalises raw JSON strings (not wrapped in MCP content)", () => {
    const content = [JSON.stringify(graphMessage)];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(1);
    expect((result[0] as any).id).toBe("msg-1");
  });

  it("handles multiple MCP content items", () => {
    const content = [
      { type: "text", text: JSON.stringify(graphMessage) },
      { type: "text", text: JSON.stringify({ ...graphMessage, id: "msg-3" }) },
    ];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(2);
  });

  it("falls through to raw content if nothing looks like a mail message", () => {
    const raw = [{ type: "text", text: "Just a plain text response" }];
    const { messages: result } = normaliseMailResults(raw);
    expect(result).toBe(raw); // same reference — unchanged
  });

  it("falls through for non-JSON text", () => {
    const raw = [{ type: "text", text: "not json {{{" }];
    const { messages: result } = normaliseMailResults(raw);
    expect(result).toBe(raw);
  });

  it("falls through for objects without id or subject", () => {
    const raw = [{ type: "text", text: JSON.stringify({ foo: "bar" }) }];
    const { messages: result } = normaliseMailResults(raw);
    expect(result).toBe(raw);
  });

  it("defaults missing fields gracefully", () => {
    const minimal = { id: "msg-minimal" };
    const content = [{ type: "text", text: JSON.stringify(minimal) }];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "msg-minimal",
      from: "",
      to: [],
      subject: "(no subject)",
      date: "",
      isRead: false,
      hasAttachments: false,
      preview: "",
    });
  });

  it("uses sender field when from is missing", () => {
    const msg = {
      id: "msg-sender",
      subject: "Test",
      sender: { emailAddress: { name: "Dan", address: "dan@test.com" } },
    };
    const content = [{ type: "text", text: JSON.stringify(msg) }];
    const { messages: result } = normaliseMailResults(content);

    expect((result[0] as any).from).toBe("Dan <dan@test.com>");
  });

  it("prefers receivedDateTime over sentDateTime and createdDateTime", () => {
    const msg = {
      id: "msg-dates",
      subject: "Dates",
      receivedDateTime: "2026-01-01T00:00:00Z",
      sentDateTime: "2025-12-31T23:59:00Z",
      createdDateTime: "2025-12-31T23:58:00Z",
    };
    const content = [{ type: "text", text: JSON.stringify(msg) }];
    const { messages: result } = normaliseMailResults(content);

    expect((result[0] as any).date).toBe("2026-01-01T00:00:00Z");
  });

  it("unwraps agency mail MCP rawResponse wrapper", () => {
    const graphResponse = { value: [graphMessage] };
    const wrapped = { rawResponse: JSON.stringify(graphResponse) };
    const content = [{ type: "text", text: JSON.stringify(wrapped) }];
    const { messages: result } = normaliseMailResults(content);

    expect(result).toHaveLength(1);
    expect((result[0] as any).id).toBe("msg-1");
    expect((result[0] as any).subject).toBe("Hello");
    expect((result[0] as any).from).toBe("Alice <alice@example.com>");
  });

  it("falls back to sentDateTime when receivedDateTime is missing", () => {
    const msg = {
      id: "msg-sent",
      subject: "Sent",
      sentDateTime: "2026-02-01T12:00:00Z",
    };
    const content = [{ type: "text", text: JSON.stringify(msg) }];
    const { messages: result } = normaliseMailResults(content);

    expect((result[0] as any).date).toBe("2026-02-01T12:00:00Z");
  });
});
