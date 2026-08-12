/**
 * Structural parentage from the network.
 *
 * The mapping is pure so it is tested against node shapes directly. What matters here is not the
 * shape of the map but its SCOPE: parentage that respects the linted issue set's state filter would
 * silently disarm every structural rule for closed entities, which is exactly the class of failure
 * these rules exist to catch.
 */

import { describe, expect, test } from "bun:test";

import { toParentage } from "../src/lib/gh.js";
import { checkIssues } from "../src/lib/invariants.js";

function node(partial: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "an issue",
    state: "OPEN",
    url: "https://github.com/o/r/issues/1",
    labels: { nodes: [] as { name: string }[] },
    milestone: null,
    parent: null,
    ...partial,
  } as Parameters<typeof toParentage>[0][number];
}

describe("toParentage — the tree, from the remote", () => {
  test("records a child's parent", () => {
    const p = toParentage([node({ number: 4, parent: { number: 3 } }), node({ number: 3 })]);
    expect(p.parentOf.get(4)).toBe(3);
    expect(p.parentOf.has(3)).toBe(false);
  });

  test("indexes every issue, parented or not", () => {
    const p = toParentage([node({ number: 4, parent: { number: 3 } }), node({ number: 3 }), node({ number: 9 })]);
    expect([...p.all.keys()].sort()).toEqual([3, 4, 9]);
  });

  test("carries labels and milestone — the structural rules read both", () => {
    const p = toParentage([
      node({ number: 3, labels: { nodes: [{ name: "epic" }] }, milestone: { title: "v1.3.0" } }),
    ]);
    expect(p.all.get(3)!.labels).toEqual(["epic"]);
    expect(p.all.get(3)!.milestone).toBe("v1.3.0");
  });

  test("a null milestone stays null rather than becoming undefined", () => {
    expect(toParentage([node()]).all.get(1)!.milestone).toBeNull();
  });

  test("keeps CLOSED entities — the fetch is all-states by design", () => {
    const p = toParentage([node({ number: 4, state: "CLOSED", parent: { number: 3 } }), node({ number: 3 })]);
    expect(p.all.get(4)!.state).toBe("CLOSED");
    expect(p.parentOf.get(4)).toBe(3);
  });
});

describe("PM105 over networked parentage — the rule that could not run before", () => {
  const issues = [
    { number: 3, title: "not an epic", state: "OPEN", url: "u", labels: ["improvement"], milestone: null },
  ];

  test("fires when a non-epic parent has children", () => {
    const parentage = toParentage([node({ number: 4, parent: { number: 3 } }), node({ number: 3, labels: { nodes: [{ name: "improvement" }] } })]);
    const v = checkIssues(issues, null, parentage);
    expect(v.map((x) => x.rule)).toContain("PM105");
  });

  test("silent when the parent is an epic", () => {
    const parentage = toParentage([node({ number: 4, parent: { number: 3 } }), node({ number: 3, labels: { nodes: [{ name: "epic" }] } })]);
    expect(checkIssues(issues, null, parentage).filter((v) => v.rule === "PM105")).toHaveLength(0);
  });

  test("fires for a CLOSED parent too — the reason the fetch is unscoped", () => {
    const parentage = toParentage([
      node({ number: 4, parent: { number: 3 } }),
      node({ number: 3, state: "CLOSED", labels: { nodes: [{ name: "improvement" }] } }),
    ]);
    // The linted set is open-only and does not contain #3 at all; the rule still resolves it.
    expect(checkIssues([], null, parentage).filter((v) => v.rule === "PM105")).toHaveLength(1);
  });
});
