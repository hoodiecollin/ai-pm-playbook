/**
 * The structural invariants — the rules that read the tree rather than one issue's labels.
 *
 * Every one of these runs over the UNSCOPED parentage index, never the linted issue set, and most
 * of these tests exist to hold that property: a closed gate is still a gate, and a rule that could
 * not see it would report the exact state it exists to catch, backwards.
 */

import { describe, expect, test } from "bun:test";

import { checkIssues } from "../src/lib/invariants.js";
import type { Issue } from "../src/lib/gh.js";

let counter = 100;
const issue = (over: Partial<Issue> = {}): Issue => {
  counter += 1;
  return {
    number: counter,
    title: `issue ${counter}`,
    state: "OPEN",
    url: `https://github.com/o/r/issues/${counter}`,
    labels: ["improvement"],
    milestone: null,
    ...over,
  };
};

/** Build parentage from a parent and its children, the way the fetch would. */
function tree(links: [child: Issue, parent: Issue][], extra: Issue[] = []) {
  const all = new Map<number, Issue>();
  const parentOf = new Map<number, number>();
  for (const [child, parent] of links) {
    all.set(child.number, child);
    all.set(parent.number, parent);
    parentOf.set(child.number, parent.number);
  }
  for (const e of extra) all.set(e.number, e);
  return { parentOf, all };
}

/** Lint structure only — pass an empty linted set so nothing but the tree rules can fire. */
const structural = (t: ReturnType<typeof tree>, cycle: string | null = null) =>
  checkIssues([], null, t, cycle).map((v) => v.rule);

describe("PM011 — a gate rides its parent's milestone (§9)", () => {
  test("flags a gate on a different milestone", () => {
    const parent = issue({ milestone: "v2.0.0" });
    const gate = issue({ labels: ["improvement:gate-1"], milestone: "v2.1.0" });
    expect(structural(tree([[gate, parent]]))).toContain("PM011");
  });

  test("silent when they match", () => {
    const parent = issue({ milestone: "v2.0.0" });
    const gate = issue({ labels: ["improvement:gate-1"], milestone: "v2.0.0" });
    expect(structural(tree([[gate, parent]]))).toEqual([]);
  });

  test("flags a milestoned gate under an unmilestoned parent", () => {
    const parent = issue();
    const gate = issue({ labels: ["improvement:gate-1"], milestone: "v2.0.0" });
    const found = checkIssues([], null, tree([[gate, parent]]));
    expect(found[0]!.rule).toBe("PM011");
    expect(found[0]!.fix).toContain("--remove-milestone");
  });

  test("an experiment's gates are unmilestoned, like the experiment", () => {
    const parent = issue({ labels: ["experiment"] });
    const gate = issue({ labels: ["experiment:gate-1"] });
    expect(structural(tree([[gate, parent]]))).toEqual([]);
  });
});

describe("PM012 — an epic never carries gates (§7.1)", () => {
  test("flags a gate hanging off an epic", () => {
    const epic = issue({ labels: ["epic"] });
    const gate = issue({ labels: ["improvement:gate-1"] });
    expect(structural(tree([[gate, epic]]))).toContain("PM012");
  });

  test("an epic with ordinary work items is fine", () => {
    const epic = issue({ labels: ["epic"] });
    expect(structural(tree([[issue(), epic]]))).toEqual([]);
  });

  test("does NOT double-report as PM105 — the epic clause is PM012's job", () => {
    const epic = issue({ labels: ["epic"] });
    const gate = issue({ labels: ["improvement:gate-1"] });
    expect(structural(tree([[gate, epic]]))).toEqual(["PM012"]);
  });
});

describe("PM105 — the depth cap (§7.1)", () => {
  test("a gate on a gate is refused — three levels is the whole tree", () => {
    const outer = issue({ labels: ["improvement:gate-1"] });
    const inner = issue({ labels: ["improvement:gate-2"] });
    const found = checkIssues([], null, tree([[inner, outer]]));
    expect(found.map((v) => v.rule)).toContain("PM105");
    expect(found.find((v) => v.rule === "PM105")!.message).toContain("is itself a gate");
  });

  test("a gate under an untyped parent is refused", () => {
    const parent = issue({ labels: [] });
    const gate = issue({ labels: ["improvement:gate-1"] });
    const found = checkIssues([], null, tree([[gate, parent]]));
    expect(found.find((v) => v.rule === "PM105")!.message).toContain("carries no work type");
  });

  test("a work item's gates and an epic's work items coexist across the two levels", () => {
    const epic = issue({ labels: ["epic"], milestone: "v2.0.0" });
    const work = issue({ milestone: "v2.0.0" });
    const g1 = issue({ labels: ["improvement:gate-1"], milestone: "v2.0.0" });
    expect(structural(tree([[work, epic], [g1, work]]))).toEqual([]);
  });
});

describe("PM013 — the complete gate set on the focused milestone (§9)", () => {
  const focused = "v2.0.0";

  test("flags a work item on the cycle with no gates at all", () => {
    const work = issue({ milestone: focused });
    const found = checkIssues([], null, tree([], [work]), focused);
    expect(found.map((v) => v.rule)).toContain("PM013");
    expect(found.find((v) => v.rule === "PM013")!.message).toContain("gate(s) 1, 2, 3");
  });

  test("flags a partial set", () => {
    const work = issue({ milestone: focused });
    const g1 = issue({ labels: ["improvement:gate-1"], milestone: focused });
    expect(structural(tree([[g1, work]]), focused)).toContain("PM013");
  });

  test("silent on a complete set", () => {
    const work = issue({ milestone: focused });
    const gates = [1, 2, 3].map((n) => issue({ labels: [`improvement:gate-${n}`], milestone: focused }));
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])), focused)).toEqual([]);
  });

  test("a bugfix needs two gates, not three", () => {
    const work = issue({ labels: ["bugfix"], milestone: focused });
    const gates = [1, 2].map((n) => issue({ labels: [`bugfix:gate-${n}`], milestone: focused }));
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])), focused)).toEqual([]);
  });

  test("silent for work milestoned BEYOND the cycle — scheduling is not focus", () => {
    const work = issue({ milestone: "v2.1.0" });
    expect(structural(tree([], [work]), focused)).toEqual([]);
  });

  test("silent when no cycle is known — the rule has no referent", () => {
    const work = issue({ milestone: focused });
    expect(structural(tree([], [work]), null)).toEqual([]);
  });

  test("silent for an experiment, which never carries a milestone to focus", () => {
    const work = issue({ labels: ["experiment"] });
    expect(structural(tree([], [work]), focused)).toEqual([]);
  });

  test("counts a CLOSED gate as present — the reason parentage is unscoped", () => {
    const work = issue({ milestone: focused });
    const gates = [1, 2, 3].map((n) =>
      issue({ labels: [`improvement:gate-${n}`], milestone: focused, state: "CLOSED" }),
    );
    // The linted set is open-only and contains none of these gates. The rule still sees them.
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])), focused)).not.toContain("PM013");
  });

  test("the fix names the materialize command", () => {
    const work = issue({ milestone: focused });
    const found = checkIssues([], null, tree([], [work]), focused);
    expect(found.find((v) => v.rule === "PM013")!.fix).toContain("materialize");
  });
});

describe("PM016 — every gate closed, work item still open (§9)", () => {
  const closedGates = (type: string, ordinals: number[], milestone: string | null = "v2.0.0") =>
    ordinals.map((n) => issue({ labels: [`${type}:gate-${n}`], milestone, state: "CLOSED" }));

  test("warns when all three gates are closed and the parent is open", () => {
    const work = issue({ milestone: "v2.0.0" });
    const found = checkIssues([], null, tree(closedGates("improvement", [1, 2, 3]).map((g) => [g, work] as [Issue, Issue])));
    const pm016 = found.find((v) => v.rule === "PM016");
    expect(pm016).toBeDefined();
    expect(pm016!.severity).toBe("warn");
  });

  test("silent once the parent is closed — the normal terminal state", () => {
    const work = issue({ milestone: "v2.0.0", state: "CLOSED" });
    expect(structural(tree(closedGates("improvement", [1, 2, 3]).map((g) => [g, work] as [Issue, Issue])))).toEqual([]);
  });

  test("silent while any gate is still open", () => {
    const work = issue({ milestone: "v2.0.0" });
    const gates = [
      ...closedGates("improvement", [1, 2]),
      issue({ labels: ["improvement:gate-3"], milestone: "v2.0.0" }),
    ];
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])))).not.toContain("PM016");
  });

  test("silent when the set is incomplete — that is PM013's finding, not this one", () => {
    const work = issue({ milestone: "v2.0.0" });
    expect(structural(tree(closedGates("improvement", [1, 2]).map((g) => [g, work] as [Issue, Issue])))).not.toContain("PM016");
  });

  test("fires for a bugfix at two closed gates", () => {
    const work = issue({ labels: ["bugfix"], milestone: "v2.0.0" });
    expect(structural(tree(closedGates("bugfix", [1, 2]).map((g) => [g, work] as [Issue, Issue])))).toContain("PM016");
  });

  test("fires under the default open-only scope, from the unscoped index", () => {
    const work = issue({ milestone: "v2.0.0" });
    const t = tree(closedGates("improvement", [1, 2, 3]).map((g) => [g, work] as [Issue, Issue]));
    // `issues` holds only the open parent; every gate is closed and therefore absent from it.
    expect(checkIssues([work], null, t).map((v) => v.rule)).toContain("PM016");
  });
});
