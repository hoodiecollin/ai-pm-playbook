/**
 * Vendoring drift detection.
 *
 * The orphan scan is the dangerous half: it walks the whole vendor dir and reports anything the
 * package does not ship, which `init --force` then offers to delete. Anything else that legitimately
 * lives under `.pm-playbook/` has to be fenced out of that scan explicitly.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BACKLOG_DIR, planVendor, VENDOR_DIR } from "../src/lib/vendor.js";

const made: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-vendor-"));
  made.push(dir);
  return dir;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** A shipped-assets dir and a repo root whose vendor dir already holds the same file. */
function fixture(): { repoRoot: string; sourceDir: string } {
  const sourceDir = tmp();
  const repoRoot = tmp();
  write(join(sourceDir, "AGENT.md"), "doctrine\n");
  write(join(repoRoot, VENDOR_DIR, "AGENT.md"), "doctrine\n");
  return { repoRoot, sourceDir };
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("planVendor — orphan scan", () => {
  test("reports a vendored file the package no longer ships", () => {
    const { repoRoot, sourceDir } = fixture();
    write(join(repoRoot, VENDOR_DIR, "retired.md"), "old section\n");

    expect(planVendor(repoRoot, sourceDir).orphaned).toEqual(["retired.md"]);
  });

  test("does NOT report the materialized backlog as orphaned", () => {
    const { repoRoot, sourceDir } = fixture();
    write(join(repoRoot, VENDOR_DIR, BACKLOG_DIR, "standalone", "42", "body.md"), "# issue 42\n");
    write(join(repoRoot, VENDOR_DIR, BACKLOG_DIR, ".sync", "index.json"), "{}\n");

    // The backlog is machine-owned state, not stale doctrine. Treating it as orphaned would offer
    // the entire local backlog up for deletion on the next `init --force`.
    expect(planVendor(repoRoot, sourceDir).orphaned).toEqual([]);
  });

  test("still reports a genuine orphan alongside a populated backlog", () => {
    const { repoRoot, sourceDir } = fixture();
    write(join(repoRoot, VENDOR_DIR, BACKLOG_DIR, "standalone", "42", "body.md"), "# issue 42\n");
    write(join(repoRoot, VENDOR_DIR, "retired.md"), "old section\n");

    expect(planVendor(repoRoot, sourceDir).orphaned).toEqual(["retired.md"]);
  });

  test("a backlog path is never mistaken for a shipped file", () => {
    const { repoRoot, sourceDir } = fixture();
    write(join(repoRoot, VENDOR_DIR, BACKLOG_DIR, "AGENT.md"), "not doctrine\n");

    const plan = planVendor(repoRoot, sourceDir);
    expect(plan.orphaned).toEqual([]);
    expect(plan.conflicted).toEqual([]);
    expect(plan.updated).toEqual([]);
  });
});

/**
 * A release can leave every vendored file byte-identical and still move the version — a fix that
 * only touches `src/`, or a docs change an earlier run already vendored.
 *
 * `init` used to write the manifest only when file CONTENT differed, so that release left the
 * recorded version behind. That is not cosmetic: PM100 compares the manifest against the installed
 * package, so it warned "your agents are reading stale rules" and named `init` as the fix — and
 * `init` answered "already current" and wrote nothing. The advice looped, and the only escape was
 * `--force`, which is documented for a different problem entirely.
 */
describe("planVendor — a version-only release", () => {
  test("reports no content changes when only the version moved", () => {
    const { repoRoot, sourceDir } = fixture();
    write(join(repoRoot, VENDOR_DIR, "AGENT.md"), "doctrine\n");
    write(join(sourceDir, "AGENT.md"), "doctrine\n");

    const plan = planVendor(repoRoot, sourceDir);
    // This is the state that fooled `init`: nothing to write by content, yet the manifest is stale.
    // `init` must therefore consult the recorded version, not this plan alone, to decide to write.
    expect(plan.added).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(plan.conflicted).toEqual([]);
  });
});
