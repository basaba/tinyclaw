import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCopilotSkillCommand,
  resolveSkillPath,
  stripFrontmatter,
} from "../../src/commands/copilot-skill.js";

describe("stripFrontmatter", () => {
  it("removes a YAML frontmatter block", () => {
    const input = "---\nname: foo\ndescription: bar\n---\n\n# Body\n\ntext";
    expect(stripFrontmatter(input)).toBe("# Body\n\ntext");
  });

  it("returns content unchanged when no frontmatter is present", () => {
    expect(stripFrontmatter("# Body\n\ntext")).toBe("# Body\n\ntext");
  });

  it("handles CRLF line endings", () => {
    const input = "---\r\nname: foo\r\n---\r\n# Body";
    expect(stripFrontmatter(input)).toBe("# Body");
  });
});

describe("resolveSkillPath", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tinyclaw-skill-"));
    mkdirSync(join(tmp, "skills", "demo"), { recursive: true });
    writeFileSync(join(tmp, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n# demo body\n");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds a skill via explicit --skills-dir", () => {
    const p = resolveSkillPath("demo", { skillsDir: join(tmp, "skills") });
    expect(p).toBe(join(tmp, "skills", "demo", "SKILL.md"));
  });

  it("finds a skill via cwd/skills fallback", () => {
    const p = resolveSkillPath("demo", { cwd: tmp });
    expect(p).toBe(join(tmp, "skills", "demo", "SKILL.md"));
  });

  it("throws when the skill is missing", () => {
    expect(() => resolveSkillPath("nope", { cwd: tmp })).toThrow(/not found/);
  });

  it("rejects path-traversal skill names", () => {
    expect(() => resolveSkillPath("../etc", { cwd: tmp })).toThrow(/Invalid skill name/);
    expect(() => resolveSkillPath("a/b", { cwd: tmp })).toThrow(/Invalid skill name/);
  });
});

describe("copilot.skill command", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tinyclaw-skill-"));
    mkdirSync(join(tmp, "skills", "demo"), { recursive: true });
    writeFileSync(
      join(tmp, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: test\n---\n\nFollow this rule: always say PONG.\n",
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("has correct metadata", () => {
    const cmd = createCopilotSkillCommand(() => ({}) as any, async () => {});
    expect(cmd.name).toBe("copilot.skill");
    expect(cmd.meta?.sideEffects).toEqual(["network"]);
    expect(cmd.help()).toContain("copilot.skill");
  });

  it("loads SKILL.md, injects body as system prompt, and calls reason()", async () => {
    let captured: { prompt: string; system?: string; model?: string } | null = null;
    const fakeClient = {
      reason: async (
        prompt: string,
        _ctx: unknown,
        system: string | undefined,
        opts: { model?: string },
      ) => {
        captured = { prompt, system, model: opts?.model };
        return "PONG";
      },
    };

    const cmd = createCopilotSkillCommand(() => fakeClient as any, async () => {});
    const emptyInput = (async function* () {})();

    const result = await cmd.run({
      input: emptyInput,
      args: { skill: "demo", "skills-dir": join(tmp, "skills"), prompt: "Ping?" },
      ctx: { cwd: tmp },
    });

    expect(captured).not.toBeNull();
    expect(captured!.prompt).toBe("Ping?");
    expect(captured!.system).toContain("--- SKILL: demo ---");
    expect(captured!.system).toContain("always say PONG");
    expect(captured!.system).not.toContain("description: test");

    const out: string[] = [];
    for await (const chunk of result.output as AsyncIterable<string>) out.push(chunk);
    expect(out).toEqual(["PONG"]);
  });

  it("prepends piped input to the prompt", async () => {
    let capturedPrompt = "";
    const fakeClient = {
      reason: async (prompt: string) => {
        capturedPrompt = prompt;
        return "ok";
      },
    };
    const cmd = createCopilotSkillCommand(() => fakeClient as any, async () => {});
    const input = (async function* () {
      yield "data line 1";
      yield "data line 2";
    })();

    await cmd.run({
      input,
      args: { skill: "demo", "skills-dir": join(tmp, "skills"), prompt: "Summarize" },
      ctx: { cwd: tmp },
    });

    expect(capturedPrompt).toContain("data line 1");
    expect(capturedPrompt).toContain("data line 2");
    expect(capturedPrompt).toContain("Summarize");
  });

  it("throws when --skill is missing", async () => {
    const cmd = createCopilotSkillCommand(() => ({}) as any, async () => {});
    await expect(
      cmd.run({
        input: (async function* () {})(),
        args: { prompt: "hi" },
        ctx: { cwd: tmp },
      }),
    ).rejects.toThrow(/--skill/);
  });

  it("throws when neither prompt nor input is provided", async () => {
    const cmd = createCopilotSkillCommand(() => ({}) as any, async () => {});
    await expect(
      cmd.run({
        input: (async function* () {})(),
        args: { skill: "demo", "skills-dir": join(tmp, "skills") },
        ctx: { cwd: tmp },
      }),
    ).rejects.toThrow(/--prompt or piped input/);
  });
});
