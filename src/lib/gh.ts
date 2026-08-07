/**
 * `gh` CLI helpers.
 *
 * Everything that touches GitHub goes through here so the rest of the code deals in plain data.
 * We shell out to `gh` rather than speak REST directly because `gh` already owns auth, and every
 * consumer of this playbook is already a `gh` user.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { run, tryRun } from "./sh.js";
import type { BacklogEntity, Comment, EntityKind } from "./backlog/model.js";

export interface Issue {
  number: number;
  title: string;
  /** gh reports "OPEN" | "CLOSED". */
  state: string;
  url: string;
  labels: string[];
  /** Milestone title, or null when unscheduled. */
  milestone: string | null;
}

export interface Milestone {
  number: number;
  title: string;
  state: string;
}

/** Verify `gh` exists and is authenticated. Throws a human-actionable error otherwise. */
export async function requireGh(): Promise<void> {
  const version = await tryRun("gh", ["--version"]);
  if (!version.ok) {
    throw new Error(
      "The `gh` CLI is required but was not found on PATH.\n" +
        "  Install it: https://cli.github.com  (macOS: brew install gh)",
    );
  }
  const auth = await tryRun("gh", ["auth", "status"]);
  if (!auth.ok) {
    throw new Error("`gh` is installed but not authenticated.\n  Run: gh auth login");
  }
}

/** Resolve owner/name from the working directory's git remote, or null if not a GitHub repo. */
export async function detectRepo(cwd: string): Promise<string | null> {
  const res = await tryRun("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
  if (!res.ok) return null;
  const name = res.stdout.trim();
  return name.includes("/") ? name : null;
}

/**
 * Is this login a user or an organization?
 *
 * Load-bearing: ProjectV2 REST paths are `/users/<login>/...` vs `/orgs/<login>/...` and the wrong
 * prefix returns a bare 404 that reads like a permissions problem. Detect instead of assuming.
 */
export async function ownerType(login: string): Promise<"users" | "orgs"> {
  const res = await tryRun("gh", ["api", `users/${login}`, "-q", ".type"]);
  if (!res.ok) return "users";
  return res.stdout.trim().toLowerCase() === "organization" ? "orgs" : "users";
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: { name: string }[];
  milestone: { title: string } | null;
}

/**
 * List issues with everything the invariants need.
 *
 * `state` defaults to "open": the invariants describe the *live* backlog, and a closed issue that
 * once carried `plan-next` is history, not drift. `--state all` is available for a migration audit.
 */
export async function listIssues(repo: string, state: "open" | "all" = "open", limit = 1000): Promise<Issue[]> {
  const out = await run("gh", [
    "issue", "list",
    "--repo", repo,
    "--state", state,
    "--limit", String(limit),
    "--json", "number,title,state,url,labels,milestone",
  ]);
  const raw = JSON.parse(out || "[]") as RawIssue[];
  return raw.map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.url,
    labels: (i.labels ?? []).map((l) => l.name),
    milestone: i.milestone?.title ?? null,
  }));
}

export async function listMilestones(repo: string): Promise<Milestone[]> {
  const out = await run("gh", ["api", "--paginate", `repos/${repo}/milestones?state=all`]);
  // --paginate concatenates JSON arrays; gh emits them as separate documents when not using --slurp.
  const chunks = out.trim().split(/(?<=\])\s*(?=\[)/).filter(Boolean);
  const all: Milestone[] = [];
  for (const chunk of chunks) {
    for (const m of JSON.parse(chunk) as Milestone[]) {
      all.push({ number: m.number, title: m.title, state: m.state });
    }
  }
  return all;
}

/** Every label defined on the repo, by name. */
export async function listLabels(repo: string): Promise<string[]> {
  const out = await run("gh", ["label", "list", "--repo", repo, "--limit", "200", "--json", "name"]);
  return (JSON.parse(out || "[]") as { name: string }[]).map((l) => l.name);
}

/** Rename a label in place. GitHub preserves every issue assignment across a rename. */
export async function renameLabel(repo: string, from: string, to: string): Promise<void> {
  await run("gh", ["label", "edit", from, "--repo", repo, "--name", to]);
}

export async function deleteLabel(repo: string, name: string): Promise<void> {
  await run("gh", ["label", "delete", name, "--repo", repo, "--yes"]);
}

export async function relabelIssue(repo: string, issue: number, add: string, remove: string): Promise<void> {
  await run("gh", [
    "issue", "edit", String(issue), "--repo", repo,
    "--add-label", add, "--remove-label", remove,
  ]);
}

export interface IssueRef {
  number: number;
  title: string;
  url: string;
  milestone: string | null;
}

export interface PullRequestScope {
  number: number;
  title: string;
  baseRefName: string;
  /**
   * Issues this PR will actually CLOSE on merge — GitHub's own linkage, driven by closing keywords
   * in the body or in commits. This is the authoritative set for §5.3: "landing next-cycle work"
   * means closing a next-cycle issue, so the strict gate reads exactly this and nothing else.
   */
  closing: IssueRef[];
  /** Bare `#N` in the title/body that is not a closing link. Advisory tier — see PM008. */
  mentioned: number[];
}

/**
 * Everything the cycle-scope gate (§5.3) needs about a PR, in one call.
 *
 * `closingIssuesReferences` carries the milestone inline, so the strict tier needs no follow-up
 * lookups. Mentions come back as bare numbers for the caller to resolve against the open issue
 * list it already has — they are a warning tier, and not worth a round trip each.
 */
export async function pullRequestScope(repo: string, pr: number): Promise<PullRequestScope> {
  const [owner, name] = repo.split("/");
  const query = `
    query($owner:String!,$name:String!,$pr:Int!){
      repository(owner:$owner,name:$name){
        pullRequest(number:$pr){
          number title body baseRefName
          closingIssuesReferences(first:100){
            nodes{ number title url milestone{ title } }
          }
        }
      }
    }`;

  const out = await run("gh", [
    "api", "graphql",
    "-f", `query=${query}`,
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
    "-F", `pr=${pr}`,
  ]);

  const node = JSON.parse(out)?.data?.repository?.pullRequest;
  if (!node) throw new Error(`${repo}#${pr}: not a pull request, or not visible with this token.`);

  const closing: IssueRef[] = (node.closingIssuesReferences?.nodes ?? []).map(
    (n: { number: number; title: string; url: string; milestone: { title: string } | null }) => ({
      number: n.number,
      title: n.title,
      url: n.url,
      milestone: n.milestone?.title ?? null,
    }),
  );

  const closingNumbers = new Set(closing.map((c) => c.number));
  const text = `${node.title ?? ""}\n${node.body ?? ""}`;
  const mentioned = [...new Set([...text.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])))].filter(
    (n) => !closingNumbers.has(n),
  );

  return { number: node.number, title: node.title, baseRefName: node.baseRefName, closing, mentioned };
}

interface RawComment {
  databaseId: number;
  author: { login: string } | null;
  createdAt: string;
  body: string;
}

interface RawBacklogNode {
  number: number;
  title: string;
  state: string;
  body: string;
  labels: { nodes: { name: string }[] } | null;
  milestone: { title: string } | null;
  parent: { number: number } | null;
  comments: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawComment[] };
}

const BACKLOG_QUERY = `
  query($owner:String!,$name:String!,$after:String){
    repository(owner:$owner,name:$name){
      issues(first:50, states:[OPEN,CLOSED], after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{
          number title state body
          labels(first:50){ nodes{ name } }
          milestone{ title }
          parent{ number }
          comments(first:100){
            pageInfo{ hasNextPage endCursor }
            nodes{ databaseId author{ login } createdAt body }
          }
        }
      }
    }
  }`;

const COMMENTS_QUERY = `
  query($owner:String!,$name:String!,$number:Int!,$after:String){
    repository(owner:$owner,name:$name){
      issue(number:$number){
        comments(first:100, after:$after){
          pageInfo{ hasNextPage endCursor }
          nodes{ databaseId author{ login } createdAt body }
        }
      }
    }
  }`;

function toComment(c: RawComment): Comment {
  return { id: c.databaseId, author: c.author?.login ?? "ghost", createdAt: c.createdAt, body: c.body };
}

/**
 * Map one GraphQL issue node onto a backlog entity.
 *
 * Kind is *derived*, never declared: a `parent` makes it a sub-issue, the `epic` label makes it an
 * epic, everything else is standalone. That is what makes "a standalone issue has no sub-issues"
 * true by construction rather than by convention (§7.1).
 */
export function toBacklogEntity(node: RawBacklogNode): BacklogEntity {
  const labels = (node.labels?.nodes ?? []).map((l) => l.name);
  const parent = node.parent?.number ?? null;
  const kind: EntityKind = parent !== null ? "subissue" : labels.includes("epic") ? "epic" : "standalone";
  return {
    number: node.number,
    kind,
    parent,
    title: node.title,
    state: node.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN",
    labels,
    milestone: node.milestone?.title ?? null,
    body: node.body ?? "",
    comments: node.comments.nodes.map(toComment),
  };
}

/**
 * The entire backlog — every issue, open and closed, with its full comment thread.
 *
 * **Always all states, deliberately.** Scoping the fetch would make an out-of-scope issue
 * indistinguishable from a deleted one, and `planSync` resolves "gone from the remote" by deleting
 * the local copy — so a narrower fetch would quietly destroy the local mirror of every closed issue.
 *
 * Unlike `epicSubIssueCounts`, this refuses to degrade. A partial backlog reads as "the remote
 * changed" across every missing entity, which manufactures conflicts wholesale.
 */
export async function fetchBacklog(repo: string): Promise<BacklogEntity[]> {
  const [owner, name] = repo.split("/");
  const out: BacklogEntity[] = [];
  let after: string | null = null;

  for (;;) {
    const args = ["api", "graphql", "-f", `query=${BACKLOG_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
    if (after) args.push("-F", `after=${after}`);
    const res = await run("gh", args);

    const page = JSON.parse(res)?.data?.repository?.issues as
      | { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawBacklogNode[] }
      | undefined;
    if (!page) throw new Error(`${repo}: could not read issues — check the token's repository scope.`);

    for (const node of page.nodes) {
      const entity = toBacklogEntity(node);
      // A truncated thread would hash as stable-but-wrong: it never flaps, it just silently omits
      // the tail. Finish the thread rather than accept a partial fetch.
      if (node.comments.pageInfo.hasNextPage) {
        entity.comments = await fetchAllComments(repo, node.number, entity.comments, node.comments.pageInfo.endCursor);
      }
      out.push(entity);
    }

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return out;
}

async function fetchAllComments(
  repo: string,
  number: number,
  first: Comment[],
  cursor: string | null,
): Promise<Comment[]> {
  const [owner, name] = repo.split("/");
  const all = [...first];
  let after = cursor;

  while (after) {
    const res = await run("gh", [
      "api", "graphql", "-f", `query=${COMMENTS_QUERY}`,
      "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`, "-F", `after=${after}`,
    ]);
    const page = JSON.parse(res)?.data?.repository?.issue?.comments as
      | { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawComment[] }
      | undefined;
    if (!page) throw new Error(`${repo}#${number}: comment thread could not be paginated.`);
    all.push(...page.nodes.map(toComment));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  }

  return all;
}

/**
 * Apply a local edit to an issue: title, body, labels and milestone, and nothing else.
 *
 * State is absent on purpose (#1): closing has release-check and milestone consequences, so it
 * stays a command rather than a consequence of editing a word in a file. Comments are absent for
 * the same class of reason — authorship cannot be represented in a file the local agent owns.
 *
 * The body goes via a temp file rather than an argument: issue bodies routinely exceed argv limits
 * and contain everything that mangles a shell.
 */
export async function updateIssue(repo: string, local: BacklogEntity, remote: BacklogEntity): Promise<void> {
  const args = ["issue", "edit", String(local.number), "--repo", repo];

  if (local.title !== remote.title) args.push("--title", local.title);

  let bodyFile: string | null = null;
  if (local.body !== remote.body) {
    bodyFile = join(mkdtempSync(join(tmpdir(), "pm-push-")), "body.md");
    writeFileSync(bodyFile, local.body, "utf8");
    args.push("--body-file", bodyFile);
  }

  for (const l of local.labels.filter((l) => !remote.labels.includes(l))) args.push("--add-label", l);
  for (const l of remote.labels.filter((l) => !local.labels.includes(l))) args.push("--remove-label", l);

  if (local.milestone !== remote.milestone) {
    // `gh issue edit --milestone` resolves OPEN milestones only; a closed one needs the REST PATCH.
    if (local.milestone) args.push("--milestone", local.milestone);
    else args.push("--remove-milestone");
  }

  // Nothing but state or comments changed — those are not ours to push.
  if (args.length === 5) return;

  try {
    await run("gh", args);
  } finally {
    if (bodyFile) rmSync(dirname(bodyFile), { recursive: true, force: true });
  }
}

/**
 * Native sub-issue counts for every open `epic`, keyed by issue number.
 *
 * Returns null when the field is unavailable (schema drift / token scope), so callers can degrade
 * to skipping the epic check rather than failing the whole run over an advisory rule.
 */
export async function epicSubIssueCounts(repo: string): Promise<Map<number, number> | null> {
  const [owner, name] = repo.split("/");
  const query = `
    query($owner:String!,$name:String!,$after:String){
      repository(owner:$owner,name:$name){
        issues(first:50, states:OPEN, labels:["epic"], after:$after){
          pageInfo{ hasNextPage endCursor }
          nodes{ number subIssuesSummary{ total } }
        }
      }
    }`;

  const counts = new Map<number, number>();
  let after: string | null = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
    if (after) args.push("-F", `after=${after}`);
    const res = await tryRun("gh", args);
    if (!res.ok) return null;

    let page: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: { number: number; subIssuesSummary: { total: number } | null }[];
    };
    try {
      page = JSON.parse(res.stdout).data.repository.issues;
    } catch {
      return null;
    }
    for (const n of page.nodes) counts.set(n.number, n.subIssuesSummary?.total ?? 0);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return counts;
}
