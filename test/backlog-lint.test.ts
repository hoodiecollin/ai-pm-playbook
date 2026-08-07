/**
 * The offline linter must see the same issues the networked one does.
 *
 * Found against a real 232-issue backlog: `check --no-remote` linted all 232 entities while the
 * networked tier linted the 71 open ones, so a closed issue that carried `plan-next` alongside a
 * milestone — an ordinary historical state — reported PM001 offline and nothing online. These
 * tests pin the scoping, and pin the one thing that must NOT be scoped.
 */

import { describe, expect, test } from "bun:test";

import { snapshot } from "../src/lib/backlog/lint.js";
import type { BacklogEntity } from "../src/lib/backlog/model.js";

function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  return {
    number: 1, kind: "standalone", parent: null, title: "An issue", state: "OPEN",
    labels: [], milestone: null, body: "", comments: [], ...partial,
  };
}

const OPEN = entity({ number: 1 });
const CLOSED = entity({ number: 2, state: "CLOSED" });

describe("state scoping matches the networked tier", () => {
  test("`open` drops closed entities", () => {
    expect(snapshot([OPEN, CLOSED], "o/n", "open").issues.map((i) => i.number)).toEqual([1]);
  });

  test("`all` keeps them", () => {
    expect(snapshot([OPEN, CLOSED], "o/n", "all").issues.map((i) => i.number)).toEqual([1, 2]);
  });

  test("the regression itself — a closed issue carrying plan-next plus a milestone is out of scope", () => {
    const stale = entity({ number: 95, state: "CLOSED", labels: ["plan-next"], milestone: "v0.2.0" });
    expect(snapshot([stale], "o/n", "open").issues).toEqual([]);
    expect(snapshot([stale], "o/n", "all").issues).toHaveLength(1);
  });
});

describe("parentage is never scoped", () => {
  test("a closed epic still parents its open sub-issue, and stays resolvable (PM105 stays armed)", () => {
    const epic = entity({ number: 10, kind: "epic", state: "CLOSED", labels: ["epic"] });
    const child = entity({ number: 11, kind: "subissue", parent: 10 });
    const { issues, parentage } = snapshot([epic, child], "o/n", "open");

    expect(issues.map((i) => i.number)).toEqual([11]);
    expect(parentage.parentOf.get(11)).toBe(10);
    // The index must retain the out-of-scope parent, or PM105 silently finds nothing to report.
    expect(parentage.all.get(10)).toMatchObject({ number: 10, labels: ["epic"] });
  });

  test("an entity with no parent is absent from the map rather than mapped to null", () => {
    expect(snapshot([OPEN], "o/n", "open").parentage.parentOf.has(1)).toBe(false);
  });

  test("the index spans every state regardless of the filter", () => {
    expect([...snapshot([OPEN, CLOSED], "o/n", "open").parentage.all.keys()]).toEqual([1, 2]);
  });
});

describe("issue shape", () => {
  test("the url is built from the recorded repo", () => {
    expect(snapshot([OPEN], "acme/widgets", "open").issues[0]!.url)
      .toBe("https://github.com/acme/widgets/issues/1");
  });

  test("an unknown repo still yields a well-formed url rather than throwing", () => {
    expect(snapshot([OPEN], null, "open").issues[0]!.url)
      .toBe("https://github.com/unknown/unknown/issues/1");
  });

  test("labels and milestone survive verbatim", () => {
    const e = entity({ labels: ["epic", "perf"], milestone: "v1.2.0" });
    expect(snapshot([e], "o/n", "open").issues[0]).toMatchObject({
      labels: ["epic", "perf"], milestone: "v1.2.0", state: "OPEN",
    });
  });
});
