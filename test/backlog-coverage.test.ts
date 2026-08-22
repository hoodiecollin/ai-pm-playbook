/**
 * The mirror describing its own coverage, and the three mechanisms that read absence as deletion.
 *
 * The scoped cases here are the ones that would destroy a mirror silently. Each has an unscoped
 * twin asserting that today's behavior is untouched — a diff that changes the unscoped path is
 * wrong regardless of what the scoped assertions say.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describes, mergeCoverage, readCoverage, shortfall, writeCoverage, UNKNOWN } from "../src/lib/backlog/coverage.js";
import { EVERYTHING, expand, parseScope } from "../src/lib/backlog/scope.js";
import { parseArgs } from "../src/lib/args.js";
import { planSync } from "../src/lib/backlog/plan.js";
import { projectionHash } from "../src/lib/backlog/project.js";
import { readIndex, readTree, writeIndex, writeTree } from "../src/lib/backlog/store.js";
import type { BacklogEntity, EntityKind } from "../src/lib/backlog/model.js";

const root = () => mkdtempSync(join(tmpdir(), "pm-coverage-"));

let counter = 0;
function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  counter += 1;
  const kind: EntityKind = partial.kind ?? "standalone";
  return {
    number: counter, kind, parent: null, title: `entity ${counter}`,
    state: "OPEN", labels: ["improvement"], milestone: null, body: "", comments: [],
    ...partial,
  };
}

const scope = (args: string[]) => {
  const r = parseScope(parseArgs(args));
  if ("error" in r) throw new Error(r.error);
  return r;
};

const asMap = (es: BacklogEntity[]) => new Map(es.map((e) => [e.number, e]));
const hashes = (es: BacklogEntity[]) => new Map(es.map((e) => [e.number, projectionHash(e)]));

describe("planSync — absence means deletion ONLY within the covered set", () => {
  const a = entity({ number: 1 });
  const b = entity({ number: 2 });

  test("an out-of-scope entity absent from the fetch is unchanged, never removed", () => {
    // The hazard in one assertion: without the covered set, #2 reads as deleted upstream and the
    // next write destroys it.
    const plan = planSync(hashes([a, b]), asMap([a, b]), asMap([a]), new Set([1]));
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toContain(2);
  });

  test("an IN-scope entity absent from the fetch IS removed — the exemption must not widen", () => {
    const plan = planSync(hashes([a, b]), asMap([a, b]), asMap([a]), new Set([1, 2]));
    expect(plan.remove).toEqual([2]);
  });

  test("unscoped behavior is unchanged", () => {
    const plan = planSync(hashes([a, b]), asMap([a, b]), asMap([a]));
    expect(plan.remove).toEqual([2]);
  });
});

describe("writeTree — prunes only within the covered set", () => {
  test("an out-of-scope directory survives a scoped write", () => {
    const dir = root();
    const a = entity({ number: 1 });
    const b = entity({ number: 2 });
    writeTree(dir, asMap([a, b]));
    expect(readTree(dir).size).toBe(2);

    // A scoped refresh that saw only #1 must not delete #2.
    const stale = writeTree(dir, asMap([a]), new Set([1]));
    expect(stale).toEqual([]);
    expect([...readTree(dir).keys()].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  test("an in-scope entity that MOVED is still pruned — closing renders a new path", () => {
    const dir = root();
    const open = entity({ number: 1, state: "OPEN" });
    writeTree(dir, asMap([open]));
    const closed = { ...open, state: "CLOSED" as const };

    const stale = writeTree(dir, asMap([closed]), new Set([1]));
    expect(stale.length).toBe(1);
    // Exactly one copy on disk, not two.
    expect(readTree(dir).size).toBe(1);
    expect(readTree(dir).get(1)!.state).toBe("CLOSED");
  });

  test("unscoped pruning is unchanged", () => {
    const dir = root();
    writeTree(dir, asMap([entity({ number: 1 }), entity({ number: 2 })]));
    writeTree(dir, asMap([entity({ number: 1 })]));
    expect(readTree(dir).size).toBe(1);
  });
});

describe("writeIndex — merges under a scope, replaces otherwise", () => {
  test("a scoped write preserves out-of-scope base hashes", () => {
    const dir = root();
    const a = entity({ number: 1 });
    const b = entity({ number: 2 });
    writeIndex(dir, hashes([a, b]), "o/r");

    writeIndex(dir, hashes([a]), "o/r", true);
    // Losing #2's base is what makes a pending local edit stop being recognisable as one.
    expect([...readIndex(dir).keys()].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  test("an unscoped write still replaces", () => {
    const dir = root();
    writeIndex(dir, hashes([entity({ number: 1 }), entity({ number: 2 })]), "o/r");
    writeIndex(dir, hashes([entity({ number: 1 })]), "o/r");
    expect([...readIndex(dir).keys()]).toEqual([1]);
  });
});

describe("the coverage record", () => {
  test("no record at all is unknown, which is not the same as empty", () => {
    const dir = root();
    expect(readCoverage(dir)).toEqual(UNKNOWN);
    expect(shortfall(readCoverage(dir))).toContain("no coverage record");
  });

  test("a full pull records everything and has no shortfall", () => {
    const dir = root();
    writeCoverage(dir, mergeCoverage(UNKNOWN, EVERYTHING, new Set([1, 2])));
    expect(readCoverage(dir).everything).toBe(true);
    expect(shortfall(readCoverage(dir))).toBeNull();
  });

  test("two scoped pulls union rather than replace — a later narrow pull does not shrink coverage", () => {
    const dir = root();
    let c = mergeCoverage(UNKNOWN, scope(["--milestone", "v1.0.0"]), new Set([1, 2]));
    c = mergeCoverage(c, scope(["--milestone", "v2.0.0"]), new Set([3]));
    writeCoverage(dir, c);

    const read = readCoverage(dir);
    expect([...read.covered].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(read.scopes).toHaveLength(2);
  });

  test("a full pull supersedes prior partial records rather than being unioned with them", () => {
    let c = mergeCoverage(UNKNOWN, scope(["--milestone", "v1.0.0"]), new Set([1]));
    c = mergeCoverage(c, EVERYTHING, new Set([1, 2, 3]));
    expect(c.everything).toBe(true);
    expect(c.scopes).toEqual(["the whole backlog"]);
  });

  test("a scoped pull onto an already-complete mirror leaves it complete", () => {
    let c = mergeCoverage(UNKNOWN, EVERYTHING, new Set([1, 2]));
    c = mergeCoverage(c, scope(["--milestone", "v1.0.0"]), new Set([1]));
    expect(c.everything).toBe(true);
  });

  test("describes() answers whether a scope is covered", () => {
    const c = mergeCoverage(UNKNOWN, scope(["--milestone", "v1.0.0"]), new Set([1, 2]));
    expect(describes(c, new Set([1, 2]))).toBe(true);
    expect(describes(c, new Set([1, 3]))).toBe(false);
    expect(describes(mergeCoverage(UNKNOWN, EVERYTHING, new Set()), new Set([99]))).toBe(true);
  });

  test("the file is written under .sync/, where the pruner cannot reach it", () => {
    const dir = root();
    writeCoverage(dir, mergeCoverage(UNKNOWN, scope(["--milestone", "v1.0.0"]), new Set([1])));
    expect(existsSync(join(dir, ".sync", "coverage.json"))).toBe(true);
    // The tree walk excludes .sync/, so a subsequent scoped write must not remove it.
    writeTree(dir, asMap([entity({ number: 1 })]), new Set([1]));
    expect(existsSync(join(dir, ".sync", "coverage.json"))).toBe(true);
  });
});

describe("expand feeds the covered set that protects all three", () => {
  test("a milestone scope covers its members and their gates, and nothing else", () => {
    const on = entity({ number: 1, milestone: "v1.0.0" });
    const gate = entity({ number: 2, parent: 1, kind: "gate", labels: ["improvement:gate-1"], milestone: "v1.0.0" });
    const off = entity({ number: 3, milestone: "v2.0.0" });
    expect([...expand([on, gate, off], scope(["--milestone", "v1.0.0"]))].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
