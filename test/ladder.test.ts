/**
 * The derived commitment ladder (§2).
 *
 * One test per row of all three tables in the design, plus the property that makes the whole thing
 * safe: exactly one state, always. A table of independent conditions could produce two answers; a
 * walk cannot, and these tests are what hold that.
 */

import { describe, expect, test } from "bun:test";

import { LADDER_STATES, ladderState, type WorkItemView } from "../src/lib/ladder.js";
import { GATES, WORK_TYPES, allGateLabels, gateLabel, gateOf, parseGateLabel, workTypeOf, isPatchMilestone } from "../src/lib/model.js";

const item = (over: Partial<WorkItemView> = {}): WorkItemView => ({
  number: 1,
  type: "improvement",
  state: "OPEN",
  milestone: null,
  gates: [],
  ...over,
});

const open = (n: number) => ({ n, state: "OPEN" as const });
const closed = (n: number) => ({ n, state: "CLOSED" as const });

describe("improvement ladder", () => {
  test("no gate-1, no milestone → idea", () => {
    expect(ladderState(item()).state).toBe("idea");
  });
  test("no gate-1, milestone → design-next", () => {
    expect(ladderState(item({ milestone: "v2.0.0" })).state).toBe("design-next");
  });
  test("gate-1 open → design-pending", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [open(1)] })).state).toBe("design-pending");
  });
  test("gate-1 closed, no gate-2 → plan-next", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1)] })).state).toBe("plan-next");
  });
  test("gate-2 open → plan-pending", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), open(2)] })).state).toBe("plan-pending");
  });
  test("gate-2 closed, no gate-3 → impl-next", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), closed(2)] })).state).toBe("impl-next");
  });
  test("gate-3 open → impl-pending, which IS §2's in-flight rung", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), closed(2), open(3)] })).state).toBe("impl-pending");
  });
  test("all gates closed, parent open → complete", () => {
    const l = ladderState(item({ milestone: "v2.0.0", gates: [closed(1), closed(2), closed(3)] }));
    expect(l.state).toBe("complete");
    expect(l.complete).toBe(true);
  });
  test("parent closed on a milestone → closed-in-milestone", () => {
    const l = ladderState(item({ state: "CLOSED", milestone: "v2.0.0", gates: [closed(1), closed(2), closed(3)] }));
    expect(l.state).toBe("closed-in-milestone");
  });
});

describe("bugfix ladder", () => {
  const bug = (over: Partial<WorkItemView> = {}) => item({ type: "bugfix", ...over });

  test("no gate-1, no milestone → triage-next", () => {
    expect(ladderState(bug()).state).toBe("triage-next");
  });
  test("no gate-1, milestone → diagnose-next", () => {
    expect(ladderState(bug({ milestone: "v2.0.0" })).state).toBe("diagnose-next");
  });
  test("gate-1 open → diagnose-pending", () => {
    expect(ladderState(bug({ milestone: "v2.0.0", gates: [open(1)] })).state).toBe("diagnose-pending");
  });
  test("gate-1 closed → fix-next", () => {
    expect(ladderState(bug({ milestone: "v2.0.0", gates: [closed(1)] })).state).toBe("fix-next");
  });
  test("gate-2 open → fix-pending", () => {
    expect(ladderState(bug({ milestone: "v2.0.0", gates: [closed(1), open(2)] })).state).toBe("fix-pending");
  });
  test("two gates, not three — a closed gate-2 completes it", () => {
    expect(ladderState(bug({ milestone: "v2.0.0", gates: [closed(1), closed(2)] })).complete).toBe(true);
  });
});

describe("experiment ladder", () => {
  const exp = (over: Partial<WorkItemView> = {}) => item({ type: "experiment", ...over });

  test("no gates → research-next, which means NOT STARTED", () => {
    expect(ladderState(exp()).state).toBe("research-next");
  });
  test("no pre-schedule split — an experiment never has a milestone to lack", () => {
    // The improvement in the same position is `idea`; the experiment skips that rung entirely.
    expect(ladderState(exp()).state).not.toBe("idea");
  });
  test("gate-1 open → research-pending", () => {
    expect(ladderState(exp({ gates: [open(1)] })).state).toBe("research-pending");
  });
  test("gate-1 closed → evaluate-next", () => {
    expect(ladderState(exp({ gates: [closed(1)] })).state).toBe("evaluate-next");
  });
  test("gate-2 open → evaluate-pending", () => {
    expect(ladderState(exp({ gates: [closed(1), open(2)] })).state).toBe("evaluate-pending");
  });
});

describe("ordering is a walk, not a table of conditions", () => {
  test("a gap in the sequence resolves to the FIRST missing gate", () => {
    // Gate 3 exists but gate 2 does not. First-match must say plan-next, never impl-pending.
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), open(3)] })).state).toBe("plan-next");
  });
  test("every work type yields exactly one state for every gate combination", () => {
    for (const type of WORK_TYPES) {
      const specs = GATES[type];
      // Every combination of absent / open / closed across the type's gates, as base-3 digits.
      for (let mask = 0; mask < 3 ** specs.length; mask++) {
        const gates = specs
          .map((s, i) => {
            const digit = Math.floor(mask / 3 ** i) % 3;
            return digit === 0 ? null : { n: s.n, state: digit === 1 ? ("OPEN" as const) : ("CLOSED" as const) };
          })
          .filter((g): g is { n: number; state: "OPEN" | "CLOSED" } => g !== null);
        const l = ladderState(item({ type, gates, milestone: "v2.0.0" }));
        expect(typeof l.state).toBe("string");
        expect(LADDER_STATES[type]).toContain(l.state);
      }
    }
  });
});


describe("the taxonomy is generated from one table", () => {
  test("seven gate labels, prefixed by type", () => {
    expect(allGateLabels()).toEqual([
      "improvement:gate-1", "improvement:gate-2", "improvement:gate-3",
      "bugfix:gate-1", "bugfix:gate-2",
      "experiment:gate-1", "experiment:gate-2",
    ]);
  });
  test("parseGateLabel rejects an ordinal the type does not define", () => {
    expect(parseGateLabel("bugfix:gate-3")).toBeNull();
    expect(parseGateLabel(gateLabel("improvement", 3))).toEqual({ type: "improvement", n: 3 });
  });
  test("a bare type label is not a gate label", () => {
    expect(parseGateLabel("improvement")).toBeNull();
    expect(gateOf(["improvement", "hotfix"])).toBeNull();
  });
  test("workTypeOf requires exactly one", () => {
    expect(workTypeOf(["improvement"])).toBe("improvement");
    expect(workTypeOf(["improvement", "bugfix"])).toBeNull();
    expect(workTypeOf(["epic"])).toBeNull();
  });
  test("gateOf finds the gate among other labels", () => {
    expect(gateOf(["release-gate", "improvement:gate-2"])).toEqual({ type: "improvement", n: 2 });
  });
});

describe("isPatchMilestone (§5.6)", () => {
  test("a non-zero patch component", () => {
    expect(isPatchMilestone("v1.2.1")).toBe(true);
    expect(isPatchMilestone("v1.2.0")).toBe(false);
  });
  test("a two-component title names the line, not a patch on it", () => {
    expect(isPatchMilestone("v1.2")).toBe(false);
  });
  test("a non-core namespace is not a patch milestone", () => {
    expect(isPatchMilestone("ext-v0.1.1")).toBe(false);
  });
});
