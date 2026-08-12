/**
 * Label migrations — the upgrade path for a MAJOR doctrine change.
 *
 * The problem this solves: labels live in the CONSUMER's GitHub, not in this package, and
 * `gh label create --force` writes by name. So a release that renames `plan-next` would silently
 * leave every consumer with both labels and every existing issue still carrying the old one. A
 * doctrine that ships breaking changes without a migration path is a doctrine nobody upgrades.
 *
 * Ordering is handled by a dedicated `migratedThrough` field in the vendored manifest rather than
 * by the doctrine `version`. Otherwise `init` (which rewrites `version`) and `migrate` would race:
 * whichever ran first would erase the other's evidence that work was still pending.
 */

/** Rename a label in place, preserving every issue assignment. */
export interface LabelRename {
  from: string;
  to: string;
}

/** Retire a label. Destructive — issues lose it — so `migrate` reports the blast radius first. */
export interface LabelRemoval {
  name: string;
  reason: string;
}

export interface Migration {
  /** The package version that introduced this change. */
  version: string;
  summary: string;
  renames: LabelRename[];
  removals: LabelRemoval[];
}

/**
 * The migration log. Append-only: once a release ships, its entry is history and must never be
 * edited, because consumers upgrading from an older version still have to replay it.
 *
 * **The label half of 2.0 migrates cleanly; the structural half cannot be automated at all.**
 * Nothing here can convert an `rfc` issue into the gate-1 sub-issue of the work item it designs,
 * read intent well enough to assign a work type, or materialize gate sets for work already in
 * flight. `migrate` says so on completion rather than implying the upgrade is finished, because a
 * migration that silently half-applies is worse than one that admits its scope.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: "2.0.0",
    summary: "Work types replace the maturity taxonomy; gates become sub-issues; the ladder is derived.",
    /*
     * Most of these are RENAMES rather than removals, which is what preserves assignments. The
     * many-to-one fan-in onto `improvement` works because `planMigrations` updates its label set as
     * it goes: the first descriptor becomes an in-place rename, and every one after it becomes a
     * merge — relabel each carrier, then delete the source. Both keep the issues.
     *
     * Order matters for exactly that reason, and it is the order below.
     */
    renames: [
      { from: "tech-debt", to: "improvement" },
      { from: "perf", to: "improvement" },
      { from: "config", to: "improvement" },
      { from: "legacy-audit", to: "improvement" },
      { from: "enhancement", to: "improvement" },
      { from: "documentation", to: "improvement" },
      { from: "bug", to: "bugfix" },
    ],
    removals: [
      // The three that carry doctrine meaning, and therefore need a reason a reader will accept.
      { name: "rfc", reason: "Gate 1 is a sub-issue now, not a label. `rfc` also never described how it was used — there was no wider audience to request comment from." },
      { name: "idea", reason: "Derived: a work item with no gate 1 and no milestone IS an idea. A label saying so is a second copy that can disagree." },
      { name: "plan-next", reason: "Derived: the milestone means committed, and the gates say how far along it is. Nothing is left for the label to add." },
      // GitHub's stock set. Every repo has these, none of them belong to this model.
      { name: "good first issue", reason: "GitHub stock label; not part of the two-axis model." },
      { name: "help wanted", reason: "GitHub stock label; not part of the two-axis model." },
      { name: "question", reason: "GitHub stock label; a question is a comment, not a work item." },
      { name: "duplicate", reason: "GitHub stock label; \"closed as duplicate\" is native now." },
      { name: "invalid", reason: "GitHub stock label; \"closed as not planned\" is native now." },
      { name: "wontfix", reason: "GitHub stock label; \"closed as not planned\" is native now." },
    ],
  },
];

/** Compare `1.2.10`-style versions numerically. Pre-release suffixes are ignored. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Migrations a repo still owes, given how far it has already migrated.
 *
 * `from` is null when the repo was never initialised — a fresh adoption owes nothing, because
 * `bootstrap` creates the current taxonomy directly rather than replaying history into it.
 */
export function pendingMigrations(
  from: string | null,
  to: string,
  all: Migration[] = MIGRATIONS,
): Migration[] {
  if (from === null) return [];
  return all
    .filter((m) => compareSemver(m.version, from) > 0 && compareSemver(m.version, to) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version));
}

export type LabelActionKind = "rename" | "merge" | "remove" | "skip";

export interface LabelAction {
  kind: LabelActionKind;
  from: string;
  to?: string;
  /** Issue numbers that carry the source label — the blast radius of a merge or removal. */
  affected: number[];
  reason: string;
}

/**
 * Decide what to do about each migration, given the repo's actual labels and issues.
 *
 * Pure, so the preview and the apply can never disagree — `migrate` prints exactly this plan and
 * then executes exactly this plan.
 *
 * A rename has three cases, and conflating them is how migrations corrupt a backlog:
 *   - only the old label exists  → a true rename; GitHub preserves every assignment.
 *   - both labels exist          → a MERGE: relabel each issue, then delete the old label. This is
 *                                  the case a naive `--force` upgrade silently produces.
 *   - only the new label exists  → already migrated; skip. Makes `migrate` idempotent.
 */
export function planMigrations(
  migrations: Migration[],
  existingLabels: string[],
  issueLabels: { number: number; labels: string[] }[],
): LabelAction[] {
  const labels = new Set(existingLabels);
  const carriers = (name: string) =>
    issueLabels.filter((i) => i.labels.includes(name)).map((i) => i.number);

  const actions: LabelAction[] = [];

  for (const m of migrations) {
    for (const r of m.renames) {
      const hasFrom = labels.has(r.from);
      const hasTo = labels.has(r.to);

      if (!hasFrom && hasTo) {
        actions.push({ kind: "skip", from: r.from, to: r.to, affected: [], reason: `already renamed to \`${r.to}\`` });
        continue;
      }
      if (!hasFrom && !hasTo) {
        actions.push({ kind: "skip", from: r.from, to: r.to, affected: [], reason: "neither label exists on this repo" });
        continue;
      }
      if (hasFrom && !hasTo) {
        actions.push({ kind: "rename", from: r.from, to: r.to, affected: carriers(r.from), reason: "in-place rename; assignments preserved" });
        labels.delete(r.from);
        labels.add(r.to);
        continue;
      }
      actions.push({
        kind: "merge", from: r.from, to: r.to, affected: carriers(r.from),
        reason: `both labels exist — relabel carriers onto \`${r.to}\`, then delete \`${r.from}\``,
      });
      labels.delete(r.from);
    }

    for (const rm of m.removals) {
      if (!labels.has(rm.name)) {
        actions.push({ kind: "skip", from: rm.name, affected: [], reason: "label does not exist on this repo" });
        continue;
      }
      actions.push({ kind: "remove", from: rm.name, affected: carriers(rm.name), reason: rm.reason });
      labels.delete(rm.name);
    }
  }

  return actions;
}
