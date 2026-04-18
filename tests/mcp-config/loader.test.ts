import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpConfig, filterMcpServers, parseMcpFilter } from "../../src/mcp-config/loader.js";

const TEST_DIR = join(tmpdir(), `lobster-mcp-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeConfig(filename: string, content: object): string {
  const path = join(TEST_DIR, filename);
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

describe("parseMcpFilter", () => {
  it("parses comma-separated names", () => {
    expect(parseMcpFilter("teams,mail,calendar")).toEqual(["teams", "mail", "calendar"]);
  });

  it("handles empty string", () => {
    expect(parseMcpFilter("")).toEqual([]);
    expect(parseMcpFilter("  ")).toEqual([]);
  });

  it("trims whitespace", () => {
    expect(parseMcpFilter(" teams , mail ")).toEqual(["teams", "mail"]);
  });

  it("handles single name", () => {
    expect(parseMcpFilter("calendar")).toEqual(["calendar"]);
  });
});

describe("loadMcpConfig", () => {
  it("returns empty record when no config file exists", () => {
    const result = loadMcpConfig({ cwd: TEST_DIR });
    expect(result).toEqual({});
  });

  it("loads from explicit configPath", () => {
    const path = writeConfig("custom.json", {
      mcpServers: {
        myserver: {
          command: "node",
          args: ["server.js"],
          tools: ["*"],
        },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(result.myserver).toEqual({
      type: "local",
      command: "node",
      args: ["server.js"],
      tools: ["*"],
    });
  });

  it("loads from mcp.json in CWD", () => {
    writeConfig("mcp.json", {
      mcpServers: {
        teams: {
          command: "agency",
          args: ["mcp", "teams"],
          tools: ["*"],
        },
      },
    });

    const result = loadMcpConfig({ cwd: TEST_DIR });
    expect(result.teams).toBeDefined();
    expect(result.teams).toMatchObject({
      command: "agency",
      args: ["mcp", "teams"],
    });
  });

  it("loads from .mcp.json in CWD", () => {
    writeConfig(".mcp.json", {
      mcpServers: {
        hidden: {
          command: "hidden-server",
          args: [],
          tools: ["*"],
        },
      },
    });

    const result = loadMcpConfig({ cwd: TEST_DIR });
    expect(result.hidden).toBeDefined();
  });

  it("loads remote (http) servers", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
          tools: ["search", "query"],
        },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(result.remote).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
      tools: ["search", "query"],
    });
  });

  it("loads remote (sse) servers", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        sse: {
          type: "sse",
          url: "https://example.com/events",
          tools: ["*"],
        },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(result.sse).toEqual({
      type: "sse",
      url: "https://example.com/events",
      tools: ["*"],
    });
  });

  it("loads local servers with env and cwd", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        custom: {
          command: "python",
          args: ["-m", "my_server"],
          env: { API_KEY: "secret" },
          cwd: "/opt/servers",
          tools: ["*"],
        },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(result.custom).toMatchObject({
      command: "python",
      args: ["-m", "my_server"],
      env: { API_KEY: "secret" },
      cwd: "/opt/servers",
    });
  });

  it("defaults tools to ['*'] when omitted", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        minimal: {
          command: "my-server",
          args: [],
        },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(result.minimal.tools).toEqual(["*"]);
  });

  it("loads multiple servers of mixed types", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        local1: { command: "server1", args: ["--port", "8080"], tools: ["*"] },
        local2: { command: "server2", args: [], tools: ["toolA"] },
        remote1: { type: "http", url: "https://api.example.com/mcp", tools: ["*"] },
      },
    });

    const result = loadMcpConfig({ configPath: path });
    expect(Object.keys(result)).toEqual(["local1", "local2", "remote1"]);
  });

  it("applies filter to select subset", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        teams: { command: "agency", args: ["mcp", "teams"], tools: ["*"] },
        mail: { command: "agency", args: ["mcp", "mail"], tools: ["*"] },
        calendar: { command: "agency", args: ["mcp", "calendar"], tools: ["*"] },
      },
    });

    const result = loadMcpConfig({ configPath: path, filter: ["teams", "calendar"] });
    expect(Object.keys(result)).toEqual(["teams", "calendar"]);
    expect(result.mail).toBeUndefined();
  });

  it("throws on missing configPath", () => {
    expect(() => loadMcpConfig({ configPath: "/nonexistent/mcp.json" })).toThrow(
      "MCP config file not found",
    );
  });

  it("throws on invalid JSON", () => {
    const path = join(TEST_DIR, "bad.json");
    writeFileSync(path, "not json {{{");

    expect(() => loadMcpConfig({ configPath: path })).toThrow("Invalid JSON");
  });

  it("throws when remote server missing url", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        bad: { type: "http", tools: ["*"] },
      },
    });

    expect(() => loadMcpConfig({ configPath: path })).toThrow('missing required "url"');
  });

  it("throws when local server missing command", () => {
    const path = writeConfig("mcp.json", {
      mcpServers: {
        bad: { args: ["--flag"], tools: ["*"] },
      },
    });

    expect(() => loadMcpConfig({ configPath: path })).toThrow('missing required "command"');
  });

  it("supports MCP_CONFIG env var", () => {
    const path = writeConfig("env-config.json", {
      mcpServers: {
        envserver: { command: "env-cmd", args: [], tools: ["*"] },
      },
    });

    const orig = process.env.MCP_CONFIG;
    process.env.MCP_CONFIG = path;
    try {
      const result = loadMcpConfig({ cwd: "/nonexistent" });
      expect(result.envserver).toBeDefined();
    } finally {
      if (orig !== undefined) process.env.MCP_CONFIG = orig;
      else delete process.env.MCP_CONFIG;
    }
  });
});

describe("filterMcpServers", () => {
  const servers = {
    teams: { type: "local" as const, command: "agency", args: ["mcp", "teams"], tools: ["*"] },
    mail: { type: "local" as const, command: "agency", args: ["mcp", "mail"], tools: ["*"] },
    calendar: { type: "local" as const, command: "agency", args: ["mcp", "calendar"], tools: ["*"] },
  };

  it("filters to requested names", () => {
    const result = filterMcpServers(servers, ["teams", "mail"]);
    expect(Object.keys(result)).toEqual(["teams", "mail"]);
  });

  it("warns on unknown names", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = filterMcpServers(servers, ["teams", "unknown"]);
    expect(Object.keys(result)).toEqual(["teams"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"unknown" not found'));
    spy.mockRestore();
  });

  it("returns empty for no matches", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = filterMcpServers(servers, ["nope"]);
    expect(result).toEqual({});
    spy.mockRestore();
  });
});
