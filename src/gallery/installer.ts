/**
 * Gallery installer — downloads sample workflow YAML and saves to
 * the user's local workflows directory (~/.tinyclaw/workflows/).
 */
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fetchSampleContent, type GallerySample } from "./manifest.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_WINDOWS = process.platform === "win32";

export const WORKFLOWS_DIR: string = IS_WINDOWS
  ? join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "tinyclaw",
      "workflows",
    )
  : join(homedir(), ".config", "tinyclaw", "workflows");

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface InstallResult {
  success: boolean;
  filePath: string;
  alreadyExists: boolean;
  error?: string;
}

/**
 * Install a gallery sample to the local workflows directory.
 *
 * @param sample   The gallery sample to install.
 * @param overwrite  If true, overwrite existing files. Default: false.
 * @returns  Result of the install operation.
 */
export async function installSample(
  sample: GallerySample,
  overwrite = false,
): Promise<InstallResult> {
  const filename = basename(sample.file);
  const destPath = join(WORKFLOWS_DIR, filename);

  if (existsSync(destPath) && !overwrite) {
    return {
      success: false,
      filePath: destPath,
      alreadyExists: true,
      error: `File already exists: ${destPath}`,
    };
  }

  try {
    const content = await fetchSampleContent(sample);

    if (!existsSync(WORKFLOWS_DIR)) {
      mkdirSync(WORKFLOWS_DIR, { recursive: true });
    }

    writeFileSync(destPath, content, "utf8");

    return {
      success: true,
      filePath: destPath,
      alreadyExists: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      filePath: destPath,
      alreadyExists: false,
      error: message,
    };
  }
}

/**
 * Check if a sample is already installed.
 */
export function isSampleInstalled(sample: GallerySample): boolean {
  const filename = basename(sample.file);
  return existsSync(join(WORKFLOWS_DIR, filename));
}
