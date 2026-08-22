/**
 * What a refresh is asked to cover.
 *
 * Scope is chosen by **naming a thing**, never by taking a quantity. "This milestone, complete" is
 * a statement a later reader can act on; "the first N of this milestone" is not — and a mirror that
 * cannot describe its own coverage in actionable terms is the problem this exists to fix rather
 * than a cheaper version of it. That is why there is no depth and no limit here.
 *
 * Three laws are fixed rather than configurable:
 *
 *   1. **Gates ride with their parent, always.** Never selected, never filtered out, never counted.
 *      A gate carries `improvement:gate-1` rather than `improvement`, so a naive kind filter drops
 *      precisely the children completeness depends on. Membership is also never derived from a
 *      gate's milestone field — that was wrong for three issues in this repository until PM011
 *      caught it.
 *   2. **An epic target brings its children.** Naming a container and getting the container is not
 *      an answer to the question that was asked.
 *   3. **A scope brings its members' ancestors.** Not a membership claim — a mechanical one. A
 *      sub-issue's path is `epics/<epic>/subissues/<n>`, so an entity whose parent is missing
 *      cannot be written to the tree at all. Found by running a scoped pull against a real backlog,
 *      where #51 is a member of a milestone its epic parent does not carry.
 *   4. **A scope is whole or it is refused.** There is no partial success.
 */

import { gateOf, workTypeOf } from "../model.js";
import { bool, list, str, type Args } from "../args.js";
/**
 * The minimum an entity must expose to be scoped. Deliberately structural: a `BacklogEntity`
 * satisfies it, and so does the cheap parentage graph — which is what lets a scope be expanded from
 * a graph of numbers BEFORE any body or comment thread is fetched.
 */
export interface Scopable {
  number: number;
  labels: string[];
  milestone: string | null;
  parent: number | null;
}

export type Target =
  | { kind: "all" }
  | { kind: "milestone"; title: string }
  | { kind: "epic"; number: number }
  | { kind: "unparented" };

/** The five things the two-axis model tracks. Gates are never members of this set. */
export const ISSUE_KINDS = ["epic", "improvement", "bugfix", "experiment", "release-gate"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export interface Scope {
  target: Target;
  /** Empty means every kind within the target. */
  kinds: Set<IssueKind>;
}

export const EVERYTHING: Scope = { target: { kind: "all" }, kinds: new Set() };

export function isEverything(scope: Scope): boolean {
  return scope.target.kind === "all" && scope.kinds.size === 0;
}

/** How a scope reads in a report or a coverage record. Stable, because it gets written to disk. */
export function describeScope(scope: Scope): string {
  const target =
    scope.target.kind === "all" ? "the whole backlog"
      : scope.target.kind === "milestone" ? `milestone ${scope.target.title}`
      : scope.target.kind === "epic" ? `epic #${scope.target.number}`
      : "work under no epic";
  const kinds = scope.kinds.size ? ` (${[...scope.kinds].sort().join(", ")})` : "";
  return `${target}${kinds}`;
}

export function parseScope(args: Args): Scope | { error: string } {
  const milestone = str(args, "milestone");
  const epic = str(args, "epic");
  const unparented = bool(args, "unparented");

  const named = [milestone !== undefined, epic !== undefined, unparented].filter(Boolean).length;
  if (named > 1) {
    return { error: "Pass at most one of --milestone, --epic, --unparented. A scope names one thing." };
  }

  let target: Target = { kind: "all" };
  if (milestone !== undefined) {
    if (!milestone.trim()) return { error: "--milestone needs a milestone title." };
    target = { kind: "milestone", title: milestone };
  } else if (epic !== undefined) {
    const n = Number(epic);
    if (!Number.isInteger(n) || n <= 0) return { error: `--epic needs an issue number, got \`${epic}\`.` };
    target = { kind: "epic", number: n };
  } else if (unparented) {
    target = { kind: "unparented" };
  }

  const kinds = new Set<IssueKind>();
  for (const raw of list(args, "type") ?? []) {
    const k = raw.toLowerCase();
    if (!(ISSUE_KINDS as readonly string[]).includes(k)) {
      return { error: `Unknown --type \`${raw}\`. Expected one or more of: ${ISSUE_KINDS.join(", ")}.` };
    }
    kinds.add(k as IssueKind);
  }

  /*
   * PM003 makes this set empty by construction, so it can never match anything. Returning zero
   * results would be indistinguishable from "already current", which is the same silent-gap failure
   * the coverage record exists to close — so it is a usage error instead.
   */
  if (kinds.has("experiment") && target.kind === "milestone") {
    return {
      error: "`--type experiment` with `--milestone` can never match: PM003 forbids an experiment "
        + "from carrying a milestone at all. Drop one of the two.",
    };
  }

  return { target, kinds };
}

/** The kind an entity presents to a filter. Gates return null — they are never filtered. */
export function kindOf(e: Scopable): IssueKind | null {
  if (gateOf(e.labels) !== null) return null;
  if (e.labels.includes("epic")) return "epic";
  if (e.labels.includes("release-gate")) return "release-gate";
  return workTypeOf(e.labels);
}

/**
 * Does this entity belong on its own account — BEFORE the ride-along laws are applied?
 *
 * Milestone membership is a **field match, not a traversal**: an epic whose children sit on a
 * milestone is not itself a member unless it carries that milestone, because children carry their
 * own (PM012's rationale — an epic spans releases while its children ship incrementally).
 */
export function isMember(e: Scopable, scope: Scope): boolean {
  if (gateOf(e.labels) !== null) return false; // gates arrive via their parent, never on their own

  if (scope.kinds.size) {
    const kind = kindOf(e);
    if (kind === null || !scope.kinds.has(kind)) return false;
  }

  switch (scope.target.kind) {
    case "all":
      return true;
    case "milestone":
      return e.milestone === scope.target.title;
    case "epic":
      return e.number === scope.target.number || e.parent === scope.target.number;
    case "unparented":
      return e.parent === null && !e.labels.includes("epic");
  }
}

/**
 * Every issue number the scope covers: members, plus every gate of a member, plus the children of a
 * targeted epic.
 *
 * The gate sweep runs over the WHOLE entity set rather than the members, and by `parent` rather
 * than by milestone. Both matter: a gate excluded by the kind filter must still ride along, and a
 * gate whose milestone disagrees with its parent's is still that parent's gate.
 */
export function expand(entities: Iterable<Scopable>, scope: Scope): Set<number> {
  const all = [...entities];
  const covered = new Set<number>();

  for (const e of all) {
    if (isMember(e, scope)) covered.add(e.number);
  }

  // An epic target brings its children even where the kind filter would have excluded them —
  // otherwise "this epic" answers with a container and nothing in it.
  if (scope.target.kind === "epic") {
    const n = scope.target.number;
    for (const e of all) {
      if (e.number === n || e.parent === n) covered.add(e.number);
    }
  }

  const byNumber = new Map(all.map((e) => [e.number, e]));

  /*
   * Gates ride down, ancestors ride up, and both to a fixed point — a gate's parent may have
   * arrived via the epic sweep, and an ancestor pulled in here may itself have a parent.
   */
  for (;;) {
    let grew = false;

    for (const e of all) {
      if (gateOf(e.labels) === null) continue;
      if (e.parent === null || covered.has(e.number)) continue;
      if (covered.has(e.parent)) {
        covered.add(e.number);
        grew = true;
      }
    }

    // Ancestors: every level's state appears in a descendant's path, so a member without its chain
    // is unwritable, not merely under-described.
    for (const n of [...covered]) {
      const parent = byNumber.get(n)?.parent ?? null;
      if (parent !== null && !covered.has(parent) && byNumber.has(parent)) {
        covered.add(parent);
        grew = true;
      }
    }

    if (!grew) break;
  }

  return covered;
}
