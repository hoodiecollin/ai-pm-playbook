/**
 * The label set is static data that is written to a live API, and GitHub rejects an over-long
 * description with a 422 rather than truncating it. That failure is invisible until `bootstrap`
 * runs against a real repo — by which point the repo is half-provisioned and every downstream
 * check reads a missing label as "nothing is labelled that way".
 *
 * These are the checks that move that failure to build time, where a static constraint on static
 * data belongs.
 */

import { describe, expect, test } from "bun:test";
import {
  CORE_LABELS, GATES, GATE_LABELS, MAX_LABEL_DESCRIPTION, TYPE_LABELS, WORK_TYPES, gateLabel, surfaceLabel,
} from "../src/lib/model.js";

describe("label descriptions fit GitHub's limit", () => {
  for (const l of CORE_LABELS) {
    test(`${l.name} (${l.description.length} chars)`, () => {
      expect(l.description.length).toBeLessThanOrEqual(MAX_LABEL_DESCRIPTION);
    });
  }

  test("a surface label with a long name still fits", () => {
    // Dynamic, so it cannot be enumerated above — this is the worst case a caller can produce
    // before the name itself becomes unusable.
    const l = surfaceLabel("a".repeat(40));
    expect(l.description.length).toBeLessThanOrEqual(MAX_LABEL_DESCRIPTION);
  });
});

describe("the short form is a real sentence, not a truncation", () => {
  for (const type of WORK_TYPES) {
    for (const g of GATES[type]) {
      test(`${gateLabel(type, g.n)} names its gate and ends cleanly`, () => {
        expect(g.labelDescription).toStartWith(`Gate ${g.n} —`);
        expect(g.labelDescription).toEndWith(".");
        // A truncation would end mid-word with an ellipsis; a rewrite does not.
        expect(g.labelDescription).not.toContain("…");
        expect(g.labelDescription).not.toContain("...");
      });
    }
  }
});

describe("the generated set stays in step with GATES", () => {
  test("one gate label per gate, and nothing else", () => {
    const expected = WORK_TYPES.flatMap((t) => GATES[t].map((g) => gateLabel(t, g.n)));
    expect(GATE_LABELS.map((l) => l.name)).toEqual(expected);
  });

  test("gate labels carry the SHORT form, not the prose one", () => {
    // The regression this guards: `description` and `labelDescription` are both on GateSpec, and
    // wiring the generator to the wrong one type-checks perfectly while breaking every write.
    for (const type of WORK_TYPES) {
      for (const g of GATES[type]) {
        const label = GATE_LABELS.find((l) => l.name === gateLabel(type, g.n))!;
        expect(label.description).toBe(g.labelDescription);
      }
    }
  });

  test("label names are unique", () => {
    const names = CORE_LABELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every work type has a type label", () => {
    for (const t of WORK_TYPES) expect(TYPE_LABELS.some((l) => l.name === t)).toBe(true);
  });
});
