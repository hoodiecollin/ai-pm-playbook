/**
 * Drafts — issues that do not exist yet.
 *
 * `create` is the only non-idempotent operation in the system, so everything it can reject offline
 * it must reject offline: an unknown label has to fail before a network call, not after a
 * half-created epic. These tests pin that validation and the creation ordering.
 */

import { describe, expect, test } from "bun:test";

import { creationOrder, parseDraft, renderDraft, validateDrafts, type Draft } from "../src/lib/backlog/draft.js";

function draft(partial: Partial<Draft> = {}): Draft {
  return {
    slug: "a-draft", title: "A draft", kind: "standalone", labels: [], milestone: null,
    body: "Body.\n", number: null, children: [], ...partial,
  };
}

const LABELS = ["rfc", "idea", "plan-next", "epic", "tech-debt"];
const MILESTONES = ["v1.2.0"];
const problems = (ds: Draft[]) => validateDrafts(ds, LABELS, MILESTONES).map((p) => p.message);

describe("round-trip", () => {
  test("survives parse(render(x)) including a null number", () => {
    const d = draft({ labels: ["rfc"], milestone: "v1.2.0" });
    expect(parseDraft("a-draft", renderDraft(d))).toEqual(d);
  });

  test("carries an assigned number back", () => {
    const d = draft({ number: 57 });
    expect(parseDraft("a-draft", renderDraft(d)).number).toBe(57);
  });

  test("defaults kind, labels, milestone and number when omitted", () => {
    const d = parseDraft("x", '---\ntitle: "Just a title"\n---\nbody\n');
    expect(d).toMatchObject({ kind: "standalone", labels: [], milestone: null, number: null });
  });
});

describe("parse rejects what create cannot recover from", () => {
  test("a missing title", () => {
    expect(() => parseDraft("x", '---\nkind: "standalone"\n---\nb\n')).toThrow(/title/i);
  });

  test("an empty title", () => {
    expect(() => parseDraft("x", '---\ntitle: "   "\n---\nb\n')).toThrow(/title/i);
  });

  test("subissue as a declared kind — nesting is what makes a sub-issue", () => {
    expect(() => parseDraft("x", '---\ntitle: "t"\nkind: "subissue"\n---\nb\n')).toThrow(/epic/i);
  });
});

describe("validation is offline and total", () => {
  test("an unknown label is rejected", () => {
    expect(problems([draft({ labels: ["nope"] })])[0]).toMatch(/label `nope` does not exist/);
  });

  test("an unknown milestone is rejected", () => {
    expect(problems([draft({ milestone: "v9.9.9" })])[0]).toMatch(/milestone `v9.9.9` does not exist/);
  });

  test("a known label and milestone pass", () => {
    expect(problems([draft({ labels: ["rfc"], milestone: "v1.2.0" })])).toEqual([]);
  });

  test("a non-epic with children is rejected (§7.1, PM105)", () => {
    const d = draft({ kind: "standalone", children: [draft({ slug: "child" })] });
    expect(problems([d])[0]).toMatch(/Only an epic decomposes/);
  });

  test("an epic with children is allowed", () => {
    const d = draft({ kind: "epic", labels: ["epic"], children: [draft({ slug: "child" })] });
    expect(problems([d])).toEqual([]);
  });

  test("epics nest one level — a grandchild is rejected", () => {
    const grandchild = draft({ slug: "gc" });
    const child = draft({ slug: "child", kind: "epic", children: [grandchild] });
    const d = draft({ kind: "epic", children: [child] });
    expect(problems([d]).some((m) => /one level/.test(m))).toBe(true);
  });

  test("a child's bad label is caught too, not just the parent's", () => {
    const d = draft({ kind: "epic", children: [draft({ slug: "child", labels: ["nope"] })] });
    expect(problems([d])[0]).toMatch(/label `nope`/);
  });
});

describe("creation order puts an epic before its children", () => {
  test("parent first, then each child, with the parent attached", () => {
    const child = draft({ slug: "child" });
    const epic = draft({ slug: "epic-one", kind: "epic", children: [child] });
    const order = creationOrder([epic]);
    expect(order.map((o) => o.draft.slug)).toEqual(["epic-one", "child"]);
    expect(order[0]!.parent).toBeNull();
    expect(order[1]!.parent!.slug).toBe("epic-one");
  });

  test("independent drafts keep their order", () => {
    expect(creationOrder([draft({ slug: "a" }), draft({ slug: "b" })]).map((o) => o.draft.slug))
      .toEqual(["a", "b"]);
  });
});
