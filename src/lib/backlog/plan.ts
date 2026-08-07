/**
 * The three-state comparison: base (as of the last pull), local now, remote now.
 *
 * `push` refuses rather than merges, which makes this the whole correctness argument for the
 * feature — the only way a teammate's edit gets destroyed is if a conflict is mislabelled as a
 * push. Everything here is pure: three maps in, a plan out, no IO and no network.
 *
 * This is `planVendor` (see `../vendor.ts`) generalized from files to entities. That function
 * already implements exactly this pattern for the doctrine tree, where `conflicted` means "matches
 * neither what we are about to write nor the manifest" — precisely `local ≠ base ∧ remote ≠ base`.
 */

import { projectionHash } from "./project.js";
import type { BacklogEntity } from "./model.js";

export type Verdict = "unchanged" | "push" | "pull" | "conflict" | "remove" | "orphaned";

export interface Conflict {
  number: number;
  /** The edit that will be set aside under `conflicts/`. */
  local: BacklogEntity;
  /** Remote truth, which reclaims the canonical path. */
  remote: BacklogEntity;
}

export interface SyncPlan {
  /** Local moved, remote did not — safe to send. */
  push: BacklogEntity[];
  /** Remote moved, local did not (or local is absent) — write remote truth locally. */
  pull: BacklogEntity[];
  /** Both moved. Refused: never merged, never silently resolved. */
  conflict: Conflict[];
  /** Present locally and in base, gone from the remote — delete the local copy. */
  remove: number[];
  /**
   * Present locally, in neither base nor remote. Never pushed: the number refers to nothing we have
   * ever seen, so writing it would either fail or edit a stranger's issue.
   */
  orphaned: number[];
  unchanged: number[];
}

const ascending = (a: number, b: number) => a - b;

/**
 * Classify every entity across the three sides.
 *
 * `base` maps issue number to the projection hash recorded at the last pull. Absence from `base`
 * means "never pulled," which is why a brand-new remote issue and a locally invented one are
 * distinguishable at all.
 */
export function planSync(
  base: Map<number, string>,
  local: Map<number, BacklogEntity>,
  remote: Map<number, BacklogEntity>,
): SyncPlan {
  const plan: SyncPlan = { push: [], pull: [], conflict: [], remove: [], orphaned: [], unchanged: [] };

  for (const number of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const baseHash = base.get(number) ?? null;
    const localEntity = local.get(number) ?? null;
    const remoteEntity = remote.get(number) ?? null;

    // Gone from the remote. GitHub is authoritative, so this is a local deletion rather than
    // something to push back — an issue can be deleted or transferred out from under us.
    if (!remoteEntity) {
      if (localEntity && baseHash) plan.remove.push(number);
      else if (localEntity) plan.orphaned.push(number);
      // In base only: a stale entry for something already reconciled away. Drop it.
      continue;
    }

    const remoteHash = projectionHash(remoteEntity);

    // Absent locally — either never pulled, or deleted on disk. Deleting a local file means
    // nothing (#1), so both resolve the same way: take remote truth.
    if (!localEntity) {
      plan.pull.push(remoteEntity);
      continue;
    }

    const localHash = projectionHash(localEntity);

    // No base to compare against: the file exists locally but was never pulled. Treat the remote as
    // the reference rather than guessing that the local copy is an intentional edit.
    if (baseHash === null) {
      if (localHash !== remoteHash) plan.pull.push(remoteEntity);
      else plan.unchanged.push(number);
      continue;
    }

    const localMoved = localHash !== baseHash;
    const remoteMoved = remoteHash !== baseHash;

    if (localMoved && remoteMoved) {
      // Both sides moved to the *same* place — someone applied the edit upstream already.
      if (localHash === remoteHash) plan.unchanged.push(number);
      else plan.conflict.push({ number, local: localEntity, remote: remoteEntity });
    } else if (localMoved) {
      plan.push.push(localEntity);
    } else if (remoteMoved) {
      plan.pull.push(remoteEntity);
    } else {
      plan.unchanged.push(number);
    }
  }

  // Deterministic output: a plan is printed to a human and diffed in tests.
  plan.push.sort((a, b) => ascending(a.number, b.number));
  plan.pull.sort((a, b) => ascending(a.number, b.number));
  plan.conflict.sort((a, b) => ascending(a.number, b.number));
  plan.remove.sort(ascending);
  plan.orphaned.sort(ascending);
  plan.unchanged.sort(ascending);

  return plan;
}

/** Does this plan contain anything that would change either side? */
export function isEmpty(plan: SyncPlan): boolean {
  return (
    plan.push.length === 0 &&
    plan.pull.length === 0 &&
    plan.conflict.length === 0 &&
    plan.remove.length === 0
  );
}
