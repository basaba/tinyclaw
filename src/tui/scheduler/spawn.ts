/**
 * Spawn the scheduler daemon as a detached background process.
 * Returns the child PID, or null if already running.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "./daemon-client.js";
import { IS_WINDOWS } from "./platform.js";

// Resolve paths relative to THIS file's location (src/tui/scheduler/)
const SCHEDULER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCHEDULER_DIR, "..", "..", "..");

export function spawnDaemon(): number | null {
  if (DaemonClient.isDaemonRunning()) {
    return DaemonClient.getDaemonPid();
  }

  const isTsx = import.meta.url.endsWith(".ts");
  const daemonScript = join(
    SCHEDULER_DIR,
    isTsx ? "daemon.ts" : "daemon.js",
  );

  // On Windows npm .bin shims are .cmd files — need shell: true to execute them.
  const tsxBin = join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const execArgs = isTsx
    ? IS_WINDOWS
      ? [tsxBin, daemonScript]
      : [tsxBin, daemonScript]
    : [process.execPath, daemonScript];

  const child = spawn(execArgs[0], execArgs.slice(1), {
    detached: true,
    stdio: "ignore",
    cwd: PROJECT_ROOT,
    // Windows .cmd shims require shell to resolve; on Unix direct exec is fine
    ...(IS_WINDOWS && isTsx ? { shell: true } : {}),
  });
  child.unref();
  return child.pid ?? null;
}
