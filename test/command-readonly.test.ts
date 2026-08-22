/**
 * `ladder`, `release-check` and `scope-check` — the three commands that only ever read.
 *
 * `release-check`'s exit code is the whole command: 1 means "this milestone cannot be tagged", and
 * a release workflow that reads it wrong ships anyway.
 */

import { describe, expect, test } from "bun:test";

import { installFakeGh } from "./support/fake-gh.js";
import { tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { ladder } from "../src/commands/ladder.js";
import { releaseCheck } from "../src/commands/release-check.js";
import { scopeCheck } from "../src/commands/scope-check.js";
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

describe("ladder — derives the rung from gate state", () => {
  test("an ungated milestoned improvement reads design-next, exit 0", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, parentage: parentageOf([issue(1, ["improvement"], "v1.0.0")]) });

    const { code, out } = await capture(() =>
      ladder(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot()));

    expect(code).toBe(0);
    const items = JSON.parse(out).items ?? JSON.parse(out);
    expect(JSON.stringify(items)).toContain("design-next");
  });

  test("an unmilestoned improvement reads idea — a milestone means committed", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, parentage: parentageOf([issue(1, ["improvement"], null)]) });

    const { out } = await capture(() =>
      ladder(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot()));
    expect(out).toContain("idea");
  });

  test("ladder never mutates", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, parentage: parentageOf([issue(1, ["improvement"], "v1.0.0")]) });
    await capture(() => ladder(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot()));
    expect(gh.mutations()).toEqual([]);
  });
});

describe("release-check — the exit code IS the answer", () => {
  test("an open release-gate on the milestone is exit 1", async () => {
    gh.reset();
    gh.set({
      milestones: CYCLE,
      issues: [issue(1, ["release-gate"], "v1.0.0")],
      parentage: parentageOf([issue(1, ["release-gate"], "v1.0.0")]),
    });

    const { code } = await capture(() =>
      releaseCheck(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "v1.0.0"));
    expect(code).toBe(1);
  });

  test("open work on the milestone is exit 1", async () => {
    gh.reset();
    gh.set({
      milestones: CYCLE,
      issues: [issue(1, ["improvement"], "v1.0.0")],
      parentage: parentageOf([issue(1, ["improvement"], "v1.0.0")]),
    });

    const { code } = await capture(() =>
      releaseCheck(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "v1.0.0"));
    expect(code).toBe(1);
  });

  test("nothing open on the milestone is exit 0", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, issues: [], parentage: parentageOf([]) });

    const { code } = await capture(() =>
      releaseCheck(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "v1.0.0"));
    expect(code).toBe(0);
  });

  test("release-check never mutates", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, issues: [], parentage: parentageOf([]) });
    await capture(() => releaseCheck(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "v1.0.0"));
    expect(gh.mutations()).toEqual([]);
  });
});

describe("scope-check — the cycle-scope gate (§5.3)", () => {
  const scope = (baseRefName: string, closing: { number: number; milestone: string | null }[]) => ({
    number: 1,
    title: "a pull request",
    baseRefName,
    closing: closing.map((c) => ({
      number: c.number, title: `issue ${c.number}`,
      url: `https://example.invalid/${c.number}`, milestone: c.milestone,
    })),
    mentioned: [],
  });

  test("a PR to main is not gated — the rule is about the integration branch", async () => {
    gh.reset();
    gh.set({ milestones: CYCLE, prScope: scope("main", [{ number: 5, milestone: "v2.0.0" }]) });

    const { code, out } = await capture(() =>
      scopeCheck(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "1"));

    expect(code).toBe(0);
    expect(out).toContain("does not apply");
    // It bails before spending the two extra API calls the gate would need.
    expect(gh.callsTo("listIssues")).toEqual([]);
  });

  test("a PR to develop closing work past the cycle is exit 1 (PM008)", async () => {
    gh.reset();
    gh.set({
      milestones: [{ number: 1, title: "v1.0.0", state: "open" }, { number: 2, title: "v2.0.0", state: "open" }],
      issues: [],
      prScope: scope("develop", [{ number: 5, milestone: "v2.0.0" }]),
    });

    const { code, out } = await capture(() =>
      scopeCheck(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot(), "1"));

    expect(code).toBe(1);
    expect(JSON.parse(out).violations.map((v: { rule: string }) => v.rule)).toContain("PM008");
  });

  test("a PR to develop closing work on the cycle is exit 0", async () => {
    gh.reset();
    gh.set({
      milestones: [{ number: 1, title: "v1.0.0", state: "open" }, { number: 2, title: "v2.0.0", state: "open" }],
      issues: [],
      prScope: scope("develop", [{ number: 5, milestone: "v1.0.0" }]),
    });

    const { code } = await capture(() =>
      scopeCheck(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot(), "1"));

    expect(code).toBe(0);
    expect(gh.mutations()).toEqual([]);
  });
});
