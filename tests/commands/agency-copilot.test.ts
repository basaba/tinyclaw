import { describe, it, expect } from "vitest";
import { createAgencyCopilotCommand, extractPromptAndFlags } from "../../src/commands/agency-copilot.js";

// ── command metadata ────────────────────────────────────────────────

describe("agency.copilot command metadata", () => {
  const cmd = createAgencyCopilotCommand();

  it("has the correct name", () => {
    expect(cmd.name).toBe("agency.copilot");
  });

  it("has meta with description and sideEffects", () => {
    expect(cmd.meta?.description).toContain("Agency Copilot");
    expect(cmd.meta?.sideEffects).toEqual(["network", "subprocess"]);
  });

  it("provides help text", () => {
    const help = cmd.help();
    expect(help).toContain("agency.copilot");
    expect(help).toContain("Piped input is written to a temp file");
  });
});

// ── extractPromptAndFlags ───────────────────────────────────────────

describe("extractPromptAndFlags", () => {
  it("extracts positional prompt from rawArgs", () => {
    const { prompt, flags } = extractPromptAndFlags(["Summarize this", "--model", "gpt-4.1"], {});
    expect(prompt).toBe("Summarize this");
    expect(flags).toEqual(["--model", "gpt-4.1"]);
  });

  it("extracts -sp flag prompt from rawArgs", () => {
    const { prompt, flags } = extractPromptAndFlags(["-sp", "Review code", "--model", "gpt-4.1"], {});
    expect(prompt).toBe("Review code");
    expect(flags).toEqual(["--model", "gpt-4.1"]);
  });

  it("extracts --prompt flag from rawArgs", () => {
    const { prompt, flags } = extractPromptAndFlags(["--prompt", "Hello", "--verbose"], {});
    expect(prompt).toBe("Hello");
    expect(flags).toEqual(["--verbose"]);
  });

  it("returns empty prompt when rawArgs has only flags", () => {
    const { prompt, flags } = extractPromptAndFlags(["--model", "gpt-4.1"], {});
    expect(prompt).toBe("");
    expect(flags).toEqual(["--model", "gpt-4.1"]);
  });

  it("extracts positional prompt from parsed args", () => {
    const { prompt, flags } = extractPromptAndFlags(undefined, { _: ["Hello world"], model: "gpt-4.1" });
    expect(prompt).toBe("Hello world");
    expect(flags).toContain("--model");
    expect(flags).toContain("gpt-4.1");
  });

  it("extracts --prompt from parsed args", () => {
    const { prompt, flags } = extractPromptAndFlags(undefined, { prompt: "Review this", verbose: true });
    expect(prompt).toBe("Review this");
    expect(flags).toContain("--verbose");
  });

  it("extracts -sp from parsed args", () => {
    const { prompt, flags } = extractPromptAndFlags(undefined, { sp: "Summarize" });
    expect(prompt).toBe("Summarize");
    expect(flags).toEqual([]);
  });

  it("handles single-char flags in parsed args", () => {
    const { flags } = extractPromptAndFlags(undefined, { _: ["Hi"], s: true, m: "gpt-4" });
    expect(flags).toContain("-s");
    expect(flags).toContain("-m");
    expect(flags).toContain("gpt-4");
  });

  it("handles boolean flags", () => {
    const { flags } = extractPromptAndFlags(undefined, { verbose: true, quiet: false });
    expect(flags).toContain("--verbose");
    expect(flags).not.toContain("--quiet");
  });

  it("skips input key", () => {
    const { flags } = extractPromptAndFlags(undefined, { input: "something", _: ["Hi"] });
    expect(flags).not.toContain("--input");
  });

  it("returns empty prompt and flags for empty args", () => {
    const { prompt, flags } = extractPromptAndFlags(undefined, {});
    expect(prompt).toBe("");
    expect(flags).toEqual([]);
  });

  it("preserves remaining positional args as flags", () => {
    const { prompt, flags } = extractPromptAndFlags(undefined, { _: ["prompt text", "extra1", "extra2"] });
    expect(prompt).toBe("prompt text");
    expect(flags).toEqual(["extra1", "extra2"]);
  });
});
