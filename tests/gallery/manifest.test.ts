import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  filterSamples,
  getCategories,
  type GallerySample,
} from "../../src/gallery/manifest.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLES: GallerySample[] = [
  {
    id: "ado-pr-monitor",
    name: "ADO PR Monitor",
    description: "Monitor Azure DevOps pull requests",
    category: "ado",
    file: "samples/ado/pr-monitor.yaml",
    args: ["org", "project"],
    tags: ["azure-devops", "pull-request"],
  },
  {
    id: "mail-digest",
    name: "Mail Digest",
    description: "Summarize unread emails",
    category: "mail",
    file: "samples/mail/mail-digest.yaml",
    args: [],
    tags: ["email", "summary"],
  },
  {
    id: "approval-demo",
    name: "Approval Demo",
    description: "Interactive approval gate example",
    category: "general",
    file: "samples/general/approval-demo.yaml",
    args: [],
    tags: ["approval", "demo"],
  },
];

// ---------------------------------------------------------------------------
// filterSamples
// ---------------------------------------------------------------------------

describe("filterSamples", () => {
  it("returns all samples for empty query", () => {
    expect(filterSamples(SAMPLES, "")).toEqual(SAMPLES);
    expect(filterSamples(SAMPLES, "   ")).toEqual(SAMPLES);
  });

  it("matches by name (case-insensitive)", () => {
    const result = filterSamples(SAMPLES, "mail digest");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mail-digest");
  });

  it("matches by description", () => {
    const result = filterSamples(SAMPLES, "pull requests");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ado-pr-monitor");
  });

  it("matches by category", () => {
    const result = filterSamples(SAMPLES, "general");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("approval-demo");
  });

  it("matches by tag", () => {
    const result = filterSamples(SAMPLES, "email");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mail-digest");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterSamples(SAMPLES, "nonexistent-xyz")).toEqual([]);
  });

  it("matches partial strings", () => {
    const result = filterSamples(SAMPLES, "approv");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("approval-demo");
  });
});

// ---------------------------------------------------------------------------
// getCategories
// ---------------------------------------------------------------------------

describe("getCategories", () => {
  it("returns sorted unique categories", () => {
    expect(getCategories(SAMPLES)).toEqual(["ado", "general", "mail"]);
  });

  it("returns empty array for no samples", () => {
    expect(getCategories([])).toEqual([]);
  });

  it("deduplicates categories", () => {
    const duped = [...SAMPLES, { ...SAMPLES[0], id: "ado-other" }];
    const cats = getCategories(duped);
    expect(cats.filter((c) => c === "ado")).toHaveLength(1);
  });
});
