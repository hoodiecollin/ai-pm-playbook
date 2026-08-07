/**
 * Frontmatter serialization for the materialized backlog.
 *
 * The property that matters is exact round-tripping. A body that does not survive parse(render(x))
 * byte-for-byte would register as a local edit on the next `pull`, manufacturing a conflict out of
 * nothing — so these tests lean on adversarial content rather than tidy examples.
 */

import { describe, expect, test } from "bun:test";

import { parseBody, parseComment, renderBody, renderComment } from "../src/lib/backlog/serialize.js";
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
    body: "Some body.\n",
    comments: [],
    ...partial,
  };
}

/** Round-trip everything except comments, which live in their own files. */
function roundTrip(e: BacklogEntity) {
  const { comments: _ignored, ...expected } = e;
  expect(parseBody(renderBody(e))).toEqual(expected);
}

describe("body round-trip", () => {
  test("a minimal standalone issue", () => {
    roundTrip(entity());
  });

  test("a title containing a colon, quotes and unicode", () => {
    roundTrip(entity({ title: 'RFC: "materialize" the backlog — π, 🎯' }));
  });

  test("a title that looks like YAML syntax", () => {
    roundTrip(entity({ title: "- [x] done: true # not a comment" }));
  });

  test("labels and a milestone", () => {
    roundTrip(entity({ labels: ["rfc", "plan-next"], milestone: "v1.2.0" }));
  });

  test("a sub-issue carries its parent", () => {
    roundTrip(entity({ number: 15, kind: "subissue", parent: 12 }));
  });

  test("a closed epic", () => {
    roundTrip(entity({ number: 12, kind: "epic", state: "CLOSED" }));
  });

  test("a body containing its own frontmatter fence", () => {
    roundTrip(entity({ body: "intro\n\n---\n\nname: not-frontmatter\n---\n\ntail\n" }));
  });

  test("an empty body", () => {
    roundTrip(entity({ body: "" }));
  });

  test("a body whose trailing whitespace is significant", () => {
    roundTrip(entity({ body: "text\n\n\n" }));
  });

  test("a body containing CRLF", () => {
    roundTrip(entity({ body: "windows\r\nline\r\n" }));
  });
});

describe("comment round-trip", () => {
  const c: Comment = {
    id: 2145678901,
    author: "octocat",
    createdAt: "2026-08-07T19:30:45Z",
    body: "A comment: with a colon.\n",
  };

  test("preserves id, author, createdAt and body", () => {
    expect(parseComment(renderComment(c))).toEqual(c);
  });

  test("survives a body that opens with a fence", () => {
    const tricky = { ...c, body: "---\nnope\n---\n" };
    expect(parseComment(renderComment(tricky))).toEqual(tricky);
  });
});

describe("rendered form", () => {
  test("is deterministic — re-rendering an entity is byte-identical", () => {
    const e = entity({ labels: ["rfc", "idea"], milestone: "v1.2.0" });
    expect(renderBody(e)).toBe(renderBody(e));
  });

  test("opens with a frontmatter fence and closes it before the body", () => {
    const text = renderBody(entity({ body: "# Heading\n" }));
    expect(text.startsWith("---\n")).toBe(true);
    expect(text.endsWith("---\n# Heading\n")).toBe(true);
  });

  test("is valid YAML flow syntax — strings are quoted, lists are inline", () => {
    const text = renderBody(entity({ title: "a: b", labels: ["rfc"], milestone: null }));
    expect(text).toContain('title: "a: b"');
    expect(text).toContain('labels: ["rfc"]');
    expect(text).toContain("milestone: null");
    expect(text).toContain("number: 42");
  });
});

describe("parse rejects malformed input", () => {
  test("a file with no frontmatter at all", () => {
    expect(() => parseBody("just a body\n")).toThrow(/frontmatter/i);
  });

  test("an unterminated frontmatter block", () => {
    expect(() => parseBody("---\nnumber: 42\n")).toThrow(/frontmatter/i);
  });

  test("a frontmatter block missing a required field names that field", () => {
    const missingTitle =
      '---\nnumber: 42\nkind: "standalone"\nparent: null\nstate: "OPEN"\nlabels: []\nmilestone: null\n---\nbody\n';
    expect(() => parseBody(missingTitle)).toThrow(/title/i);
  });

  test("a frontmatter field of the wrong type is rejected", () => {
    const numericTitle =
      '---\nnumber: 42\nkind: "standalone"\nparent: null\ntitle: 7\nstate: "OPEN"\nlabels: []\nmilestone: null\n---\nbody\n';
    expect(() => parseBody(numericTitle)).toThrow(/title/i);
  });
});
