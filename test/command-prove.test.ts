/**
 * `prove` — the one path by which a gate closes without a human, so its refusals matter more than
 * its success: every case where a person still has to decide must exit 1 and close nothing.
 */

import { describe, expect, test } from "bun:test";

import { installFakeGh } from "./support/fake-gh.js";
import { tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { prove } from "../src/commands/prove.js";
import { GATES, gateMarker } from "../src/lib/model.js";

const gh = installFakeGh();

const SEED = GATES.improvement.find((g) => g.verb === "proof")!.seed;

function body(rows: string[], doors: string): string {
  return `${gateMarker(1)}\n\n${SEED}`
    .replace("|---|---|---|", ["|---|---|---|", ...rows].join("\n"))
    .replace(/(### One-way doors\n<!--[\s\S]*?-->)/, `$1\n${doors}`);
}

const proof = (b: string, labels = ["gate:proof"]) => ({ 9: { title: "Proof: x", state: "OPEN", labels, body: b } });

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = (s: unknown) => void lines.push(String(s));
  try {
    const code = await prove(parseArgs(["--repo", "owner/repo", ...argv.slice(1)]), tempRepoRoot(), argv[0]);
    return { code, out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const PROVEN = ["| it builds | ran | `cargo build` → ok |"];

describe("prove — closes only when nothing is left for a human", () => {
  test("proven, no one-way doors, --yes → closes", async () => {
    gh.reset();
    gh.set({ details: proof(body(PROVEN, "None")) });
    const { code } = await run(["9", "--yes"]);
    expect(code).toBe(0);
    expect(gh.callsTo("closeIssue")).toHaveLength(1);
  });

  test("without --yes it only reports", async () => {
    gh.reset();
    gh.set({ details: proof(body(PROVEN, "None")) });
    const { code, out } = await run(["9"]);
    expect(code).toBe(0);
    expect(out).toContain("Closable");
    expect(gh.mutations()).toEqual([]);
  });

  test("an assumed claim → exit 1, nothing closed", async () => {
    gh.reset();
    gh.set({ details: proof(body(["| it is fast | assumed | |"], "None")) });
    const { code, out } = await run(["9", "--yes"]);
    expect(code).toBe(1);
    expect(out).toContain("is assumed");
    expect(gh.mutations()).toEqual([]);
  });

  test("declared one-way doors → exit 1: a human decides however good the evidence", async () => {
    gh.reset();
    gh.set({ details: proof(body(PROVEN, "- the cache directory layout is public")) });
    const { code, out } = await run(["9", "--yes"]);
    expect(code).toBe(1);
    expect(out).toContain("human decision");
    expect(gh.mutations()).toEqual([]);
  });

  test("any other gate is refused outright — only proof closes on evidence", async () => {
    gh.reset();
    gh.set({ details: proof(body(PROVEN, "None"), ["gate:intent"]) });
    const { code } = await run(["9", "--yes"]);
    expect(code).toBe(2);
    expect(gh.mutations()).toEqual([]);
  });
});
