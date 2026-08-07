/**
 * Vendoring — how doctrine reaches an agent's context window.
 *
 * Why copy into the consumer's repo instead of referencing `node_modules/`:
 *   - cloud agents, CI containers and review sandboxes routinely have no `node_modules`;
 *   - a committed file is diffable, so a doctrine change shows up in PR review;
 *   - every harness can read repo files; none reliably resolve a package path from prose.
 *
 * The cost of copying is drift, so we pay for it with a manifest: package version + a SHA-256 per
 * file. `check` compares the two and tells you to re-run `init`. That is the lockfile pattern
 * applied to prose.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { sha256, walk } from "./fs-util.js";

export { sha256, walk };

export const VENDOR_DIR = ".pm-playbook";
export const MANIFEST_FILE = "manifest.json";

/**
 * The materialized backlog, which lives under the vendor dir but is NOT vendored doctrine.
 *
 * It is machine-owned local state: `pull` writes it, it is gitignored in consumer repos, and the
 * package ships none of it. That makes it invisible to `walk(sourceDir)` and therefore an orphan
 * by default — which would offer the entire local backlog for deletion on the next `init --force`.
 * Every scan over the vendor dir must prune it.
 */
export const BACKLOG_DIR = "backlog";

export interface Manifest {
  package: string;
  version: string;
  /**
   * The version through which GitHub-side label migrations have been applied.
   *
   * Tracked separately from `version` because the two advance independently: `init` rewrites the
   * vendored doctrine (bumping `version`) while the repo's labels are still on the old taxonomy.
   * Collapsing them would make `init` erase the evidence that `migrate` still had work to do.
   *
   * A fresh adoption is born current — `bootstrap` creates today's taxonomy directly rather than
   * replaying history into it — so `init` seeds this with the installed version on first run and
   * preserves whatever is already there on every subsequent run.
   */
  migratedThrough: string;
  /** POSIX-relative path within the vendor dir -> sha256 of the content we wrote. */
  files: Record<string, string>;
}

export function readManifest(repoRoot: string): Manifest | null {
  const path = join(repoRoot, VENDOR_DIR, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export interface VendorPlan {
  /** Files that will be created. */
  added: string[];
  /** Files whose content will change and that still match their manifest hash (safe to rewrite). */
  updated: string[];
  /** Files edited locally since the last init — refuse to clobber these without --force. */
  conflicted: string[];
  /** Files present in the vendor dir that the package no longer ships. */
  orphaned: string[];
}

/**
 * Diff the shipped playbook against what is vendored, WITHOUT writing anything.
 *
 * `conflicted` is the important column: a file whose on-disk content matches neither what we are
 * about to write nor what the manifest says we last wrote has been hand-edited. Silently
 * overwriting that would destroy a deliberate local override.
 */
export function planVendor(repoRoot: string, sourceDir: string): VendorPlan {
  const manifest = readManifest(repoRoot);
  const target = join(repoRoot, VENDOR_DIR);
  const shipped = walk(sourceDir);

  const plan: VendorPlan = { added: [], updated: [], conflicted: [], orphaned: [] };

  for (const rel of shipped) {
    const dest = join(target, ...rel.split("/"));
    const next = readFileSync(join(sourceDir, ...rel.split("/")), "utf8");
    if (!existsSync(dest)) {
      plan.added.push(rel);
      continue;
    }
    const current = readFileSync(dest, "utf8");
    if (sha256(current) === sha256(next)) continue; // already correct
    const recorded = manifest?.files[rel];
    if (recorded && recorded === sha256(current)) plan.updated.push(rel);
    else plan.conflicted.push(rel);
  }

  const shippedSet = new Set(shipped);
  for (const rel of walk(target, target, (d) => d === BACKLOG_DIR)) {
    if (rel === MANIFEST_FILE) continue;
    if (!shippedSet.has(rel)) plan.orphaned.push(rel);
  }

  return plan;
}

/** Write the vendored tree + manifest. Assumes conflicts have been resolved or forced. */
export function writeVendor(repoRoot: string, sourceDir: string, version: string, pkg: string): Manifest {
  const target = join(repoRoot, VENDOR_DIR);
  const files: Record<string, string> = {};
  // Preserve migration progress across an upgrade; seed it on first adoption.
  const migratedThrough = readManifest(repoRoot)?.migratedThrough ?? version;

  for (const rel of walk(sourceDir)) {
    const content = readFileSync(join(sourceDir, ...rel.split("/")), "utf8");
    const dest = join(target, ...rel.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, "utf8");
    files[rel] = sha256(content);
  }

  const manifest: Manifest = { package: pkg, version, migratedThrough, files };
  mkdirSync(target, { recursive: true });
  // Deliberately no timestamp: re-running `init` on an unchanged version must be a no-op diff.
  writeFileSync(join(target, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

/** Record that label migrations have been applied through `version`. Called only by `migrate`. */
export function setMigratedThrough(repoRoot: string, version: string): void {
  const manifest = readManifest(repoRoot);
  if (!manifest) throw new Error(`No ${VENDOR_DIR}/${MANIFEST_FILE} — run \`init\` first.`);
  const next: Manifest = { ...manifest, migratedThrough: version };
  writeFileSync(
    join(repoRoot, VENDOR_DIR, MANIFEST_FILE),
    JSON.stringify(next, null, 2) + "\n",
    "utf8",
  );
}

export interface DriftReport {
  vendored: boolean;
  vendoredVersion: string | null;
  installedVersion: string;
  versionMismatch: boolean;
  modified: string[];
  missing: string[];
}

/** Local-only drift check — no network, safe to run in any CI job. */
export function detectDrift(repoRoot: string, installedVersion: string): DriftReport {
  const manifest = readManifest(repoRoot);
  if (!manifest) {
    return {
      vendored: false, vendoredVersion: null, installedVersion,
      versionMismatch: false, modified: [], missing: [],
    };
  }

  const target = join(repoRoot, VENDOR_DIR);
  const modified: string[] = [];
  const missing: string[] = [];

  for (const [rel, hash] of Object.entries(manifest.files)) {
    const path = join(target, ...rel.split("/"));
    if (!existsSync(path)) {
      missing.push(rel);
      continue;
    }
    if (sha256(readFileSync(path, "utf8")) !== hash) modified.push(rel);
  }

  return {
    vendored: true,
    vendoredVersion: manifest.version,
    installedVersion,
    versionMismatch: manifest.version !== installedVersion,
    modified,
    missing,
  };
}
