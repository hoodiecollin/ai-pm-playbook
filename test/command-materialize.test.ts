/**
 * `materialize` — creates issues on GitHub, so its preview path is the one that most needs proving.
 *
 * It is also the only command that both creates and links, and the link is what makes a partial
 * failure recoverable, so "created N and linked N" is asserted rather than "created N".
 */

import { describe, expect, test } from "bun:test";

import { installFakeGh } from "./support/fake-gh.js";
import { tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { materialize } from "../src/commands/materialize.js";
import type { Issue } from "../src/lib/gh.js";
import type { Parentage } from "../src/lib/invariants.js";

const gh = installFakeGh();

const issue = (number: number, labels: string[], milestone: string | null, state = "OPEN"): Issue => ({
  number, title: `issue ${number}`, state, url: `https://example.invalid/${number}`, labels, milestone,
});

const parentageOf = (issues: Issue[], parentOf = new Map<number, number>()): Parentage => ({
  parentOf,
  all: new Map(issues.map((i) => [i.number, i])),
});

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = () => {};
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const CYCLE = [{ number: 1, title: "v1.0.0", state: "open" }];

/** One ungated improvement on the cycle in flight — three gates pending. */
function ungated() {
  return {
    milestones: CYCLE,
    parentage: parentageOf([issue(1, ["improvement"], "v1.0.0")]),
  };
}

const run = (argv: string[]) =>
  capture(() => materialize(parseArgs(["--repo", "owner/repo", ...argv]), tempRepoRoot()));

describe("materialize — preview creates nothing", () => {
  test("names the gates it would create and mutates nothing", async () => {
    gh.reset();
    gh.set(ungated());

    const { code, out } = await run([]);
    expect(code).toBe(0);
    expect(out).toContain("improvement:gate-1");
    expect(out).toContain("3 gate(s) to materialize");
    expect(gh.mutations()).toEqual([]);
  });

  test("--json previews without mutating", async () => {
    gh.reset();
    gh.set(ungated());

    const { code, out } = await run(["--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out).create).toHaveLength(3);
    expect(gh.mutations()).toEqual([]);
  });
});

describe("materialize --yes — creates and links", () => {
  test("one createIssue and one addSubIssue per gate, under the right parent", async () => {
    gh.reset();
    gh.set({ ...ungated(), nextIssueNumber: 100 });

    const { code } = await run(["--yes"]);
    expect(code).toBe(0);

    expect(gh.callsTo("createIssue")).toHaveLength(3);
    const links = gh.callsTo("addSubIssue");
    expect(links).toHaveLength(3);
    // Every link names the work item as parent — an unlinked gate is invisible to PM013.
    for (const link of links) expect(link.args[1]).toBe(1);
  });

  test("a gate inherits its parent's milestone — PM011 depends on it", async () => {
    gh.reset();
    gh.set({ ...ungated(), nextIssueNumber: 100 });

    await run(["--yes"]);
    for (const call of gh.callsTo("createIssue")) {
      expect((call.args[1] as { milestone: string | null }).milestone).toBe("v1.0.0");
    }
  });
});

describe("materialize — idempotence", () => {
  test("a complete gate set is a no-op, not a duplicate", async () => {
    gh.reset();
    const parent = issue(1, ["improvement"], "v1.0.0");
    const gates = [
      issue(2, ["improvement:gate-1"], "v1.0.0"),
      issue(3, ["improvement:gate-2"], "v1.0.0"),
      issue(4, ["improvement:gate-3"], "v1.0.0"),
    ];
    gh.set({
      milestones: CYCLE,
      parentage: parentageOf([parent, ...gates], new Map([[2, 1], [3, 1], [4, 1]])),
    });

    const { code, out } = await run(["--yes"]);
    expect(code).toBe(0);
    expect(out).toContain("already carry their complete gate set");
    expect(gh.mutations()).toEqual([]);
  });
});

describe("materialize — usage", () => {
  test("no open core milestone is exit 2, not a silent no-op", async () => {
    gh.reset();
    gh.set({ milestones: [], parentage: parentageOf([]) });
    const { code } = await run([]);
    expect(code).toBe(2);
  });
});
