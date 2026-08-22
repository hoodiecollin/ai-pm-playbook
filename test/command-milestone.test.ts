/**
 * `milestone` — the exit codes matter because three failure modes would otherwise all print
 * something that looks like an answer: no mirror, no such milestone, and a mirror that does not
 * cover the milestone.
 */

import { describe, expect, test } from "bun:test";

import { seedBacklog, tempRepoRoot, entity } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { milestone } from "../src/commands/milestone.js";
import { backlogRoot } from "../src/lib/backlog/store.js";
import { writeCoverage, mergeCoverage, UNKNOWN } from "../src/lib/backlog/coverage.js";
import { EVERYTHING, parseScope } from "../src/lib/backlog/scope.js";
import { SUMMARY_HEADING } from "../src/lib/backlog/summary.js";

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  const write = process.stdout.write.bind(process.stdout);
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = () => {};
  (process.stdout as { write: unknown }).write = (s: unknown) => { lines.push(String(s)); return true; };
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
    (process.stdout as { write: unknown }).write = write;
  }
}

const MILESTONES = [{ number: 1, title: "v1.0.0", state: "open" }];
const body = `### ${SUMMARY_HEADING}\n\nWhat this is.\n\n### Detail\n\nMore.\n`;

/** A mirror covering everything, which is the ordinary case. */
function fullMirror(entities = [entity({ number: 1, milestone: "v1.0.0", body })]) {
  const root = tempRepoRoot();
  seedBacklog(root, entities, { base: "match", milestones: MILESTONES });
  writeCoverage(backlogRoot(root), mergeCoverage(UNKNOWN, EVERYTHING, new Set()));
  return root;
}

describe("milestone — preconditions", () => {
  test("no mirror at all is exit 2, naming pull", async () => {
    const { code } = await capture(() => milestone(parseArgs([]), tempRepoRoot(), "v1.0.0"));
    expect(code).toBe(2);
  });

  test("a milestone that does not exist is exit 2, not an empty report", async () => {
    const { code } = await capture(() => milestone(parseArgs([]), fullMirror(), "v9.9.9"));
    expect(code).toBe(2);
  });

  test("a real but empty milestone is exit 0 and says nothing is open", async () => {
    const root = fullMirror([entity({ number: 1, milestone: null, body })]);
    const { code, out } = await capture(() => milestone(parseArgs([]), root, "v1.0.0"));
    expect(code).toBe(0);
    expect(out).toContain("Nothing open");
  });

  test("with no argument it reports the cycle in flight", async () => {
    const { code, out } = await capture(() => milestone(parseArgs([]), fullMirror(), undefined));
    expect(code).toBe(0);
    expect(out).toContain("v1.0.0");
  });
});

describe("milestone — coverage", () => {
  test("a mirror that does not cover the milestone is exit 2, not a partial answer", async () => {
    // The one failure this command must not have: reporting a subset as a milestone's remaining
    // work. The mirror here holds the issue but coverage never recorded it.
    const root = tempRepoRoot();
    seedBacklog(root, [entity({ number: 1, milestone: "v1.0.0", body })], {
      base: "match", milestones: MILESTONES,
    });
    const scoped = parseScope(parseArgs(["--milestone", "v2.0.0"]));
    if ("error" in scoped) throw new Error(scoped.error);
    writeCoverage(backlogRoot(root), mergeCoverage(UNKNOWN, scoped, new Set([99])));

    const { code } = await capture(() => milestone(parseArgs([]), root, "v1.0.0"));
    expect(code).toBe(2);
  });

  test("a mirror scoped to exactly this milestone is accepted", async () => {
    const root = tempRepoRoot();
    seedBacklog(root, [entity({ number: 1, milestone: "v1.0.0", body })], {
      base: "match", milestones: MILESTONES,
    });
    const scoped = parseScope(parseArgs(["--milestone", "v1.0.0"]));
    if ("error" in scoped) throw new Error(scoped.error);
    writeCoverage(backlogRoot(root), mergeCoverage(UNKNOWN, scoped, new Set([1])));

    const { code } = await capture(() => milestone(parseArgs([]), root, "v1.0.0"));
    expect(code).toBe(0);
  });
});

describe("milestone — output", () => {
  test("--json emits the model and exits 0", async () => {
    const { code, out } = await capture(() => milestone(parseArgs(["--json"]), fullMirror(), "v1.0.0"));
    expect(code).toBe(0);
    const model = JSON.parse(out);
    expect(model.milestone).toBe("v1.0.0");
    expect(model.buckets[0].improvements[0].number).toBe(1);
  });

  test("the block is emitted verbatim and identically across runs", async () => {
    const root = fullMirror();
    const a = await capture(() => milestone(parseArgs([]), root, "v1.0.0"));
    const b = await capture(() => milestone(parseArgs([]), root, "v1.0.0"));
    expect(a.out).toBe(b.out);
  });
});
