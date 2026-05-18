/**
 * Gallery manifest types and fetch logic.
 *
 * Fetches the sample workflow manifest from a remote URL (GitHub raw content),
 * caches it locally with a configurable TTL, and falls back to the cached or
 * bundled manifest when offline.
 */
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GallerySample {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Path relative to gallery/ in the repo */
  file: string;
  args: string[];
  tags: string[];
}

export interface GalleryManifest {
  version: number;
  samples: GallerySample[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_WINDOWS = process.platform === "win32";

const CACHE_DIR: string = IS_WINDOWS
  ? join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "tinyclaw",
      "cache",
    )
  : join(homedir(), ".config", "tinyclaw", "cache");

const CACHE_FILE = join(CACHE_DIR, "gallery-manifest.json");

/** Cache TTL in milliseconds (default: 1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Path to the bundled manifest shipped with the package.
 * Resolves to `<pkg>/gallery/manifest.json` relative to this source file.
 */
const BUNDLED_MANIFEST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "gallery",
  "manifest.json",
);

/**
 * Base URL for fetching gallery assets from the repo.
 * Override with `TINYCLAW_GALLERY_URL` env var for testing.
 */
function baseUrl(): string {
  return (
    process.env.TINYCLAW_GALLERY_URL ??
    "https://raw.githubusercontent.com/nicholasgasior/tinyclaw/main/gallery"
  );
}

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

function isCacheValid(): boolean {
  try {
    const stat = statSync(CACHE_FILE);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function readCache(): GalleryManifest | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw) as GalleryManifest;
  } catch {
    return null;
  }
}

function writeCache(manifest: GalleryManifest): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(manifest), "utf8");
  } catch {
    // Best-effort caching — don't fail the gallery.
  }
}

/**
 * Read the bundled manifest shipped with the package.
 */
function readBundled(): GalleryManifest | null {
  try {
    const raw = readFileSync(BUNDLED_MANIFEST, "utf8");
    return JSON.parse(raw) as GalleryManifest;
  } catch {
    return null;
  }
}

/**
 * Fetch the gallery manifest.
 *
 * Resolution order:
 * 1. Local cache (if within TTL)
 * 2. Remote fetch from GitHub
 * 3. Stale cache (if remote fails)
 * 4. Bundled manifest (shipped with package)
 * 5. Empty manifest (last resort)
 */
export async function fetchManifest(): Promise<GalleryManifest> {
  // 1. Fresh cache
  if (isCacheValid()) {
    const cached = readCache();
    if (cached) return cached;
  }

  // 2. Remote fetch
  try {
    const url = `${baseUrl()}/manifest.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const manifest = (await res.json()) as GalleryManifest;
      writeCache(manifest);
      return manifest;
    }
  } catch {
    // Network error — fall through.
  }

  // 3. Stale cache
  const stale = readCache();
  if (stale) return stale;

  // 4. Bundled manifest (shipped with the package)
  const bundled = readBundled();
  if (bundled) return bundled;

  // 5. Empty manifest (last resort)
  return { version: 1, samples: [] };
}

/**
 * Fetch the raw YAML content for a gallery sample.
 * Falls back to the bundled file if the remote fetch fails.
 */
export async function fetchSampleContent(
  sample: GallerySample,
): Promise<string> {
  // 1. Try remote fetch
  try {
    const url = `${baseUrl()}/${sample.file}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      return res.text();
    }
  } catch {
    // Network error — fall through to bundled.
  }

  // 2. Try bundled local file
  const bundledPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "gallery",
    sample.file,
  );
  try {
    return readFileSync(bundledPath, "utf8");
  } catch {
    throw new Error(
      `Failed to fetch sample "${sample.name}": not available remotely or locally`,
    );
  }
}

// ---------------------------------------------------------------------------
// Search / filter helpers
// ---------------------------------------------------------------------------

/**
 * Filter samples by a search query (matches name, description, category, tags).
 */
export function filterSamples(
  samples: GallerySample[],
  query: string,
): GallerySample[] {
  if (!query.trim()) return samples;
  const q = query.toLowerCase();
  return samples.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/**
 * Get unique categories from a list of samples.
 */
export function getCategories(samples: GallerySample[]): string[] {
  return [...new Set(samples.map((s) => s.category))].sort();
}
