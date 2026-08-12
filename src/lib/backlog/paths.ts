/**
 * Rendering an entity to its location in the backlog tree.
 *
 * **Identity is the issue number; the path is derived.** A path encodes state and parentage, both
 * of which change over an issue's life — closing, reopening, and reparenting all move files. The
 * sync layer keys on the number precisely so those moves are moves, not delete+create pairs.
 *
 * Pure string rendering: nothing here touches the filesystem.
 */

import { gateOf } from "../model.js";
import type { BacklogEntity, Comment, EntityState } from "./model.js";

export const STANDALONE_DIR = "standalone";
export const EPICS_DIR = "epics";
export const SUBISSUES_DIR = "subissues";
export const GATES_DIR = "gates";
const GATES_DIR_PREFIX = "gate-";
/** Closed work is parked here at whatever level it closed. */
export const CLOSED_DIR = "_";
/** Drafts with no number yet. */
export const NEW_DIR = "new";
/** Local edits set aside by `pull` after a refused push. */
export const CONFLICTS_DIR = "conflicts";
/** Machinery: base snapshot, label/milestone tables, index. Never hand-edited. */
export const SYNC_DIR = ".sync";

export const BODY_FILE = "body.md";

/** Minimum ordinal width. Threads longer than 999 widen past it — see `commentFileNames`. */
const MIN_ORDINAL_WIDTH = 3;

/** `42` when open, `_/42` when closed. Applied independently at each level of nesting. */
function segment(state: EntityState, number: number): string {
  return state === "CLOSED" ? `${CLOSED_DIR}/${number}` : String(number);
}

/**
 * A gate's directory name: `gate-1--42`.
 *
 * The ordinal leads so a listing reads in gate order, and the issue number follows so the directory
 * is still addressable by identity. **No `_/` segment, ever** — see `entityDir`.
 */
export function gateDirName(e: BacklogEntity): string {
  const gate = gateOf(e.labels);
  if (!gate) {
    throw new Error(`#${e.number} is a gate but carries no \`{type}:gate-{n}\` label to name it by.`);
  }
  return `${GATES_DIR_PREFIX}${gate.n}--${e.number}`;
}

/**
 * The directory holding an entity's `body.md` and comment files, relative to the backlog root.
 *
 * `ancestors` is the chain from the root down to the immediate parent — `[epic]` for a sub-issue,
 * `[epic, workItem]` for a gate beneath one. It has to be the whole chain rather than one parent
 * because every level's *state* appears in the path, so closing an epic moves its grandchildren too.
 * Passing the wrong chain, or none, is a programming error rather than something to guess at: a
 * silently mislocated issue would read as a delete plus a create.
 *
 * **Gates do not move when they close.** Everything else relocates under `_/` because closed work is
 * archive; a closed gate is *reference*. §9's whole premise is that each gate's output is the next
 * one's input, so burying the approved gate 1 exactly when gate 2 is being written against it would
 * be backwards. State still lives in the frontmatter, which is what any reader should trust anyway.
 */
export function entityDir(e: BacklogEntity, ancestors: BacklogEntity[] = []): string {
  const parentDir = () => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent) {
      throw new Error(`#${e.number} is a ${e.kind}; its ancestor chain is required to render its path.`);
    }
    if (parent.number !== e.parent) {
      throw new Error(`#${e.number} names parent #${e.parent} but was rendered against #${parent.number}.`);
    }
    return entityDir(parent, ancestors.slice(0, -1));
  };

  switch (e.kind) {
    case "standalone":
      return `${STANDALONE_DIR}/${segment(e.state, e.number)}`;
    case "epic":
      return `${EPICS_DIR}/${segment(e.state, e.number)}`;
    case "subissue":
      return `${parentDir()}/${SUBISSUES_DIR}/${segment(e.state, e.number)}`;
    case "gate":
      return `${parentDir()}/${GATES_DIR}/${gateDirName(e)}`;
  }
}

export function bodyPath(e: BacklogEntity, ancestors: BacklogEntity[] = []): string {
  return `${entityDir(e, ancestors)}/${BODY_FILE}`;
}

/**
 * `comment-<ordinal>--<id>.md`.
 *
 * Both halves earn their place: the zero-padded ordinal makes a directory listing read in thread
 * order, and the ID is the identity the projection hash keys on. Deleting a mid-thread comment
 * therefore renames the files after it without registering as a content change.
 *
 * The separator is a double dash, matching `gateDirName`, so that "ordinal then identity" reads the
 * same everywhere in the tree. Changing it is free: `project.ts` excludes the ordinal from the
 * projection, so no hash moves, and `store.ts` finds comment files by prefix and reads the ID from
 * the comment's own frontmatter rather than parsing it back out of the name.
 */
export function commentFileName(index: number, id: number, width = MIN_ORDINAL_WIDTH): string {
  return `comment-${String(index).padStart(width, "0")}--${id}.md`;
}

/**
 * Filenames for a whole thread, oldest first.
 *
 * The ordinal is a **whole-thread property** — its width depends on how many comments there are, so
 * a comment fetched in isolation cannot be named. That is why this takes the thread rather than one
 * comment, and why no future optimization can introduce a per-comment fetch path.
 */
export function commentFileNames(comments: Comment[]): string[] {
  // "1000" sorts before "999", so a fixed width would silently reorder the tail of a long thread.
  const width = Math.max(MIN_ORDINAL_WIDTH, String(comments.length).length);
  return comments.map((c, i) => commentFileName(i + 1, c.id, width));
}
