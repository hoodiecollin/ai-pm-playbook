/**
 * Project the materialized backlog into what the linter consumes.
 *
 * The offline and networked tiers of `check` must lint the SAME issues, or the two disagree and
 * the offline answer is worthless — an agent that trusts it gets violations that vanish the moment
 * CI runs with a token. `listIssues` scopes by state on the server; the local tree has no server,
 * so the scoping has to happen here, deliberately, rather than falling out of the fetch.
 */

import type { BacklogEntity } from "./model.js";
import type { Parentage } from "../invariants.js";
import type { Issue } from "../gh.js";

/** Matches the `state` argument `listIssues` takes, so the two tiers cannot drift apart. */
export type StateFilter = "open" | "all";

export interface Snapshot {
  /** Issues in scope for the state filter — exactly what `checkIssues` should see. */
  issues: Issue[];
  /** Structural parentage over the WHOLE tree, unscoped. See `Parentage`. */
  parentage: Parentage;
}

export function asIssue(e: BacklogEntity, repo: string | null): Issue {
  return {
    number: e.number,
    title: e.title,
    state: e.state,
    url: `https://github.com/${repo ?? "unknown/unknown"}/issues/${e.number}`,
    labels: e.labels,
    milestone: e.milestone,
  };
}

export function snapshot(entities: Iterable<BacklogEntity>, repo: string | null, state: StateFilter): Snapshot {
  const all = [...entities];

  const issues = all.filter((e) => state === "all" || e.state === "OPEN").map((e) => asIssue(e, repo));

  return {
    issues,
    parentage: {
      parentOf: new Map(all.filter((e) => e.parent !== null).map((e) => [e.number, e.parent!])),
      all: new Map(all.map((e) => [e.number, asIssue(e, repo)])),
    },
  };
}
