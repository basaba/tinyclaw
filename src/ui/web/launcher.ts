/**
 * Launcher for the TinyClaw web UI server. Invoked from `tinyclaw web`.
 */
import { startWebServer } from "./server.js";

export interface WebLauncherOptions {
  port?: number;
  host?: string;
}

export async function startWeb(opts: WebLauncherOptions = {}): Promise<void> {
  await startWebServer(opts);
  // Keep the process alive
  await new Promise<void>(() => {});
}
