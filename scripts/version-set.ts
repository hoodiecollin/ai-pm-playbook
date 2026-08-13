#!/usr/bin/env bun
/**
 * `bun run version:set <x.y.z>` — move every version-carrying asset at once.
 *
 * Four files declare the version and must agree (see `version-ledger.ts` for why and which). Doing
 * that by hand is four edits, and the one that gets forgotten is the stanza — which is generated,
 * so a human editing it by hand is already the wrong shape.
 *
 * NEVER bump by find-and-replace on the version string. `README.md` carries it inside an example
 * payload, `test/structure.test.ts` uses it as an arbitrary milestone fixture, and `release.yml`
 * mentions it in a comment. None of those are ledger rows and none of them may move. This script
 * edits four specific fields and nothing else.
 *
 * It deliberately does NOT commit, tag, or publish. Those are decisions, not side effects.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LEDGER, readLedger, setVersion } from "./version-ledger.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Core semver only — this package's release spine has no pre-release or build-metadata line. */
const SEMVER = /^\d+\.\d+\.\d+$/;

const target = process.argv[2];

if (!target) {
  console.error("usage: bun run version:set <x.y.z>\n");
  console.error("Current ledger:");
  for (const row of readLedger(ROOT)) {
    console.error(`  ${(row.version ?? "UNREADABLE").padEnd(10)} ${row.file}`);
  }
  process.exit(2);
}

if (!SEMVER.test(target)) {
  console.error(`Not a version: ${target}. Expected x.y.z.`);
  process.exit(2);
}

const before = readLedger(ROOT);

setVersion(ROOT, target);

const after = readLedger(ROOT);

console.log(`Version ledger → ${target}\n`);
for (const [i, row] of after.entries()) {
  const was = before[i]!.version ?? "unreadable";
  const changed = was !== row.version;
  console.log(`  ${changed ? "~" : "="} ${row.file}${changed ? `  (was ${was})` : "  unchanged"}`);
}

// A row that did not land is a half-written ledger, which is worse than not running at all: the
// files disagree and the next `bun test` is the only thing standing between that and a release.
const failed = after.filter((r) => r.version !== target);
if (failed.length) {
  console.error(`\nFAILED to set: ${failed.map((r) => r.file).join(", ")}`);
  process.exit(1);
}

console.log(`\n${LEDGER.length} file(s) now declare ${target}. Review with \`git diff\`, then commit.`);
