/**
 * Spawn the scheduler daemon as a detached background process.
 * Returns the child PID, or null if already running.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "./daemon-client.js";

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

  const execArgs = isTsx
    ? [join(PROJECT_ROOT, "node_modules", ".bin", "tsx"), daemonScript]
    : [process.execPath, daemonScript];

  const child = spawn(execArgs[0], execArgs.slice(1), {
    detached: true,
    stdio: "ignore",
    cwd: PROJECT_ROOT,
  });
  child.unref();
  return child.pid ?? null;
}
