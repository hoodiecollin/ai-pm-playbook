/**
 * Scope membership and the three fixed laws (#61).
 *
 * The gate scenarios are the ones worth reading closely: they are what a naive label filter or a
 * milestone-field match gets wrong, and getting them wrong means fetching a work item without its
 * gates — not a smaller answer, a wrong one.
 */

import { describe, expect, test } from "bun:test";

import { EVERYTHING, describeScope, expand, isMember, parseScope, type Scope } from "../src/lib/backlog/scope.js";
import { parseArgs } from "../src/lib/args.js";
import type { BacklogEntity, EntityKind } from "../src/lib/backlog/model.js";

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

const scope = (args: string[]): Scope => {
  const r = parseScope(parseArgs(args));
  if ("error" in r) throw new Error(`unexpected parse error: ${r.error}`);
  return r;
};

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("parseScope", () => {
  test("no flags is everything", () => {
    expect(scope([])).toEqual(EVERYTHING);
  });

  test("two targets at once is an error — a scope names one thing", () => {
    const r = parseScope(parseArgs(["--milestone", "v1.0.0", "--epic", "3"]));
    expect(r).toHaveProperty("error");
  });

  test("a non-numeric epic is an error", () => {
    expect(parseScope(parseArgs(["--epic", "abc"]))).toHaveProperty("error");
  });

  test("an unknown --type is an error naming the valid set", () => {
    const r = parseScope(parseArgs(["--type", "feature"])) as { error: string };
    expect(r.error).toContain("improvement");
  });

  test("--type takes a comma-separated list", () => {
    expect([...scope(["--type", "improvement,bugfix"]).kinds].sort()).toEqual(["bugfix", "improvement"]);
  });

  test("`--type experiment` with `--milestone` is a usage error, not an empty result", () => {
    // PM003 makes the set empty by construction, and an empty success is indistinguishable from
    // "already current".
    const r = parseScope(parseArgs(["--type", "experiment", "--milestone", "v1.0.0"])) as { error: string };
    expect(r.error).toContain("PM003");
  });

  test("`--type experiment` without a milestone is fine", () => {
    expect(parseScope(parseArgs(["--type", "experiment"]))).not.toHaveProperty("error");
  });
});

describe("describeScope — the coverage record has to be readable", () => {
  test("names the target and the kinds", () => {
    expect(describeScope(scope(["--milestone", "v1.0.0"]))).toBe("milestone v1.0.0");
    expect(describeScope(scope(["--epic", "3", "--type", "bugfix"]))).toBe("epic #3 (bugfix)");
    expect(describeScope(EVERYTHING)).toBe("the whole backlog");
  });
});

describe("milestone membership is a field match, not a traversal", () => {
  test("issues carrying the milestone are members", () => {
    const on = entity({ number: 1, milestone: "v1.0.0" });
    const off = entity({ number: 2, milestone: "v2.0.0" });
    expect(sorted(expand([on, off], scope(["--milestone", "v1.0.0"])))).toEqual([1]);
  });

  test("an epic whose CHILDREN are on the milestone is not itself a MEMBER", () => {
    // Children carry their own milestones; an epic spans releases (PM012's rationale).
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic", milestone: null });
    const child = entity({ number: 2, parent: 1, kind: "subissue", milestone: "v1.0.0" });
    expect(isMember(epic, scope(["--milestone", "v1.0.0"]))).toBe(false);
  });

  test("...but it is still COVERED, because the child cannot be written without it", () => {
    // A sub-issue's path is epics/<epic>/subissues/<n>. Not a membership claim, a mechanical one —
    // found by running a scoped pull against this repo, where #51 sits on a milestone epic #3 does
    // not carry, and the write failed rather than producing a wrong tree.
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic", milestone: null });
    const child = entity({ number: 2, parent: 1, kind: "subissue", milestone: "v1.0.0" });
    expect(sorted(expand([epic, child], scope(["--milestone", "v1.0.0"])))).toEqual([1, 2]);
  });
});

describe("an epic target brings its children", () => {
  test("the epic and every child, whatever their milestones", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const a = entity({ number: 2, parent: 1, kind: "subissue", milestone: "v1.0.0" });
    const b = entity({ number: 3, parent: 1, kind: "subissue", milestone: "v9.0.0" });
    const other = entity({ number: 4 });
    expect(sorted(expand([epic, a, b, other], scope(["--epic", "1"])))).toEqual([1, 2, 3]);
  });

  test("children arrive even when the kind filter would exclude them", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const child = entity({ number: 2, parent: 1, kind: "subissue", labels: ["bugfix"] });
    expect(sorted(expand([epic, child], scope(["--epic", "1", "--type", "epic"])))).toEqual([1, 2]);
  });
});

describe("gates ride with their parent — always", () => {
  const parent = () => entity({ number: 1, labels: ["improvement"], milestone: "v1.0.0" });
  const gate = (n: number, milestone: string | null = "v1.0.0") =>
    entity({ number: n, parent: 1, kind: "gate", labels: [`improvement:gate-${n - 1}`], milestone });

  test("a member's gates are covered", () => {
    expect(sorted(expand([parent(), gate(2), gate(3)], scope(["--milestone", "v1.0.0"])))).toEqual([1, 2, 3]);
  });

  test("a gate rides along even when the kind filter excludes its own label", () => {
    // The case a naive label filter gets wrong: a gate carries `improvement:gate-1`, not
    // `improvement`, so filtering on kind would drop exactly the children completeness needs.
    expect(sorted(expand([parent(), gate(2)], scope(["--milestone", "v1.0.0", "--type", "improvement"]))))
      .toEqual([1, 2]);
  });

  test("a gate whose milestone disagrees with its parent's still rides along", () => {
    // Gate membership is never derived from the milestone field — it was wrong for three issues in
    // this repository until PM011 caught it.
    expect(sorted(expand([parent(), gate(2, null)], scope(["--milestone", "v1.0.0"])))).toEqual([1, 2]);
  });

  test("a gate is never a member on its own account", () => {
    const orphanGate = entity({ number: 9, parent: 99, kind: "gate", labels: ["improvement:gate-1"], milestone: "v1.0.0" });
    expect(isMember(orphanGate, scope(["--milestone", "v1.0.0"]))).toBe(false);
    expect(sorted(expand([orphanGate], scope(["--milestone", "v1.0.0"])))).toEqual([]);
  });

  test("gates of an epic's children ride along too — two levels, one pass", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const child = entity({ number: 2, parent: 1, kind: "subissue" });
    const childGate = entity({ number: 3, parent: 2, kind: "gate", labels: ["improvement:gate-1"] });
    expect(sorted(expand([epic, child, childGate], scope(["--epic", "1"])))).toEqual([1, 2, 3]);
  });
});

describe("unparented", () => {
  test("covers work under no epic, and not the epics themselves", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const child = entity({ number: 2, parent: 1, kind: "subissue" });
    const standalone = entity({ number: 3 });
    expect(sorted(expand([epic, child, standalone], scope(["--unparented"])))).toEqual([3]);
  });
});

describe("everything", () => {
  test("covers every entity, gates included", () => {
    const all = [
      entity({ number: 1 }),
      entity({ number: 2, parent: 1, kind: "gate", labels: ["improvement:gate-1"] }),
      entity({ number: 3, labels: ["epic"], kind: "epic" }),
    ];
    expect(sorted(expand(all, EVERYTHING))).toEqual([1, 2, 3]);
  });
});
