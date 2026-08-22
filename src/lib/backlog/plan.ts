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
  covered?: Set<number> | null,
): SyncPlan {
  const plan: SyncPlan = { push: [], pull: [], conflict: [], remove: [], orphaned: [], unchanged: [] };

  for (const number of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const baseHash = base.get(number) ?? null;
    const localEntity = local.get(number) ?? null;
    const remoteEntity = remote.get(number) ?? null;

    /*
     * Absence means DELETED only within what the fetch was asked to cover. Outside it, absence
     * means "not looked at" — and the two are indistinguishable from here, which is the whole
     * hazard: a scoped fetch without this guard reads every out-of-scope issue as deleted and
     * quietly destroys the local mirror of all of them.
     *
     * Absent, everything is covered, which is exactly today's behavior.
     */
    if (!remoteEntity && covered && !covered.has(number)) {
      if (localEntity) plan.unchanged.push(number);
      continue;
    }

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

/** Why `comment` refused. Ordered as they are checked: presence first, then content. */
export type CommentRefusal = "no-base" | "unknown" | "gone" | "remote-moved" | "local-pending";

export type CommentPlan =
  | { ok: true; target: BacklogEntity }
  | { ok: false; refusal: CommentRefusal };

/**
 * May we post a comment on `target`?
 *
 * Adding a comment cannot violate an invariant and cannot overwrite anyone's work, so almost none of
 * `push`'s machinery applies. What is left is entirely about **when to refuse**, and the whole of
 * that judgement lives here rather than in the command, so it is testable without a network.
 *
 * Two refusals carry the weight:
 *
 *   - **`remote-moved`** is "re-read before you reply." The thread moved since our last pull, so the
 *     copy the author composed against is stale and the reply may be answering something that
 *     changed. The common case is that someone else commented, which is exactly when re-reading is
 *     the point rather than friction.
 *   - **`local-pending`** is the reason this command exists at all. Posting a comment on an issue
 *     with an unpushed body edit moves the remote projection; the edit already moved the local one;
 *     so the next `pull` classifies the issue as a conflict, sets the body aside under `conflicts/`
 *     and restores remote truth over it. The author's edit is demoted by their own comment, through
 *     a path that looks exactly like a teammate's race. This is unwarnable from outside the mirror,
 *     which is why `gh issue comment` cannot be the answer.
 *
 * Presence resolves before content, matching `planSync`. Absence from `base` — never pulled — is the
 * `orphaned` rule applied to one issue: the number refers to nothing we know, so a typo would
 * otherwise comment on a stranger's issue. It is deliberately NOT keyed on the local tree, because
 * deleting a local file means nothing (`store.ts`).
 */
export function planComment(
  base: Map<number, string>,
  local: Map<number, BacklogEntity>,
  remote: Map<number, BacklogEntity>,
  target: number,
): CommentPlan {
  if (base.size === 0) return { ok: false, refusal: "no-base" };

  const baseHash = base.get(target);
  if (baseHash === undefined) return { ok: false, refusal: "unknown" };

  const remoteEntity = remote.get(target);
  if (!remoteEntity) return { ok: false, refusal: "gone" };

  if (projectionHash(remoteEntity) !== baseHash) return { ok: false, refusal: "remote-moved" };

  const localEntity = local.get(target);
  if (localEntity && projectionHash(localEntity) !== baseHash) {
    return { ok: false, refusal: "local-pending" };
  }

  return { ok: true, target: remoteEntity };
}

/**
 * What `pull` writes for an entity with a pending local edit: our fields, the remote's thread.
 *
 * `pull` leaves a pending edit on disk rather than overwriting it — that is what makes it safe to
 * run before `push`. It used to preserve the whole local entity, comments included, which was wrong
 * in a way that compounded: comments are pull-only, so a locally-read thread is never authoritative,
 * and writing a corrupted one back re-materialized it at every ordinal it had ever held.
 *
 * Taking the remote's thread is a no-op on a healthy mirror, because this branch runs only when the
 * remote has NOT moved — so its thread already equals the base's, which is what a healthy local copy
 * holds. On a corrupted one it is the repair, and the phantom edit clears itself on the next pull.
 */
export function mergePending(local: BacklogEntity, remote: BacklogEntity): BacklogEntity {
  return { ...local, comments: remote.comments };
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
