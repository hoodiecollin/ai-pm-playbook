/**
 * Reading and writing the materialized tree.
 *
 * One deliberate asymmetry: **writing interprets paths, reading does not.** `writeEntity` renders a
 * canonical location from state and parentage, but `readTree` simply finds every `body.md` and
 * trusts its frontmatter. A file in the wrong place therefore still parses, and the next `pull`
 * relocates it — where a path-parsing reader would instead mis-key it and report a delete plus a
 * create.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { walk } from "../fs-util.js";
import { BACKLOG_DIR, VENDOR_DIR } from "../vendor.js";
import { parseBody, parseComment, renderBody, renderComment } from "./serialize.js";
import { BODY_FILE, CONFLICTS_DIR, NEW_DIR, SYNC_DIR, commentFileNames, entityDir } from "./paths.js";
import type { BacklogEntity, Comment } from "./model.js";

export const INDEX_FILE = "index.json";
export const LABELS_FILE = "labels.json";
export const MILESTONES_FILE = "milestones.json";

/** Directories under the backlog root that hold machinery or drafts rather than tracked entities. */
const NON_ENTITY_ROOTS = new Set([SYNC_DIR, NEW_DIR, CONFLICTS_DIR]);

export function backlogRoot(repoRoot: string): string {
  return join(repoRoot, VENDOR_DIR, BACKLOG_DIR);
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Every tracked entity on disk, keyed by number. Ignores `.sync/`, `new/` and `conflicts/`. */
export function readTree(root: string): Map<number, BacklogEntity> {
  const out = new Map<number, BacklogEntity>();
  if (!existsSync(root)) return out;

  for (const rel of walk(root, root, (d) => NON_ENTITY_ROOTS.has(d.split("/")[0]!))) {
    if (!rel.endsWith(`/${BODY_FILE}`)) continue;
    const dir = join(root, dirname(rel));
    const front = parseBody(readFileSync(join(root, rel), "utf8"));
    out.set(front.number, { ...front, comments: readComments(dir) });
  }
  return out;
}

/**
 * A directory's comment thread, ordered oldest-first.
 *
 * Ordering comes from `createdAt` rather than from the filename ordinal: the ordinal is what we
 * *wrote*, and re-deriving order from content keeps a hand-renamed file from reordering a thread.
 */
function readComments(dir: string): Comment[] {
  if (!existsSync(dir)) return [];
  const comments = readdirSync(dir)
    .filter((f) => f.startsWith("comment-") && f.endsWith(".md"))
    .map((f) => parseComment(readFileSync(join(dir, f), "utf8")));
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** Write one entity's `body.md` and comment files to its canonical location. */
export function writeEntity(root: string, e: BacklogEntity, ancestors: BacklogEntity[] = []): string {
  const dir = entityDir(e, ancestors);
  write(join(root, dir, BODY_FILE), renderBody(e));
  const names = commentFileNames(e.comments);
  e.comments.forEach((c, i) => write(join(root, dir, names[i]!), renderComment(c)));
  return dir;
}

/**
 * The chain from the tree root down to an entity's immediate parent.
 *
 * Every level's state appears in the path, so a gate three levels down needs its grandparent as
 * much as its parent — closing the epic has to move the gate too. The walk stops at a broken link
 * rather than throwing: `entityDir` will report the mismatch with the entity's own number, which is
 * a far more useful error than one raised here with no context.
 */
function ancestorsOf(e: BacklogEntity, entities: Map<number, BacklogEntity>): BacklogEntity[] {
  const chain: BacklogEntity[] = [];
  let current = e;
  const seen = new Set<number>([e.number]);
  while (current.parent !== null) {
    const parent = entities.get(current.parent);
    // A cycle cannot happen through GitHub, but a hand-edited tree can produce one, and an infinite
    // loop here would hang `pull` with no output at all.
    if (!parent || seen.has(parent.number)) break;
    chain.unshift(parent);
    seen.add(parent.number);
    current = parent;
  }
  return chain;
}

/**
 * Write the full entity set and delete anything left over.
 *
 * Pruning is what makes a *move* a move: closing an issue renders a new path, and without removing
 * the old directory the tree would hold two copies and `readTree` would see whichever it walked
 * last. Returns the directories removed.
 */
export function writeTree(root: string, entities: Map<number, BacklogEntity>): string[] {
  const keep = new Set<string>();
  for (const e of entities.values()) {
    keep.add(writeEntity(root, e, ancestorsOf(e, entities)));
  }

  const stale: string[] = [];
  for (const rel of walk(root, root, (d) => NON_ENTITY_ROOTS.has(d.split("/")[0]!))) {
    if (!rel.endsWith(`/${BODY_FILE}`)) continue;
    const dir = dirname(rel);
    if (keep.has(dir)) continue;
    stale.push(dir);
    rmSync(join(root, dir), { recursive: true, force: true });
  }
  return stale.sort();
}

/** Set aside a local edit that lost to a remote change, so nothing is silently destroyed. */
export function setAsideConflict(root: string, e: BacklogEntity, stamp: string): string {
  const dir = join(CONFLICTS_DIR, `${e.number}-${stamp}`);
  write(join(root, dir, BODY_FILE), renderBody(e));
  return dir;
}

/** Conflict drafts still awaiting a decision. Surfaced by `check` so they cannot pile up unseen. */
export function listConflicts(root: string): string[] {
  const dir = join(root, CONFLICTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function readIndex(root: string): Map<number, string> {
  const path = join(root, SYNC_DIR, INDEX_FILE);
  if (!existsSync(path)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { hashes?: Record<string, string> };
    return new Map(Object.entries(raw.hashes ?? {}).map(([k, v]) => [Number(k), v]));
  } catch {
    // A torn or hand-mangled index means "no base", which degrades to treating the remote as
    // authoritative — safe, because push refuses without a base it can trust.
    return new Map();
  }
}

/** The repository the snapshot was pulled from, so offline output can still cite real issue URLs. */
export function readIndexRepo(root: string): string | null {
  const path = join(root, SYNC_DIR, INDEX_FILE);
  if (!existsSync(path)) return null;
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { repo?: string }).repo ?? null;
  } catch {
    return null;
  }
}

/**
 * Record the base snapshot.
 *
 * Written LAST by `pull`, on purpose: a crash mid-write then leaves a tree with no index, which is
 * detectable and forces a clean re-pull, rather than an index that lies about a half-written tree.
 */
export function writeIndex(root: string, hashes: Map<number, string>, repo: string): void {
  const sorted = [...hashes.entries()].sort((a, b) => a[0] - b[0]);
  const payload = { repo, hashes: Object.fromEntries(sorted.map(([k, v]) => [String(k), v])) };
  write(join(root, SYNC_DIR, INDEX_FILE), JSON.stringify(payload, null, 2) + "\n");
}

export function writeTable(root: string, file: string, value: unknown): void {
  write(join(root, SYNC_DIR, file), JSON.stringify(value, null, 2) + "\n");
}

export function readTable<T>(root: string, file: string): T | null {
  const path = join(root, SYNC_DIR, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}
