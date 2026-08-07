/**
 * Mapping GraphQL nodes onto backlog entities.
 *
 * Kind is derived rather than declared, which is what makes "a standalone issue has no sub-issues"
 * (§7.1) true by construction instead of by convention. The mapping is pure, so it is tested
 * directly against node shapes rather than through the network.
 */

import { describe, expect, test } from "bun:test";

import { toBacklogEntity } from "../src/lib/gh.js";

function node(partial: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "an issue",
    state: "OPEN",
    body: "Body.\n",
    labels: { nodes: [] as { name: string }[] },
    milestone: null,
    parent: null,
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    ...partial,
  } as Parameters<typeof toBacklogEntity>[0];
}

describe("kind is derived from the remote, never declared", () => {
  test("no parent and no epic label → standalone", () => {
    expect(toBacklogEntity(node()).kind).toBe("standalone");
  });

  test("the epic label → epic", () => {
    expect(toBacklogEntity(node({ labels: { nodes: [{ name: "epic" }] } })).kind).toBe("epic");
  });

  test("a parent → sub-issue, regardless of labels", () => {
    const e = toBacklogEntity(node({ parent: { number: 12 }, labels: { nodes: [{ name: "epic" }] } }));
    expect(e.kind).toBe("subissue");
    expect(e.parent).toBe(12);
  });
});

describe("field mapping", () => {
  test("CLOSED state is normalized", () => {
    expect(toBacklogEntity(node({ state: "CLOSED" })).state).toBe("CLOSED");
  });

  test("milestone flattens to its title, absent becomes null", () => {
    expect(toBacklogEntity(node({ milestone: { title: "v1.2.0" } })).milestone).toBe("v1.2.0");
    expect(toBacklogEntity(node()).milestone).toBeNull();
  });

  test("labels flatten to names", () => {
    const e = toBacklogEntity(node({ labels: { nodes: [{ name: "rfc" }, { name: "idea" }] } }));
    expect(e.labels).toEqual(["rfc", "idea"]);
  });

  test("a null body becomes an empty string rather than null", () => {
    expect(toBacklogEntity(node({ body: null })).body).toBe("");
  });

  test("a deleted comment author degrades to ghost instead of throwing", () => {
    const e = toBacklogEntity(node({
      comments: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ databaseId: 7, author: null, createdAt: "2026-08-07T00:00:00Z", body: "hi" }],
      },
    }));
    expect(e.comments[0]!.author).toBe("ghost");
    expect(e.comments[0]!.id).toBe(7);
  });
});
