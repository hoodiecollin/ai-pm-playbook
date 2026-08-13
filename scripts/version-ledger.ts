/**
 * The version ledger — every file in this repo that declares the package's version.
 *
 * Four assets carry the version and must move together. Three of them had no guard of any kind:
 * nothing in `src/`, `test/` or `scripts/` read `plugin.json` or `marketplace.json`, so a bump that
 * missed one was invisible until someone opened the file. v1.1.0 shipped with a stale stanza and
 * 2.0.0 shipped one teaching a retired taxonomy; both were found by hand.
 *
 * This module is the SINGLE definition of where the versions live, imported by both the check
 * (`test/version-ledger.test.ts`) and the writer (`scripts/version-set.ts`). Two lists would be two
 * things that can disagree — the same class of bug the ledger exists to catch.
 *
 * It lives in `scripts/` rather than `src/` because it is release tooling, not shipped library
 * code: nothing reachable from `dist/` references it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeStanza } from "../src/lib/agent-files.js";

export interface LedgerRow {
  /** Human label for reporting. */
  label: string;
  /** Repo-relative path. */
  file: string;
  /** The version this row currently declares, or null when it cannot be located. */
  read(root: string): string | null;
  /** Rewrite this row to `version`. Throws rather than half-writing. */
  write(root: string, version: string): void;
}

/**
 * Matches the `"version": "…"` field of a JSON manifest.
 *
 * Deliberately a targeted edit rather than `JSON.parse` → `JSON.stringify`: `package.json`
 * round-trips losslessly, but both plugin manifests keep `keywords` inline and re-serializing
 * explodes them across seven lines each (16→23 and 27→34 lines). Every bump would then bury one
 * meaningful line under whitespace churn.
 */
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/g;

function jsonRow(label: string, file: string): LedgerRow {
  return {
    label,
    file,
    read(root) {
      const matches = [...readFileSync(join(root, file), "utf8").matchAll(VERSION_FIELD)];
      // Exactly one is the invariant that makes a targeted edit safe. A second would mean the file
      // gained a nested manifest (a second plugin in `marketplace.json`, say) and a human should
      // decide whether both move together — so this reports "cannot locate" rather than guessing.
      return matches.length === 1 ? matches[0]![2]! : null;
    },
    write(root, version) {
      const path = join(root, file);
      const before = readFileSync(path, "utf8");
      let hits = 0;
      const after = before.replace(VERSION_FIELD, (_m, open: string, _old: string, close: string) => {
        hits += 1;
        return `${open}${version}${close}`;
      });
      if (hits !== 1) {
        throw new Error(`${file}: expected exactly one "version" field, found ${hits} — refusing to write.`);
      }
      writeFileSync(path, after, "utf8");
    },
  };
}

/** The stanza's own heading, e.g. `## Project management — pm-playbook v2.1.0`. */
const STANZA_HEADING = /^## Project management — pm-playbook v(.+)$/m;

const STANZA_FILE = "AGENTS.md";

function stanzaRow(): LedgerRow {
  return {
    label: "This repo's adoption stanza",
    file: STANZA_FILE,
    read(root) {
      return STANZA_HEADING.exec(readFileSync(join(root, STANZA_FILE), "utf8"))?.[1] ?? null;
    },
    // Regenerated wholesale rather than patched, so the stanza is current by construction — the
    // same call `init` makes. A hand-edit inside the markers is discarded, which is intended: the
    // block is generated, and 2.0.0 shipped precisely because a generated block was edited by hand.
    write(root, version) {
      writeStanza(root, STANZA_FILE, version);
    },
  };
}

/**
 * Every version-carrying asset. The FIRST row is the source of truth — the others are checked
 * against it.
 */
export const LEDGER: LedgerRow[] = [
  jsonRow("npm package", "package.json"),
  jsonRow("Claude Code plugin", "plugins/pm-playbook/.claude-plugin/plugin.json"),
  jsonRow("Marketplace entry", ".claude-plugin/marketplace.json"),
  stanzaRow(),
];

export interface LedgerReading {
  label: string;
  file: string;
  version: string | null;
}

export function readLedger(root: string): LedgerReading[] {
  return LEDGER.map((row) => ({ label: row.label, file: row.file, version: row.read(root) }));
}

/** The version the other rows must match. */
export function sourceVersion(root: string): string {
  const version = LEDGER[0]!.read(root);
  if (version === null) throw new Error(`Cannot read the version from ${LEDGER[0]!.file}.`);
  return version;
}

/**
 * Rows that disagree with `expected`, including any whose version could not be located at all.
 *
 * Pure, so the test can feed it synthetic rows and prove it actually reports a mismatch. Asserting
 * only against the real files would pass vacuously if the reader silently returned nothing.
 */
export function mismatches(rows: LedgerReading[], expected: string): LedgerReading[] {
  return rows.filter((r) => r.version !== expected);
}

/** Point every row at `version`. */
export function setVersion(root: string, version: string): void {
  for (const row of LEDGER) row.write(root, version);
}
