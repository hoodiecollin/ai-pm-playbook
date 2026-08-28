/**
 * The invariant rules are the reason this package is a dependency rather than a docs repo, so they
 * get real coverage. Each test names the PLAYBOOK section it defends.
 */

import { describe, expect, test } from "bun:test";

import { RULES, checkIssues, checkPullRequestScope, releaseBlockers } from "../src/lib/invariants.js";
import { compareMilestones, currentCycle, isCoreMilestone, parseVersion } from "../src/lib/model.js";
import type { Issue } from "../src/lib/gh.js";

/**
 * The default fixture carries `improvement` because 2.0 makes a work type mandatory (PM010). A
 * bare-labelled issue is now itself a violation, so leaving fixtures untyped would make every test
 * in this file assert against PM010 noise instead of the rule it names.
 */
let counter = 0;
function issue(partial: Partial<Issue> = {}): Issue {
  counter += 1;
  return {
    number: counter,
    title: `issue ${counter}`,
    state: "OPEN",
    url: `https://github.com/o/r/issues/${counter}`,
    labels: ["improvement"],
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

describe("PM105 — only an `epic` may have non-gate sub-issues (§7.1)", () => {
  test("flags a standalone issue that has children", () => {
    const parent = issue();
    const child = issue();
    expect(rulesWithParents([parent, child], new Map([[child.number, parent.number]]))).toContain("PM105");
  });

  test("allows an epic to have children", () => {
    const parent = issue({ labels: ["epic"] });
    const child = issue();
    expect(rulesWithParents([parent, child], new Map([[child.number, parent.number]]))).toEqual([]);
  });

  test("reports the parent, not the child — the parent is what is mis-modelled", () => {
    const parent = issue();
    const child = issue();
    const found = checkIssues([parent, child], null, parentage([parent, child], new Map([[child.number, parent.number]])));
    expect(found[0]!.issue!.number).toBe(parent.number);
    expect(found[0]!.fix).toContain(`#${child.number}`);
  });

  test("stays armed when the parent is outside the linted scope — a closed epic is still an epic", () => {
    // The live case that found this: forgedb #218 is OPEN under CLOSED epic #167. Resolving the
    // parent through the linted (open-only) set would report nothing at all.
    const parent = issue({ number: 167, state: "CLOSED" });
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
    expect(rules([issue()])).toEqual([]);
  });

  test("ignores a parent that is not in the scanned set", () => {
    const child = issue();
    expect(rulesWithParents([child], new Map([[child.number, 9999]]))).toEqual([]);
  });
});

describe("PM001 / PM002 are retired, and their numbers stay burned (§2)", () => {
  test("`plan-next` with a milestone is no longer a violation — the label does not exist", () => {
    expect(rules([issue({ labels: ["improvement", "plan-next"], milestone: "v0.4.0" })])).toEqual([]);
  });
  test("no rule reuses the retired numbers", () => {
    expect(RULES.map((r) => r.rule)).not.toContain("PM001");
    expect(RULES.map((r) => r.rule)).not.toContain("PM002");
  });
});

describe("PM010 — exactly one work type (§3.1)", () => {
  test("flags an untyped work item", () => {
    expect(rules([issue({ labels: [] })])).toContain("PM010");
  });
  test("flags two types at once", () => {
    expect(rules([issue({ labels: ["improvement", "bugfix"] })])).toContain("PM010");
  });
  test("an epic is a container, not a work item", () => {
    expect(rules([issue({ labels: ["epic"] })])).toEqual([]);
  });
  test("a gate takes its type from its own label, not a second one", () => {
    expect(rules([issue({ labels: ["improvement:gate-1"] })])).toEqual([]);
  });
  test("the fix names a concrete label to add", () => {
    const [v] = checkIssues([issue({ labels: [] })]);
    expect(v!.fix).toContain("--add-label improvement");
  });
});

describe("PM003 — experiment never rides the spine (§4)", () => {
  test("flags a milestoned experiment", () => {
    expect(rules([issue({ labels: ["experiment"], milestone: "v0.4.0" })])).toContain("PM003");
  });
  test("allows an off-spine experiment", () => {
    expect(rules([issue({ labels: ["experiment"] })])).toEqual([]);
  });
  test("the milestone fix unschedules rather than relabels", () => {
    const [v] = checkIssues([issue({ labels: ["experiment"], milestone: "v0.4.0" })]);
    expect(v!.fix).toContain("--remove-milestone");
  });
});

describe("PM014 — the hotfix shape (§5.6)", () => {
  const hot = (over: Partial<Issue> = {}) =>
    issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1", ...over });

  test("a well-formed hotfix is clean", () => {
    expect(rules([hot()])).toEqual([]);
  });
  test("flags a hotfix with no milestone", () => {
    expect(rules([hot({ milestone: null })])).toContain("PM014");
  });
  test("flags `hotfix` without `bugfix` — it is a form of bugfix, not a fourth type", () => {
    expect(rules([issue({ labels: ["improvement", "hotfix"], milestone: "v1.2.1" })])).toContain("PM014");
  });
  test("flags hotfix + experiment", () => {
    expect(rules([hot({ labels: ["bugfix", "hotfix", "experiment"] })])).toContain("PM014");
  });
  test("flags hotfix + epic", () => {
    expect(rules([hot({ labels: ["bugfix", "hotfix", "epic"] })])).toContain("PM014");
  });
});

/*
 * §5.6 calls PM015 a BOUNDEDNESS invariant — "One hotfix, one milestone". Until 3.0.0 it checked
 * labels and never counted anything, so it was wrong in both directions: three hotfixes on one
 * patch milestone returned `[]`, while a single bounded `improvement` was refused.
 *
 * The rule now counts work items and ignores their type. The scenarios below keep the four cases
 * that were already right and add the ones that were not.
 */
describe("PM015 — a patch milestone holds exactly one work item (§5.6)", () => {
  test("silent for a lone hotfix, the classic case", () => {
    expect(rules([issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1" })])).toEqual([]);
  });
  test("silent for its gates, which ride the same milestone", () => {
    expect(rules([issue({ labels: ["bugfix:gate-1"], milestone: "v1.2.1" })])).toEqual([]);
  });

  /*
   * #28. §5.2 makes a `release-gate` issue the asset ledger's only home, and §5.6 does not waive
   * the ledger for a patch — so the compliant milestone was the one PM015 rejected. That exemption
   * is the regression risk of rewriting this rule, hence two cases rather than one.
   */
  test("silent for the release-gate carrying the §5.2 asset ledger", () => {
    expect(rules([issue({ labels: ["release-gate"], milestone: "v1.2.1" })])).toEqual([]);
  });
  test("silent for a release-gate that also carries a work type", () => {
    expect(rules([issue({ labels: ["improvement", "release-gate"], milestone: "v1.2.1" })])).toEqual([]);
  });

  test("a `.0` milestone is not a patch milestone, however much work it holds", () => {
    expect(rules([
      issue({ labels: ["improvement"], milestone: "v1.2.0" }),
      issue({ labels: ["bugfix"], milestone: "v1.2.0" }),
      issue({ labels: ["improvement"], milestone: "v1.2.0" }),
    ])).toEqual([]);
  });

  /*
   * The relaxation. `hotfix` eligibility (§5.6) requires a defect in RELEASED behavior, which
   * refuses a bounded CI or hygiene change that legitimately warrants its own patch line. The
   * boundedness the section actually protects is a count, not a type.
   */
  test("silent for a lone improvement — type no longer decides", () => {
    expect(rules([issue({ labels: ["improvement"], milestone: "v1.2.1" })])).toEqual([]);
  });
  test("silent for a lone bugfix that is not labelled hotfix", () => {
    expect(rules([issue({ labels: ["bugfix"], milestone: "v1.2.1" })])).toEqual([]);
  });

  /*
   * The half that was measured rather than reported: before 3.0.0 these returned `[]`, so the
   * accumulation §5.6 exists to prevent passed clean while the prose called it an invariant.
   */
  test("flags TWO hotfixes on one patch milestone", () => {
    expect(rules([
      issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1" }),
      issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1" }),
    ])).toEqual(["PM015", "PM015"]);
  });
  test("flags every item on an over-full milestone, not just the surplus", () => {
    const out = checkIssues([
      issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1" }),
      issue({ labels: ["improvement"], milestone: "v1.2.1" }),
      issue({ labels: ["bugfix"], milestone: "v1.2.1" }),
    ]).filter((v) => v.rule === "PM015");
    expect(out).toHaveLength(3);
    // The message has to name what each item is in conflict with, or one violation read on its
    // own is unactionable.
    for (const v of out) expect(v.message).toContain("3 work items");
  });

  /*
   * The composition case a naive `issues.length > 1` breaks: one work item may be accompanied by
   * any number of its gates and a release-gate, and none of them count toward the limit.
   */
  test("one work item + its gates + a release-gate is clean", () => {
    expect(rules([
      issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.1" }),
      issue({ labels: ["bugfix:gate-1"], milestone: "v1.2.1" }),
      issue({ labels: ["bugfix:gate-2"], milestone: "v1.2.1" }),
      issue({ labels: ["release-gate"], milestone: "v1.2.1" }),
    ])).toEqual([]);
  });
  test("an epic does not count toward the limit", () => {
    expect(rules([
      issue({ labels: ["epic"], milestone: "v1.2.1" }),
      issue({ labels: ["improvement"], milestone: "v1.2.1" }),
    ])).toEqual([]);
  });
  test("grouping is per milestone — two patches with one item each are both clean", () => {
    expect(rules([
      issue({ labels: ["improvement"], milestone: "v1.2.1" }),
      issue({ labels: ["bugfix", "hotfix"], milestone: "v1.2.2" }),
    ])).toEqual([]);
  });

  /*
   * Gate 1's explicit reason for a structural predicate rather than `workTypeOf`, which returns
   * null for zero OR multiple types. Deriving the count from it would make PM015 stop enforcing
   * anything the moment PM010 is dirty — an invariant that evaporates in the presence of another
   * violation is the failure this whole change is about.
   */
  test("a mislabelled item still counts, so PM015 does not depend on PM010 being clean", () => {
    const out = checkIssues([
      issue({ labels: ["improvement", "bugfix"], milestone: "v1.2.1" }),
      issue({ labels: ["improvement"], milestone: "v1.2.1" }),
    ]).map((v) => v.rule);
    expect(out).toContain("PM010");
    expect(out.filter((r) => r === "PM015")).toHaveLength(2);
  });
});

describe("PM004 / PM005 — release-gate (§3.2, §5.2)", () => {
  test("PM004 flags a gate with no milestone", () => {
    expect(rules([issue({ labels: ["improvement", "release-gate"] })])).toContain("PM004");
  });
  test("PM005 flags a speculative gate", () => {
    expect(rules([issue({ labels: ["experiment", "release-gate"], milestone: "v1.0.0" })])).toContain("PM005");
  });
  test("a correctly-formed gate is clean", () => {
    expect(rules([issue({ labels: ["improvement", "release-gate"], milestone: "v1.0.0" })])).toEqual([]);
  });

  // A release obligation is not work with a design→plan→impl arc, so PM010 must not demand a type
  // for one. It used to, and the type it demanded then satisfied PM013's precondition — which
  // demanded three gates nobody could write. The two rules together made every release-gate on the
  // cycle in flight permanently non-compliant.
  test("PM010 does not demand a work type on a release obligation", () => {
    expect(rules([issue({ labels: ["release-gate"], milestone: "v1.0.0" })])).toEqual([]);
  });
  test("...but a release-gate that carries one anyway is still accepted", () => {
    expect(rules([issue({ labels: ["improvement", "release-gate"], milestone: "v1.0.0" })])).toEqual([]);
  });
});

describe("PM006 — surface exclusion (§6.1)", () => {
  test("flags a non-core surface on a core v* milestone", () => {
    expect(rules([issue({ labels: ["improvement", "surface:website"], milestone: "v0.5.0" })])).toContain("PM006");
  });
  test("allows surface:core on a core milestone", () => {
    expect(rules([issue({ labels: ["improvement", "surface:core"], milestone: "v0.5.0" })])).toEqual([]);
  });
  test("allows a non-core surface on its own namespace", () => {
    expect(rules([issue({ labels: ["improvement", "surface:ide-extension"], milestone: "ext-v0.1.0" })])).toEqual([]);
  });
  test("allows an unscheduled non-core surface issue", () => {
    expect(rules([issue({ labels: ["improvement", "surface:website"] })])).toEqual([]);
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

  // A patch on an already-shipped line sorts BELOW the cycle, so the naive "lowest open" reading
  // hands the gate a cycle that is behind the work and fails every legitimate PR until the patch
  // milestone closes. The line's closed milestone is what marks it as shipped.
  test("skips a patch milestone on a line that already shipped", () => {
    expect(currentCycle([
      { title: "v1.2.0", state: "closed" },
      { title: "v1.2.1", state: "open" },
      { title: "v1.3.0", state: "open" },
    ])).toBe("v1.3.0");
  });
  test("skips every patch on a shipped line, not just the first", () => {
    expect(currentCycle([
      { title: "v1.2.0", state: "closed" },
      { title: "v1.2.1", state: "closed" },
      { title: "v1.2.2", state: "open" },
      { title: "v1.3.0", state: "open" },
    ])).toBe("v1.3.0");
  });
  test("a patch on an UNSHIPPED line is still the cycle", () => {
    expect(currentCycle([
      { title: "v1.5.0", state: "open" },
      { title: "v1.5.1", state: "open" },
    ])).toBe("v1.5.0");
  });
  test("a short title shares a line with its patches", () => {
    expect(currentCycle([
      { title: "v1", state: "closed" },
      { title: "v1.0.1", state: "open" },
      { title: "v1.1.0", state: "open" },
    ])).toBe("v1.1.0");
  });
  // Deriving null here would disarm PM008 entirely and tell you to open a milestone you already
  // have. Nothing can be later than the highest open milestone, so falling back is free.
  test("falls back to the lowest open when EVERY open milestone is on a shipped line", () => {
    expect(currentCycle([
      { title: "v1.2.0", state: "closed" },
      { title: "v1.2.1", state: "open" },
    ])).toBe("v1.2.1");
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
        issue({ labels: ["improvement"] }),
        issue({ labels: ["improvement"], milestone: "v0.4.0" }),
        issue({ labels: ["bugfix"], milestone: "v0.4.0" }),
        issue({ labels: ["bugfix", "hotfix"], milestone: "v0.3.1" }),
        issue({ labels: ["experiment"] }),
        issue({ labels: ["improvement:gate-2"], milestone: "v0.4.0" }),
        issue({ labels: ["improvement", "release-gate"], milestone: "v0.4.0" }),
        issue({ labels: ["improvement", "surface:website"], milestone: "web-2026-08" }),
      ]),
    ).toEqual([]);
  });
});
