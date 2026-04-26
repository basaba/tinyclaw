/**
 * Azure DevOps PR List — fetch PRs via `az repos pr list`
 *
 * Standalone helper (no Lobster SDK dependency) so it can be used
 * directly from the tinyclaw CLI or scheduler.
 */

import { spawn } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

function runAz(
  argv: string[],
  opts: { env?: Record<string, string | undefined> },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // On Windows, `az` is a `.cmd` shim that requires shell execution.
    // Using shell with args array triggers DEP0190, so we build a single
    // command string with properly quoted arguments instead.
    let child;
    if (IS_WINDOWS) {
      const quoted = argv.map((a) => `"${a}"`).join(" ");
      child = spawn(`az ${quoted}`, {
        env: opts.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
    } else {
      child = spawn("az", argv, {
        env: opts.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("az CLI not found on PATH — install Azure CLI"));
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`az exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export interface AdoPrListOptions {
  org: string;
  project: string;
  repository?: string;
  sourceBranch?: string;
  targetBranch?: string;
  creator?: string;
  reviewer?: string;
  status?: "active" | "completed" | "abandoned" | "all";
  top?: number;
}

/**
 * Fetch Azure DevOps PRs matching the given filters.
 * Returns the parsed JSON array from `az repos pr list`.
 */
export async function fetchAdoPrs(
  options: AdoPrListOptions,
  env?: Record<string, string | undefined>,
): Promise<any[]> {
  const argv = [
    "repos", "pr", "list",
    "--org", options.org,
    "--project", options.project,
    "--output", "json",
  ];

  if (options.repository) argv.push("--repository", options.repository);
  if (options.sourceBranch) argv.push("--source-branch", options.sourceBranch);
  if (options.targetBranch) argv.push("--target-branch", options.targetBranch);
  if (options.creator) argv.push("--creator", options.creator);
  if (options.reviewer) argv.push("--reviewer", options.reviewer);
  if (options.status) argv.push("--status", options.status);
  if (options.top) argv.push("--top", String(options.top));

  const { stdout } = await runAz(argv, { env });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`az returned non-JSON output: ${stdout.trim().slice(0, 200)}`);
  }

  return Array.isArray(parsed) ? parsed : [];
}
