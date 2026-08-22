/**
 * Neighbourhood derivation and the pack (#52).
 *
 * The roster-completeness scenario is the one that matters most: it is the property that cannot be
 * traded for size, because silent truncation recreates the exact blindness the command exists to
 * fix.
 */

import { describe, expect, test } from "bun:test";

import { mentionsIn, neighboursOf } from "../src/lib/backlog/neighbourhood.js";
import { renderPack } from "../src/lib/backlog/pack.js";
import { SUMMARY_HEADING } from "../src/lib/backlog/summary.js";
import type { BacklogEntity, Comment, EntityKind } from "../src/lib/backlog/model.js";

let counter = 0;
function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  counter += 1;
  const kind: EntityKind = partial.kind ?? "standalone";
  return {
    number: counter, kind, parent: null, title: `entity ${counter}`,
    state: "OPEN", labels: ["improvement"], milestone: null,
    body: `### ${SUMMARY_HEADING}\n\nWhat this is.\n`, comments: [],
    ...partial,
  };
}

const comment = (body: string): Comment =>
  ({ id: ++counter, author: "a", createdAt: "2026-01-01T00:00:00Z", body });

const relations = (all: BacklogEntity[], subject: number) =>
  neighboursOf(all, subject).map((n) => [n.number, n.relation]);

describe("mentions", () => {
  test("a body mention is found, in both directions", () => {
    const a = entity({ number: 1, body: "see #2 for the rest" });
    const b = entity({ number: 2 });
    expect(relations([a, b], 1)).toEqual([[2, "mention"]]);
    expect(relations([a, b], 2)).toEqual([[1, "mention"]]);
  });

  test("a mention inside a comment counts — the mirror holds comments", () => {
    const a = entity({ number: 1, comments: [comment("actually this blocks #2")] });
    const b = entity({ number: 2 });
    expect(relations([a, b], 1)).toEqual([[2, "mention"]]);
  });

  test("references inside fenced code are ignored — a transcript would flood the roster", () => {
    const e = entity({ number: 1, body: "text\n```\n# comment #999\ngit show #998\n```\n" });
    expect(mentionsIn(e).has(999)).toBe(false);
    expect(mentionsIn(e).has(998)).toBe(false);
  });

  test("an issue never mentions itself", () => {
    expect(mentionsIn(entity({ number: 5, body: "this is #5" })).has(5)).toBe(false);
  });

  test("a mention of something not in the mirror is not a neighbour", () => {
    const a = entity({ number: 1, body: "see #9999" });
    expect(relations([a], 1)).toEqual([]);
  });
});

describe("structural relations", () => {
  test("the epic parent and its other children", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const me = entity({ number: 2, parent: 1, kind: "subissue" });
    const sib = entity({ number: 3, parent: 1, kind: "subissue" });
    expect(relations([epic, me, sib], 2)).toEqual([[1, "epic-parent"], [3, "epic-sibling"]]);
  });

  test("an epic sees its own children", () => {
    const epic = entity({ number: 1, labels: ["epic"], kind: "epic" });
    const child = entity({ number: 2, parent: 1, kind: "subissue" });
    expect(relations([epic, child], 1)).toEqual([[2, "epic-sibling"]]);
  });

  test("a shared surface label, open only", () => {
    const a = entity({ number: 1, labels: ["improvement", "surface:web"] });
    const b = entity({ number: 2, labels: ["improvement", "surface:web"] });
    expect(relations([a, b], 1)).toEqual([[2, "surface"]]);
  });

  test("a shared milestone, open only", () => {
    const a = entity({ number: 1, milestone: "v1.0.0" });
    const b = entity({ number: 2, milestone: "v1.0.0" });
    expect(relations([a, b], 1)).toEqual([[2, "milestone"]]);
  });

  test("`milestone: null` is NOT a relation — 63 of 247 issues carry none", () => {
    const a = entity({ number: 1, milestone: null });
    const b = entity({ number: 2, milestone: null });
    expect(relations([a, b], 1)).toEqual([]);
  });

  test("a gate is never a neighbour — it is its parent's status", () => {
    const me = entity({ number: 1, milestone: "v1.0.0" });
    const gate = entity({ number: 2, parent: 1, kind: "gate", labels: ["improvement:gate-1"], milestone: "v1.0.0" });
    expect(relations([me, gate], 1)).toEqual([]);
  });
});

describe("ranking", () => {
  test("a neighbour reachable two ways appears once, at its strongest relation", () => {
    const a = entity({ number: 1, milestone: "v1.0.0", body: "see #2" });
    const b = entity({ number: 2, milestone: "v1.0.0" });
    expect(relations([a, b], 1)).toEqual([[2, "mention"]]);
  });

  test("ordering is by relation strength, then issue number", () => {
    const me = entity({ number: 1, milestone: "v1.0.0", body: "see #9" });
    const mentioned = entity({ number: 9, milestone: "v1.0.0" });
    const shared = entity({ number: 2, milestone: "v1.0.0" });
    expect(relations([me, mentioned, shared], 1)).toEqual([[9, "mention"], [2, "milestone"]]);
  });

  test("the rung is derived via ladderState, not re-implemented", () => {
    const me = entity({ number: 1, milestone: "v1.0.0" });
    const other = entity({ number: 2, milestone: "v1.0.0" });
    // Gate 1 closed, gate 2 ABSENT. §2: the first gate that is not closed decides — absent means
    // `-next`, open means `-pending`. Reusing ladderState is what keeps that distinction correct
    // here without restating it.
    const g1 = entity({ number: 3, parent: 2, kind: "gate", labels: ["improvement:gate-1"], state: "CLOSED" });
    expect(neighboursOf([me, other, g1], 1)[0]!.rung).toBe("plan-next");

    const g2 = entity({ number: 4, parent: 2, kind: "gate", labels: ["improvement:gate-2"], state: "OPEN" });
    expect(neighboursOf([me, other, g1, g2], 1)[0]!.rung).toBe("plan-pending");
  });
});

describe("the pack", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      entity({
        number: i + 2,
        milestone: "v1.0.0",
        body: `### ${SUMMARY_HEADING}\n\n${"words ".repeat(400)}\n`,
      }));

  test("EVERY neighbour appears in the roster even when depth is exhausted", () => {
    const me = entity({ number: 1, milestone: "v1.0.0" });
    const all = [me, ...many(30)];
    const neighbours = neighboursOf(all, 1);
    const pack = renderPack(me, neighbours, new Map(all.map((e) => [e.number, e])), { byteBudget: 3000 });

    for (const n of neighbours) expect(pack).toContain(`#${n.number} [`);
    expect(neighbours).toHaveLength(30);
  });

  test("what was not expanded is stated as a count, with the command to expand it", () => {
    const me = entity({ number: 1, milestone: "v1.0.0" });
    const all = [me, ...many(30)];
    const pack = renderPack(me, neighboursOf(all, 1), new Map(all.map((e) => [e.number, e])), { byteBudget: 3000 });
    expect(pack).toContain("Not expanded");
    expect(pack).toContain("pm-playbook context");
  });

  test("closed neighbours are roster-only", () => {
    const me = entity({ number: 1, milestone: "v1.0.0", body: "see #2" });
    const closed = entity({ number: 2, state: "CLOSED", body: `### ${SUMMARY_HEADING}\n\nSecret.\n` });
    const all = [me, closed];
    const pack = renderPack(me, neighboursOf(all, 1), new Map(all.map((e) => [e.number, e])));
    expect(pack).toContain("#2 [closed]");
    expect(pack).not.toContain("Secret.");
  });

  test("a neighbour with no summary slot says so rather than falling back", () => {
    const me = entity({ number: 1, body: "see #2" });
    const bare = entity({ number: 2, body: "### Detail\n\nNot a summary.\n" });
    const all = [me, bare];
    const pack = renderPack(me, neighboursOf(all, 1), new Map(all.map((e) => [e.number, e])));
    expect(pack).toContain("No summary section");
    expect(pack).not.toContain("Not a summary.");
  });

  test("the pack is deterministic", () => {
    const me = entity({ number: 1, title: "Subject", milestone: "v1.0.0" });
    const other = entity({ number: 2, title: "Other", milestone: "v1.0.0" });
    const all = [me, other];
    const map = new Map(all.map((e) => [e.number, e]));
    expect(renderPack(me, neighboursOf(all, 1), map)).toBe(renderPack(me, neighboursOf(all, 1), map));
  });
});
