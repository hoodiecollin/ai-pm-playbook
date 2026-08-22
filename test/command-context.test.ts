/**
 * `context` — its failure modes all have to be exit 2, because a short pack looks exactly like a
 * complete one. That is the failure the command exists to fix, one level down.
 */

import { describe, expect, test } from "bun:test";

import { entity, seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { context } from "../src/commands/context.js";
import { backlogRoot } from "../src/lib/backlog/store.js";
import { mergeCoverage, writeCoverage, UNKNOWN } from "../src/lib/backlog/coverage.js";
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

const body = `### ${SUMMARY_HEADING}\n\nWhat this is.\n`;

function mirror(entities = [entity({ number: 1, body }), entity({ number: 2, body: `${body}\nsee #1\n` })]) {
  const root = tempRepoRoot();
  seedBacklog(root, entities, { base: "match" });
  writeCoverage(backlogRoot(root), mergeCoverage(UNKNOWN, EVERYTHING, new Set()));
  return root;
}

describe("context — refusals", () => {
  test("no issue argument is exit 2", async () => {
    expect((await capture(() => context(parseArgs([]), mirror(), undefined))).code).toBe(2);
  });

  test("a non-numeric issue is exit 2", async () => {
    expect((await capture(() => context(parseArgs([]), mirror(), "abc"))).code).toBe(2);
  });

  test("no mirror is exit 2, naming pull", async () => {
    expect((await capture(() => context(parseArgs([]), tempRepoRoot(), "1"))).code).toBe(2);
  });

  test("an issue not in the mirror is exit 2", async () => {
    expect((await capture(() => context(parseArgs([]), mirror(), "999"))).code).toBe(2);
  });

  test("a mirror that does not cover the neighbourhood is exit 2 — a short roster reads as whole", async () => {
    const root = tempRepoRoot();
    seedBacklog(root, [entity({ number: 1, body }), entity({ number: 2, body: `${body}\nsee #1\n` })], {
      base: "match",
    });
    const scoped = parseScope(parseArgs(["--milestone", "v1.0.0"]));
    if ("error" in scoped) throw new Error(scoped.error);
    // Covers the subject but NOT its neighbour.
    writeCoverage(backlogRoot(root), mergeCoverage(UNKNOWN, scoped, new Set([1])));

    expect((await capture(() => context(parseArgs([]), root, "1"))).code).toBe(2);
  });

  test("a non-numeric --budget is exit 2 rather than a silently huge pack", async () => {
    const { code } = await capture(() => context(parseArgs(["--budget", "lots"]), mirror(), "1"));
    expect(code).toBe(2);
  });
});

describe("context — the pack", () => {
  test("emits the subject, its summary, and the roster", async () => {
    const { code, out } = await capture(() => context(parseArgs([]), mirror(), "1"));
    expect(code).toBe(0);
    expect(out).toContain("Context for #1");
    expect(out).toContain("What this is.");
    expect(out).toContain("#2 [");
  });

  test("an issue with no neighbours says so rather than printing an empty section", async () => {
    const root = mirror([entity({ number: 1, body })]);
    const { code, out } = await capture(() => context(parseArgs([]), root, "1"));
    expect(code).toBe(0);
    expect(out).toContain("Nothing else in the backlog");
  });

  test("--json emits the neighbours and exits 0", async () => {
    const { code, out } = await capture(() => context(parseArgs(["--json"]), mirror(), "1"));
    expect(code).toBe(0);
    const model = JSON.parse(out);
    expect(model.subject).toBe(1);
    expect(model.neighbours[0].number).toBe(2);
  });

  test("the pack is identical across runs", async () => {
    const root = mirror();
    const a = await capture(() => context(parseArgs([]), root, "1"));
    const b = await capture(() => context(parseArgs([]), root, "1"));
    expect(a.out).toBe(b.out);
  });
});
