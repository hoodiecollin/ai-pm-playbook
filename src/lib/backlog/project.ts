/**
 * The projection — an entity reduced to exactly the state we claim to own, in canonical form.
 *
 * Every sync decision compares projection hashes, so this function's field set *is* the contract
 * for what counts as a change. Two failure modes bound it from either side: include something we do
 * not model and `push` refuses forever over noise it cannot even represent; omit something a
 * teammate can edit and `push` silently overwrites their work.
 *
 * Notably included: the **whole comment thread**. Gates 1 and 2 live in comments (PLAYBOOK §9), so
 * a new comment is a change to something we own — being forced to re-read before pushing a body
 * edit is the correct behavior, not friction.
 *
 * Notably excluded: the comment *ordinal*. It is a rendered property of thread position, so
 * comments are canonicalized by ID and a deletion registers as the content change it is rather than
 * as a mass renumbering.
 */

import { sha256 } from "../fs-util.js";
import type { BacklogEntity } from "./model.js";

/**
 * Canonical JSON for an entity. Key order is fixed by construction; the two collections that have
 * no meaningful order — labels and comments — are sorted so that GitHub returning them differently
 * between two fetches cannot fabricate a difference.
 */
export function project(e: BacklogEntity): string {
  return JSON.stringify({
    number: e.number,
    kind: e.kind,
    parent: e.parent,
    title: e.title,
    state: e.state,
    labels: [...e.labels].sort(),
    milestone: e.milestone,
    body: e.body,
    comments: [...e.comments]
      .sort((a, b) => a.id - b.id)
      .map((c) => ({ id: c.id, author: c.author, createdAt: c.createdAt, body: c.body })),
  });
}

export function projectionHash(e: BacklogEntity): string {
  return sha256(project(e));
}
