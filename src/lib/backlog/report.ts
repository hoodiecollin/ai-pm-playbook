/**
 * What remains on a milestone, as a model.
 *
 * Kept separate from rendering so that "identical output for the same backlog state" is a property
 * of two small pieces rather than one large one — the ordering lives here and is total, and the
 * bytes live in `render.ts`.
 *
 * Nothing here re-derives anything that already has a home: the rung comes from `ladderState`, the
 * purpose line from `readSummary`. A second derivation would be a second answer.
 */

import { gateOf, workTypeOf } from "../model.js";
import { ladderState, type GateView, type WorkItemView } from "../ladder.js";
import { readSummary } from "./summary.js";
import type { BacklogEntity } from "./model.js";

export interface ItemLine {
  number: number;
  title: string;
  /** null when the body has no summary slot. Never a guess — see `readSummary`. */
  summary: string | null;
  rung: string;
  gates: { n: number; closed: boolean }[];
}

export interface Bucket {
  /** null for the standalone bucket, which always sorts last. */
  epic: { number: number; title: string; summary: string | null } | null;
  improvements: ItemLine[];
  bugfixes: ItemLine[];
}

export interface Report {
  milestone: string;
  buckets: Bucket[];
}

const ascending = (a: number, b: number) => a - b;

function lineOf(e: BacklogEntity, gates: BacklogEntity[]): ItemLine {
  const views: GateView[] = gates
    .map((g) => ({ n: gateOf(g.labels)!.n, state: g.state }))
    .sort((a, b) => ascending(a.n, b.n));

  const item: WorkItemView = {
    number: e.number,
    type: workTypeOf(e.labels)!,
    state: e.state,
    milestone: e.milestone,
    gates: views,
  };

  return {
    number: e.number,
    title: e.title,
    summary: readSummary(e.body).text,
    rung: ladderState(item).state,
    gates: views.map((g) => ({ n: g.n, closed: g.state === "CLOSED" })),
  };
}

/**
 * Build the report.
 *
 * Closed work items are absent by construction: the question is what *remains*, and a report that
 * grows monotonically through a cycle is one nobody reads by the end of it. It is also what makes
 * §9.6's open-only summary guarantee exactly sufficient here.
 *
 * `release-gate` issues are excluded at this layer rather than hidden at the render layer. A release
 * gate is a synchronisation mechanism, not work — it carries no purpose to summarise and no gates to
 * report, and `release-check` already answers the question it exists for.
 */
export function buildReport(entities: Iterable<BacklogEntity>, milestone: string): Report {
  const all = [...entities];
  const byNumber = new Map(all.map((e) => [e.number, e]));

  const gatesOf = new Map<number, BacklogEntity[]>();
  for (const e of all) {
    if (gateOf(e.labels) === null || e.parent === null) continue;
    gatesOf.set(e.parent, [...(gatesOf.get(e.parent) ?? []), e]);
  }

  const open = all.filter(
    (e) =>
      e.state === "OPEN" &&
      e.milestone === milestone &&
      gateOf(e.labels) === null &&
      !e.labels.includes("release-gate") &&
      !e.labels.includes("epic") &&
      workTypeOf(e.labels) !== null,
  );

  // Bucket by epic parent. An epic may carry a different milestone from its children, or none at
  // all — it spans releases while they ship incrementally (PM012) — so the bucket is keyed by
  // parentage and never by the epic's own milestone.
  const byEpic = new Map<number | null, BacklogEntity[]>();
  for (const e of open) {
    const parent = e.parent !== null && byNumber.get(e.parent)?.labels.includes("epic") ? e.parent : null;
    byEpic.set(parent, [...(byEpic.get(parent) ?? []), e]);
  }

  const buckets: Bucket[] = [];
  const epicNumbers = [...byEpic.keys()].filter((k): k is number => k !== null).sort(ascending);

  for (const n of epicNumbers) {
    const epic = byNumber.get(n)!;
    buckets.push({
      epic: { number: n, title: epic.title, summary: readSummary(epic.body).text },
      ...split(byEpic.get(n)!, gatesOf),
    });
  }

  const standalone = byEpic.get(null);
  if (standalone?.length) buckets.push({ epic: null, ...split(standalone, gatesOf) });

  return { milestone, buckets };
}

/** Improvements then bugfixes, each by issue number. Every sort key here is immutable. */
function split(items: BacklogEntity[], gatesOf: Map<number, BacklogEntity[]>) {
  const of = (type: string) =>
    items
      .filter((e) => workTypeOf(e.labels) === type)
      .sort((a, b) => ascending(a.number, b.number))
      .map((e) => lineOf(e, gatesOf.get(e.number) ?? []));

  return { improvements: of("improvement"), bugfixes: of("bugfix") };
}
