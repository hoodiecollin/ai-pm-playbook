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
import { RETIRED_GATE, gateLabel } from "../src/lib/model.js";

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

const INTENT = gateLabel("improvement", 1);
const PROOF = gateLabel("improvement", 2);
const WARRANT = gateLabel("bugfix", 1);
const CHARTER = gateLabel("experiment", 1);
const VERDICT = gateLabel("experiment", 2);

describe("PM011 — a gate rides its parent's milestone (§2)", () => {
  test("flags a gate on a different milestone", () => {
    const parent = issue({ milestone: "v2.0.0" });
    const gate = issue({ labels: [INTENT], milestone: "v2.1.0" });
    expect(structural(tree([[gate, parent]]))).toContain("PM011");
  });

  test("silent when they match", () => {
    const parent = issue({ milestone: "v2.0.0" });
    const gate = issue({ labels: [INTENT], milestone: "v2.0.0" });
    expect(structural(tree([[gate, parent]]))).toEqual([]);
  });

  test("flags a milestoned gate under an unmilestoned parent", () => {
    const parent = issue();
    const gate = issue({ labels: [INTENT], milestone: "v2.0.0" });
    const found = checkIssues([], null, tree([[gate, parent]]));
    expect(found[0]!.rule).toBe("PM011");
    expect(found[0]!.fix).toContain("--remove-milestone");
  });

  test("an experiment's gates are unmilestoned, like the experiment", () => {
    const parent = issue({ labels: ["experiment"] });
    const gate = issue({ labels: [CHARTER] });
    expect(structural(tree([[gate, parent]]))).toEqual([]);
  });

  test("a retired gate still rides its parent — history keeps its shape", () => {
    const parent = issue({ milestone: "v2.0.0" });
    const gate = issue({ labels: [RETIRED_GATE], milestone: "v1.0.0", state: "CLOSED" });
    expect(structural(tree([[gate, parent]]))).toContain("PM011");
  });
});

describe("PM012 — an epic never carries gates (§7)", () => {
  test("flags a gate hanging off an epic", () => {
    const epic = issue({ labels: ["epic"] });
    const gate = issue({ labels: [INTENT] });
    expect(structural(tree([[gate, epic]]))).toContain("PM012");
  });

  test("an epic with ordinary work items is fine", () => {
    const epic = issue({ labels: ["epic"] });
    expect(structural(tree([[issue(), epic]]))).toEqual([]);
  });

  test("does NOT double-report as PM105 — the epic clause is PM012's job", () => {
    const epic = issue({ labels: ["epic"] });
    const gate = issue({ labels: [INTENT] });
    expect(structural(tree([[gate, epic]]))).toEqual(["PM012"]);
  });
});

describe("PM105 — the depth cap (§7)", () => {
  test("a gate on a gate is refused — three levels is the whole tree", () => {
    const outer = issue({ labels: [INTENT] });
    const inner = issue({ labels: [PROOF] });
    const found = checkIssues([], null, tree([[inner, outer]]));
    expect(found.map((v) => v.rule)).toContain("PM105");
    expect(found.find((v) => v.rule === "PM105")!.message).toContain("is itself a gate");
  });

  test("a gate under an untyped parent is refused", () => {
    const parent = issue({ labels: [] });
    const gate = issue({ labels: [INTENT] });
    const found = checkIssues([], null, tree([[gate, parent]]));
    expect(found.find((v) => v.rule === "PM105")!.message).toContain("carries no work type");
  });

  test("a work item's gates and an epic's work items coexist across the two levels", () => {
    const epic = issue({ labels: ["epic"], milestone: "v2.0.0" });
    const work = issue({ milestone: "v2.0.0" });
    const g1 = issue({ labels: [INTENT], milestone: "v2.0.0" });
    expect(structural(tree([[work, epic], [g1, work]]))).toEqual([]);
  });
});

describe("PM013 — the complete gate set on the focused milestone (§2)", () => {
  const focused = "v2.0.0";
  const under = (work: Issue, labels: string[], state = "OPEN") =>
    labels.map((l) => [issue({ labels: [l], milestone: work.milestone, state }), work] as [Issue, Issue]);

  test("flags an improvement on the cycle with no gates, naming both", () => {
    const work = issue({ milestone: focused });
    const found = checkIssues([], null, tree([], [work]), focused);
    expect(found.find((v) => v.rule === "PM013")!.message).toContain("`intent` and `proof`");
  });

  test("flags a partial set — intent without proof", () => {
    const work = issue({ milestone: focused });
    expect(structural(tree(under(work, [INTENT])), focused)).toContain("PM013");
  });

  test("a retired gate does not stand in for a live one", () => {
    // The 4.0 migration folds an old PLAN gate onto gate:retired. It must not count as a proof.
    const work = issue({ milestone: focused });
    expect(structural(tree(under(work, [INTENT, RETIRED_GATE], "CLOSED")), focused)).toContain("PM013");
  });

  test("silent on a release obligation, which has no gates", () => {
    const bare = issue({ labels: ["release-gate"], milestone: focused });
    expect(structural(tree([], [bare]), focused)).not.toContain("PM013");
    const typed = issue({ labels: ["improvement", "release-gate"], milestone: focused });
    expect(structural(tree([], [typed]), focused)).not.toContain("PM013");
  });

  test("silent on a complete set", () => {
    const work = issue({ milestone: focused });
    expect(structural(tree(under(work, [INTENT, PROOF])), focused)).toEqual([]);
  });

  test("a plain bugfix owes nothing", () => {
    const work = issue({ labels: ["bugfix"], milestone: focused });
    expect(structural(tree([], [work]), focused)).toEqual([]);
  });

  test("a hotfix owes its warrant", () => {
    const work = issue({ labels: ["bugfix", "hotfix"], milestone: focused });
    expect(structural(tree([], [work]), focused)).toContain("PM013");
    expect(structural(tree(under(work, [WARRANT])), focused)).toEqual([]);
  });

  test("a hotfix on an open patch milestone owes its warrant, though the patch is not the cycle", () => {
    // v2.0.1 patches a released line while v2.1.0 is the cycle; a patch milestone is in flight.
    const work = issue({ labels: ["bugfix", "hotfix"], milestone: "v2.0.1" });
    const found = checkIssues([], null, tree([], [work]), "v2.1.0");
    expect(found.find((v) => v.rule === "PM013")!.fix).toContain("--milestone v2.0.1");
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
    expect(structural(tree(under(work, [INTENT, PROOF], "CLOSED")), focused)).not.toContain("PM013");
  });

  test("the fix names the materialize command", () => {
    const work = issue({ milestone: focused });
    const found = checkIssues([], null, tree([], [work]), focused);
    expect(found.find((v) => v.rule === "PM013")!.fix).toContain("materialize");
  });
});

describe("PM016 — an experiment whose verdict is closed is finished (§4)", () => {
  const closedGates = (labels: string[]) => labels.map((l) => issue({ labels: [l], state: "CLOSED" }));

  test("warns when charter and verdict are closed and the experiment is open", () => {
    const work = issue({ labels: ["experiment"] });
    const found = checkIssues([], null, tree(closedGates([CHARTER, VERDICT]).map((g) => [g, work] as [Issue, Issue])));
    const pm016 = found.find((v) => v.rule === "PM016");
    expect(pm016?.severity).toBe("warn");
  });

  test("silent once the experiment is closed", () => {
    const work = issue({ labels: ["experiment"], state: "CLOSED" });
    expect(structural(tree(closedGates([CHARTER, VERDICT]).map((g) => [g, work] as [Issue, Issue])))).toEqual([]);
  });

  test("silent while the verdict is open", () => {
    const work = issue({ labels: ["experiment"] });
    const gates = [...closedGates([CHARTER]), issue({ labels: [VERDICT] })];
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])))).not.toContain("PM016");
  });

  test("silent for an improvement past proof — it is being BUILT, which is legitimately open", () => {
    const work = issue({ milestone: "v2.0.0" });
    const gates = closedGates([INTENT, PROOF]).map((g) => ({ ...g, milestone: "v2.0.0" }));
    expect(structural(tree(gates.map((g) => [g, work] as [Issue, Issue])))).not.toContain("PM016");
  });

  test("fires under the default open-only scope, from the unscoped index", () => {
    const work = issue({ labels: ["experiment"] });
    const t = tree(closedGates([CHARTER, VERDICT]).map((g) => [g, work] as [Issue, Issue]));
    expect(checkIssues([work], null, t).map((v) => v.rule)).toContain("PM016");
  });
});
