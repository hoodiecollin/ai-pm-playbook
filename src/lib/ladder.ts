/**
 * The commitment ladder (PLAYBOOK §2), derived from gate state.
 *
 * Under the previous model these rungs were labels — `idea`, `plan-next` — and two invariants
 * existed solely to detect the case where a human forgot to move one. Deriving them removes the
 * failure rather than detecting it: there is no second copy to disagree with the first.
 *
 * **One rule generates every state.** Walk the type's gates in order; the first gate that is not
 * closed decides the answer — absent means `<verb>-next`, open means `<verb>-pending`. A type
 * contributes only its verbs, so a fourth work type is a row in `GATES` and nothing here changes.
 *
 * The one thing that is not generated is the pre-gate split, because it is genuinely per-type: an
 * unmilestoned improvement is an `idea`, an unmilestoned bugfix is untriaged, and an experiment has
 * no such state at all because it never carries a milestone to lack.
 */

import { GATES, type WorkType } from "./model.js";

export type EntityState = "OPEN" | "CLOSED";

export interface GateView {
  /** Gate ordinal, 1-based. */
  n: number;
  state: EntityState;
}

export interface WorkItemView {
  number: number;
  type: WorkType;
  state: EntityState;
  milestone: string | null;
  /** The gate sub-issues that exist. Order does not matter; ordinals do. */
  gates: GateView[];
}

export interface Ladder {
  /** The rung's name, e.g. `design-next`. */
  state: string;
  /** The gate the state refers to, or null for pre-gate and terminal states. */
  gate: number | null;
  /** Every gate the type defines exists and is closed. */
  complete: boolean;
}

/**
 * What an unmilestoned, ungated work item is called.
 *
 * `experiment` is deliberately absent: it never carries a milestone (§4), so "has no milestone yet"
 * is not a distinguishing fact about one. An ungated experiment falls straight through to
 * `research-next`, which is the model's name for "not started".
 */
const UNSCHEDULED: Partial<Record<WorkType, string>> = {
  improvement: "idea",
  bugfix: "triage-next",
};

/** Every rung this model can produce, in ladder order per type. Printed by `pm-playbook rules`. */
export const LADDER_STATES: Record<WorkType, string[]> = Object.fromEntries(
  (Object.keys(GATES) as WorkType[]).map((t) => [
    t,
    [
      ...(UNSCHEDULED[t] ? [UNSCHEDULED[t]!] : []),
      ...GATES[t].flatMap((g) => [`${g.verb}-next`, `${g.verb}-pending`]),
      "complete",
    ],
  ]),
) as Record<WorkType, string[]>;

/**
 * The rung a work item sits on.
 *
 * Ordered, first match wins, and every rung presumes the gates before it are closed — which is why
 * this is a walk rather than a table of independent conditions. A set of conditions that each
 * mentioned "and all earlier gates are closed" would say the same thing far less clearly, and would
 * let two of them be true at once the moment one was written wrong.
 */
export function ladderState(item: WorkItemView): Ladder {
  const specs = GATES[item.type];
  const byOrdinal = new Map(item.gates.map((g) => [g.n, g]));
  const complete = specs.every((s) => byOrdinal.get(s.n)?.state === "CLOSED");

  if (item.state === "CLOSED") {
    // §2 keeps closed and released distinct; nothing an issue carries can prove a tag exists, so
    // this is as far as derivation honestly goes.
    return { state: item.milestone ? "closed-in-milestone" : "closed", gate: null, complete };
  }

  const unscheduled = UNSCHEDULED[item.type];
  if (unscheduled && !byOrdinal.has(1) && item.milestone === null) {
    return { state: unscheduled, gate: null, complete: false };
  }

  for (const spec of specs) {
    const gate = byOrdinal.get(spec.n);
    if (!gate) return { state: `${spec.verb}-next`, gate: spec.n, complete: false };
    if (gate.state === "OPEN") return { state: `${spec.verb}-pending`, gate: spec.n, complete: false };
  }

  // Every gate closed and the item still open. Legitimate for the length of one merge, and drift
  // after that — PM016 is the rule that says so.
  return { state: "complete", gate: null, complete: true };
}
