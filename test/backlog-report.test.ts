/**
 * The milestone report — model and render (#58).
 *
 * The render's determinism and width are the two properties the design rests on, so they are
 * asserted as properties rather than against a golden string that would need updating on every
 * wording change.
 */

import { describe, expect, test } from "bun:test";

import { buildReport } from "../src/lib/backlog/report.js";
import { MAX_WIDTH, renderReport } from "../src/lib/backlog/render.js";
import { SUMMARY_HEADING } from "../src/lib/backlog/summary.js";
import type { BacklogEntity, EntityKind } from "../src/lib/backlog/model.js";

let counter = 0;
function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  counter += 1;
  const kind: EntityKind = partial.kind ?? "standalone";
  return {
    number: counter, kind, parent: null, title: `entity ${counter}`,
    state: "OPEN", labels: ["improvement"], milestone: "v1.0.0",
    body: `### ${SUMMARY_HEADING}\n\nWhat this is.\n\n### Detail\n\nMore.\n`,
    comments: [],
    ...partial,
  };
}

const gate = (number: number, parent: number, n: number, state: "OPEN" | "CLOSED" = "OPEN") =>
  entity({ number, parent, kind: "gate", labels: [`improvement:gate-${n}`], state });

const widest = (s: string) => Math.max(...s.split("\n").map((l) => l.length));

describe("buildReport — bucketing", () => {
  test("an epic bucket holds its children; standalone work goes in its own bucket, last", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic", milestone: null });
    const child = entity({ number: 2, parent: 1, kind: "subissue" });
    const alone = entity({ number: 3 });

    const report = buildReport([epic, child, alone], "v1.0.0");
    expect(report.buckets).toHaveLength(2);
    expect(report.buckets[0]!.epic!.number).toBe(1);
    expect(report.buckets[0]!.improvements.map((i) => i.number)).toEqual([2]);
    expect(report.buckets[1]!.epic).toBeNull();
    expect(report.buckets[1]!.improvements.map((i) => i.number)).toEqual([3]);
  });

  test("an epic carrying no milestone still gets a bucket — an epic spans releases (PM012)", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic", milestone: null });
    const child = entity({ number: 2, parent: 1, kind: "subissue", milestone: "v1.0.0" });
    expect(buildReport([epic, child], "v1.0.0").buckets[0]!.epic!.number).toBe(1);
  });

  test("improvements come before bugfixes, each by issue number", () => {
    const items = [
      entity({ number: 4, labels: ["bugfix"] }),
      entity({ number: 3, labels: ["improvement"] }),
      entity({ number: 2, labels: ["bugfix"] }),
      entity({ number: 1, labels: ["improvement"] }),
    ];
    const bucket = buildReport(items, "v1.0.0").buckets[0]!;
    expect(bucket.improvements.map((i) => i.number)).toEqual([1, 3]);
    expect(bucket.bugfixes.map((i) => i.number)).toEqual([2, 4]);
  });
});

describe("buildReport — what is excluded", () => {
  test("a release-gate appears in no bucket — it is a sync mechanism, not work", () => {
    const rg = entity({ number: 1, labels: ["release-gate"] });
    const work = entity({ number: 2 });
    const bucket = buildReport([rg, work], "v1.0.0").buckets[0]!;
    expect(bucket.improvements.map((i) => i.number)).toEqual([2]);
  });

  test("a closed work item is absent — the question is what REMAINS", () => {
    const closed = entity({ number: 1, state: "CLOSED" });
    expect(buildReport([closed], "v1.0.0").buckets).toEqual([]);
  });

  test("work on another milestone is absent", () => {
    expect(buildReport([entity({ number: 1, milestone: "v9.0.0" })], "v1.0.0").buckets).toEqual([]);
  });

  test("gates are not listed as items — they are the item's status", () => {
    const work = entity({ number: 1 });
    const g = gate(2, 1, 1);
    const bucket = buildReport([work, g], "v1.0.0").buckets[0]!;
    expect(bucket.improvements.map((i) => i.number)).toEqual([1]);
  });
});

describe("buildReport — per item", () => {
  test("the rung comes from ladderState, and gate marks show closed vs open", () => {
    const work = entity({ number: 1 });
    const items = [work, gate(2, 1, 1, "CLOSED"), gate(3, 1, 2), gate(4, 1, 3)];
    const line = buildReport(items, "v1.0.0").buckets[0]!.improvements[0]!;
    expect(line.rung).toBe("plan-pending");
    expect(line.gates).toEqual([{ n: 1, closed: true }, { n: 2, closed: false }, { n: 3, closed: false }]);
  });

  test("a body with no summary slot yields null — never a fallback to the first section", () => {
    const work = entity({ number: 1, body: "### What is the need?\n\nSomething.\n" });
    expect(buildReport([work], "v1.0.0").buckets[0]!.improvements[0]!.summary).toBeNull();
  });
});

describe("renderReport — the two properties the design rests on", () => {
  // Titles are pinned rather than defaulted: the fixture's default title carries a global counter,
  // so two calls would differ and the determinism assertion would fail for the fixture's reasons
  // rather than the renderer's.
  const model = () => {
    const epic = entity({ number: 1, title: "An epic", labels: ["epic"], kind: "epic", milestone: null });
    const child = entity({ number: 2, title: "A child", parent: 1, kind: "subissue" });
    const alone = entity({ number: 3, title: "A bug", labels: ["bugfix"] });
    return buildReport([epic, child, alone, gate(4, 2, 1, "CLOSED")], "v1.0.0");
  };

  test("the same model renders byte-identically", () => {
    expect(renderReport(model())).toBe(renderReport(model()));
  });

  test("no line exceeds the width budget — a phone wraps beyond it", () => {
    expect(widest(renderReport(model()))).toBeLessThanOrEqual(MAX_WIDTH);
  });

  test("a very long title and summary still respect the budget", () => {
    const long = entity({
      number: 1,
      title: "A title that runs on and on and keeps running well past any sensible width for a phone",
      body: `### ${SUMMARY_HEADING}\n\n${"words ".repeat(200)}\n`,
    });
    expect(widest(renderReport(buildReport([long], "v1.0.0")))).toBeLessThanOrEqual(MAX_WIDTH);
  });

  test("a clipped summary says it was clipped — silent truncation is forbidden", () => {
    const long = entity({ number: 1, body: `### ${SUMMARY_HEADING}\n\n${"words ".repeat(200)}\n` });
    expect(renderReport(buildReport([long], "v1.0.0"))).toContain("clipped");
  });

  test("a missing summary is stated, not omitted", () => {
    const bare = entity({ number: 1, body: "### Detail\n\nNo slot here.\n" });
    expect(renderReport(buildReport([bare], "v1.0.0"))).toContain("No summary");
  });

  test("an empty milestone says so, distinctly from a missing one", () => {
    expect(renderReport(buildReport([], "v1.0.0"))).toContain("Nothing open");
  });
});
