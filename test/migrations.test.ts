/**
 * Label migrations are the riskiest code in the package — they mutate a consumer's real backlog —
 * so the planner is pure and tested against fixtures rather than exercised against GitHub.
 */

import { describe, expect, test } from "bun:test";

import {
  MIGRATIONS, compareSemver, pendingMigrations, planMigrations, type Migration,
} from "../src/lib/migrations.js";

const FIXTURES: Migration[] = [
  { version: "2.0.0", summary: "rename plan-next", renames: [{ from: "plan-next", to: "committed" }], removals: [] },
  { version: "3.0.0", summary: "retire config", renames: [], removals: [{ name: "config", reason: "folded into enhancement" }] },
];

describe("compareSemver", () => {
  test("compares numerically, not lexically", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
  test("treats equal versions as equal", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  test("tolerates a leading v and a pre-release suffix", () => {
    expect(compareSemver("v2.0.0", "2.0.0-rc.1")).toBe(0);
  });
});

describe("pendingMigrations", () => {
  test("returns migrations in the (from, to] window", () => {
    expect(pendingMigrations("1.0.0", "3.0.0", FIXTURES).map((m) => m.version)).toEqual(["2.0.0", "3.0.0"]);
  });
  test("excludes migrations already applied", () => {
    expect(pendingMigrations("2.0.0", "3.0.0", FIXTURES).map((m) => m.version)).toEqual(["3.0.0"]);
  });
  test("excludes migrations newer than what is installed", () => {
    expect(pendingMigrations("1.0.0", "2.0.0", FIXTURES).map((m) => m.version)).toEqual(["2.0.0"]);
  });
  test("nothing pending when fully migrated", () => {
    expect(pendingMigrations("3.0.0", "3.0.0", FIXTURES)).toEqual([]);
  });
  test("a fresh adoption owes nothing — bootstrap creates today's taxonomy directly", () => {
    expect(pendingMigrations(null, "3.0.0", FIXTURES)).toEqual([]);
  });
});

describe("planMigrations — rename", () => {
  const [rename] = FIXTURES;

  test("only the old label exists → in-place rename, assignments preserved", () => {
    const [a] = planMigrations([rename!], ["plan-next", "idea"], [{ number: 1, labels: ["plan-next"] }]);
    expect(a!.kind).toBe("rename");
    expect(a!.affected).toEqual([1]);
  });

  test("BOTH labels exist → merge, not a blind rename", () => {
    // This is exactly the state a naive `--force` upgrade leaves behind.
    const [a] = planMigrations(
      [rename!],
      ["plan-next", "committed"],
      [{ number: 1, labels: ["plan-next"] }, { number: 2, labels: ["committed"] }],
    );
    expect(a!.kind).toBe("merge");
    expect(a!.affected).toEqual([1]); // only carriers of the OLD label get relabelled
  });

  test("only the new label exists → skip (idempotent re-run)", () => {
    const [a] = planMigrations([rename!], ["committed"], []);
    expect(a!.kind).toBe("skip");
  });

  test("neither label exists → skip", () => {
    const [a] = planMigrations([rename!], ["idea"], []);
    expect(a!.kind).toBe("skip");
  });
});

describe("planMigrations — removal", () => {
  const [, removal] = FIXTURES;

  test("reports the blast radius before deleting", () => {
    const [a] = planMigrations(
      [removal!],
      ["config"],
      [{ number: 5, labels: ["config"] }, { number: 6, labels: ["config", "perf"] }, { number: 7, labels: ["perf"] }],
    );
    expect(a!.kind).toBe("remove");
    expect(a!.affected).toEqual([5, 6]);
  });

  test("skips a label the repo never had", () => {
    expect(planMigrations([removal!], ["perf"], [])[0]!.kind).toBe("skip");
  });
});

describe("planMigrations — chained migrations", () => {
  test("a later migration sees the state the earlier one produced", () => {
    const chained: Migration[] = [
      { version: "2.0.0", summary: "a→b", renames: [{ from: "a", to: "b" }], removals: [] },
      { version: "3.0.0", summary: "b→c", renames: [{ from: "b", to: "c" }], removals: [] },
    ];
    const actions = planMigrations(chained, ["a"], [{ number: 1, labels: ["a"] }]);
    // `a` renames to `b`; the second step must then see `b` as present and rename it to `c`,
    // rather than skipping because `b` was absent in the ORIGINAL label list.
    expect(actions.map((x) => x.kind)).toEqual(["rename", "rename"]);
    expect(actions[1]!.from).toBe("b");
    expect(actions[1]!.to).toBe("c");
  });
});

describe("the shipped migration log", () => {
  test("is append-only and internally ordered", async () => {
    const { MIGRATIONS } = await import("../src/lib/migrations.js");
    const versions = MIGRATIONS.map((m) => m.version);
    expect([...versions].sort(compareSemver)).toEqual(versions);
  });
});

describe("the 2.0.0 entry — the first real migration", () => {
  const m = MIGRATIONS.filter((x) => x.version === "2.0.0");

  test("a lone descriptor is an in-place rename, so every assignment survives", () => {
    const actions = planMigrations(m, ["tech-debt"], [{ number: 1, labels: ["tech-debt"] }]);
    const rename = actions.find((a) => a.from === "tech-debt")!;
    expect(rename.kind).toBe("rename");
    expect(rename.to).toBe("improvement");
  });

  test("the many-to-one fan-in is rename-then-merge, never a silent drop", () => {
    const actions = planMigrations(
      m,
      ["tech-debt", "perf", "config", "legacy-audit"],
      [
        { number: 1, labels: ["tech-debt"] },
        { number: 2, labels: ["perf"] },
        { number: 3, labels: ["config"] },
      ],
    );
    const kinds = ["tech-debt", "perf", "config", "legacy-audit"].map(
      (n) => actions.find((a) => a.from === n)!.kind,
    );
    // The first creates `improvement`; every one after it finds both labels present.
    expect(kinds).toEqual(["rename", "merge", "merge", "merge"]);
    // And the merges name their carriers, so `migrate` can relabel each before deleting the source.
    expect(actions.find((a) => a.from === "perf")!.affected).toEqual([2]);
  });

  test("`bug` merges onto `bugfix` when both already exist", () => {
    const actions = planMigrations(m, ["bug", "bugfix"], [{ number: 9, labels: ["bug"] }]);
    const a = actions.find((x) => x.from === "bug")!;
    expect(a.kind).toBe("merge");
    expect(a.affected).toEqual([9]);
  });

  test("the derived-state labels are removals, and each says why", () => {
    const actions = planMigrations(m, ["rfc", "idea", "plan-next"], []);
    for (const name of ["rfc", "idea", "plan-next"]) {
      const a = actions.find((x) => x.from === name)!;
      expect(a.kind).toBe("remove");
      expect(a.reason.length).toBeGreaterThan(20);
    }
  });

  test("a second run is entirely skips — the plan is idempotent", () => {
    const after = ["improvement", "bugfix", "experiment", "epic", "release-gate"];
    expect(planMigrations(m, after, []).every((a) => a.kind === "skip")).toBe(true);
  });

  test("`experiment` is never touched — same name, same meaning, both sides of 2.0", () => {
    const all = m.flatMap((x) => [...x.renames.map((r) => r.from), ...x.removals.map((r) => r.name)]);
    expect(all).not.toContain("experiment");
    expect(all).not.toContain("epic");
    expect(all).not.toContain("release-gate");
  });

  test("sixteen labels retire: seven merges and nine removals", () => {
    expect(m[0]!.renames).toHaveLength(7);
    expect(m[0]!.removals).toHaveLength(9);
  });
});
