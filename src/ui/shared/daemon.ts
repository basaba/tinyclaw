/**
 * Shared helper for connecting to the TinyClaw scheduler daemon.
 * Used by both the Electron main process and the web server.
 */
import { DaemonClient } from "../../tui/scheduler/daemon-client.js";
import { spawnDaemon } from "../../tui/scheduler/spawn.js";

export interface ConnectOptions {
  /** How many connection attempts to make before giving up. Default 5. */
  retries?: number;
  /** Delay (ms) between connection attempts. Default 500. */
  retryDelayMs?: number;
  /** Optional logger (defaults to console.error). */
  log?: (msg: string) => void;
}

/**
 * Spawn the daemon if it's not already running, then connect.
 * Throws if it cannot connect after `retries` attempts.
 */
export async function connectToDaemon(opts: ConnectOptions = {}): Promise<DaemonClient> {
  const retries = opts.retries ?? 5;
  const delay = opts.retryDelayMs ?? 500;
  const log = opts.log ?? ((m) => console.error(m));

  const client = new DaemonClient();

  if (!DaemonClient.isDaemonRunning()) {
    log("Daemon not running, starting…");
    const pid = spawnDaemon();
    if (pid) log(`Daemon started (pid ${pid}).`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await client.connect();
      log("Connected to TinyClaw daemon");
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(`Cannot connect to daemon after ${retries} attempts.`);
}
