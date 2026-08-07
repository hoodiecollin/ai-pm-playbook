/**
 * The on-disk tree.
 *
 * Two properties carry the weight: a write/read cycle must be lossless, and rewriting the tree must
 * turn a state change into a *move* rather than leaving two copies behind. The second is what keeps
 * `readTree` from seeing whichever duplicate it happened to walk last.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listConflicts, readIndex, readTree, setAsideConflict, writeEntity, writeIndex, writeTree,
} from "../src/lib/backlog/store.js";
import type { BacklogEntity } from "../src/lib/backlog/model.js";

const made: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-store-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  return {
    number: 42, kind: "standalone", parent: null, title: "an issue", state: "OPEN",
    labels: ["rfc"], milestone: "v1.2.0", body: "Body.\n", comments: [], ...partial,
  };
}

const comment = (id: number, createdAt: string) => ({ id, author: "octocat", createdAt, body: `c${id}` });
const map = (...es: BacklogEntity[]) => new Map(es.map((e) => [e.number, e]));

describe("write then read is lossless", () => {
  test("a standalone issue with comments", () => {
    const r = root();
    const e = entity({ comments: [comment(2, "2026-08-07T01:00:00Z"), comment(1, "2026-08-07T00:00:00Z")] });
    writeEntity(r, e);

    const back = readTree(r).get(42)!;
    expect(back.title).toBe(e.title);
    expect(back.labels).toEqual(["rfc"]);
    // Order is re-derived from createdAt, not from the filename ordinal.
    expect(back.comments.map((c) => c.id)).toEqual([1, 2]);
  });

  test("an epic and its sub-issue", () => {
    const r = root();
    const epic = entity({ number: 12, kind: "epic" });
    const sub = entity({ number: 15, kind: "subissue", parent: 12 });
    writeTree(r, map(epic, sub));

    expect(existsSync(join(r, "epics/12/body.md"))).toBe(true);
    expect(existsSync(join(r, "epics/12/subissues/15/body.md"))).toBe(true);
    expect([...readTree(r).keys()].sort((a, b) => a - b)).toEqual([12, 15]);
  });
});

describe("readTree trusts frontmatter, not location", () => {
  test("an entity in the wrong directory still parses under its real number", () => {
    const r = root();
    mkdirSync(join(r, "standalone/999"), { recursive: true });
    writeFileSync(
      join(r, "standalone/999/body.md"),
      '---\nnumber: 42\nkind: "standalone"\nparent: null\ntitle: "moved"\nstate: "OPEN"\nlabels: []\nmilestone: null\n---\nbody\n',
      "utf8",
    );
    expect([...readTree(r).keys()]).toEqual([42]);
  });

  test("machinery directories are not mistaken for entities", () => {
    const r = root();
    writeEntity(r, entity());
    writeIndex(r, new Map([[42, "abc"]]), "o/n");
    setAsideConflict(r, entity({ body: "mine\n" }), "20260807");
    expect([...readTree(r).keys()]).toEqual([42]);
  });
});

describe("writeTree turns a state change into a move", () => {
  test("closing an issue removes the open location", () => {
    const r = root();
    writeTree(r, map(entity()));
    expect(existsSync(join(r, "standalone/42/body.md"))).toBe(true);

    const stale = writeTree(r, map(entity({ state: "CLOSED" })));

    expect(existsSync(join(r, "standalone/_/42/body.md"))).toBe(true);
    expect(existsSync(join(r, "standalone/42/body.md"))).toBe(false);
    expect(stale).toEqual(["standalone/42"]);
    expect([...readTree(r).keys()]).toEqual([42]);
  });

  test("closing an epic moves its sub-issue with it, leaving no duplicate", () => {
    const r = root();
    const epic = entity({ number: 12, kind: "epic" });
    const sub = entity({ number: 15, kind: "subissue", parent: 12 });
    writeTree(r, map(epic, sub));

    writeTree(r, map({ ...epic, state: "CLOSED" }, sub));

    expect(existsSync(join(r, "epics/_/12/subissues/15/body.md"))).toBe(true);
    expect(existsSync(join(r, "epics/12"))).toBe(false);
    expect([...readTree(r).keys()].sort((a, b) => a - b)).toEqual([12, 15]);
  });

  test("an entity dropped from the set is removed from disk", () => {
    const r = root();
    writeTree(r, map(entity(), entity({ number: 43 })));
    writeTree(r, map(entity()));
    expect([...readTree(r).keys()]).toEqual([42]);
  });
});

describe("conflicts", () => {
  test("a set-aside edit is preserved and listed", () => {
    const r = root();
    setAsideConflict(r, entity({ body: "my edit\n" }), "20260807T1930");
    expect(listConflicts(r)).toEqual(["42-20260807T1930"]);
    expect(readFileSync(join(r, "conflicts/42-20260807T1930/body.md"), "utf8")).toContain("my edit");
  });

  test("none reported on a clean tree", () => {
    expect(listConflicts(root())).toEqual([]);
  });
});

describe("the base index", () => {
  test("round-trips", () => {
    const r = root();
    writeIndex(r, new Map([[42, "aaa"], [7, "bbb"]]), "o/n");
    expect(readIndex(r)).toEqual(new Map([[7, "bbb"], [42, "aaa"]]));
  });

  test("a missing index reads as no base rather than throwing", () => {
    expect(readIndex(root())).toEqual(new Map());
  });

  test("a torn index reads as no base rather than throwing", () => {
    const r = root();
    mkdirSync(join(r, ".sync"), { recursive: true });
    writeFileSync(join(r, ".sync/index.json"), '{"hashes": {"42": ', "utf8");
    expect(readIndex(r)).toEqual(new Map());
  });
});
