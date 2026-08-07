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
 * This is derived from GitHub state rather than declared: an issue with the `epic` label is an
 * epic, an issue with a parent is a sub-issue, and everything else is standalone. A standalone
 * issue therefore cannot have sub-issues by construction (PLAYBOOK §7.1).
 */
export type EntityKind = "standalone" | "epic" | "subissue";

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
  /** The parent epic's number. Set iff `kind === "subissue"`. */
  parent: number | null;
  title: string;
  state: EntityState;
  labels: string[];
  milestone: string | null;
  body: string;
  /** Ordered oldest-first. The ordinal in a comment's filename is this array's index. */
  comments: Comment[];
}
