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
 * Empty at the initial release — the taxonomy has not changed yet. The machinery ships now so
 * that the first rename is a data change rather than an emergency.
 */
export const MIGRATIONS: Migration[] = [];

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
