import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 200;
const YAML_RE = /\.ya?ml$/;

/**
 * Recursively scan directories for YAML files.
 * Returns absolute paths so workflows work regardless of where the TUI is opened.
 */
export function scanYamlFiles(
  baseDirs: string[],
  maxDepth = DEFAULT_MAX_DEPTH,
  maxFiles = DEFAULT_MAX_FILES,
): string[] {
  const results: string[] = [];

  for (const dir of baseDirs) {
    if (results.length >= maxFiles) break;
    walk(resolve(dir), 0, maxDepth, maxFiles, results);
  }

  return results;
}

function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  maxFiles: number,
  results: string[],
): void {
  if (depth > maxDepth || results.length >= maxFiles) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
    if (results.length >= maxFiles) return;

    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(full, depth + 1, maxDepth, maxFiles, results);
    } else if (stat.isFile() && YAML_RE.test(entry)) {
      results.push(full);
    }
  }
}

/**
 * Fuzzy-match a query against candidate paths.
 * Returns matching candidates sorted by relevance (best first).
 */
export function fuzzyMatch(query: string, candidates: string[]): string[] {
  if (!query) return candidates.slice(0, 10);

  const lower = query.toLowerCase();
  const scored: Array<{ path: string; score: number }> = [];

  for (const c of candidates) {
    const cl = c.toLowerCase();
    // Exact substring match
    const idx = cl.indexOf(lower);
    if (idx >= 0) {
      // Prefer matches at path segment boundaries and earlier positions
      const segBonus = idx === 0 || cl[idx - 1] === "/" ? 10 : 0;
      scored.push({ path: c, score: 100 - idx + segBonus });
      continue;
    }
    // Character-by-character fuzzy match
    const s = fuzzyScore(lower, cl);
    if (s > 0) {
      scored.push({ path: c, score: s });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.path);
}

function fuzzyScore(query: string, target: string): number {
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      score += 1;
      // Consecutive matches get bonus
      if (lastMatchIdx === ti - 1) score += 2;
      // Segment boundary bonus
      if (ti === 0 || target[ti - 1] === "/" || target[ti - 1] === "-") score += 1;
      lastMatchIdx = ti;
      qi++;
    }
  }

  // All query chars must match
  return qi === query.length ? score : 0;
}

/** Check whether a path resolves to an existing file. */
export function fileExists(path: string): boolean {
  try {
    const resolved = resolve(path);
    return existsSync(resolved) && statSync(resolved).isFile();
  } catch {
    return false;
  }
}

/**
 * Shorten an absolute path for display purposes.
 * Replaces home directory with ~ and uses relative path if under cwd.
 */
export function shortenPath(absPath: string): string {
  const cwd = process.cwd();
  const rel = relative(cwd, absPath);
  // If the relative path doesn't start with "..", it's under cwd — use it
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    return rel || absPath;
  }
  // Otherwise, try replacing home dir with ~
  const home = homedir();
  if (absPath.startsWith(home)) {
    return "~" + absPath.slice(home.length);
  }
  return absPath;
}

function isAbsolute(p: string): boolean {
  return /^[/\\]|^[a-zA-Z]:/.test(p);
}
