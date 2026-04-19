import { describe, it, expect } from "vitest";
import { resolveServer } from "../../src/mcp-client/client.js";
import type { McpServerConfig } from "../../src/mcp-config/loader.js";

describe("resolveServer", () => {
  const servers: Record<string, McpServerConfig> = {
    myserver: {
      command: "node",
      args: ["server.js"],
      tools: ["tool1", "tool2"],
    },
    httpserver: {
      type: "http",
      url: "http://localhost:3000",
      tools: ["*"],
    } as any,
  };

  it("returns matching stdio server from config", () => {
    const config = resolveServer("myserver", servers);
    expect(config.command).toBe("node");
    expect(config.args).toEqual(["server.js"]);
    expect(config.tools).toEqual(["tool1", "tool2"]);
  });

  it("throws for HTTP servers", () => {
    expect(() => resolveServer("httpserver", servers)).toThrow(
      /only stdio servers are supported/,
    );
  });

  it("falls back to agency mcp <name> for unknown servers", () => {
    const config = resolveServer("icm", servers);
    expect(config.command).toBe("agency");
    expect(config.args).toEqual(["mcp", "icm"]);
    expect(config.tools).toEqual(["*"]);
  });

  it("falls back to agency for any unknown name", () => {
    const config = resolveServer("kusto", {});
    expect(config.command).toBe("agency");
    expect(config.args).toEqual(["mcp", "kusto"]);
  });
});
