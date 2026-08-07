/**
 * The projection hash — the operand every sync decision is made against.
 *
 * Its contract is narrow and load-bearing: it must change for every difference we own and claim to
 * push, and for nothing else. Too sensitive and `push` refuses forever over noise; too blunt and a
 * remote edit is silently overwritten. These tests pin both directions.
 */

import { describe, expect, test } from "bun:test";

import { projectionHash } from "../src/lib/backlog/project.js";
import type { BacklogEntity, Comment } from "../src/lib/backlog/model.js";

function comment(partial: Partial<Comment> = {}): Comment {
  return { id: 100, author: "octocat", createdAt: "2026-08-07T00:00:00Z", body: "hi", ...partial };
}

function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  return {
    number: 42,
    kind: "standalone",
    parent: null,
    title: "an issue",
    state: "OPEN",
    labels: ["rfc"],
    milestone: "v1.2.0",
    body: "Some body.\n",
    comments: [comment()],
    ...partial,
  };
}

const same = (a: BacklogEntity, b: BacklogEntity) => expect(projectionHash(a)).toBe(projectionHash(b));
const differs = (a: BacklogEntity, b: BacklogEntity) =>
  expect(projectionHash(a)).not.toBe(projectionHash(b));

describe("stable under presentation-only differences", () => {
  test("identical entities hash identically", () => {
    same(entity(), entity());
  });

  test("comment array order does not matter — the ordinal is presentation", () => {
    const a = comment({ id: 1 });
    const b = comment({ id: 2 });
    same(entity({ comments: [a, b] }), entity({ comments: [b, a] }));
  });

  test("label order does not matter", () => {
    same(entity({ labels: ["rfc", "idea"] }), entity({ labels: ["idea", "rfc"] }));
  });
});

describe("changes for anything we own and push", () => {
  test("title", () => {
    differs(entity(), entity({ title: "different" }));
  });

  test("body", () => {
    differs(entity(), entity({ body: "different\n" }));
  });

  test("a whitespace-only body change", () => {
    differs(entity({ body: "text\n" }), entity({ body: "text\n\n" }));
  });

  test("label set", () => {
    differs(entity({ labels: ["rfc"] }), entity({ labels: ["rfc", "idea"] }));
  });

  test("milestone", () => {
    differs(entity(), entity({ milestone: null }));
  });

  test("state", () => {
    differs(entity(), entity({ state: "CLOSED" }));
  });

  test("parentage", () => {
    differs(
      entity({ number: 15, kind: "subissue", parent: 12 }),
      entity({ number: 15, kind: "subissue", parent: 13 }),
    );
  });
});

describe("changes for remote comment activity", () => {
  test("a different comment ID — the same text posted twice is not the same comment", () => {
    differs(entity({ comments: [comment({ id: 1 })] }), entity({ comments: [comment({ id: 2 })] }));
  });

  test("an added comment", () => {
    differs(entity({ comments: [comment({ id: 1 })] }), entity({ comments: [comment({ id: 1 }), comment({ id: 2 })] }));
  });

  test("a deleted comment", () => {
    differs(entity({ comments: [comment({ id: 1 }), comment({ id: 2 })] }), entity({ comments: [comment({ id: 1 })] }));
  });

  test("an edited comment body", () => {
    differs(entity({ comments: [comment({ body: "a" })] }), entity({ comments: [comment({ body: "b" })] }));
  });

  test("a comment authored by someone else", () => {
    differs(entity({ comments: [comment({ author: "a" })] }), entity({ comments: [comment({ author: "b" })] }));
  });
});

describe("hash shape", () => {
  test("is a hex sha256", () => {
    expect(projectionHash(entity())).toMatch(/^[0-9a-f]{64}$/);
  });
});
