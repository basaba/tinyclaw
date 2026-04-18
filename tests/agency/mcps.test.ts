import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAgencyMcps, parseMcpString, listKnownMcps } from "../../src/agency/mcps.js";

// Mock execFileSync to avoid needing actual agency binary
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "agency 2026.4.17.2"),
}));

describe("parseMcpString", () => {
  it("parses comma-separated names", () => {
    const result = parseMcpString("teams,mail,calendar");
    expect(result).toEqual(["teams", "mail", "calendar"]);
  });

  it("handles empty string", () => {
    expect(parseMcpString("")).toEqual([]);
    expect(parseMcpString("  ")).toEqual([]);
  });

  it("trims whitespace", () => {
    const result = parseMcpString(" teams , mail ");
    expect(result).toEqual(["teams", "mail"]);
  });

  it("parses name with extra args via colon syntax", () => {
    const result = parseMcpString("teams,ado:--organization myorg");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("teams");
    expect(result[1]).toEqual({ name: "ado", args: ["--organization", "myorg"] });
  });

  it("handles single MCP", () => {
    expect(parseMcpString("calendar")).toEqual(["calendar"]);
  });
});

describe("resolveAgencyMcps", () => {
  it("returns empty for empty input", () => {
    expect(resolveAgencyMcps([])).toEqual({});
  });

  it("resolves string entries to MCPLocalServerConfig", () => {
    const result = resolveAgencyMcps(["teams", "mail"]);

    expect(result["agency-teams"]).toEqual({
      type: "local",
      command: "agency",
      args: ["mcp", "teams"],
      tools: ["*"],
    });

    expect(result["agency-mail"]).toEqual({
      type: "local",
      command: "agency",
      args: ["mcp", "mail"],
      tools: ["*"],
    });
  });

  it("resolves structured entries with extra args", () => {
    const result = resolveAgencyMcps([
      { name: "ado", args: ["--organization", "myorg"] },
    ]);

    expect(result["agency-ado"]).toEqual({
      type: "local",
      command: "agency",
      args: ["mcp", "ado", "--organization", "myorg"],
      tools: ["*"],
    });
  });

  it("resolves entries with env vars", () => {
    const result = resolveAgencyMcps([
      { name: "kusto", env: { KUSTO_CLUSTER: "https://mycluster.kusto.windows.net" } },
    ]);

    expect(result["agency-kusto"].env).toEqual({
      KUSTO_CLUSTER: "https://mycluster.kusto.windows.net",
    });
  });

  it("resolves entries with tool filter", () => {
    const result = resolveAgencyMcps([
      { name: "teams", tools: ["ListChats", "PostMessage"] },
    ]);

    expect(result["agency-teams"].tools).toEqual(["ListChats", "PostMessage"]);
  });

  it("warns about unknown MCP names but still resolves them", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveAgencyMcps(["unknown-mcp"]);

    expect(result["agency-unknown-mcp"]).toBeDefined();
    expect(result["agency-unknown-mcp"].args).toEqual(["mcp", "unknown-mcp"]);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown Agency MCP "unknown-mcp"'),
    );

    stderrSpy.mockRestore();
  });

  it("omits env when empty", () => {
    const result = resolveAgencyMcps(["teams"]);
    expect(result["agency-teams"].env).toBeUndefined();
  });
});

describe("listKnownMcps", () => {
  it("returns known MCPs with names and descriptions", () => {
    const mcps = listKnownMcps();

    expect(mcps.length).toBeGreaterThan(15);
    expect(mcps.find((m) => m.name === "teams")).toEqual({
      name: "teams",
      description: "Microsoft Teams — chats, channels, messages",
    });
    expect(mcps.find((m) => m.name === "calendar")).toBeDefined();
    expect(mcps.find((m) => m.name === "mail")).toBeDefined();
  });
});
