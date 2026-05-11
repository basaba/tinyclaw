/**
 * Launcher for the TinyClaw desktop UI — spawns Electron with the main process.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function startUi(): Promise<void> {
  // Resolve the Electron binary from the installed package
  let electronPath: string;
  try {
    // electron package exports a string path to the binary
    const electronMod = await import("electron");
    electronPath = (electronMod.default ?? electronMod) as unknown as string;
  } catch {
    console.error("Error: electron is not installed. Run: npm install electron");
    process.exit(1);
  }

  const mainScript = join(__dirname, "main", "index.js");

  console.error("Starting TinyClaw Desktop UI…");
  const child = spawn(electronPath, [mainScript], {
    stdio: "inherit",
    detached: false,
    windowsHide: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
