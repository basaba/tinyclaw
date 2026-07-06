import { describe, it, expect, vi, beforeEach } from "vitest";

const loadHistory = vi.fn();
const loadSchedules = vi.fn();

vi.mock("../../src/tui/scheduler/config.js", () => ({
  loadHistory: () => loadHistory(),
  loadSchedules: () => loadSchedules(),
}));

const { createSchedRunsCommand, parseSinceMs } = await import(
  "../../src/commands/sched-runs.js"
);

const emptyInput: AsyncIterable<unknown> = {
  async *[Symbol.asyncIterator]() {},
};

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function run(id: string, workflowId: string, status: string, triggeredAt: string) {
  return {
    id,
    workflowId,
    triggeredBy: "schedule",
    triggeredAt,
    status,
    input: { filePath: `C:/wf/${workflowId}.yaml`, schedule: "every 1h" },
  };
}

beforeEach(() => {
  loadHistory.mockReset();
  loadSchedules.mockReset();
  loadSchedules.mockReturnValue({
    workflows: [
      { id: "wf-a", name: "Alpha", filePath: "C:/wf/a.yaml", schedule: "every 1h", enabled: true },
      { id: "wf-b", name: "Beta", filePath: "C:/wf/b.yaml", schedule: "every 1h", enabled: true },
    ],
  });
});

describe("parseSinceMs", () => {
  it("parses units", () => {
    expect(parseSinceMs("30s")).toBe(30_000);
    expect(parseSinceMs("5m")).toBe(300_000);
    expect(parseSinceMs("2h")).toBe(7_200_000);
    expect(parseSinceMs("1d")).toBe(86_400_000);
  });
  it("returns null for garbage", () => {
    expect(parseSinceMs("later")).toBeNull();
  });
});

describe("sched.runs command", () => {
  it("has correct name and meta", () => {
    const cmd = createSchedRunsCommand();
    expect(cmd.name).toBe("sched.runs");
    expect(cmd.meta?.sideEffects).toContain("filesystem");
  });

  it("defaults to failures only (error,rejected) and enriches workflowName", async () => {
    loadHistory.mockReturnValue({
      runs: [
        run("1", "wf-a", "success", "2026-01-01T10:00:00Z"),
        run("2", "wf-a", "error", "2026-01-01T09:00:00Z"),
        run("3", "wf-b", "rejected", "2026-01-01T08:00:00Z"),
      ],
    });
    const cmd = createSchedRunsCommand();
    const { output } = await cmd.run({ input: emptyInput, args: {} });
    const items = await collect(output);
    expect(items.map((i) => i.status).sort()).toEqual(["error", "rejected"]);
    const alpha = items.find((i) => i.workflowId === "wf-a");
    expect(alpha.workflowName).toBe("Alpha");
  });

  it("filters by explicit status and workflow", async () => {
    loadHistory.mockReturnValue({
      runs: [
        run("1", "wf-a", "success", "2026-01-01T10:00:00Z"),
        run("2", "wf-b", "success", "2026-01-01T09:00:00Z"),
      ],
    });
    const cmd = createSchedRunsCommand();
    const { output } = await cmd.run({
      input: emptyInput,
      args: { status: "success", workflow: "wf-a" },
    });
    const items = await collect(output);
    expect(items).toHaveLength(1);
    expect(items[0].workflowId).toBe("wf-a");
  });

  it("--latest keeps only the newest run per workflow, ignoring status filter", async () => {
    loadHistory.mockReturnValue({
      runs: [
        run("1", "wf-a", "success", "2026-01-01T12:00:00Z"),
        run("2", "wf-a", "error", "2026-01-01T11:00:00Z"),
        run("3", "wf-b", "error", "2026-01-01T10:00:00Z"),
      ],
    });
    const cmd = createSchedRunsCommand();
    const { output } = await cmd.run({ input: emptyInput, args: { latest: true } });
    const items = await collect(output);
    expect(items).toHaveLength(2);
    const alpha = items.find((i) => i.workflowId === "wf-a");
    // Newest wf-a run is the success — even though a later status filter default
    // would exclude successes.
    expect(alpha.status).toBe("success");
    expect(alpha.id).toBe("1");
    const beta = items.find((i) => i.workflowId === "wf-b");
    expect(beta.status).toBe("error");
  });

  it("respects --limit", async () => {
    loadHistory.mockReturnValue({
      runs: [
        run("1", "wf-a", "error", "2026-01-01T12:00:00Z"),
        run("2", "wf-a", "error", "2026-01-01T11:00:00Z"),
        run("3", "wf-a", "error", "2026-01-01T10:00:00Z"),
      ],
    });
    const cmd = createSchedRunsCommand();
    const { output } = await cmd.run({ input: emptyInput, args: { limit: 2 } });
    expect(await collect(output)).toHaveLength(2);
  });
});
