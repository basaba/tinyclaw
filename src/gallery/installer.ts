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
  /** Arg defaults extracted from the workflow YAML (name → default value). */
  argDefaults?: Record<string, string>;
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
      argDefaults: parseArgsDefaults(content),
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

// ---------------------------------------------------------------------------
// YAML arg-default extraction (lightweight, no YAML parser dependency)
// ---------------------------------------------------------------------------

/**
 * Extract arg defaults from workflow YAML content.
 *
 * Parses the `args:` block to find each arg's `default:` value.
 * Returns a map of arg name → default value (string). Args without
 * a default are included with an empty string.
 *
 * Expected YAML structure:
 * ```yaml
 * args:
 *   argName:
 *     description: "..."
 *     default: "value"
 * ```
 */
export function parseArgsDefaults(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const result: Record<string, string> = {};

  // Find the `args:` top-level key
  let i = 0;
  while (i < lines.length) {
    if (/^args:\s*$/.test(lines[i])) {
      i++;
      break;
    }
    i++;
  }
  if (i >= lines.length) return result;

  // Parse arg entries (indented under `args:`)
  let currentArg: string | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // Stop if we hit a non-indented line (next top-level key or blank followed by top-level)
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) break;

    // Arg name line: "  argName:" (2-space indent, no further nesting)
    const argNameMatch = line.match(/^[ \t]{2}(\w[\w-]*):\s*$/);
    if (argNameMatch) {
      currentArg = argNameMatch[1];
      result[currentArg] = "";
      i++;
      continue;
    }

    // Arg with inline value: "  argName: value" (simple scalar arg, no sub-keys)
    const argInlineMatch = line.match(/^[ \t]{2}(\w[\w-]*):\s+(.+)$/);
    if (argInlineMatch && !argInlineMatch[2].startsWith("{")) {
      // This is a simple arg like `argName: defaultValue` (shorthand without description)
      currentArg = argInlineMatch[1];
      result[currentArg] = unquote(argInlineMatch[2]);
      i++;
      continue;
    }

    // Default value line: "    default: value" (4-space indent under current arg)
    if (currentArg) {
      const defaultMatch = line.match(/^[ \t]{4}default:\s+(.+)$/);
      if (defaultMatch) {
        const val = unquote(defaultMatch[1].trim());
        if (val !== "null" && val !== "~") {
          result[currentArg] = val;
        }
        i++;
        continue;
      }
    }

    i++;
  }

  return result;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
