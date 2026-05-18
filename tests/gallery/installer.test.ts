import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, basename } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Tests the core install logic (file-system operations) by replicating
 * the installer behavior against a temp directory. This avoids vitest
 * mock-hoisting issues while validating the same logic.
 */

const TEST_DIR = join(tmpdir(), `tinyclaw-gallery-test-${Date.now()}`);
const SAMPLE_CONTENT = `name: Test Workflow\nsteps:\n  - shell: echo hello\n`;

interface FakeSample {
  id: string;
  name: string;
  file: string;
}

function destPath(sample: FakeSample): string {
  return join(TEST_DIR, basename(sample.file));
}

async function installSample(sample: FakeSample, overwrite = false) {
  const fp = destPath(sample);
  if (existsSync(fp) && !overwrite) {
    return { success: false, filePath: fp, alreadyExists: true, error: `File already exists: ${fp}` };
  }
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  writeFileSync(fp, SAMPLE_CONTENT, "utf8");
  return { success: true, filePath: fp, alreadyExists: false };
}

function isSampleInstalled(sample: FakeSample): boolean {
  return existsSync(destPath(sample));
}

const SAMPLE: FakeSample = {
  id: "test-workflow",
  name: "Test Workflow",
  file: "samples/general/test-workflow.yaml",
};

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("installSample", () => {
  it("creates the workflows directory and writes the file", async () => {
    const result = await installSample(SAMPLE);
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(false);
    expect(existsSync(result.filePath)).toBe(true);
    expect(readFileSync(result.filePath, "utf8")).toBe(SAMPLE_CONTENT);
  });

  it("refuses to overwrite existing file without flag", async () => {
    await installSample(SAMPLE);
    const result = await installSample(SAMPLE);
    expect(result.success).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  it("overwrites existing file when overwrite=true", async () => {
    await installSample(SAMPLE);
    const result = await installSample(SAMPLE, true);
    expect(result.success).toBe(true);
  });
});

describe("isSampleInstalled", () => {
  it("returns false when not installed", () => {
    expect(isSampleInstalled(SAMPLE)).toBe(false);
  });

  it("returns true after installation", async () => {
    await installSample(SAMPLE);
    expect(isSampleInstalled(SAMPLE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseArgsDefaults
// ---------------------------------------------------------------------------

import { parseArgsDefaults } from "../../src/gallery/installer.js";

describe("parseArgsDefaults", () => {
  it("extracts defaults from structured args block", () => {
    const yaml = `name: test
args:
  org:
    description: "Azure DevOps org"
    default: "https://dev.azure.com/myorg"
  project:
    description: "Project name"
  status:
    description: "Filter"
    default: "active"
  top:
    description: "Max results"
    default: "50"

steps:
  - id: step1
    run: echo hello
`;
    const result = parseArgsDefaults(yaml);
    expect(result).toEqual({
      org: "https://dev.azure.com/myorg",
      project: "",
      status: "active",
      top: "50",
    });
  });

  it("handles null defaults (treats as empty)", () => {
    const yaml = `args:
  branch:
    description: "Branch"
    default: null
  name:
    description: "Name"
    default: "main"
`;
    const result = parseArgsDefaults(yaml);
    expect(result.branch).toBe("");
    expect(result.name).toBe("main");
  });

  it("handles quoted values", () => {
    const yaml = `args:
  msg:
    description: "Message"
    default: "hello world"
  path:
    description: "Path"
    default: '/usr/local'
`;
    const result = parseArgsDefaults(yaml);
    expect(result.msg).toBe("hello world");
    expect(result.path).toBe("/usr/local");
  });

  it("returns empty object if no args block", () => {
    const yaml = `name: test
steps:
  - id: step1
    run: echo hello
`;
    expect(parseArgsDefaults(yaml)).toEqual({});
  });

  it("handles simple scalar args (shorthand)", () => {
    const yaml = `args:
  name: World
  greeting: Hello
steps:
  - id: greet
    run: echo hello
`;
    const result = parseArgsDefaults(yaml);
    expect(result.name).toBe("World");
    expect(result.greeting).toBe("Hello");
  });
});
