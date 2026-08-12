/**
 * The third level of the mirror.
 *
 * Two properties carry the whole design and both are asserted here: a gate's path contains EVERY
 * ancestor's state (so closing an epic moves its grandchildren), and a gate's own state never
 * appears in its path at all (because a closed gate is reference, not archive).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bodyPath, entityDir, gateDirName } from "../src/lib/backlog/paths.js";
import { readTree, writeTree } from "../src/lib/backlog/store.js";
import { projectionHash } from "../src/lib/backlog/project.js";
import { validateDrafts } from "../src/lib/backlog/draft.js";
import type { BacklogEntity } from "../src/lib/backlog/model.js";

const base = {
  title: "t",
  labels: [] as string[],
  milestone: null as string | null,
  body: "Body.\n",
  comments: [],
};

const epic = (over: Partial<BacklogEntity> = {}): BacklogEntity =>
  ({ ...base, number: 3, kind: "epic", parent: null, state: "OPEN", labels: ["epic"], ...over });
const work = (over: Partial<BacklogEntity> = {}): BacklogEntity =>
  ({ ...base, number: 7, kind: "standalone", parent: null, state: "OPEN", labels: ["improvement"], ...over });
const sub = (over: Partial<BacklogEntity> = {}): BacklogEntity =>
  ({ ...base, number: 4, kind: "subissue", parent: 3, state: "OPEN", labels: ["improvement"], ...over });
const gate = (n: number, over: Partial<BacklogEntity> = {}): BacklogEntity =>
  ({ ...base, number: 40 + n, kind: "gate", parent: 7, state: "OPEN", labels: [`improvement:gate-${n}`], ...over });

describe("gateDirName", () => {
  test("ordinal first for listing order, number second for identity", () => {
    expect(gateDirName(gate(1))).toBe("gate-1--41");
  });
  test("a gate with no gate label cannot be named", () => {
    expect(() => gateDirName(gate(1, { labels: ["improvement"] }))).toThrow(/gate-\{n\}|label/i);
  });
});

describe("entityDir — gates", () => {
  test("under a standalone work item", () => {
    expect(entityDir(gate(2), [work()])).toBe("standalone/7/gates/gate-2--42");
  });

  test("under a sub-issue under an epic — the full three levels", () => {
    const g = gate(1, { parent: 4 });
    expect(entityDir(g, [epic(), sub()])).toBe("epics/3/subissues/4/gates/gate-1--41");
  });

  test("a CLOSED gate does not move — it is reference, not archive", () => {
    expect(entityDir(gate(1, { state: "CLOSED" }), [work()])).toBe("standalone/7/gates/gate-1--41");
  });

  test("but a closed PARENT does move it", () => {
    expect(entityDir(gate(1), [work({ state: "CLOSED" })])).toBe("standalone/_/7/gates/gate-1--41");
  });

  test("and so does a closed GRANDPARENT — every level's state is in the path", () => {
    const g = gate(1, { parent: 4 });
    expect(entityDir(g, [epic({ state: "CLOSED" }), sub()])).toBe("epics/_/3/subissues/4/gates/gate-1--41");
  });

  test("rendering a gate against the wrong parent is refused, not guessed", () => {
    expect(() => entityDir(gate(1), [epic()])).toThrow(/names parent/i);
  });

  test("rendering a gate with no chain at all is refused", () => {
    expect(() => entityDir(gate(1))).toThrow(/ancestor chain/i);
  });

  test("bodyPath appends body.md at the gate level", () => {
    expect(bodyPath(gate(3), [work()])).toBe("standalone/7/gates/gate-3--43/body.md");
  });
});

describe("the tree round-trips through disk", () => {
  const root = () => mkdtempSync(join(tmpdir(), "pm-gates-"));

  test("writes three levels and reads them back with no path parsing", () => {
    const r = root();
    const e = epic();
    const s = sub();
    const g = gate(1, { parent: 4 });
    const entities = new Map([e, s, g].map((x) => [x.number, x]));

    writeTree(r, entities);
    expect(existsSync(join(r, "epics/3/subissues/4/gates/gate-1--41/body.md"))).toBe(true);

    const back = readTree(r);
    expect([...back.keys()].sort()).toEqual([3, 4, 41]);
    expect(back.get(41)!.kind).toBe("gate");
    expect(back.get(41)!.parent).toBe(4);
  });

  test("closing the epic relocates the gate with it, in one pass", () => {
    const r = root();
    const s = sub();
    const g = gate(1, { parent: 4 });

    writeTree(r, new Map([epic(), s, g].map((x) => [x.number, x])));
    writeTree(r, new Map([epic({ state: "CLOSED" }), s, g].map((x) => [x.number, x])));

    expect(existsSync(join(r, "epics/_/3/subissues/4/gates/gate-1--41/body.md"))).toBe(true);
    expect(existsSync(join(r, "epics/3"))).toBe(false);
  });

  test("closing the gate itself leaves it exactly where it was", () => {
    const r = root();
    const w = work();

    writeTree(r, new Map([w, gate(1)].map((x) => [x.number, x])));
    writeTree(r, new Map([w, gate(1, { state: "CLOSED" })].map((x) => [x.number, x])));

    expect(existsSync(join(r, "standalone/7/gates/gate-1--41/body.md"))).toBe(true);
    expect(readdirSync(join(r, "standalone/7/gates"))).toEqual(["gate-1--41"]);
    // The state is still recorded — in the frontmatter, which is what any reader should trust.
    expect(readTree(r).get(41)!.state).toBe("CLOSED");
  });

  test("a gate's own comments live beside its body", () => {
    const r = root();
    const g = gate(2, {
      comments: [{ id: 55, author: "a", createdAt: "2026-01-01T00:00:00Z", body: "approved" }],
    });
    writeTree(r, new Map([work(), g].map((x) => [x.number, x])));
    expect(existsSync(join(r, "standalone/7/gates/gate-2--42/comment-001--55.md"))).toBe(true);
  });
});

describe("the projection is unmoved by the separator change", () => {
  test("an entity's hash does not depend on comment filenames", () => {
    const withComments = work({
      comments: [
        { id: 2, author: "a", createdAt: "2026-01-02T00:00:00Z", body: "b" },
        { id: 1, author: "a", createdAt: "2026-01-01T00:00:00Z", body: "a" },
      ],
    });
    // Same comments, opposite array order: the projection sorts by ID, and the ordinal — the only
    // thing the rename touched — is excluded from it entirely.
    const reordered = { ...withComments, comments: [...withComments.comments].reverse() };
    expect(projectionHash(withComments)).toBe(projectionHash(reordered));
  });
});

describe("gates are tool-materialized, never drafted", () => {
  test("a draft carrying a gate label is refused before anything is created", () => {
    const problems = validateDrafts(
      [{ slug: "thing", number: null, kind: "standalone", title: "t", labels: ["improvement:gate-1"], milestone: null, body: "", children: [] }],
      ["improvement:gate-1"],
      [],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("never drafted by hand");
    expect(problems[0]!.fix).toContain("materialize");
  });

  test("an ordinary work-item draft still passes", () => {
    expect(
      validateDrafts(
        [{ slug: "thing", number: null, kind: "standalone", title: "t", labels: ["improvement"], milestone: null, body: "", children: [] }],
        ["improvement"],
        [],
      ),
    ).toEqual([]);
  });
});
