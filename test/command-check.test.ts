/**
 * `check` — the command whose exit code is most likely to be consumed by a script, and the one
 * where a wrong code is least visible to a human reading the output.
 *
 * The offline tier needs no fake at all, which makes it the cheapest real assertion in the suite.
 */

import { describe, expect, test } from "bun:test";

import { installFakeGh } from "./support/fake-gh.js";
import { entity, seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { check } from "../src/commands/check.js";

const gh = installFakeGh();

/** Capture stdout for the run, since `--json` writes the whole report there. */
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

const MILESTONES = [{ number: 1, title: "v1.0.0", state: "open" }];

describe("check --no-remote — lints the mirror, no network", () => {
  test("a clean mirror is exit 0", async () => {
    const root = tempRepoRoot();
    seedBacklog(root, [entity({ number: 1, labels: ["improvement"] })], {
      base: "match",
      milestones: MILESTONES,
    });
    const { code } = await capture(() => check(parseArgs(["--no-remote"]), root));
    expect(code).toBe(0);
  });

  test("a violation in the mirror is exit 1, and --json says so", async () => {
    const root = tempRepoRoot();
    // PM003: an experiment never carries a milestone (§4).
    seedBacklog(root, [entity({ number: 1, labels: ["experiment"], milestone: "v1.0.0" })], {
      base: "match",
      milestones: MILESTONES,
    });

    const { code, out } = await capture(() => check(parseArgs(["--no-remote", "--json"]), root));
    expect(code).toBe(1);

    const report = JSON.parse(out);
    expect(report.ok).toBe(false);
    expect(report.violations.map((v: { rule: string }) => v.rule)).toContain("PM003");
    expect(report.counts.error).toBeGreaterThan(0);
  });

  test("every violation carries an executable fix — the agent-facing contract", async () => {
    const root = tempRepoRoot();
    seedBacklog(root, [entity({ number: 1, labels: ["experiment"], milestone: "v1.0.0" })], {
      base: "match",
      milestones: MILESTONES,
    });
    const { out } = await capture(() => check(parseArgs(["--no-remote", "--json"]), root));
    for (const v of JSON.parse(out).violations) {
      expect(typeof v.fix).toBe("string");
      expect(v.fix.length).toBeGreaterThan(0);
    }
  });
});

describe("check --strict — warnings become failures", () => {
  test("a warning alone is exit 0 without --strict and 1 with it", async () => {
    const root = tempRepoRoot();
    // An epic with no native sub-issues is PM007, a warning.
    seedBacklog(root, [entity({ number: 1, labels: ["epic"], kind: "epic" })], {
      base: "match",
      milestones: MILESTONES,
    });

    const lenient = await capture(() => check(parseArgs(["--no-remote", "--json"]), root));
    const report = JSON.parse(lenient.out);
    // Guard the premise: this fixture must produce warnings and no errors, or the test is vacuous.
    expect(report.counts.error).toBe(0);
    expect(report.counts.warn).toBeGreaterThan(0);
    expect(lenient.code).toBe(0);

    const strict = await capture(() => check(parseArgs(["--no-remote", "--json", "--strict"]), root));
    expect(strict.code).toBe(1);
  });
});

describe("check — networked tier", () => {
  test("reads through the faked gh layer and never shells out", async () => {
    gh.reset();
    gh.set({
      issues: [{
        number: 1, title: "an experiment", state: "OPEN",
        url: "https://example.invalid/1", labels: ["experiment"], milestone: "v1.0.0",
      }],
      milestones: MILESTONES,
    });

    const { code, out } = await capture(() =>
      check(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot()));

    expect(code).toBe(1);
    expect(JSON.parse(out).violations.map((v: { rule: string }) => v.rule)).toContain("PM003");
    expect(gh.callsTo("listIssues")).toHaveLength(1);
    // Structural rules need the tree; without this fetch they would pass by not running.
    expect(gh.callsTo("fetchParentage")).toHaveLength(1);
  });

  test("check never mutates, on any path", async () => {
    gh.reset();
    gh.set({ issues: [], milestones: MILESTONES });
    await capture(() => check(parseArgs(["--repo", "owner/repo", "--json"]), tempRepoRoot()));
    expect(gh.mutations()).toEqual([]);
  });
});
