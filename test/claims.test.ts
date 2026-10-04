/**
 * The proof gate's claims table (§2). Its shape is defined once, in `GATES`' proof seed, so these
 * tests parse the seed itself: if the seed and the parser ever disagree, this file fails first.
 */

import { describe, expect, test } from "bun:test";

import { evaluateProof, isUnfilledGate, parseClaims } from "../src/lib/claims.js";
import { GATES, WORK_TYPES, gateMarker } from "../src/lib/model.js";

const PROOF_SEED = GATES.improvement.find((g) => g.verb === "proof")!.seed;

/** A materialized gate body, the way `materialize` writes it. */
const materialized = (seed: string) => `${gateMarker(7)}\n\n> description\n> Parent: #7\n\n${seed}\n`;

/** Fill the seed's table and one-way-door section the way an agent would. */
function filled(rows: string[], doors = "None"): string {
  return materialized(PROOF_SEED)
    .replace("|---|---|---|", ["|---|---|---|", ...rows].join("\n"))
    .replace(/(### One-way doors\n<!--[\s\S]*?-->)/, `$1\n${doors}`);
}

describe("the seed", () => {
  test("parses as an empty claims table, not a missing one", () => {
    expect(parseClaims(PROOF_SEED)).toEqual([]);
  });

  test("an unfilled seed cannot close: no rows, and no one-way-door answer", () => {
    const r = evaluateProof(materialized(PROOF_SEED));
    expect(r.problems.some((p) => p.includes("no rows"))).toBe(true);
    expect(r.oneWay).toBe("missing");
  });

  test("every gate's freshly materialized body reads as unfilled", () => {
    for (const t of WORK_TYPES) for (const g of GATES[t]) expect(isUnfilledGate(materialized(g.seed))).toBe(true);
  });
});

describe("evaluateProof", () => {
  test("ran, read and out-of-scope with evidence, and doors = None → closable", () => {
    const r = evaluateProof(filled([
      "| syn::File is Send | ran | `cargo check` → error E0277, so it is NOT; approach uses per-thread parse |",
      "| generate is called once per build | read | src/build.rs:120 @ abc1234 |",
      "| Windows paths | out-of-scope | no Windows target in 1.x |",
    ]));
    expect(r.problems).toEqual([]);
    expect(r.oneWay).toBe("none");
    expect(r.rows.map((x) => x.status)).toEqual(["ran", "read", "out-of-scope"]);
  });

  test("an assumed claim blocks closing, and names the claim", () => {
    const r = evaluateProof(filled(["| parse cache saves ~19.7 s | assumed | |"]));
    expect(r.problems.join(" ")).toContain('"parse cache saves ~19.7 s" is assumed');
  });

  test("ran or read without evidence is not evidence", () => {
    const r = evaluateProof(filled(["| it builds | ran | |", "| it is wired | `read` |  |"]));
    expect(r.problems).toHaveLength(2);
  });

  test("out-of-scope needs a reason, or it is an assumption with a different name", () => {
    expect(evaluateProof(filled(["| Windows | out-of-scope | |"])).problems).toHaveLength(1);
  });

  test("an unknown status is a finding, not silently ignored", () => {
    expect(evaluateProof(filled(["| it works | probably | trust me |"])).problems[0]).toContain("must be one of");
  });

  test("declared one-way doors are not a problem — they route the decision to a human", () => {
    const r = evaluateProof(filled(["| x | read | a.ts:1 @ abc |"], "- the on-disk format of `.forge/` is permanent"));
    expect(r.problems).toEqual([]);
    expect(r.oneWay).toBe("declared");
  });

  test("`None` is accepted with formatting around it", () => {
    expect(evaluateProof(filled(["| x | read | a.ts:1 @ abc |"], "**None.**")).oneWay).toBe("none");
  });
});

describe("isUnfilledGate", () => {
  test("any written content counts", () => {
    expect(isUnfilledGate(materialized(PROOF_SEED).replace("### Approach", "### Approach\nUse a per-thread cache."))).toBe(false);
  });
});
