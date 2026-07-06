import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the gh CLI by intercepting execFile. promisify(execFile) resolves to the
// value passed to the callback, so we hand back { stdout }.
const ghCalls: string[][] = [];
let issuesInRepo: Array<{ number: number; state: string; body: string; url: string }> = [];
let nextIssueNumber = 100;

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, res: { stdout: string; stderr: string }) => void,
  ) => {
    ghCalls.push(args);
    let stdout = "";
    const sub = args[0];
    const action = args[1];
    if (sub === "issue" && action === "list") {
      stdout = JSON.stringify(issuesInRepo);
    } else if (sub === "issue" && action === "create") {
      const bodyIdx = args.indexOf("--body");
      const body = bodyIdx >= 0 ? args[bodyIdx + 1] : "";
      const number = nextIssueNumber++;
      const url = `https://github.com/o/r/issues/${number}`;
      issuesInRepo.push({ number, state: "open", body, url });
      stdout = url + "\n";
    } else if (sub === "issue" && (action === "close" || action === "reopen")) {
      const number = Number(args[2]);
      const it = issuesInRepo.find((i) => i.number === number);
      if (it) it.state = action === "close" ? "closed" : "open";
    } else if (sub === "issue" && action === "edit") {
      const number = Number(args[2]);
      const bodyIdx = args.indexOf("--body");
      const it = issuesInRepo.find((i) => i.number === number);
      if (it && bodyIdx >= 0) it.body = args[bodyIdx + 1];
    }
    cb(null, { stdout, stderr: "" });
  },
}));

const { createGithubIssueUpsertCommand } = await import(
  "../../src/commands/github-issue.js"
);

const emptyInput: AsyncIterable<unknown> = {
  async *[Symbol.asyncIterator]() {},
};

function inputOf(...items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function record(workflowId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    workflowId,
    workflowName: workflowId.toUpperCase(),
    status,
    triggeredAt: new Date().toISOString(),
    ...extra,
  };
}

beforeEach(() => {
  ghCalls.length = 0;
  issuesInRepo = [];
  nextIssueNumber = 100;
});

describe("github.issue.upsert command", () => {
  it("has correct name and requires repo", async () => {
    const cmd = createGithubIssueUpsertCommand();
    expect(cmd.name).toBe("github.issue.upsert");
    await expect(cmd.run({ input: emptyInput, args: {} })).rejects.toThrow(/--repo/);
  });

  it("creates an issue for a failure when none exists", async () => {
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(record("wf-a", "error", { error: "boom" })),
      args: { repo: "o/r" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("created");
    expect(issuesInRepo).toHaveLength(1);
    expect(issuesInRepo[0].body).toContain("<!-- tinyclaw:key=wf-a -->");
  });

  it("comments (not duplicates) when an issue already exists", async () => {
    issuesInRepo.push({
      number: 5,
      state: "open",
      body: "<!-- tinyclaw:key=wf-a -->\nold",
      url: "https://github.com/o/r/issues/5",
    });
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(record("wf-a", "error")),
      args: { repo: "o/r" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("commented");
    expect(res.issueNumber).toBe(5);
    expect(ghCalls.some((a) => a[0] === "issue" && a[1] === "create")).toBe(false);
  });

  it("dedups multiple failures of the same workflow into a single create", async () => {
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(
        record("wf-a", "error", { triggeredAt: "2026-01-01T09:00:00Z" }),
        record("wf-a", "error", { triggeredAt: "2026-01-01T10:00:00Z" }),
        record("wf-a", "error", { triggeredAt: "2026-01-01T08:00:00Z" }),
      ),
      args: { repo: "o/r" },
    });
    const results = await collect(output);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("created");
    const creates = ghCalls.filter((a) => a[0] === "issue" && a[1] === "create");
    expect(creates).toHaveLength(1);
  });

  it("closes an open issue on recovery (success)", async () => {
    issuesInRepo.push({
      number: 7,
      state: "open",
      body: "<!-- tinyclaw:key=wf-a -->\nfailing",
      url: "https://github.com/o/r/issues/7",
    });
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(record("wf-a", "success")),
      args: { repo: "o/r" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("closed");
    expect(issuesInRepo[0].state).toBe("closed");
  });

  it("reopens a closed issue when the workflow fails again", async () => {
    issuesInRepo.push({
      number: 9,
      state: "closed",
      body: "<!-- tinyclaw:key=wf-a -->\nresolved",
      url: "https://github.com/o/r/issues/9",
    });
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(record("wf-a", "error")),
      args: { repo: "o/r" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("reopened");
    expect(issuesInRepo[0].state).toBe("open");
  });

  it("noops on success when no issue exists", async () => {
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: inputOf(record("wf-a", "success")),
      args: { repo: "o/r" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("noop");
    expect(issuesInRepo).toHaveLength(0);
  });

  it("supports the single-run flag form (no piped input)", async () => {
    const cmd = createGithubIssueUpsertCommand();
    const { output } = await cmd.run({
      input: emptyInput,
      args: { repo: "o/r", workflow: "wf-z", status: "error", error: "flag failure" },
    });
    const [res] = await collect(output);
    expect(res.action).toBe("created");
    expect(issuesInRepo[0].body).toContain("<!-- tinyclaw:key=wf-z -->");
  });

  describe("--mode status", () => {
    it("creates a persistent issue for a healthy workflow", async () => {
      const cmd = createGithubIssueUpsertCommand();
      const { output } = await cmd.run({
        input: inputOf(record("wf-a", "success")),
        args: { repo: "o/r", mode: "status" },
      });
      const [res] = await collect(output);
      expect(res.action).toBe("created");
      expect(issuesInRepo).toHaveLength(1);
      expect(issuesInRepo[0].body).toContain("<!-- tinyclaw:status=success -->");
    });

    it("updates an existing status issue in place without closing it", async () => {
      issuesInRepo.push({
        number: 3,
        state: "open",
        body: "<!-- tinyclaw:key=wf-a -->\n<!-- tinyclaw:status=success -->\nold",
        url: "https://github.com/o/r/issues/3",
      });
      const cmd = createGithubIssueUpsertCommand();
      const { output } = await cmd.run({
        input: inputOf(record("wf-a", "error", { error: "broke" })),
        args: { repo: "o/r", mode: "status" },
      });
      const [res] = await collect(output);
      expect(res.action).toBe("updated");
      expect(issuesInRepo[0].state).toBe("open"); // never closed
      expect(issuesInRepo[0].body).toContain("<!-- tinyclaw:status=error -->");
      // Edited in place — no duplicate issue.
      expect(issuesInRepo).toHaveLength(1);
      // Transition success→error posts a comment.
      expect(ghCalls.some((a) => a[0] === "issue" && a[1] === "comment")).toBe(true);
    });

    it("does not comment when status is unchanged", async () => {
      issuesInRepo.push({
        number: 4,
        state: "open",
        body: "<!-- tinyclaw:key=wf-a -->\n<!-- tinyclaw:status=success -->\nok",
        url: "https://github.com/o/r/issues/4",
      });
      const cmd = createGithubIssueUpsertCommand();
      const { output } = await cmd.run({
        input: inputOf(record("wf-a", "success")),
        args: { repo: "o/r", mode: "status" },
      });
      const [res] = await collect(output);
      expect(res.action).toBe("updated");
      expect(ghCalls.some((a) => a[0] === "issue" && a[1] === "comment")).toBe(false);
    });

    it("ignores a transient running run (no create, no comment)", async () => {
      const cmd = createGithubIssueUpsertCommand();
      const { output } = await cmd.run({
        input: inputOf(record("wf-a", "running")),
        args: { repo: "o/r", mode: "status" },
      });
      const [res] = await collect(output);
      expect(res.action).toBe("noop");
      expect(issuesInRepo).toHaveLength(0);
      expect(ghCalls.some((a) => a[0] === "issue" && a[1] === "comment")).toBe(false);
    });

    it("reopens a manually-closed status issue to keep it live", async () => {
      issuesInRepo.push({
        number: 6,
        state: "closed",
        body: "<!-- tinyclaw:key=wf-a -->\n<!-- tinyclaw:status=success -->\nx",
        url: "https://github.com/o/r/issues/6",
      });
      const cmd = createGithubIssueUpsertCommand();
      const { output } = await cmd.run({
        input: inputOf(record("wf-a", "success")),
        args: { repo: "o/r", mode: "status" },
      });
      const [res] = await collect(output);
      expect(res.action).toBe("updated");
      expect(issuesInRepo[0].state).toBe("open");
    });
  });
});
