/**
 * The invariant rules are the reason this package is a dependency rather than a docs repo, so they
 * get real coverage. Each test names the PLAYBOOK section it defends.
 */

import { describe, expect, test } from "bun:test";

import { checkIssues, checkPullRequestScope, releaseBlockers } from "../src/lib/invariants.js";
import { compareMilestones, currentCycle, isCoreMilestone, parseVersion } from "../src/lib/model.js";
import type { Issue } from "../src/lib/gh.js";

let counter = 0;
function issue(partial: Partial<Issue> = {}): Issue {
  counter += 1;
  return {
    number: counter,
    title: `issue ${counter}`,
    state: "OPEN",
    url: `https://github.com/o/r/issues/${counter}`,
    labels: [],
    milestone: null,
    ...partial,
  };
}

const rules = (issues: Issue[], counts?: Map<number, number> | null) =>
  checkIssues(issues, counts).map((v) => v.rule);

/**
 * Parentage carries its own index, so these helpers build it from the same issues by default —
 * the common case. `rulesWithHiddenParent` covers the case that matters: a parent the linted scope
 * excludes.
 */
const parentage = (all: Issue[], parentOf: Map<number, number>) => ({
  parentOf,
  all: new Map(all.map((i) => [i.number, i])),
});

const rulesWithParents = (issues: Issue[], parentOf: Map<number, number>) =>
  checkIssues(issues, null, parentage(issues, parentOf)).map((v) => v.rule);

describe("PM105 — only an `epic` may have sub-issues (§7.1)", () => {
  test("flags a standalone issue that has children", () => {
    const parent = issue({ labels: [] });
    const child = issue();
    expect(rulesWithParents([parent, child], new Map([[child.number, parent.number]]))).toContain("PM105");
  });

  test("allows an epic to have children", () => {
    const parent = issue({ labels: ["epic"] });
    const child = issue();
    expect(rulesWithParents([parent, child], new Map([[child.number, parent.number]]))).toEqual([]);
  });

  test("reports the parent, not the child — the parent is what is mis-modelled", () => {
    const parent = issue({ labels: [] });
    const child = issue();
    const found = checkIssues([parent, child], null, parentage([parent, child], new Map([[child.number, parent.number]])));
    expect(found[0]!.issue!.number).toBe(parent.number);
    expect(found[0]!.fix).toContain(`#${child.number}`);
  });

  test("stays armed when the parent is outside the linted scope — a closed epic is still an epic", () => {
    // The live case that found this: forgedb #218 is OPEN under CLOSED epic #167. Resolving the
    // parent through the linted (open-only) set would report nothing at all.
    const parent = issue({ number: 167, state: "CLOSED", labels: [] });
    const child = issue({ number: 218 });
    const found = checkIssues([child], null, parentage([parent, child], new Map([[218, 167]])));
    expect(found.map((v) => v.rule)).toEqual(["PM105"]);
    expect(found[0]!.issue!.number).toBe(167);
  });

  test("a closed parent that IS an epic stays silent", () => {
    const parent = issue({ number: 167, state: "CLOSED", labels: ["epic"] });
    const child = issue({ number: 218 });
    expect(checkIssues([child], null, parentage([parent, child], new Map([[218, 167]])))).toEqual([]);
  });

  test("is skipped rather than guessed when parentage is unknown", () => {
    expect(rules([issue({ labels: [] })])).toEqual([]);
  });

  test("ignores a parent that is not in the scanned set", () => {
    const child = issue();
    expect(rulesWithParents([child], new Map([[child.number, 9999]]))).toEqual([]);
  });
});

describe("PM001 — plan-next ⊕ milestone (§3.2)", () => {
  test("flags the collision", () => {
    expect(rules([issue({ labels: ["plan-next"], milestone: "v0.4.0" })])).toContain("PM001");
  });
  test("allows plan-next with no milestone", () => {
    expect(rules([issue({ labels: ["plan-next"] })])).toEqual([]);
  });
  test("allows a milestone with no plan-next", () => {
    expect(rules([issue({ labels: ["tech-debt"], milestone: "v0.4.0" })])).toEqual([]);
  });
});

describe("PM002 — idea ⊕ plan-next (§3.2)", () => {
  test("flags the collision", () => {
    expect(rules([issue({ labels: ["idea", "plan-next"] })])).toContain("PM002");
  });
  test("allows either alone", () => {
    expect(rules([issue({ labels: ["idea"] }), issue({ labels: ["plan-next"] })])).toEqual([]);
  });
});

describe("PM003 — experiment never rides the spine (§4)", () => {
  test("flags a milestoned experiment", () => {
    expect(rules([issue({ labels: ["experiment"], milestone: "v0.4.0" })])).toContain("PM003");
  });
  test("flags experiment + plan-next", () => {
    expect(rules([issue({ labels: ["experiment", "plan-next"] })])).toContain("PM003");
  });
  test("flags experiment + idea", () => {
    expect(rules([issue({ labels: ["experiment", "idea"] })])).toContain("PM003");
  });
  test("allows an off-spine experiment", () => {
    expect(rules([issue({ labels: ["experiment", "perf"] })])).toEqual([]);
  });
  test("the milestone fix unschedules rather than relabels", () => {
    const [v] = checkIssues([issue({ labels: ["experiment"], milestone: "v0.4.0" })]);
    expect(v!.fix).toContain("--remove-milestone");
  });
});

describe("PM004 / PM005 — release-gate (§3.2, §5.2)", () => {
  test("PM004 flags a gate with no milestone", () => {
    expect(rules([issue({ labels: ["release-gate"] })])).toContain("PM004");
  });
  test("PM005 flags a speculative gate", () => {
    expect(rules([issue({ labels: ["release-gate", "idea"], milestone: "v1.0.0" })])).toContain("PM005");
  });
  test("a correctly-formed gate is clean", () => {
    expect(rules([issue({ labels: ["release-gate"], milestone: "v1.0.0" })])).toEqual([]);
  });
});

describe("PM006 — surface exclusion (§6.1)", () => {
  test("flags a non-core surface on a core v* milestone", () => {
    expect(rules([issue({ labels: ["surface:website"], milestone: "v0.5.0" })])).toContain("PM006");
  });
  test("allows surface:core on a core milestone", () => {
    expect(rules([issue({ labels: ["surface:core"], milestone: "v0.5.0" })])).toEqual([]);
  });
  test("allows a non-core surface on its own namespace", () => {
    expect(rules([issue({ labels: ["surface:ide-extension"], milestone: "ext-v0.1.0" })])).toEqual([]);
  });
  test("allows an unscheduled non-core surface issue", () => {
    expect(rules([issue({ labels: ["surface:website"] })])).toEqual([]);
  });
});

describe("PM007 — epics decompose via native sub-issues (§7.1)", () => {
  test("warns on a childless epic", () => {
    const e = issue({ labels: ["epic"] });
    expect(rules([e], new Map([[e.number, 0]]))).toContain("PM007");
  });
  test("silent when children exist", () => {
    const e = issue({ labels: ["epic"] });
    expect(rules([e], new Map([[e.number, 3]]))).toEqual([]);
  });
  test("skipped entirely when counts are unavailable", () => {
    expect(rules([issue({ labels: ["epic"] })], null)).toEqual([]);
  });
});

describe("isCoreMilestone (§5)", () => {
  test("recognises core version milestones", () => {
    expect(isCoreMilestone("v0.4.0")).toBe(true);
    expect(isCoreMilestone("v1.0.0")).toBe(true);
  });
  test("rejects other release namespaces and themes", () => {
    expect(isCoreMilestone("ext-v0.1.0")).toBe(false);
    expect(isCoreMilestone("vscode-v2")).toBe(false);
    expect(isCoreMilestone("Q3 polish")).toBe(false);
  });
});

describe("version ordering (§5)", () => {
  test("parseVersion extracts numeric components", () => {
    expect(parseVersion("v0.4.0")).toEqual([0, 4, 0]);
    expect(parseVersion("v1")).toEqual([1]);
    expect(parseVersion("ext-v0.1.0")).toBeNull();
  });
  test("compareMilestones orders by version, not lexically", () => {
    // The trap a string sort falls into: "v0.10.0" < "v0.9.0" lexically.
    expect(["v0.9.0", "v0.10.0", "v0.4.0"].sort(compareMilestones)).toEqual(["v0.4.0", "v0.9.0", "v0.10.0"]);
  });
  test("shorter versions sort first", () => {
    expect(compareMilestones("v1", "v1.1")).toBeLessThan(0);
  });
});

describe("currentCycle — the cycle in flight (§5)", () => {
  test("is the lowest OPEN core milestone", () => {
    expect(currentCycle([
      { title: "v0.3.0", state: "closed" },
      { title: "v0.5.0", state: "open" },
      { title: "v0.4.0", state: "open" },
    ])).toBe("v0.4.0");
  });
  test("ignores non-core release namespaces", () => {
    expect(currentCycle([
      { title: "ext-v0.1.0", state: "open" },
      { title: "v0.4.0", state: "open" },
    ])).toBe("v0.4.0");
  });
  test("null when the spine has no open milestone", () => {
    expect(currentCycle([{ title: "v0.3.0", state: "closed" }])).toBeNull();
  });
  test("a milestone left open after its tag freezes the cycle — the documented failure mode", () => {
    expect(currentCycle([
      { title: "v0.3.0", state: "open" }, // shipped but never closed
      { title: "v0.4.0", state: "open" },
    ])).toBe("v0.3.0");
  });
});

describe("releaseBlockers — can we tag? (§5.2)", () => {
  const issues = [
    issue({ labels: ["release-gate"], milestone: "v1.0.0", state: "OPEN" }),
    issue({ labels: ["release-gate"], milestone: "v1.0.0", state: "CLOSED" }),
    issue({ labels: ["release-gate"], milestone: "v0.9.0", state: "OPEN" }),
    issue({ labels: ["tech-debt"], milestone: "v1.0.0", state: "OPEN" }),
  ];
  test("counts only open gates on the named milestone", () => {
    expect(releaseBlockers(issues, "v1.0.0")).toHaveLength(1);
  });
  test("a milestone with no open gates is ungated", () => {
    expect(releaseBlockers(issues, "v2.0.0")).toHaveLength(0);
  });
});

describe("PM008 / PM009 — the cycle-scope gate (§5.3)", () => {
  const scope = (over: Partial<Parameters<typeof checkPullRequestScope>[0]> = {}) => ({
    number: 7,
    title: "feat: thing",
    baseRefName: "develop",
    closing: [],
    mentioned: [],
    ...over,
  });
  const closing = (number: number, milestone: string | null) => ({
    number, milestone, title: `issue ${number}`, url: `https://github.com/o/r/issues/${number}`,
  });

  test("PM008 blocks a PR closing next-cycle work", () => {
    const v = checkPullRequestScope(scope({ closing: [closing(20, "v0.5.0")] }), "v0.4.0");
    expect(v.map((x) => x.rule)).toEqual(["PM008"]);
    expect(v[0]!.severity).toBe("error");
  });

  test("allows closing current-cycle work", () => {
    expect(checkPullRequestScope(scope({ closing: [closing(20, "v0.4.0")] }), "v0.4.0")).toEqual([]);
  });

  test("allows closing earlier work (a late landing, not a future one)", () => {
    expect(checkPullRequestScope(scope({ closing: [closing(20, "v0.3.0")] }), "v0.4.0")).toEqual([]);
  });

  test("deny-list shape: an untracked chore with no issue passes", () => {
    expect(checkPullRequestScope(scope(), "v0.4.0")).toEqual([]);
  });

  test("deny-list shape: a closed issue with no milestone passes", () => {
    expect(checkPullRequestScope(scope({ closing: [closing(20, null)] }), "v0.4.0")).toEqual([]);
  });

  test("ignores non-core milestone namespaces — not on this spine", () => {
    expect(checkPullRequestScope(scope({ closing: [closing(20, "ext-v9.0.0")] }), "v0.4.0")).toEqual([]);
  });

  test("uses version order, not lexical order", () => {
    // v0.10.0 IS later than v0.9.0, though it sorts earlier as a string.
    const v = checkPullRequestScope(scope({ closing: [closing(20, "v0.10.0")] }), "v0.9.0");
    expect(v.map((x) => x.rule)).toEqual(["PM008"]);
  });

  test("PM009 warns on a mention of next-cycle work", () => {
    const future = issue({ milestone: "v0.5.0" });
    const v = checkPullRequestScope(scope({ mentioned: [future.number] }), "v0.4.0", [future]);
    expect(v.map((x) => x.rule)).toEqual(["PM009"]);
    expect(v[0]!.severity).toBe("warn");
  });

  test("PM009 stays silent for a mention of current-cycle work", () => {
    const now = issue({ milestone: "v0.4.0" });
    expect(checkPullRequestScope(scope({ mentioned: [now.number] }), "v0.4.0", [now])).toEqual([]);
  });

  test("PM009 stays silent for an unresolvable mention", () => {
    expect(checkPullRequestScope(scope({ mentioned: [9999] }), "v0.4.0", [])).toEqual([]);
  });
});

describe("clean backlog", () => {
  test("a well-formed backlog produces nothing", () => {
    expect(
      rules([
        issue({ labels: ["idea"] }),
        issue({ labels: ["plan-next", "tech-debt"] }),
        issue({ labels: ["perf"], milestone: "v0.4.0" }),
        issue({ labels: ["experiment"] }),
        issue({ labels: ["release-gate"], milestone: "v0.4.0" }),
        issue({ labels: ["surface:website"], milestone: "web-2026-08" }),
      ]),
    ).toEqual([]);
  });
});
