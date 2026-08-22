/**
 * An issue's neighbourhood — derived, never recorded.
 *
 * §1 bans a third decomposition axis, so there is nowhere in the model to say that two issues
 * constrain each other. A parallel agent is not failing to look; there is nothing to look at. This
 * derives the relation instead of storing it, which is the same argument §8 makes for the Project
 * board: nothing persisted means nothing that can drift.
 *
 * Ranking is by relation strength, strongest first, and the order below IS the ranking.
 */

import { gateOf, workTypeOf, SURFACE_PREFIX } from "../model.js";
import { ladderState, type GateView, type WorkItemView } from "../ladder.js";
import { readSummary } from "./summary.js";
import type { BacklogEntity } from "./model.js";

export type Relation = "mention" | "epic-parent" | "epic-sibling" | "surface" | "milestone";

/** Strongest first. Mention degree is the best signal and the cheapest (p50=3, p90=10, max=29). */
const STRENGTH: Relation[] = ["mention", "epic-parent", "epic-sibling", "surface", "milestone"];

export interface Neighbour {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  labels: string[];
  milestone: string | null;
  relation: Relation;
  /** The rung, via `ladderState`. Null for anything that is not a work item. */
  rung: string | null;
  /** The neighbour's own summary. Undefined until the depth layer expands it. */
  summary?: string | null;
}

/**
 * Issue references in a body or comment thread.
 *
 * Fenced blocks are stripped first: a body quoting a shell transcript or a diff can otherwise
 * generate dozens of spurious references. Beyond that the match is deliberately generous — an
 * over-match costs one roster line, an under-match loses a real relation, and the roster is the
 * cheap layer.
 */
export function mentionsIn(e: BacklogEntity): Set<number> {
  const text = [e.body, ...e.comments.map((c) => c.body)]
    .join("\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");

  const out = new Set<number>();
  for (const m of text.matchAll(/(?:^|[^\w/#])#(\d+)\b/g)) out.add(Number(m[1]));
  out.delete(e.number);
  return out;
}

function rungOf(e: BacklogEntity, gates: BacklogEntity[]): string | null {
  const type = workTypeOf(e.labels);
  if (type === null || gateOf(e.labels) !== null) return null;

  const views: GateView[] = gates
    .map((g) => ({ n: gateOf(g.labels)!.n, state: g.state }))
    .sort((a, b) => a.n - b.n);

  const item: WorkItemView = { number: e.number, type, state: e.state, milestone: e.milestone, gates: views };
  return ladderState(item).state;
}

/**
 * Everything related to `subject`, each at its strongest relation.
 *
 * Gates are excluded: a gate is its parent's *status*, not a neighbour, and including them would
 * bury the roster in entries that say nothing an agent can act on.
 *
 * **`milestone: null` is not a relation.** Measured on forgedb, 63 of 247 issues carry no milestone,
 * so treating null as a shared value would make a third of the backlog everyone's neighbour.
 */
export function neighboursOf(entities: Iterable<BacklogEntity>, subject: number): Neighbour[] {
  const all = [...entities];
  const byNumber = new Map(all.map((e) => [e.number, e]));
  const me = byNumber.get(subject);
  if (!me) return [];

  const gatesOf = new Map<number, BacklogEntity[]>();
  for (const e of all) {
    if (gateOf(e.labels) === null || e.parent === null) continue;
    gatesOf.set(e.parent, [...(gatesOf.get(e.parent) ?? []), e]);
  }

  const found = new Map<number, Relation>();
  const claim = (n: number, relation: Relation) => {
    if (n === subject || !byNumber.has(n)) return;
    if (gateOf(byNumber.get(n)!.labels) !== null) return;
    const existing = found.get(n);
    if (existing === undefined || STRENGTH.indexOf(relation) < STRENGTH.indexOf(existing)) {
      found.set(n, relation);
    }
  };

  // Mentions, both directions. A neighbour that names you constrains you exactly as much as one you
  // name, and only one of the two is visible from your own body.
  for (const n of mentionsIn(me)) claim(n, "mention");
  for (const e of all) {
    if (e.number !== subject && mentionsIn(e).has(subject)) claim(e.number, "mention");
  }

  if (me.parent !== null && byNumber.get(me.parent)?.labels.includes("epic")) {
    claim(me.parent, "epic-parent");
    for (const e of all) if (e.parent === me.parent) claim(e.number, "epic-sibling");
  }
  if (me.labels.includes("epic")) {
    for (const e of all) if (e.parent === subject) claim(e.number, "epic-sibling");
  }

  const surfaces = me.labels.filter((l) => l.startsWith(SURFACE_PREFIX));
  for (const e of all) {
    if (e.state !== "OPEN") continue;
    if (surfaces.some((s) => e.labels.includes(s))) claim(e.number, "surface");
    if (me.milestone !== null && e.milestone === me.milestone) claim(e.number, "milestone");
  }

  const out: Neighbour[] = [...found].map(([number, relation]) => {
    const e = byNumber.get(number)!;
    return {
      number,
      title: e.title,
      state: e.state,
      labels: e.labels,
      milestone: e.milestone,
      relation,
      rung: rungOf(e, gatesOf.get(number) ?? []),
    };
  });

  // Total and stable: relation strength, then issue number. Nothing mutable is a sort key.
  out.sort((a, b) => STRENGTH.indexOf(a.relation) - STRENGTH.indexOf(b.relation) || a.number - b.number);
  return out;
}

/**
 * Which neighbours the depth layer should expand, in order.
 *
 * **Closed neighbours are roster-only, always.** That is what collapses the milestone ring by
 * roughly 90% with nothing hidden — and it is also what makes §9.6's open-only summary guarantee
 * exactly sufficient rather than merely convenient.
 */
export function expandable(neighbours: Neighbour[]): Neighbour[] {
  return neighbours.filter((n) => n.state === "OPEN");
}

/** Attach each neighbour's own summary. Absence stays null — never a guess (§9.6). */
export function withSummaries(
  neighbours: Neighbour[],
  entities: Map<number, BacklogEntity>,
): Neighbour[] {
  return neighbours.map((n) => ({ ...n, summary: readSummary(entities.get(n.number)?.body ?? "").text }));
}
