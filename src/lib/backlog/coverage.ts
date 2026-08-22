/**
 * What the mirror knows it has looked at.
 *
 * Without this, a partial mirror and a complete one are indistinguishable on disk — and everything
 * that reads the mirror offline would confidently report a subset as the whole. `check --no-remote`
 * is the sharp case: its value rests on the tree being complete, so a partial mirror makes
 * structural rules report the exact state they exist to catch, backwards.
 *
 * It lives under `.sync/` rather than in the entity tree because that directory already holds this
 * class of fact (the repository the snapshot came from, the label and milestone tables) and is
 * already excluded from the walk that prunes. Putting it in the tree would make the pruner delete it.
 *
 * Coverage only ever GROWS within a mirror's life. A later narrow pull does not shrink what earlier
 * pulls established, because those entities are still on disk and still accurate as of when they
 * were written. Only a full pull resets it, and it resets it to everything.
 */

import { readTable, writeTable } from "./store.js";
import { describeScope, isEverything, type Scope } from "./scope.js";

export const COVERAGE_FILE = "coverage.json";

export interface Coverage {
  /** True when a full pull has run — the mirror covers the repository. */
  everything: boolean;
  /** Human-readable descriptions of the scopes recorded, oldest first. For reporting only. */
  scopes: string[];
  /** Every issue number some recorded scope covered. Empty when `everything` is true. */
  covered: Set<number>;
}

interface Stored {
  everything: boolean;
  scopes: string[];
  covered: number[];
}

/** No record at all means an unknown mirror, which is NOT the same as an empty one. */
export const UNKNOWN: Coverage = { everything: false, scopes: [], covered: new Set() };

export function readCoverage(root: string): Coverage {
  const raw = readTable<Stored>(root, COVERAGE_FILE);
  if (!raw) return UNKNOWN;
  return {
    everything: raw.everything === true,
    scopes: Array.isArray(raw.scopes) ? raw.scopes : [],
    covered: new Set(Array.isArray(raw.covered) ? raw.covered : []),
  };
}

export function writeCoverage(root: string, coverage: Coverage): void {
  writeTable(root, COVERAGE_FILE, {
    everything: coverage.everything,
    scopes: coverage.scopes,
    // Sorted so the file diffs cleanly and two equivalent pulls produce identical bytes.
    covered: coverage.everything ? [] : [...coverage.covered].sort((a, b) => a - b),
  } satisfies Stored);
}

/** Fold a completed refresh into what was already known. */
export function mergeCoverage(prior: Coverage, scope: Scope, numbers: Set<number>): Coverage {
  if (isEverything(scope)) {
    // A full pull supersedes every partial record rather than being unioned with it — carrying the
    // old scope descriptions forward would misreport a now-complete mirror as patchwork.
    return { everything: true, scopes: [describeScope(scope)], covered: new Set() };
  }
  if (prior.everything) {
    // The mirror was already complete and a narrower pull refreshed part of it. Still complete.
    return prior;
  }
  return {
    everything: false,
    scopes: [...prior.scopes, describeScope(scope)],
    covered: new Set([...prior.covered, ...numbers]),
  };
}

/** Does the mirror cover this whole scope? */
export function describes(coverage: Coverage, wanted: Set<number>): boolean {
  if (coverage.everything) return true;
  for (const n of wanted) if (!coverage.covered.has(n)) return false;
  return true;
}

/** One line for a reader, or null when the mirror covers everything and there is nothing to warn about. */
export function shortfall(coverage: Coverage): string | null {
  if (coverage.everything) return null;
  if (!coverage.scopes.length) return "the mirror has no coverage record — it predates scoped pulls, or no pull has run";
  return `the mirror covers ${coverage.covered.size} issue(s) from: ${coverage.scopes.join("; ")}`;
}
