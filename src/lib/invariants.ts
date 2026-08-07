/**
 * The label invariants (PLAYBOOK §3.2, §4, §6.1), expressed as executable rules.
 *
 * This module is the reason the package is a dependency and not a docs repo. Prose in an agent's
 * context is a suggestion; a rule that exits non-zero is a constraint. Every rule here is a direct
 * transcription of a stated invariant — if you change one, change the PLAYBOOK section it cites
 * and bump the MAJOR version (a renamed or re-scoped invariant is a breaking change for consumers,
 * because their existing issues may now be violations).
 */

import { CORE_SURFACE, SURFACE_PREFIX, compareMilestones, isCoreMilestone } from "./model.js";
import type { Issue, PullRequestScope } from "./gh.js";

export type Severity = "error" | "warn";

export interface Violation {
  /** Stable rule id — safe to reference in CI config and in agent instructions. */
  rule: string;
  severity: Severity;
  /** The PLAYBOOK section this transcribes. */
  section: string;
  message: string;
  /** The concrete corrective action. Written imperatively so an agent can execute it directly. */
  fix: string;
  issue?: { number: number; title: string; url: string };
  file?: string;
}

export interface RuleMeta {
  rule: string;
  section: string;
  severity: Severity;
  summary: string;
}

/** Machine-readable rule index — printed by `pm-playbook rules`, consumed by agents. */
export const RULES: RuleMeta[] = [
  { rule: "PM001", section: "§3.2", severity: "error", summary: "`plan-next` and a milestone must never coexist." },
  { rule: "PM002", section: "§3.2", severity: "error", summary: "`idea` and `plan-next` must never coexist." },
  { rule: "PM003", section: "§3.2/§4", severity: "error", summary: "`experiment` never carries `idea`, `plan-next`, or a milestone." },
  { rule: "PM004", section: "§3.2", severity: "error", summary: "`release-gate` requires a milestone." },
  { rule: "PM005", section: "§3.2", severity: "error", summary: "`release-gate` never carries `idea`, `plan-next`, or `experiment`." },
  { rule: "PM006", section: "§6.1", severity: "error", summary: "A non-core `surface:*` issue never rides a core `v*` milestone." },
  { rule: "PM007", section: "§7.1", severity: "warn", summary: "An `epic` should decompose via native sub-issues." },
  { rule: "PM008", section: "§5.3", severity: "error", summary: "A PR to the integration branch must not close work milestoned past the cycle in flight." },
  { rule: "PM009", section: "§5.3", severity: "warn", summary: "A PR references next-cycle work it does not close (advisory)." },
  { rule: "PM100", section: "—", severity: "warn", summary: "Vendored `.pm-playbook/` differs from the installed package." },
  { rule: "PM101", section: "—", severity: "warn", summary: "Agent instruction file is missing the pm-playbook stanza." },
  { rule: "PM102", section: "§11", severity: "warn", summary: "A markdown shadow backlog exists; the backlog lives in Issues." },
  { rule: "PM103", section: "—", severity: "warn", summary: "Label migrations from a newer doctrine version have not been applied." },
  { rule: "PM104", section: "§11", severity: "warn", summary: "Unresolved backlog conflict drafts are waiting for a decision." },
  { rule: "PM105", section: "§7.1", severity: "error", summary: "Only an `epic` may have sub-issues." },
];

function ref(i: Issue) {
  return { number: i.number, title: i.title, url: i.url };
}

function surfaceLabels(i: Issue): string[] {
  return i.labels.filter((l) => l.startsWith(SURFACE_PREFIX));
}

/**
 * Structural parentage, carried separately from the linted issue set.
 *
 * It carries its own index on purpose. The linted set is scoped by state — open-only by default —
 * but parentage is not a state-dependent property: a closed epic is still an epic, and a closed
 * parent that is *not* labelled `epic` is still mis-modelled. Resolving the parent through the
 * scoped set would disarm PM105 for exactly the closed parents worth auditing.
 */
export interface Parentage {
  /** Sub-issue number → parent number. */
  parentOf: Map<number, number>;
  /** Every entity by number, including entities outside the linted scope. */
  all: Map<number, Issue>;
}

/**
 * Evaluate every issue-level invariant. Pure — takes data, returns findings.
 *
 * `parentage` is optional because it is only knowable from a materialized backlog or a GraphQL
 * fetch; without it, PM105 is skipped rather than guessed.
 */
export function checkIssues(
  issues: Issue[],
  subIssueCounts?: Map<number, number> | null,
  parentage?: Parentage | null,
): Violation[] {
  const out: Violation[] = [];

  // PM105 — only an `epic` may have sub-issues (§7.1). Checked from the parent's side: a child
  // naming a non-epic parent means the *parent* is mis-modelled, so that is where the fix belongs.
  if (parentage) {
    const childrenOf = new Map<number, number[]>();
    for (const [child, parent] of parentage.parentOf) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    }
    for (const [parent, children] of [...childrenOf].sort((a, b) => a[0] - b[0])) {
      const issue = parentage.all.get(parent);
      if (!issue || issue.labels.includes("epic")) continue;
      out.push({
        rule: "PM105", severity: "error", section: "§7.1", issue: ref(issue),
        message: `#${parent} has ${children.length} sub-issue(s) but is not labelled \`epic\`. Only an epic decomposes.`,
        fix: `Either label it: gh issue edit ${parent} --add-label epic — or detach the children: ${children
          .map((c) => `#${c}`)
          .join(", ")}`,
      });
    }
  }

  for (const i of issues) {
    const has = (l: string) => i.labels.includes(l);
    const scheduled = i.milestone !== null;

    // PM001 — plan-next ⊕ milestone. The #1 drift smell (§12.7).
    if (has("plan-next") && scheduled) {
      out.push({
        rule: "PM001", severity: "error", section: "§3.2", issue: ref(i),
        message: `\`plan-next\` coexists with milestone \`${i.milestone}\`. Committed-but-unscheduled and scheduled are exclusive states.`,
        fix: `Assigning a milestone IS scheduling. Drop the label: gh issue edit ${i.number} --remove-label plan-next`,
      });
    }

    // PM002 — idea ⊕ plan-next. Speculative and committed are opposites.
    if (has("idea") && has("plan-next")) {
      out.push({
        rule: "PM002", severity: "error", section: "§3.2", issue: ref(i),
        message: "`idea` coexists with `plan-next`. Speculative and committed are opposite rungs of the ladder.",
        fix: `Pick one. If an RFC was accepted (Gate 1), it is committed: gh issue edit ${i.number} --remove-label idea`,
      });
    }

    // PM003 — experiment ⊕ {idea, plan-next, milestone}. Experiments never ride the spine (§4).
    if (has("experiment")) {
      const conflicts = ["idea", "plan-next"].filter(has);
      if (scheduled) conflicts.push(`milestone \`${i.milestone}\``);
      if (conflicts.length) {
        out.push({
          rule: "PM003", severity: "error", section: "§3.2/§4", issue: ref(i),
          message: `\`experiment\` coexists with ${conflicts.join(", ")}. A spike's deliverable is a decision, not a shippable artifact — it feeds the spine, it never rides it.`,
          fix:
            scheduled
              ? `Unschedule the spike, then file the feature its conclusion commits as a separate issue and milestone THAT: gh issue edit ${i.number} --remove-milestone`
              : `Drop the conflicting label(s): gh issue edit ${i.number} --remove-label ${conflicts.join(",")}`,
        });
      }
    }

    // PM004 — release-gate ⇒ milestone. A gate blocks a *specific* tag; without one it means nothing.
    if (has("release-gate") && !scheduled) {
      out.push({
        rule: "PM004", severity: "error", section: "§3.2", issue: ref(i),
        message: "`release-gate` has no milestone. A gate is meaningless without naming the tag it blocks.",
        fix: `Assign the milestone this blocks: gh issue edit ${i.number} --milestone <vX.Y.Z>`,
      });
    }

    // PM005 — release-gate ⊕ {idea, plan-next, experiment}. A gate is committed by definition.
    if (has("release-gate")) {
      const conflicts = ["idea", "plan-next", "experiment"].filter(has);
      if (conflicts.length) {
        out.push({
          rule: "PM005", severity: "error", section: "§3.2", issue: ref(i),
          message: `\`release-gate\` coexists with ${conflicts.join(", ")}. A release obligation is committed by definition — it can never be speculative or unscheduled.`,
          fix: `gh issue edit ${i.number} --remove-label ${conflicts.join(",")}`,
        });
      }
    }

    // PM006 — non-core surface ⊕ core v* milestone. Reads "done, awaiting vX" while already shipped.
    const nonCore = surfaceLabels(i).filter((l) => l !== CORE_SURFACE);
    if (nonCore.length && scheduled && isCoreMilestone(i.milestone!)) {
      out.push({
        rule: "PM006", severity: "error", section: "§6.1", issue: ref(i),
        message: `${nonCore.join(", ")} is milestoned onto core \`${i.milestone}\`. It would read as "done — awaiting ${i.milestone}" even though it ships on its own line, and it would never reach the core changelog.`,
        fix: `Move it to that surface's own milestone namespace (e.g. \`ext-v0.1.0\`), or unschedule it: gh issue edit ${i.number} --remove-milestone`,
      });
    }

    // PM007 — an epic decomposes via native sub-issues, not checkboxes and not a Project field.
    if (has("epic") && subIssueCounts && subIssueCounts.get(i.number) === 0) {
      out.push({
        rule: "PM007", severity: "warn", section: "§7.1", issue: ref(i),
        message: "`epic` has no native sub-issues. Task-list checkboxes and Project fields are not decomposition — they drift.",
        fix: `Link children with the real Parent/Sub-issue relation: gh api repos/{owner}/{repo}/issues/${i.number}/sub_issues -f sub_issue_id=<child REST id>`,
      });
    }
  }

  return out;
}

/**
 * "Can we tag?" (§5.2) — an open `release-gate` on a milestone blocks it, regardless of whether
 * every feature on it is closed.
 */
export function releaseBlockers(issues: Issue[], milestone: string): Issue[] {
  return issues.filter(
    (i) => i.labels.includes("release-gate") && i.state.toUpperCase() === "OPEN" && i.milestone === milestone,
  );
}

/**
 * PM008 (error) / PM009 (warn) — the cycle-scope gate (§5.3).
 *
 * > A pull request targeting the integration branch may not close an issue milestoned later than
 * > the cycle in flight.
 *
 * Note the shape: a **deny-list on future milestones**, not an allow-list on the current one. That
 * is what makes it usable without escape hatches — untracked chores, CI fixes and typo PRs carry no
 * milestone, so they cannot trip it, and correctly so: work with no issue cannot be next-cycle
 * work, because next-cycle work is *defined* by carrying that milestone.
 *
 * Two tiers, because they warrant different responses:
 *   - ERROR on `closing` — GitHub's own closing-reference linkage. Merging really does land the
 *     work, so this is the thing the rule exists to catch.
 *   - WARN on `mentioned` — a bare `#N` is often just context ("relates to", "see also"), so it is
 *     advisory. It still earns a line, because a mention is sometimes a closing keyword someone
 *     forgot to write.
 *
 * Non-core milestones (`ext-v0.1.0`) are ignored: they are not on this spine, so "later than the
 * cycle" is not a question that has an answer for them.
 */
export function checkPullRequestScope(
  scope: PullRequestScope,
  cycle: string,
  openIssues: Issue[] = [],
): Violation[] {
  const out: Violation[] = [];
  const isFuture = (milestone: string | null): boolean =>
    milestone !== null && isCoreMilestone(milestone) && compareMilestones(milestone, cycle) > 0;

  for (const c of scope.closing) {
    if (!isFuture(c.milestone)) continue;
    out.push({
      rule: "PM008", severity: "error", section: "§5.3",
      issue: { number: c.number, title: c.title, url: c.url },
      message: `This PR closes #${c.number}, milestoned \`${c.milestone}\` — later than the cycle in flight (\`${cycle}\`). Merging it would land next-cycle work on the integration branch.`,
      fix:
        `Keep it on its own branch off the integration branch until \`${cycle}\` ships, then rebase and land it. ` +
        `If it is genuinely part of this cycle, move it: gh issue edit ${c.number} --milestone ${cycle}`,
    });
  }

  const byNumber = new Map(openIssues.map((i) => [i.number, i]));
  for (const n of scope.mentioned) {
    const issue = byNumber.get(n);
    if (!issue || !isFuture(issue.milestone)) continue;
    out.push({
      rule: "PM009", severity: "warn", section: "§5.3",
      issue: ref(issue),
      message: `This PR references #${n}, milestoned \`${issue.milestone}\` (later than \`${cycle}\`), without a closing link. Advisory — but check that a closing keyword was not simply left off.`,
      fix: `If the PR does close it, it must wait for \`${cycle}\` to ship. If it only relates to it, no action needed.`,
    });
  }

  return out;
}

