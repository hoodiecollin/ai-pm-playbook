---
name: pm-playbook
description: "The two-axis GitHub Issues model — milestones (when) + labels (what/maturity), with hard invariants. Use when creating, labeling, milestoning, closing, or triaging issues; filing an RFC or implementation plan; building or reading a roadmap; deciding what to work on next; preparing a release or asking whether a milestone can be tagged; choosing which branch a PR targets; or reviewing someone else's tracking changes. Keywords - issue, backlog, milestone, label, epic, roadmap, rfc, release, tag, plan-next, experiment, release-gate, surface, sub-issue."
---

# pm-playbook

Issue tracking follows a two-axis model with **hard invariants**. Violating one is a bug, not a
style preference — `npx @hoodiecollin/pm-playbook check` exits non-zero on them.

## Where the authoritative text lives

If the repo has a `.pm-playbook/` directory, **that is authoritative** — it is version-pinned to
what this project actually adopted, and it may be a different version than this plugin. Read
`.pm-playbook/AGENT.md` for the router and `.pm-playbook/reference/*.md` for detail.

If it does not exist, this repo has not adopted the playbook. Say so before proceeding, and offer:

```bash
npx @hoodiecollin/pm-playbook init          # vendor the doctrine + wire agent instruction files
npx @hoodiecollin/pm-playbook bootstrap --repo <owner>/<name>   # provision labels on GitHub
```

Everything below is the always-true core, and is safe to act on either way.

## The two axes — and nothing else decomposes work

| Axis | Mechanism | Answers |
|---|---|---|
| **When** | **Milestone** = a version release (the release spine) | Is this scheduled, and for which release? |
| **What kind / maturity** | **Labels** | What is this, and how committed are we? |

- Epics decompose via GitHub **native sub-issues** — not task-list checkboxes, not a Project field.
- The Project board is a **view** over issues, never a second source of truth.
- There are **no Priority / Size / Workstream fields**. Never add or propose one.
- Code + git history is **ground truth**. A board card, a label, a roadmap doc, an RFC, a memory
  note — each is a *claim* about it. When a claim disagrees with the code, the claim is wrong.

## The commitment ladder

```
idea  →  plan-next  →  milestone assigned  →  merged/closed  →  GitHub Release
(speculative) (committed,   (scheduled;        (into the        (shipped;
              unscheduled)   drop plan-next)    milestone)       roadmap flips)
```

`experiment` is **not** a rung — it is off-spine entirely.

## Invariants

| Rule | Invariant |
|---|---|
| `PM001` | `plan-next` ⊕ milestone — assigning a milestone means dropping `plan-next` |
| `PM002` | `idea` ⊕ `plan-next` |
| `PM003` | `experiment` ⊕ {`idea`, `plan-next`, milestone} |
| `PM004` | `release-gate` ⇒ milestone |
| `PM005` | `release-gate` ⊕ {`idea`, `plan-next`, `experiment`} |
| `PM006` | non-core `surface:*` ⊕ core `v*` milestone |
| `PM008` | a PR to the integration branch never closes work milestoned past the cycle in flight |

A `PreToolUse` hook in this plugin blocks the statically-detectable ones (`PM001`–`PM005`) before a
`gh issue create/edit` runs. It only sees the command text, so it cannot catch a violation that
depends on the issue's *existing* labels — run `check` for that.

## The six things to get right

1. **Dropping `plan-next` when you assign a milestone.** The milestone *is* the schedule signal.
   Do both in one action. This is the single most common violation.
2. **Never milestone an experiment.** A spike's deliverable is a *decision*, not a shippable
   artifact. It feeds the spine; it never rides it. If its conclusion commits feature work, file
   *that feature* as its own issue and milestone that instead.
3. **Gates before code.** Nothing gets coded until a design-doc (`rfc` issue — what and why), then
   an implementation-plan (how), exist in that order. Then BDD specs RED → GREEN. Two rules about
   the gates themselves (§9.1, §9.2):
   - **Redoing an accepted gate? Purge the issue body FIRST**, before any new thinking, down to a
     placeholder saying the gate is being redone. A withdrawn design left in the body does not
     read as withdrawn — it reads as *the* design, because that is what a body is, and the
     correction always sits in a comment nobody scrolls to. Repopulate only at acceptance.
   - **Reconcile sources before AND after every gate.** Verify claims against code going in;
     propagate the accepted outcome going out. A gate's input is the previous gate's output, so a
     stale claim there is built on rather than caught.
4. **The release-gate issue carries a ledger of EVERY versioned asset** (§5.2), defaulting each
   row to "no change", created when the milestone opens and updated in the same pass that lands a
   change touching that asset. An absent row and a "no change" row look identical at tag time and
   mean opposite things. Include internal packages — their failure is the quiet one: the version
   exists, so nothing errors, and the release ships stale source behind a correct-looking number.
5. **No markdown backlog.** No `TODO.md` / `TASKS.md`. Ask "what's next" with
   `gh issue list --state open`. When you commit to work, `gh issue create` *first*, then implement.
6. **Prioritize on engineering merit.** Scope, risk, foundational sequencing, identity fit — never
   demand or usage, which for a pre-launch product is data nobody has. Never estimate in time
   units; effort labels are banned.

## Verifying

```bash
npx @hoodiecollin/pm-playbook check --json          # every violation, each with an executable fix
npx @hoodiecollin/pm-playbook release-check vX.Y.Z  # can this milestone be tagged?
npx @hoodiecollin/pm-playbook scope-check <pr>      # is this PR landing next-cycle work on develop?
```

Run `check` before you finish any task that touched issues, and act on what it reports rather than
reporting the violations back to the user unfixed.
