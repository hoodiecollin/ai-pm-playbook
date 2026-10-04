/**
 * The derived commitment ladder (§2).
 *
 * One test per rung of each type, plus the property that makes the whole thing safe: exactly one
 * state, always. A table of independent conditions could produce two answers; a walk cannot, and
 * these tests are what hold that.
 */

import { describe, expect, test } from "bun:test";

import { LADDER_STATES, ladderState, type WorkItemView } from "../src/lib/ladder.js";
import {
  GATES, RETIRED_GATE, WORK_TYPES, allGateLabels, gateLabel, gateOf, gatesFor, isLegacyGateLabel,
  isPatchMilestone, parseGateLabel, workTypeOf,
} from "../src/lib/model.js";

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
  test("no gates, no milestone → idea", () => {
    expect(ladderState(item()).state).toBe("idea");
  });
  test("no gates, milestone → intent-next", () => {
    expect(ladderState(item({ milestone: "v2.0.0" })).state).toBe("intent-next");
  });
  test("intent open → intent-pending", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [open(1)] })).state).toBe("intent-pending");
  });
  test("intent closed, no proof → proof-next", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1)] })).state).toBe("proof-next");
  });
  test("proof open → proof-pending", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), open(2)] })).state).toBe("proof-pending");
  });
  test("both closed, parent open → build, the in-flight rung", () => {
    const l = ladderState(item({ milestone: "v2.0.0", gates: [closed(1), closed(2)] }));
    expect(l.state).toBe("build");
    expect(l.complete).toBe(true);
  });
  test("parent closed on a milestone → closed-in-milestone", () => {
    const l = ladderState(item({ state: "CLOSED", milestone: "v2.0.0", gates: [closed(1), closed(2)] }));
    expect(l.state).toBe("closed-in-milestone");
  });
  test("a retired gate (ordinal 0) is history, not a stage", () => {
    expect(ladderState(item({ milestone: "v2.0.0", gates: [closed(1), open(0)] })).state).toBe("proof-next");
  });
});

describe("bugfix ladder", () => {
  const bug = (over: Partial<WorkItemView> = {}) => item({ type: "bugfix", ...over });

  test("no milestone → triage-next", () => {
    expect(ladderState(bug()).state).toBe("triage-next");
  });
  test("milestoned → fix: a plain bugfix owes no gates", () => {
    const l = ladderState(bug({ milestone: "v2.0.0" }));
    expect(l.state).toBe("fix");
    expect(l.complete).toBe(true);
  });
  test("a hotfix owes its warrant first", () => {
    expect(ladderState(bug({ hotfix: true, milestone: "v2.0.1" })).state).toBe("warrant-next");
    expect(ladderState(bug({ hotfix: true, milestone: "v2.0.1", gates: [open(1)] })).state).toBe("warrant-pending");
    expect(ladderState(bug({ hotfix: true, milestone: "v2.0.1", gates: [closed(1)] })).state).toBe("fix");
  });
});

describe("experiment ladder", () => {
  const exp = (over: Partial<WorkItemView> = {}) => item({ type: "experiment", ...over });

  test("no gates → charter-next, which means NOT STARTED", () => {
    expect(ladderState(exp()).state).toBe("charter-next");
  });
  test("no pre-schedule split — an experiment never has a milestone to lack", () => {
    expect(ladderState(exp()).state).not.toBe("idea");
  });
  test("charter open → charter-pending", () => {
    expect(ladderState(exp({ gates: [open(1)] })).state).toBe("charter-pending");
  });
  test("charter closed → verdict-next", () => {
    expect(ladderState(exp({ gates: [closed(1)] })).state).toBe("verdict-next");
  });
  test("verdict open → verdict-pending", () => {
    expect(ladderState(exp({ gates: [closed(1), open(2)] })).state).toBe("verdict-pending");
  });
  test("verdict closed → complete: the verdict is the deliverable", () => {
    expect(ladderState(exp({ gates: [closed(1), closed(2)] })).state).toBe("complete");
  });
});

describe("ordering is a walk, not a table of conditions", () => {
  test("a gap in the sequence resolves to the FIRST missing gate", () => {
    // Proof exists but intent does not. First-match must say intent-next, never proof-pending.
    expect(ladderState(item({ milestone: "v2.0.0", gates: [open(2)] })).state).toBe("intent-next");
  });
  test("every work type yields exactly one state for every gate combination", () => {
    for (const type of WORK_TYPES) {
      for (const hotfix of [false, true]) {
        const specs = gatesFor(type, hotfix ? ["hotfix"] : []);
        for (let mask = 0; mask < 3 ** specs.length; mask++) {
          const gates = specs
            .map((s, i) => {
              const digit = Math.floor(mask / 3 ** i) % 3;
              return digit === 0 ? null : { n: s.n, state: digit === 1 ? ("OPEN" as const) : ("CLOSED" as const) };
            })
            .filter((g): g is { n: number; state: "OPEN" | "CLOSED" } => g !== null);
          const l = ladderState(item({ type, hotfix, gates, milestone: "v2.0.0" }));
          expect(LADDER_STATES[type]).toContain(l.state);
        }
      }
    }
  });
});

describe("the taxonomy is generated from one table", () => {
  test("five live gate labels, named by verb", () => {
    expect(allGateLabels()).toEqual(["gate:intent", "gate:proof", "gate:warrant", "gate:charter", "gate:verdict"]);
  });
  test("every verb is unique across types, so the verb alone names the gate", () => {
    const verbs = WORK_TYPES.flatMap((t) => GATES[t].map((g) => g.verb));
    expect(new Set(verbs).size).toBe(verbs.length);
  });
  test("parseGateLabel round-trips gateLabel, and rejects an unknown verb", () => {
    expect(parseGateLabel(gateLabel("improvement", 2))).toEqual({ type: "improvement", n: 2, verb: "proof", retired: false });
    expect(parseGateLabel("gate:design")).toBeNull();
  });
  test("a pre-4.0 label is a gate structurally, but no stage of the 4.x model", () => {
    expect(parseGateLabel("improvement:gate-2")).toEqual({ type: null, n: 0, verb: "legacy", retired: true });
    expect(isLegacyGateLabel("improvement:gate-2")).toBe(true);
    expect(isLegacyGateLabel(gateLabel("improvement", 2))).toBe(false);
  });
  test("gate:retired is a gate, but belongs to no type and no stage", () => {
    expect(gateOf([RETIRED_GATE])).toEqual({ type: null, n: 0, verb: "retired", retired: true });
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
    expect(gateOf(["release-gate", gateLabel("improvement", 2)])?.verb).toBe("proof");
  });
  test("only a hotfix owes the warrant", () => {
    expect(gatesFor("bugfix", [])).toEqual([]);
    expect(gatesFor("bugfix", ["hotfix"]).map((g) => g.verb)).toEqual(["warrant"]);
    expect(gatesFor("improvement", ["hotfix"]).map((g) => g.verb)).toEqual(["intent", "proof"]);
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
