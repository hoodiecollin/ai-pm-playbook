/**
 * `migrate` — applies GitHub-side label migrations after a MAJOR upgrade.
 *
 * Both paths live here rather than with the read-only commands: on apply it renames and deletes
 * labels and relabels issues, which is shared team state, and it deliberately touches closed issues
 * too so history stays queryable.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { installFakeGh } from "./support/fake-gh.js";
import { tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { migrate } from "../src/commands/migrate.js";
import { MANIFEST_FILE, VENDOR_DIR } from "../src/lib/vendor.js";
import { packageVersion } from "../src/lib/paths.js";

const gh = installFakeGh();

/** A repo that adopted the playbook at `migratedThrough`, with nothing else vendored. */
function adopted(migratedThrough: string): string {
  const root = tempRepoRoot();
  mkdirSync(join(root, VENDOR_DIR), { recursive: true });
  writeFileSync(
    join(root, VENDOR_DIR, MANIFEST_FILE),
    JSON.stringify({
      package: "@hoodiecollin/pm-playbook",
      version: packageVersion(),
      migratedThrough,
      files: {},
    }, null, 2),
    "utf8",
  );
  return root;
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = (s: unknown) => void lines.push(String(s));
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const run = (argv: string[], root: string) =>
  capture(() => migrate(parseArgs(["--repo", "owner/repo", ...argv]), root));

describe("migrate — preconditions", () => {
  test("a repo that never adopted the playbook is exit 2", async () => {
    gh.reset();
    const { code, out } = await run([], tempRepoRoot());
    expect(code).toBe(2);
    expect(out).toContain("init");
    expect(gh.mutations()).toEqual([]);
  });

  test("already migrated through the installed version is exit 0, nothing to do", async () => {
    gh.reset();
    const { code, out } = await run([], adopted(packageVersion()));
    expect(code).toBe(0);
    expect(out).toContain("No pending label migrations");
    // It returns before touching the network at all.
    expect(gh.callsTo("listLabels")).toEqual([]);
  });
});

describe("migrate — preview changes nothing", () => {
  test("a pending migration previews without relabelling", async () => {
    gh.reset();
    gh.set({
      labels: ["maturity:idea", "improvement"],
      issues: [{
        number: 1, title: "old", state: "OPEN",
        url: "https://example.invalid/1", labels: ["maturity:idea"], milestone: null,
      }],
    });

    const { code, out } = await run(["--json"], adopted("1.0.0"));
    expect(code).toBe(0);

    const report = JSON.parse(out);
    expect(report.applied).toBe(false);
    expect(report.migrations.map((m: { version: string }) => m.version)).toContain("2.0.0");

    expect(gh.callsTo("relabelIssue")).toEqual([]);
    expect(gh.callsTo("renameLabel")).toEqual([]);
    expect(gh.callsTo("deleteLabel")).toEqual([]);
  });

  test("it reads ALL states — a migration that skipped closed issues would break history", async () => {
    gh.reset();
    gh.set({ labels: [], issues: [] });
    await run(["--json"], adopted("1.0.0"));

    const [call] = gh.callsTo("listIssues");
    expect(call).toBeDefined();
    expect(call!.args[1]).toBe("all");
  });
});
