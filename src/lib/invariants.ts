/**
 * The label invariants (PLAYBOOK §3.2, §4, §6.1), expressed as executable rules.
 *
 * This module is the reason the package is a dependency and not a docs repo. Prose in an agent's
 * context is a suggestion; a rule that exits non-zero is a constraint. Every rule here is a direct
 * transcription of a stated invariant — if you change one, change the PLAYBOOK section it cites
 * and bump the MAJOR version (a renamed or re-scoped invariant is a breaking change for consumers,
 * because their existing issues may now be violations).
 */

import {
  CORE_SURFACE, GATES, SURFACE_PREFIX, WORK_TYPES,
  compareMilestones, gateOf, isCoreMilestone, isPatchMilestone, workTypeOf,
} from "./model.js";
import { SUMMARY_HEADING, readSummary } from "./backlog/summary.js";
import type { BacklogEntity } from "./backlog/model.js";
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
/**
 * PM001 and PM002 are RETIRED, not renumbered and never reused.
 *
 * They policed `plan-next` and `idea`, which 2.0 deletes as labels — the ladder is derived from
 * gate state instead (§2), so the drift they detected is no longer representable. A consumer's CI
 * config or agent prompt that still names PM001 must stop matching rather than silently match some
 * unrelated rule, which is why the numbers stay burned.
 */
export const RULES: RuleMeta[] = [
  { rule: "PM003", section: "§4", severity: "error", summary: "`experiment` never carries a milestone." },
  { rule: "PM004", section: "§3.2", severity: "error", summary: "`release-gate` requires a milestone." },
  { rule: "PM005", section: "§3.2", severity: "error", summary: "`release-gate` never carries `experiment`." },
  { rule: "PM006", section: "§6.1", severity: "error", summary: "A non-core `surface:*` issue never rides a core `v*` milestone." },
  { rule: "PM007", section: "§7.1", severity: "warn", summary: "An `epic` should decompose via native sub-issues." },
  { rule: "PM008", section: "§5.3", severity: "error", summary: "A PR to the integration branch must not close work milestoned past the cycle in flight." },
  { rule: "PM009", section: "§5.3", severity: "warn", summary: "A PR references next-cycle work it does not close (advisory)." },
  { rule: "PM010", section: "§3.1", severity: "error", summary: "A work item carries exactly one type label." },
  { rule: "PM011", section: "§9", severity: "error", summary: "A gate's milestone equals its parent's." },
  { rule: "PM012", section: "§7.1", severity: "error", summary: "An `epic` never carries gates." },
  { rule: "PM013", section: "§9", severity: "error", summary: "A work item on the focused milestone carries its complete gate set." },
  { rule: "PM014", section: "§5.6", severity: "error", summary: "`hotfix` requires `bugfix` and a milestone, and never carries `experiment` or `epic`." },
  { rule: "PM015", section: "§5.6", severity: "error", summary: "A patch milestone holds exactly one work item, its gates, and any release-gate — no other work." },
  { rule: "PM016", section: "§9", severity: "warn", summary: "Every gate is closed but the work item is still open." },
  { rule: "PM017", section: "§9.6", severity: "warn", summary: "An open work item or epic opens with the plain-English summary slot." },
  { rule: "PM100", section: "—", severity: "warn", summary: "Vendored `.pm-playbook/` differs from the installed package." },
  { rule: "PM101", section: "—", severity: "warn", summary: "Agent instruction file is missing the pm-playbook stanza." },
  { rule: "PM102", section: "§11", severity: "warn", summary: "A markdown shadow backlog exists; the backlog lives in Issues." },
  { rule: "PM103", section: "—", severity: "warn", summary: "Label migrations from a newer doctrine version have not been applied." },
  { rule: "PM104", section: "§11", severity: "warn", summary: "Unresolved backlog conflict drafts are waiting for a decision." },
  { rule: "PM105", section: "§7.1", severity: "error", summary: "Only an `epic` may have non-gate sub-issues, and only a work item may have gates." },
  { rule: "PM106", section: "—", severity: "warn", summary: "The mirror covers only part of the backlog, so an offline answer covers only that part." },
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
 * The structural rules — everything that reads the tree rather than one issue's labels.
 *
 * All of these run over `parentage.all`, **never** over the linted issue set, and the reason is the
 * same one `Parentage` documents for PM105: the linted set is scoped by state, and a closed gate is
 * still a gate. Scoping here would mean a work item whose gate 1 is closed reads as though gate 1
 * were never created — which is precisely the state PM013 exists to catch, reported backwards.
 */
/**
 * PM015 — a patch milestone holds exactly one work item (§5.6).
 *
 * §5.6 states this as "One hotfix, one milestone", and until 3.0.0 the check tested the `hotfix`
 * LABEL and never counted anything. That was wrong in both directions at once: three hotfixes on
 * one patch milestone passed clean, while a single bounded item that was not a defect in released
 * behavior — a CI repair, a source-hygiene sweep — was refused because it could not honestly carry
 * the label. The property §5.6 actually protects is boundedness, so the rule counts.
 *
 * Eligibility stays human doctrine asserted in gate 1, which is the only place it can live:
 * "waiting for the next release is unacceptable" is a judgement, and the label was never more than
 * a proxy for someone having made it.
 *
 * WHAT COUNTS is structural rather than derived from `workTypeOf`, which returns null for zero OR
 * multiple type labels. Counting through it would make this rule stop enforcing anything the moment
 * PM010 is dirty — an invariant that evaporates in the presence of another violation is the exact
 * failure being fixed here. A gate, a `release-gate` and an `epic` are excluded because they are
 * not work, which is the same boundary PM010 and PM013 already draw.
 *
 * EVERY member of an over-full milestone is flagged, not just the surplus: there is no principled
 * way to decide which one "belongs", and flagging the 2nd-and-later would encode a first-wins
 * scheduling opinion the linter has no basis for. The message names the count so a single violation
 * read on its own is actionable.
 *
 * SCOPE: this is aggregate, so it under-counts when the caller passes a subset — `create` lints
 * only projected drafts, `push` only in-scope entries. That fails safe (false negative, never false
 * positive), and PM106 already reports a partial mirror rather than letting a clean run over a
 * subset read as a clean run over the backlog.
 */
function checkPatchMilestones(issues: Issue[]): Violation[] {
  const byMilestone = new Map<string, Issue[]>();
  for (const i of issues) {
    if (i.milestone === null || !isPatchMilestone(i.milestone)) continue;
    if (gateOf(i.labels) !== null) continue;
    if (i.labels.includes("release-gate") || i.labels.includes("epic")) continue;
    const held = byMilestone.get(i.milestone);
    if (held) held.push(i);
    else byMilestone.set(i.milestone, [i]);
  }

  const out: Violation[] = [];
  for (const [milestone, items] of byMilestone) {
    if (items.length <= 1) continue;
    const all = items.map((i) => `#${i.number}`).join(", ");
    for (const i of items) {
      out.push({
        rule: "PM015", severity: "error", section: "§5.6", issue: ref(i),
        message: `\`${milestone}\` is a patch milestone holding ${items.length} work items (${all}). A patch milestone holds exactly one, so that a patch release stays the bounded thing it was cut for.`,
        fix: `Keep one and move the rest to the cycle in flight: gh issue edit <n> --milestone <vX.Y.0> — or give one its own patch milestone.`,
      });
    }
  }
  return out;
}

function checkStructure(parentage: Parentage, cycle: string | null): Violation[] {
  const out: Violation[] = [];

  const childrenOf = new Map<number, number[]>();
  for (const [child, parent] of parentage.parentOf) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
  }
  const isGate = (n: number) => gateOf(parentage.all.get(n)?.labels ?? []) !== null;

  // --- PM105 / PM012 — what may hold what ----------------------------------------------------
  for (const [parent, children] of [...childrenOf].sort((a, b) => a[0] - b[0])) {
    const issue = parentage.all.get(parent);
    if (!issue) continue;
    const epic = issue.labels.includes("epic");
    const gates = children.filter(isGate);
    const plain = children.filter((c) => !isGate(c));

    // PM012 — an epic spans releases while its children ship incrementally, so an epic-level gate
    // would be approving a design for work that has not been decomposed yet.
    if (epic && gates.length) {
      out.push({
        rule: "PM012", severity: "error", section: "§7.1", issue: ref(issue),
        message: `#${parent} is an \`epic\` and carries ${gates.length} gate(s): ${gates.map((g) => `#${g}`).join(", ")}. An epic groups work; it never gates it.`,
        fix: `Move the gate(s) onto the work item they actually design, or drop the epic label if this is really one work item: gh issue edit ${parent} --remove-label epic`,
      });
    }

    // PM105 — non-gate children require an epic parent. Checked from the parent's side: a child
    // naming a non-epic parent means the *parent* is mis-modelled, so that is where the fix belongs.
    if (plain.length && !epic) {
      out.push({
        rule: "PM105", severity: "error", section: "§7.1", issue: ref(issue),
        message: `#${parent} has ${plain.length} non-gate sub-issue(s) but is not labelled \`epic\`. Only an epic decomposes into work; a work item decomposes into gates.`,
        fix: `Either label it: gh issue edit ${parent} --add-label epic — or detach the children: ${plain.map((c) => `#${c}`).join(", ")}`,
      });
    }

    // PM105 — a gate's parent must be a work item. This is what caps the tree at three levels: a
    // gate on a gate has nowhere to sit, and nothing downstream could render or lint it.
    if (gates.length && !epic && workTypeOf(issue.labels) === null) {
      const why = gateOf(issue.labels) ? "is itself a gate" : "carries no work type";
      out.push({
        rule: "PM105", severity: "error", section: "§7.1", issue: ref(issue),
        message: `#${parent} holds gate(s) ${gates.map((g) => `#${g}`).join(", ")} but ${why}. Only a work item takes gates, which is what keeps the tree three levels deep.`,
        fix: `Give it a type: gh issue edit ${parent} --add-label improvement    # or bugfix / experiment`,
      });
    }
  }

  // --- PM011 / PM013 / PM016 — per work item ------------------------------------------------
  for (const [number, issue] of [...parentage.all].sort((a, b) => a[0] - b[0])) {
    const gate = gateOf(issue.labels);

    // PM011 — a gate carries its parent's milestone (§9). Without this, moving a parent strands its
    // gates on the old milestone, and every milestone-scoped query silently under-reports.
    if (gate) {
      const parentNumber = parentage.parentOf.get(number);
      const parent = parentNumber === undefined ? null : parentage.all.get(parentNumber);
      if (parent && parent.milestone !== issue.milestone) {
        out.push({
          rule: "PM011", severity: "error", section: "§9", issue: ref(issue),
          message: `Gate #${number} is milestoned \`${issue.milestone ?? "none"}\` but its parent #${parent.number} is on \`${parent.milestone ?? "none"}\`. A gate rides its parent's milestone or it is invisible to every query that matters.`,
          fix: parent.milestone
            ? `gh issue edit ${number} --milestone ${parent.milestone}`
            : `gh issue edit ${number} --remove-milestone`,
        });
      }
      continue;
    }

    const type = workTypeOf(issue.labels);
    // A `release-gate` is a release OBLIGATION, not work with a design→plan→impl arc: publish the
    // substrate, reconcile a version line, rotate a credential. There is no design to accept and no
    // plan to write, so demanding a gate set for one asks for three sub-issues nobody can fill in.
    // It sits in the same exempt class as `epic` — a thing the two-axis model tracks that is not a
    // work item. PM004/PM005 are what govern it instead.
    if (!type || issue.labels.includes("epic") || issue.labels.includes("release-gate")) continue;

    const children = childrenOf.get(number) ?? [];
    const present = new Map<number, Issue>();
    for (const c of children) {
      const g = gateOf(parentage.all.get(c)?.labels ?? []);
      if (g) present.set(g.n, parentage.all.get(c)!);
    }

    // PM013 — the completeness rule that makes "gate absent" unambiguous (§9). It fires only on the
    // FOCUSED milestone, because that is the trigger materialization uses: work scheduled three
    // releases out is correctly gateless, and flagging it would train people to ignore the rule.
    if (cycle && issue.milestone === cycle && issue.state.toUpperCase() === "OPEN") {
      const missing = GATES[type].filter((g) => !present.has(g.n)).map((g) => g.n);
      if (missing.length) {
        out.push({
          rule: "PM013", severity: "error", section: "§9", issue: ref(issue),
          message: `#${number} is on the cycle in flight (\`${cycle}\`) but is missing gate(s) ${missing.join(", ")} of ${GATES[type].length}. An absent gate has to mean "not materialized yet" or "nobody wrote it" — never both.`,
          fix: `npx @hoodiecollin/pm-playbook materialize --milestone ${cycle}`,
        });
      }
    }

    // PM016 — every gate closed and the work item still open (§9). A warn: one PR closes the last
    // gate and the parent, and GitHub does not do it atomically, so an error would fire on correct
    // behavior mid-merge. What it catches is the case that outlives the merge — finished work that
    // sits on a milestone forever, blocking `release-check` and reading as in flight.
    if (
      issue.state.toUpperCase() === "OPEN" &&
      GATES[type].length === present.size &&
      GATES[type].every((g) => present.get(g.n)?.state.toUpperCase() === "CLOSED")
    ) {
      out.push({
        rule: "PM016", severity: "warn", section: "§9", issue: ref(issue),
        message: `#${number} has every gate closed but is still open. Closing the last gate is what finishes the work — if it is really done, the milestone is waiting on nothing but this.`,
        fix: `gh issue close ${number}    # or reopen the gate that is not actually finished`,
      });
    }
  }

  return out;
}

/**
 * Evaluate every issue-level invariant. Pure — takes data, returns findings.
 *
 * `parentage` is optional because it is only knowable from a materialized backlog or a GraphQL
 * fetch; without it every structural rule is skipped rather than guessed. `cycle` is optional for
 * the same reason — PM013 has no referent without one.
 */
export function checkIssues(
  issues: Issue[],
  subIssueCounts?: Map<number, number> | null,
  parentage?: Parentage | null,
  cycle?: string | null,
): Violation[] {
  const out: Violation[] = [];

  if (parentage) out.push(...checkStructure(parentage, cycle ?? null));
  out.push(...checkPatchMilestones(issues));

  for (const i of issues) {
    const has = (l: string) => i.labels.includes(l);
    const scheduled = i.milestone !== null;
    const isGate = gateOf(i.labels) !== null;

    // PM010 — exactly one type label (§3.1). Epics are containers, not work; gates inherit their
    // parent's type through their own label, so neither is a work item for this purpose. Nor is a
    // `release-gate`: it is a release obligation, and requiring a type on one walked straight into
    // PM013, which then demanded a gate set for it. Between them the two rules made every
    // release-gate on the cycle in flight permanently non-compliant — the exemption belongs here,
    // at the rule that was asking the wrong question, rather than as a suppression downstream.
    if (!isGate && !has("epic") && !has("release-gate")) {
      const found = WORK_TYPES.filter(has);
      if (found.length !== 1) {
        out.push({
          rule: "PM010", severity: "error", section: "§3.1", issue: ref(i),
          message:
            found.length === 0
              ? "No work type. Every work item is exactly one of `improvement`, `bugfix` or `experiment` — the type decides which gates it takes."
              : `Carries ${found.length} work types (${found.join(", ")}). A work item is exactly one kind of work.`,
          fix:
            found.length === 0
              ? `gh issue edit ${i.number} --add-label improvement    # or bugfix / experiment`
              : `Keep one: gh issue edit ${i.number} --remove-label ${found.slice(1).join(",")}`,
        });
      }
    }

    // PM003 — experiment ⊕ milestone. An experiment feeds the spine; it never rides it (§4).
    if (has("experiment") && scheduled) {
      out.push({
        rule: "PM003", severity: "error", section: "§4", issue: ref(i),
        message: `\`experiment\` is milestoned \`${i.milestone}\`. A spike's deliverable is a finding, not a shippable artifact — it feeds the spine, it never rides it.`,
        fix: `Unschedule the spike, then file the work its verdict commits as its own issue and milestone THAT: gh issue edit ${i.number} --remove-milestone`,
      });
    }

    // PM014 — the hotfix warrant's structural half (§5.6). The eligibility tests are human
    // judgement and live in the gate-1 body; what a machine can check is the shape.
    if (has("hotfix")) {
      if (!has("bugfix")) {
        out.push({
          rule: "PM014", severity: "error", section: "§5.6", issue: ref(i),
          message: "`hotfix` without `bugfix`. A hotfix is a *form* of bugfix — the urgency changes the milestone and the branch, not the kind of work or the gates.",
          fix: `gh issue edit ${i.number} --add-label bugfix`,
        });
      }
      if (!scheduled) {
        out.push({
          rule: "PM014", severity: "error", section: "§5.6", issue: ref(i),
          message: "`hotfix` has no milestone. A hotfix ships on its own patch milestone, opened when the warrant is accepted — an unmilestoned hotfix is just a bug.",
          fix: `Open the patch milestone and assign it: gh issue edit ${i.number} --milestone <vX.Y.Z>`,
        });
      }
      const forbidden = ["experiment", "epic"].filter(has);
      if (forbidden.length) {
        out.push({
          rule: "PM014", severity: "error", section: "§5.6", issue: ref(i),
          message: `\`hotfix\` coexists with ${forbidden.join(", ")}. A hotfix is bounded, released-behavior work — it is neither a spike nor a container.`,
          fix: `gh issue edit ${i.number} --remove-label ${forbidden.join(",")}`,
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

    // PM005 — release-gate ⊕ experiment. A release obligation is committed by definition; a spike
    // is the one kind of work that can never be one.
    if (has("release-gate") && has("experiment")) {
      out.push({
        rule: "PM005", severity: "error", section: "§3.2", issue: ref(i),
        message: "`release-gate` coexists with `experiment`. A release obligation blocks a tag — it is committed by definition, and a spike never is.",
        fix: `gh issue edit ${i.number} --remove-label experiment`,
      });
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


/**
 * PM017 — every open work item and epic opens with the plain-English summary slot (§9.6).
 *
 * Carried separately from `checkIssues` because it is the one rule that reads a **body**, and
 * `Issue` has none: `asIssue` projects a `BacklogEntity` into an `Issue` and drops it, and the
 * networked fetch omits bodies on purpose — `fetchParentage`'s own note says fetching them would
 * make every `check` pay `fetchBacklog` prices for a graph of numbers.
 *
 * So this runs on the materialized backlog only, and `check` says so on the networked tier rather
 * than passing by not running (§5.5). PM104 is already mirror-only for the same structural reason.
 *
 * A **warning**, not an error: every repo adopting the playbook would otherwise fail `check` on its
 * entire existing backlog at once. `--strict` remains available to anyone who wants it enforced.
 */
export function checkBodies(entities: Iterable<BacklogEntity>, repo: string | null): Violation[] {
  const out: Violation[] = [];

  for (const e of entities) {
    // Closed issues are never retrofitted — they are the historical record, and flagging them would
    // generate permanent noise nobody may act on.
    if (e.state !== "OPEN") continue;

    // Gates and release-gates are seeded with mandated structure that already serves this purpose.
    // An epic is NOT exempt: it is read by the same tooling its children are.
    if (gateOf(e.labels) !== null) continue;
    if (e.labels.includes("release-gate")) continue;
    if (workTypeOf(e.labels) === null && !e.labels.includes("epic")) continue;

    const { text, misplaced } = readSummary(e.body);
    const issue = {
      number: e.number,
      title: e.title,
      url: `https://github.com/${repo ?? "unknown/unknown"}/issues/${e.number}`,
    };

    if (text === null) {
      out.push({
        rule: "PM017", severity: "warn", section: "§9.6", issue,
        message: `#${e.number} has no \`### ${SUMMARY_HEADING}\` section. A reader — or a command composing this issue's purpose — has nothing to read but the whole body.`,
        fix: `Add \`### ${SUMMARY_HEADING}\` as the first section: two or three sentences on what this is, for someone who has never seen it.`,
      });
      continue;
    }

    // Presence and position are separate facts, so they get separate messages. "It exists but is
    // third" is a different edit from "it does not exist".
    if (misplaced) {
      out.push({
        rule: "PM017", severity: "warn", section: "§9.6", issue,
        message: `#${e.number} has a \`### ${SUMMARY_HEADING}\` section, but something else comes first. The summary is what a reader sees before deciding whether to read on.`,
        fix: `Move \`### ${SUMMARY_HEADING}\` to the top of the body, above every other section.`,
      });
    }
  }

  return out;
}
