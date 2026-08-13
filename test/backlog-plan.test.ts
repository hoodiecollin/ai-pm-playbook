/**
 * The three-state comparison — base (as of last pull), local now, remote now.
 *
 * This is the whole correctness argument for the feature. `push` refuses rather than merges, so
 * the only way a teammate's edit gets destroyed is if this function mislabels a conflict as a push.
 * The table is therefore tested exhaustively, including the presence/absence edges that the happy
 * path never exercises.
 */

import { describe, expect, test } from "bun:test";

import { mergePending, planComment, planSync } from "../src/lib/backlog/plan.js";
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

/*
 * #41. `pull` keeps a pending local edit on disk instead of overwriting it — but it used to write
 * the whole LOCAL entity back, comment thread included. Comments are pull-only, so a local thread is
 * never authoritative, and writing one back is what turned a single stale file into thirty-four.
 *
 * This branch runs only when the remote has NOT moved, so the remote's thread already equals the
 * base's. Taking it is therefore a no-op on a healthy mirror and a repair on a corrupted one.
 */
describe("a pending local edit keeps our fields and the remote's thread", () => {
  const thread = [{ id: 1, author: "octocat", createdAt: "2026-08-01T00:00:00Z", body: "c1" }];

  test("owned fields come from local, comments from remote", () => {
    const local = { ...entity(1, "my edit\n"), labels: ["rfc"], milestone: "v2.2.0" };
    const remote = { ...entity(1, "remote body\n"), comments: thread };

    const merged = mergePending(local, remote);
    expect(merged.body).toBe("my edit\n");
    expect(merged.labels).toEqual(["rfc"]);
    expect(merged.milestone).toBe("v2.2.0");
    expect(merged.comments).toEqual(thread);
  });

  test("an inflated thread heals: a phantom edit stops reading as one", () => {
    // The corruption in the field — the same comment present twice, and nothing else different.
    const remote = { ...entity(1, "same\n"), comments: thread };
    const local = { ...entity(1, "same\n"), comments: [...thread, ...thread] };
    expect(projectionHash(local)).not.toBe(projectionHash(remote));

    expect(projectionHash(mergePending(local, remote))).toBe(projectionHash(remote));
  });
});

/*
 * #4. Posting a comment is refused rather than attempted whenever the local copy cannot be trusted
 * to be what the author read. All of the judgement lives here so it is testable without a network:
 * `comment.ts` reads a file, prints, and calls this.
 *
 * The refusal that justifies the command existing is `local-pending`. Posting a comment on an issue
 * with an unpushed body edit moves the remote projection, both sides then differ from base, and the
 * next `pull` files the author's edit as a conflict — down a path indistinguishable from a
 * teammate's race, caused by their own comment.
 */
describe("refusing to comment on something we cannot trust we have read", () => {
  const at = entity(9, "as pulled\n");
  const moved = entity(9, "changed upstream\n");
  const edited = entity(9, "edited locally, not pushed\n");

  test("no base snapshot at all", () => {
    expect(planComment(new Map(), map(at), map(at), 9)).toEqual({ ok: false, refusal: "no-base" });
  });

  test("a number we have never pulled — the orphan rule, applied to one issue", () => {
    // Keyed on the base, NOT the local tree: deleting a local file means nothing (`store.ts`), so a
    // missing file must not refuse. Never having pulled it is what makes the number meaningless.
    expect(planComment(baseOf(at), map(at), map(at, entity(77, "a stranger\n")), 77))
      .toEqual({ ok: false, refusal: "unknown" });
  });

  test("pulled once, since deleted or transferred away", () => {
    expect(planComment(baseOf(at), map(at), new Map(), 9)).toEqual({ ok: false, refusal: "gone" });
  });

  test("the thread moved since our last pull — re-read before replying", () => {
    expect(planComment(baseOf(at), map(at), map(moved), 9)).toEqual({ ok: false, refusal: "remote-moved" });
  });

  test("a pending local edit, which our own comment would turn into a conflict", () => {
    expect(planComment(baseOf(at), map(edited), map(at), 9)).toEqual({ ok: false, refusal: "local-pending" });
  });

  test("absent locally is fine — a deleted file is not an edit", () => {
    expect(planComment(baseOf(at), new Map(), map(at), 9)).toEqual({ ok: true, target: at });
  });

  test("all three agree, and the target returned is the remote", () => {
    const plan = planComment(baseOf(at), map(at), map(at), 9);
    expect(plan).toEqual({ ok: true, target: at });
    if (plan.ok) expect(plan.target).toBe(map(at).get(9) ?? at);
  });

  test("a gate resolves like any other kind — it is the most common target", () => {
    const gate = { ...entity(16, "gate body\n"), kind: "gate" as const, parent: 4, labels: ["improvement:gate-1"] };
    expect(planComment(baseOf(gate), map(gate), map(gate), 16)).toEqual({ ok: true, target: gate });
  });

  describe("precedence — presence before content, as planSync does it", () => {
    test("never pulled beats everything, even a moved remote", () => {
      expect(planComment(baseOf(at), map(at), map(at, moved), 77).ok).toBe(false);
      expect(planComment(baseOf(at), new Map(), map(entity(77, "x\n")), 77))
        .toEqual({ ok: false, refusal: "unknown" });
    });

    test("gone beats a pending local edit", () => {
      expect(planComment(baseOf(at), map(edited), new Map(), 9)).toEqual({ ok: false, refusal: "gone" });
    });

    test("a moved remote beats a pending local edit", () => {
      // Both sides moved. `planSync` would call this a conflict; here the actionable instruction is
      // to pull, so the remote is named first.
      expect(planComment(baseOf(at), map(edited), map(moved), 9))
        .toEqual({ ok: false, refusal: "remote-moved" });
    });
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
