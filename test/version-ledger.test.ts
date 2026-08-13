/**
 * The version ledger must agree with `package.json`.
 *
 * Four files declare this package's version, and until now exactly one of them was checked — by
 * PM101, at `warn`, which cannot fail a build. Nothing anywhere read `plugin.json` or
 * `marketplace.json`. v2.1.0 shipped them consistent only because they were compared by hand.
 *
 * This is a test rather than a PM rule on purpose. PM rules ship to consumer repos, where "your
 * marketplace.json disagrees" is meaningless — the ledger is a property of THIS repo's release.
 *
 * It needs no CI wiring: `bun test` already runs in the CI `build` job and in `prepublishOnly`, so
 * this gates every PR and every publish from the moment it exists.
 */

import { describe, expect, test } from "bun:test";

import { LEDGER, mismatches, readLedger, sourceVersion } from "../scripts/version-ledger.js";
import { PACKAGE_ROOT, packageVersion } from "../src/lib/paths.js";
import { stanzaStatus } from "../src/lib/agent-files.js";

const root = PACKAGE_ROOT;

describe("every version-carrying asset agrees", () => {
  test("the source row is package.json, and it is what the CLI reports", () => {
    // If these ever diverge, every other assertion here is measuring the wrong thing.
    expect(LEDGER[0]!.file).toBe("package.json");
    expect(sourceVersion(root)).toBe(packageVersion());
  });

  for (const row of LEDGER) {
    test(`${row.file} declares the source version`, () => {
      // A null reading is a failure, not a skip: it means the field could not be located, which is
      // exactly the state a silent bump would leave behind.
      expect(row.read(root)).toBe(sourceVersion(root));
    });
  }

  test("no row is left over or unaccounted for", () => {
    expect(mismatches(readLedger(root), sourceVersion(root))).toEqual([]);
  });
});

describe("the stanza is current in content, not just in version", () => {
  test("AGENTS.md carries the stanza this version renders", () => {
    // Strictly stronger than the heading check above. `stanzaStatus` compares the FULL rendered
    // block, so it also catches a stanza whose body drifted while its version number stayed right —
    // which is what 2.0.0 shipped: a block headed "v2.0.0" describing the retired 1.x taxonomy.
    expect(stanzaStatus(root, "AGENTS.md", packageVersion())).toBe("current");
  });
});

describe("the comparison actually reports a mismatch", () => {
  // Without these, the suite above could pass vacuously — a reader that silently returned an empty
  // list would satisfy every assertion in it.
  const rows = [
    { label: "source", file: "package.json", version: "1.0.0" },
    { label: "drifted", file: "plugin.json", version: "0.9.0" },
    { label: "unreadable", file: "marketplace.json", version: null },
  ];

  test("flags a row left behind by a bump", () => {
    expect(mismatches(rows, "1.0.0").map((r) => r.file)).toEqual(["plugin.json", "marketplace.json"]);
  });

  test("a version it could not locate counts as a mismatch, never as a pass", () => {
    expect(mismatches([rows[2]!], "1.0.0")).toHaveLength(1);
  });

  test("agreement reports nothing", () => {
    expect(mismatches([{ label: "a", file: "a.json", version: "2.0.0" }], "2.0.0")).toEqual([]);
  });
});
