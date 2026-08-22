/**
 * PM017 — the body-shape rule (§9.6).
 *
 * It is the only invariant that reads a body, which is why it is carried separately from
 * `checkIssues` and why it can run on the mirror only.
 */

import { describe, expect, test } from "bun:test";

import { checkBodies } from "../src/lib/invariants.js";
import { SUMMARY_HEADING } from "../src/lib/backlog/summary.js";
import type { BacklogEntity, EntityKind } from "../src/lib/backlog/model.js";

let counter = 0;
function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  counter += 1;
  const kind: EntityKind = partial.kind ?? "standalone";
  return {
    number: counter, kind, parent: null, title: `entity ${counter}`,
    state: "OPEN", labels: ["improvement"], milestone: null,
    body: `### ${SUMMARY_HEADING}\n\nWhat this is.\n\n### What is the need?\n\nDetail.\n`,
    comments: [],
    ...partial,
  };
}

const rules = (entities: BacklogEntity[]) => checkBodies(entities, "o/r").map((v) => v.rule);

describe("PM017 — presence", () => {
  test("a well-formed body is clean", () => {
    expect(rules([entity()])).toEqual([]);
  });

  test("a body with no slot is flagged", () => {
    expect(rules([entity({ body: "### What is the need?\n\nSomething.\n" })])).toEqual(["PM017"]);
  });

  test("the fix names the heading to add", () => {
    const [v] = checkBodies([entity({ body: "no headings at all" })], "o/r");
    expect(v!.fix).toContain(SUMMARY_HEADING);
  });

  test("an empty slot passes — present but unfilled is a different defect", () => {
    expect(rules([entity({ body: `### ${SUMMARY_HEADING}\n\n### Next\n` })])).toEqual([]);
  });
});

describe("PM017 — position", () => {
  test("a slot that is not first is flagged, and the message says position not absence", () => {
    const body = `### Background\n\nStuff.\n\n### ${SUMMARY_HEADING}\n\nSummary.\n`;
    const [v] = checkBodies([entity({ body })], "o/r");
    expect(v!.rule).toBe("PM017");
    expect(v!.message).toContain("comes first");
    expect(v!.fix).toContain("Move");
  });

  test("a leading HTML comment is not content — every template has one", () => {
    const body = `<!-- how to fill this in -->\n\n### ${SUMMARY_HEADING}\n\nSummary.\n`;
    expect(rules([entity({ body })])).toEqual([]);
  });
});

describe("PM017 — who it applies to", () => {
  test("an epic IS checked — it is read by the same tooling its children are", () => {
    expect(rules([entity({ labels: ["epic"], kind: "epic", body: "## Something else\n" })])).toEqual(["PM017"]);
  });

  test("a gate is exempt — its body is seeded with mandated structure", () => {
    expect(rules([entity({ labels: ["improvement:gate-1"], kind: "gate", body: "### Problem\n" })])).toEqual([]);
  });

  test("a release-gate is exempt for the same reason", () => {
    expect(rules([entity({ labels: ["release-gate"], body: "### What blocks the tag\n" })])).toEqual([]);
  });

  test("a closed issue is exempt — closed issues are never retrofitted", () => {
    expect(rules([entity({ state: "CLOSED", body: "### Something else\n" })])).toEqual([]);
  });

  test("an unlabelled issue is skipped — PM010 is the rule for that, not this one", () => {
    expect(rules([entity({ labels: [], body: "nothing\n" })])).toEqual([]);
  });
});

describe("PM017 — severity", () => {
  test("it is a warning: adopting the playbook must not fail check on the whole backlog", () => {
    const [v] = checkBodies([entity({ body: "### Something else\n" })], "o/r");
    expect(v!.severity).toBe("warn");
  });
});
