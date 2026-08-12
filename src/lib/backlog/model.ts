/**
 * The vocabulary of the materialized backlog.
 *
 * One entity per GitHub issue, plus its comment thread. Everything downstream — path rendering,
 * serialization, the projection hash, the sync plan — is written against these shapes and nothing
 * else, so that the whole core stays pure and testable without a network.
 */

/**
 * Where an issue sits in the tree.
 *
 * This is derived from GitHub state rather than declared: a `{type}:gate-{n}` label makes it a gate,
 * otherwise a parent makes it a sub-issue, the `epic` label makes it an epic, and everything else is
 * standalone. A standalone issue therefore cannot have sub-issues by construction (PLAYBOOK §7.1).
 *
 * The gate check comes first because a gate always has a parent and would otherwise read as an
 * ordinary sub-issue — which would put it under `subissues/` and lose the level entirely.
 */
export type EntityKind = "standalone" | "epic" | "subissue" | "gate";

export type EntityState = "OPEN" | "CLOSED";

export interface Comment {
  /**
   * GitHub's `databaseId` — the comment's identity, and the only part of its filename that the
   * projection hash reads. The ordinal alongside it is presentation.
   */
  id: number;
  author: string;
  createdAt: string;
  body: string;
}

export interface BacklogEntity {
  number: number;
  kind: EntityKind;
  /**
   * The parent's number — an epic for a `subissue`, a work item for a `gate`. Null for the two
   * root kinds. Set iff `kind` is `subissue` or `gate`.
   */
  parent: number | null;
  title: string;
  state: EntityState;
  labels: string[];
  milestone: string | null;
  body: string;
  /** Ordered oldest-first. The ordinal in a comment's filename is this array's index. */
  comments: Comment[];
}
