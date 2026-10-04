/**
 * The commitment ladder (PLAYBOOK §2), derived from gate state.
 *
 * Under an earlier model these rungs were labels — `idea`, `plan-next` — and two invariants existed
 * solely to detect the case where a human forgot to move one. Deriving them removes the failure
 * rather than detecting it: there is no second copy to disagree with the first.
 *
 * **One rule generates every gate rung.** Walk the gates the item owes, in order; the first that is
 * not closed decides the answer — absent means `<verb>-next`, open means `<verb>-pending`. A type
 * contributes only its verbs, so a fourth work type is a row in `GATES` and nothing here changes.
 *
 * Two things are per-type rather than generated:
 *   - the pre-gate split: an unmilestoned improvement is an `idea`, an unmilestoned bugfix is
 *     untriaged, and an experiment has neither because it never carries a milestone to lack;
 *   - the rung after the last gate. An improvement whose proof is closed is being BUILT, and a
 *     bugfix (which usually has no gates at all) is being FIXED — both legitimately open until the
 *     PR merges. An experiment has no such rung: its verdict is the deliverable, so every gate
 *     closed means it should close (PM016).
 */

import { gatesFor, type WorkType } from "./model.js";

export type EntityState = "OPEN" | "CLOSED";

export interface GateView {
  /** Gate ordinal, 1-based. A retired gate (0) is ignored. */
  n: number;
  state: EntityState;
}

export interface WorkItemView {
  number: number;
  type: WorkType;
  state: EntityState;
  milestone: string | null;
  /** True when the item carries `hotfix`, which is what makes a bugfix owe its warrant. */
  hotfix?: boolean;
  /** The gate sub-issues that exist. Order does not matter; ordinals do. */
  gates: GateView[];
}

export interface Ladder {
  /** The rung's name, e.g. `proof-next`. */
  state: string;
  /** The gate the state refers to, or null for pre-gate and post-gate states. */
  gate: number | null;
  /** Every gate the item owes exists and is closed. */
  complete: boolean;
}

/**
 * What an unmilestoned, ungated work item is called.
 *
 * `experiment` is deliberately absent: it never carries a milestone (§4), so "has no milestone yet"
 * is not a distinguishing fact about one. An ungated experiment falls straight through to
 * `charter-next`, which is the model's name for "not started".
 */
const UNSCHEDULED: Partial<Record<WorkType, string>> = {
  improvement: "idea",
  bugfix: "triage-next",
};

/** The open rung after the last gate. Absent for `experiment`, whose verdict finishes it. */
const AFTER_GATES: Record<WorkType, string> = {
  improvement: "build",
  bugfix: "fix",
  experiment: "complete",
};

/** Every rung this model can produce, in ladder order per type. Printed by `pm-playbook rules`. */
export const LADDER_STATES: Record<WorkType, string[]> = Object.fromEntries(
  (["improvement", "bugfix", "experiment"] as WorkType[]).map((t) => [
    t,
    [
      ...(UNSCHEDULED[t] ? [UNSCHEDULED[t]!] : []),
      // `hotfix` is passed so the bugfix row lists its warrant rungs; a plain bugfix skips them.
      ...gatesFor(t, ["hotfix"]).flatMap((g) => [`${g.verb}-next`, `${g.verb}-pending`]),
      AFTER_GATES[t],
    ],
  ]),
) as Record<WorkType, string[]>;

/**
 * The rung a work item sits on.
 *
 * Ordered, first match wins, and every rung presumes the gates before it are closed — which is why
 * this is a walk rather than a table of independent conditions.
 */
export function ladderState(item: WorkItemView): Ladder {
  const specs = gatesFor(item.type, item.hotfix ? ["hotfix"] : []);
  const byOrdinal = new Map(item.gates.filter((g) => g.n > 0).map((g) => [g.n, g]));
  const complete = specs.every((s) => byOrdinal.get(s.n)?.state === "CLOSED");

  if (item.state === "CLOSED") {
    // §2 keeps closed and released distinct; nothing an issue carries can prove a tag exists, so
    // this is as far as derivation honestly goes.
    return { state: item.milestone ? "closed-in-milestone" : "closed", gate: null, complete };
  }

  const unscheduled = UNSCHEDULED[item.type];
  if (unscheduled && byOrdinal.size === 0 && item.milestone === null) {
    return { state: unscheduled, gate: null, complete: false };
  }

  for (const spec of specs) {
    const gate = byOrdinal.get(spec.n);
    if (!gate) return { state: `${spec.verb}-next`, gate: spec.n, complete: false };
    if (gate.state === "OPEN") return { state: `${spec.verb}-pending`, gate: spec.n, complete: false };
  }

  return { state: AFTER_GATES[item.type], gate: null, complete: true };
}
