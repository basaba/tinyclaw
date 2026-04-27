import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanYamlFiles, fuzzyMatch, fileExists } from "../../../src/tui/utils/file-scanner.js";

const TMP = join(import.meta.dirname ?? __dirname, "__tmp_file_scanner__");

function setup() {
  mkdirSync(join(TMP, "sub", "deep"), { recursive: true });
  mkdirSync(join(TMP, "node_modules"), { recursive: true });
  writeFileSync(join(TMP, "a.yaml"), "name: a");
  writeFileSync(join(TMP, "b.yml"), "name: b");
  writeFileSync(join(TMP, "c.txt"), "not yaml");
  writeFileSync(join(TMP, "sub", "d.yaml"), "name: d");
  writeFileSync(join(TMP, "sub", "deep", "e.yaml"), "name: e");
  writeFileSync(join(TMP, "node_modules", "skip.yaml"), "name: skip");
}

describe("scanYamlFiles", () => {
  beforeEach(setup);
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("finds yaml/yml files recursively", () => {
    const files = scanYamlFiles([TMP]);
    expect(files).toContain("a.yaml");
    expect(files).toContain("b.yml");
    expect(files).toContain(join("sub", "d.yaml"));
    expect(files).toContain(join("sub", "deep", "e.yaml"));
  });

  it("excludes non-yaml files", () => {
    const files = scanYamlFiles([TMP]);
    expect(files).not.toContain("c.txt");
  });

  it("excludes node_modules", () => {
    const files = scanYamlFiles([TMP]);
    const nodeModuleFiles = files.filter((f) => f.includes("node_modules"));
    expect(nodeModuleFiles).toHaveLength(0);
  });

  it("respects maxDepth", () => {
    const files = scanYamlFiles([TMP], 0);
    expect(files).toContain("a.yaml");
    expect(files).toContain("b.yml");
    expect(files).not.toContain(join("sub", "d.yaml"));
  });

  it("respects maxFiles", () => {
    const files = scanYamlFiles([TMP], 4, 2);
    expect(files.length).toBeLessThanOrEqual(2);
  });
});

describe("fuzzyMatch", () => {
  const candidates = [
    "examples/mail/mail-digest.yaml",
    "examples/ado/pr-monitor.yaml",
    "examples/approval-demo.yaml",
    "config/settings.yaml",
    "sub/deep/test.yaml",
  ];

  it("returns all candidates for empty query (up to limit)", () => {
    const result = fuzzyMatch("", candidates);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("matches exact substrings", () => {
    const result = fuzzyMatch("mail", candidates);
    expect(result[0]).toBe("examples/mail/mail-digest.yaml");
  });

  it("matches path segments", () => {
    const result = fuzzyMatch("pr-monitor", candidates);
    expect(result[0]).toBe("examples/ado/pr-monitor.yaml");
  });

  it("handles fuzzy character matching", () => {
    const result = fuzzyMatch("appdemo", candidates);
    expect(result).toContain("examples/approval-demo.yaml");
  });

  it("returns empty for non-matching query", () => {
    const result = fuzzyMatch("zzzzzzz", candidates);
    expect(result).toHaveLength(0);
  });
});

describe("fileExists", () => {
  beforeEach(setup);
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it("returns true for existing file", () => {
    expect(fileExists(join(TMP, "a.yaml"))).toBe(true);
  });

  it("returns false for directory", () => {
    expect(fileExists(join(TMP, "sub"))).toBe(false);
  });

  it("returns false for non-existent path", () => {
    expect(fileExists(join(TMP, "nope.yaml"))).toBe(false);
  });
});
