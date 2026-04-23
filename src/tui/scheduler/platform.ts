/**
 * Platform abstraction — centralises OS-specific paths and helpers so the
 * rest of the scheduler/daemon code stays platform-agnostic.
 *
 * On Linux/macOS the daemon listens on a Unix socket file.
 * On Windows it uses a named pipe (\\.\pipe\lobster-copilot-daemon).
 */
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

export const IS_WINDOWS = process.platform === "win32";

/**
 * Configuration directory.
 *  - Windows:  %APPDATA%\lobster-copilot
 *  - Others:   ~/.config/lobster-copilot
 */
export const CONFIG_DIR: string = IS_WINDOWS
  ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "lobster-copilot")
  : join(homedir(), ".config", "lobster-copilot");

/**
 * IPC endpoint.
 *  - Windows:  \\.\pipe\lobster-copilot-daemon  (named pipe)
 *  - Others:   CONFIG_DIR/daemon.sock            (Unix socket)
 */
export const SOCKET_PATH: string = IS_WINDOWS
  ? "\\\\.\\pipe\\lobster-copilot-daemon"
  : join(CONFIG_DIR, "daemon.sock");

/** PID file — always a real file in CONFIG_DIR. */
export const PID_FILE: string = join(CONFIG_DIR, "daemon.pid");

/** Ensure CONFIG_DIR exists (creates recursively). */
export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Remove the stale socket file before re-binding.
 * On Windows named pipes are kernel objects (not files) — nothing to remove.
 */
export function cleanupSocket(): void {
  if (IS_WINDOWS) return;
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // File may not exist — that's fine.
  }
}

/**
 * Check whether a process with the given PID is still alive.
 * Uses signal-0 probe (works cross-platform in Node.js).
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to kill a process by PID.
 * On Windows `SIGTERM` is translated to a `TerminateProcess` call by Node.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  process.kill(pid, signal);
}
