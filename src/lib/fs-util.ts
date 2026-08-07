/**
 * Generic filesystem helpers.
 *
 * These are content-addressing and tree-walking primitives with no opinion about what the tree
 * holds. They live here rather than in `vendor.ts` because the materialized backlog needs the same
 * two operations, and depending on the doctrine-vendoring module to hash an issue body would be a
 * dependency that describes history rather than structure.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Recursively list files under `dir`, returned as POSIX-relative paths, sorted.
 *
 * `skip` is consulted with each directory's relative path and prunes the whole subtree. Pruning
 * rather than filtering afterwards is deliberate: the caller that needs this is excluding the
 * materialized backlog, which can be far larger than the tree being walked.
 */
export function walk(dir: string, base = dir, skip?: (rel: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(base, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (skip?.(rel)) continue;
      out.push(...walk(full, base, skip));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}
