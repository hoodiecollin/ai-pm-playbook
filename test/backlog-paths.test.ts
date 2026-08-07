/**
 * Path rendering for the materialized backlog.
 *
 * The load-bearing rule (#1, "identity is the ID; the path is derived"): a path is a *rendered
 * property* of state and parentage, never identity. Closing, reopening, and reparenting therefore
 * move files, and the sync layer must key on the number instead. These tests pin the rendering so
 * that every move is a move rather than a delete+create.
 */

import { describe, expect, test } from "bun:test";

import { bodyPath, commentFileName, commentFileNames, entityDir } from "../src/lib/backlog/paths.js";
import type { BacklogEntity, Comment } from "../src/lib/backlog/model.js";

function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  return {
    number: 42,
    kind: "standalone",
    parent: null,
    title: "an issue",
    state: "OPEN",
    labels: [],
    milestone: null,
    body: "",
    comments: [],
    ...partial,
  };
}

function comment(id: number): Comment {
  return { id, author: "someone", createdAt: "2026-08-07T00:00:00Z", body: "hi" };
}

describe("entityDir — standalone", () => {
  test("an open standalone issue sits at the top level", () => {
    expect(entityDir(entity())).toBe("standalone/42");
  });

  test("a closed standalone issue moves under _/", () => {
    expect(entityDir(entity({ state: "CLOSED" }))).toBe("standalone/_/42");
  });
});

describe("entityDir — epics", () => {
  test("an open epic gets its own directory", () => {
    expect(entityDir(entity({ number: 12, kind: "epic" }))).toBe("epics/12");
  });

  test("a closed epic moves under _/", () => {
    expect(entityDir(entity({ number: 12, kind: "epic", state: "CLOSED" }))).toBe("epics/_/12");
  });
});

describe("entityDir — sub-issues nest inside their parent", () => {
  const epic = entity({ number: 12, kind: "epic" });
  const closedEpic = entity({ number: 12, kind: "epic", state: "CLOSED" });
  const sub = entity({ number: 15, kind: "subissue", parent: 12 });

  test("an open sub-issue of an open epic", () => {
    expect(entityDir(sub, epic)).toBe("epics/12/subissues/15");
  });

  test("a closed sub-issue moves under its own _/", () => {
    expect(entityDir({ ...sub, state: "CLOSED" }, epic)).toBe("epics/12/subissues/_/15");
  });

  test("closing the epic moves its children with it", () => {
    expect(entityDir(sub, closedEpic)).toBe("epics/_/12/subissues/15");
  });

  test("a closed sub-issue of a closed epic composes both _/ levels", () => {
    expect(entityDir({ ...sub, state: "CLOSED" }, closedEpic)).toBe("epics/_/12/subissues/_/15");
  });

  test("rendering a sub-issue without its parent is a programming error, not a guess", () => {
    expect(() => entityDir(sub)).toThrow(/parent/i);
  });
});

describe("bodyPath", () => {
  test("is the entity directory plus body.md", () => {
    expect(bodyPath(entity())).toBe("standalone/42/body.md");
  });
});

describe("commentFileName — ordinal for order, ID for identity", () => {
  test("pads the ordinal to three digits and is 1-based", () => {
    expect(commentFileName(1, 2145678901)).toBe("comment-001-2145678901.md");
  });

  test("carries the comment ID verbatim", () => {
    expect(commentFileName(12, 7)).toBe("comment-012-7.md");
  });
});

describe("commentFileNames — the ordinal is a whole-thread property", () => {
  test("a twelve-comment thread sorts lexically in creation order", () => {
    const names = commentFileNames(Array.from({ length: 12 }, (_, i) => comment(9000 - i)));
    expect(names[0]).toBe("comment-001-9000.md");
    expect(names[11]).toBe("comment-012-8989.md");
    expect([...names].sort()).toEqual(names);
  });

  test("widens past three digits so lexical order never diverges from numeric", () => {
    // "1000" < "999" lexically — a fixed width would silently reorder the tail.
    const names = commentFileNames(Array.from({ length: 1000 }, (_, i) => comment(i + 1)));
    expect(names[0]).toBe("comment-0001-1.md");
    expect(names[999]).toBe("comment-1000-1000.md");
    expect([...names].sort()).toEqual(names);
  });

  test("an empty thread renders no files", () => {
    expect(commentFileNames([])).toEqual([]);
  });
});
