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
    // Prefer pwsh over cmd.exe to avoid Defender false positives (ClickFix).
    let child;
    if (IS_WINDOWS) {
      const shellOverride = (opts.env?.LOBSTER_SHELL ?? process.env.LOBSTER_SHELL ?? "").trim();
      if (shellOverride && /pwsh|powershell/i.test(shellOverride)) {
        const escaped = argv.map((a) => `'${a.replace(/'/g, "''")}'`).join(" ");
        child = spawn(shellOverride, ["-NoProfile", "-Command", `& az ${escaped}`], {
          env: opts.env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        const quoted = argv.map((a) => `"${a}"`).join(" ");
        child = spawn(`az ${quoted}`, {
          env: opts.env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        });
      }
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
  /** One or more PR creators to filter by (comma-separated or array). */
  creator?: string | string[];
  reviewer?: string;
  status?: "active" | "completed" | "abandoned" | "all";
  top?: number;
}

/**
 * Fetch Azure DevOps PRs matching the given filters.
 * Returns the parsed JSON array from `az repos pr list`.
 */
/** Normalize creator option into an array (splits comma-separated strings). */
export function normalizeCreators(
  creator: string | string[] | undefined,
): string[] {
  if (!creator) return [];
  const raw = Array.isArray(creator) ? creator : [creator];
  return raw.flatMap((c) => c.split(",")).map((c) => c.trim()).filter(Boolean);
}

/**
 * Fetch Azure DevOps PRs matching the given filters.
 * Returns the parsed JSON array from `az repos pr list`.
 *
 * When multiple creators are specified the CLI is called once per creator
 * and results are deduplicated by `pullRequestId`.
 */
export async function fetchAdoPrs(
  options: AdoPrListOptions,
  env?: Record<string, string | undefined>,
): Promise<any[]> {
  const creators = normalizeCreators(options.creator);

  // Build base argv (without --creator)
  const baseArgv = [
    "repos", "pr", "list",
    "--org", options.org,
    "--project", options.project,
    "--output", "json",
  ];
  if (options.repository) baseArgv.push("--repository", options.repository);
  if (options.sourceBranch) baseArgv.push("--source-branch", options.sourceBranch);
  if (options.targetBranch) baseArgv.push("--target-branch", options.targetBranch);
  if (options.reviewer) baseArgv.push("--reviewer", options.reviewer);
  if (options.status) baseArgv.push("--status", options.status);
  if (options.top) baseArgv.push("--top", String(options.top));

  async function fetchOnce(argv: string[]): Promise<any[]> {
    const { stdout } = await runAz(argv, { env });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`az returned non-JSON output: ${stdout.trim().slice(0, 200)}`);
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  if (creators.length <= 1) {
    const argv = [...baseArgv];
    if (creators.length === 1) argv.push("--creator", creators[0]);
    return fetchOnce(argv);
  }

  // Multiple creators: fetch in parallel, deduplicate by pullRequestId
  const batches = await Promise.all(
    creators.map((c) => fetchOnce([...baseArgv, "--creator", c])),
  );
  const seen = new Set<number>();
  const merged: any[] = [];
  for (const batch of batches) {
    for (const pr of batch) {
      const id = pr?.pullRequestId;
      if (id != null && !seen.has(id)) {
        seen.add(id);
        merged.push(pr);
      }
    }
  }
  return merged;
}
