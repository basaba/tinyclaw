import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { DaemonClient } from "./scheduler/daemon-client.js";
import { spawnDaemon } from "./scheduler/spawn.js";

export async function startTui(): Promise<void> {
  const client = new DaemonClient();

  if (!DaemonClient.isDaemonRunning()) {
    const pid = spawnDaemon();
    if (!pid) {
      process.exit(1);
    }
    // Give the daemon a moment to bind the socket
    await new Promise((r) => setTimeout(r, 500));
  }

  // Retry connection a few times (daemon may still be starting)
  let connected = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await client.connect();
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!connected) {
    process.exit(1);
  }

  // Enter alternate screen buffer (like vim/htop)
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[H");

  const instance = render(<App client={client} />);

  await instance.waitUntilExit();

  // Leave alternate screen buffer
  process.stdout.write("\x1b[?1049l");
}
