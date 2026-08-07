/**
 * The three-state comparison — base (as of last pull), local now, remote now.
 *
 * This is the whole correctness argument for the feature. `push` refuses rather than merges, so
 * the only way a teammate's edit gets destroyed is if this function mislabels a conflict as a push.
 * The table is therefore tested exhaustively, including the presence/absence edges that the happy
 * path never exercises.
 */

import { describe, expect, test } from "bun:test";

import { planSync } from "../src/lib/backlog/plan.js";
import { projectionHash } from "../src/lib/backlog/project.js";
import type { BacklogEntity } from "../src/lib/backlog/model.js";

function entity(number: number, body: string): BacklogEntity {
  return {
    number,
    kind: "standalone",
    parent: null,
    title: `issue ${number}`,
    state: "OPEN",
    labels: [],
    milestone: null,
    body,
    comments: [],
  };
}

const map = (...es: BacklogEntity[]) => new Map(es.map((e) => [e.number, e]));
const baseOf = (...es: BacklogEntity[]) => new Map(es.map((e) => [e.number, projectionHash(e)]));

describe("the decision table, entity present on all three sides", () => {
  const original = entity(1, "original\n");
  const edited = entity(1, "edited\n");
  const movedRemote = entity(1, "moved remotely\n");

  test("local = base, remote = base → unchanged", () => {
    const plan = planSync(baseOf(original), map(original), map(original));
    expect(plan.unchanged).toEqual([1]);
    expect(plan.push).toEqual([]);
    expect(plan.pull).toEqual([]);
    expect(plan.conflict).toEqual([]);
  });

  test("local ≠ base, remote = base → push", () => {
    const plan = planSync(baseOf(original), map(edited), map(original));
    expect(plan.push.map((e) => e.number)).toEqual([1]);
    expect(plan.push[0]!.body).toBe("edited\n");
    expect(plan.conflict).toEqual([]);
  });

  test("local = base, remote ≠ base → pull", () => {
    const plan = planSync(baseOf(original), map(original), map(movedRemote));
    expect(plan.pull.map((e) => e.number)).toEqual([1]);
    expect(plan.pull[0]!.body).toBe("moved remotely\n");
    expect(plan.push).toEqual([]);
  });

  test("local ≠ base, remote ≠ base → conflict", () => {
    const plan = planSync(baseOf(original), map(edited), map(movedRemote));
    expect(plan.conflict.map((c) => c.number)).toEqual([1]);
  });

  test("a conflict carries both sides, so pull can restore truth and keep the edit", () => {
    const plan = planSync(baseOf(original), map(edited), map(movedRemote));
    expect(plan.conflict[0]!.local.body).toBe("edited\n");
    expect(plan.conflict[0]!.remote.body).toBe("moved remotely\n");
  });

  test("a conflict appears in no other bucket", () => {
    const plan = planSync(baseOf(original), map(edited), map(movedRemote));
    expect(plan.push).toEqual([]);
    expect(plan.pull).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  test("local and remote converged on the same edit → unchanged, nothing to send", () => {
    const plan = planSync(baseOf(original), map(edited), map(entity(1, "edited\n")));
    expect(plan.unchanged).toEqual([1]);
    expect(plan.push).toEqual([]);
  });
});

describe("presence edges", () => {
  const one = entity(1, "one\n");

  test("new remotely, absent from base and local → pull", () => {
    const plan = planSync(new Map(), new Map(), map(one));
    expect(plan.pull.map((e) => e.number)).toEqual([1]);
  });

  test("deleted locally but unchanged remotely → pull restores it", () => {
    // "Deleting a local file means nothing." (#1, desired behavior)
    const plan = planSync(baseOf(one), new Map(), map(one));
    expect(plan.pull.map((e) => e.number)).toEqual([1]);
    expect(plan.remove).toEqual([]);
  });

  test("gone remotely → removed locally, never pushed back", () => {
    const plan = planSync(baseOf(one), map(one), new Map());
    expect(plan.remove).toEqual([1]);
    expect(plan.push).toEqual([]);
  });

  test("a locally edited issue that vanished remotely is still a removal, not a push", () => {
    const plan = planSync(baseOf(one), map(entity(1, "edited\n")), new Map());
    expect(plan.remove).toEqual([1]);
    expect(plan.push).toEqual([]);
  });

  test("local-only with a number never seen remotely → orphaned, not pushed", () => {
    const plan = planSync(new Map(), map(one), new Map());
    expect(plan.orphaned).toEqual([1]);
    expect(plan.push).toEqual([]);
  });

  test("a stale base entry for something on neither side is dropped silently", () => {
    const plan = planSync(baseOf(one), new Map(), new Map());
    expect(plan.push).toEqual([]);
    expect(plan.pull).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.orphaned).toEqual([]);
  });
});

describe("comments participate in the comparison", () => {
  const withComment = (n: number, id: number): BacklogEntity => ({
    ...entity(n, "body\n"),
    comments: [{ id, author: "octocat", createdAt: "2026-08-07T00:00:00Z", body: "note" }],
  });

  test("a remote comment plus an unrelated local body edit is a conflict", () => {
    const base = entity(1, "body\n");
    const localEdit = entity(1, "body edited\n");
    const plan = planSync(baseOf(base), map(localEdit), map(withComment(1, 99)));
    expect(plan.conflict.map((c) => c.number)).toEqual([1]);
  });

  test("a remote comment with no local edit is an ordinary pull", () => {
    const base = entity(1, "body\n");
    const plan = planSync(baseOf(base), map(base), map(withComment(1, 99)));
    expect(plan.pull.map((e) => e.number)).toEqual([1]);
  });
});

describe("determinism", () => {
  test("buckets are ordered by issue number regardless of map insertion order", () => {
    const a = entity(3, "a\n");
    const b = entity(1, "b\n");
    const c = entity(2, "c\n");
    const plan = planSync(new Map(), new Map(), map(a, b, c));
    expect(plan.pull.map((e) => e.number)).toEqual([1, 2, 3]);
  });
});
