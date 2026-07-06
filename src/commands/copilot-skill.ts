import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { CopilotBridgeClient } from "../copilot/client.js";
import { createCopilotCommand, type LobsterCommand } from "./copilot.js";

/**
 * Strip a leading YAML frontmatter block (between `---` fences) from a
 * skill markdown file and return the body.
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).replace(/^\s+/, "") : content;
}

/**
 * Resolve the path to a named skill's SKILL.md. Mirrors the Copilot CLI's
 * own skill discovery: a repo-wide `<cwd>/skills` directory and a user-scoped
 * `~/.copilot/skills` directory. An explicit `--skills-dir` override wins.
 */
export function resolveSkillPath(
  skill: string,
  opts: { skillsDir?: string; cwd?: string },
): string {
  if (!skill || /[\\/]|\.\./.test(skill)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(skill)}`);
  }

  const candidates: string[] = [];
  if (opts.skillsDir) {
    candidates.push(isAbsolute(opts.skillsDir) ? opts.skillsDir : resolve(opts.cwd ?? process.cwd(), opts.skillsDir));
  }
  candidates.push(resolve(opts.cwd ?? process.cwd(), "skills"));
  candidates.push(join(homedir(), ".copilot", "skills"));

  for (const dir of candidates) {
    const file = join(dir, skill, "SKILL.md");
    if (existsSync(file)) return file;
  }

  throw new Error(
    `Skill ${JSON.stringify(skill)} not found. Searched:\n` +
      candidates.map((d) => `  - ${join(d, skill, "SKILL.md")}`).join("\n"),
  );
}

/**
 * `copilot.skill` — Thin alias over the `copilot` command that guarantees a
 * named skill's instructions are active by loading `<skillsDir>/<name>/SKILL.md`
 * and forwarding its body as the `--system` prompt. Unlike relying on the
 * agent to auto-trigger a skill from its description, this guarantees the
 * skill instructions are in effect for the call.
 */
export function createCopilotSkillCommand(
  getClient: () => CopilotBridgeClient,
  ensureStarted: () => Promise<void>,
): LobsterCommand {
  const copilot = createCopilotCommand(getClient, ensureStarted);

  return {
    name: "copilot.skill",
    meta: {
      description: "Send a prompt to Copilot with a named skill's instructions injected as the system prompt",
      argsSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Skill name (folder under skills/)" },
          prompt: { type: "string", description: "The prompt to send" },
          model: { type: "string", description: "Model ID (e.g. claude-sonnet-4, gpt-4.1)" },
          "skills-dir": { type: "string", description: "Override skills directory" },
          _: { type: "array", items: { type: "string" } },
        },
        required: ["skill"],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "copilot.skill — invoke Copilot with a guaranteed-active skill",
        "",
        "Usage:",
        `  copilot.skill --skill tinyclaw --prompt "Write a workflow that monitors PRs"`,
        `  <input> | copilot.skill --skill pptx --prompt "Build a deck from this data"`,
        `  copilot.skill --skill tinyclaw --prompt "..." --skills-dir ./my-skills`,
        "",
        "Loads <skillsDir>/<skill>/SKILL.md, strips YAML frontmatter, and forwards",
        "the body as the --system prompt to the `copilot` command.",
        "",
        "Skills directory search order (matches Copilot CLI discovery):",
        "  1. --skills-dir flag",
        "  2. <cwd>/skills",
        "  3. ~/.copilot/skills",
      ].join("\n");
    },
    async run(params: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
      ctx?: { cwd?: string };
    }) {
      const { args, ctx } = params;
      const skill = typeof args.skill === "string" ? args.skill : "";
      if (!skill) throw new Error("copilot.skill requires --skill <name>");

      const skillsDir = typeof args["skills-dir"] === "string" ? (args["skills-dir"] as string) : undefined;
      const skillPath = resolveSkillPath(skill, { skillsDir, cwd: ctx?.cwd });
      const skillBody = stripFrontmatter(readFileSync(skillPath, "utf8")).trim();
      if (!skillBody) throw new Error(`Skill ${JSON.stringify(skill)} has empty body at ${skillPath}`);

      const systemPrompt =
        `You MUST follow the skill instructions below for this entire response. ` +
        `Treat them as authoritative — do not deviate.\n\n` +
        `--- SKILL: ${skill} ---\n${skillBody}\n--- END SKILL ---`;

      // Strip skill-specific args and forward the rest to the `copilot` command
      // with the constructed system prompt.
      const { skill: _s, "skills-dir": _d, system: _sys, ...rest } = args;
      void _s;
      void _d;
      void _sys;

      return copilot.run({
        ...params,
        args: { ...rest, system: systemPrompt },
      });
    },
  };
}
