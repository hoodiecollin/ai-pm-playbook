---
name: pm-playbook
description: "The two-axis GitHub Issues model — milestones (when) + labels (what kind), with gates as sub-issues and hard invariants. Use when creating, labeling, milestoning, closing, or triaging issues; writing a design or implementation plan; building or reading a roadmap; deciding what to work on next; preparing a release or asking whether a milestone can be tagged; filing a hotfix; choosing which branch a PR targets; or reviewing someone else's tracking changes. Keywords - issue, backlog, milestone, label, epic, roadmap, gate, release, tag, hotfix, improvement, bugfix, experiment, release-gate, surface, sub-issue."
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
| **When** | **Milestone** = a version release (the release spine) | Are we committed to this, and for which release? |
| **What kind** | **Labels** | What kind of work is this? |

- **A milestone means COMMITTED.** *Focus* — that milestone being the cycle in flight — is what
  means scheduled. There is no "committed but unscheduled" label; it is just a later milestone.
- Epics decompose via GitHub **native sub-issues** — not task-list checkboxes, not a Project field.
- **Work items decompose into gates**, also native sub-issues. Three levels total, no fourth.
- The Project board is a **view** over issues, never a second source of truth.
- There are **no Priority / Size / Workstream fields**. Never add or propose one.
- Code + git history is **ground truth**. A board card, a label, a roadmap doc, a design gate, a
  memory note — each is a *claim* about it. When a claim disagrees with the code, the claim is wrong.

## Three work types, and their gates

Every work item carries **exactly one** type label. The type decides its gates, each a sub-issue
labelled `{type}:gate-{n}`:

| Type | Gates |
|---|---|
| `improvement` | design → plan → impl |
| `bugfix` | diagnose → fix |
| `experiment` | research → evaluate (never milestoned) |

`hotfix` is a bounded, warranted form of `bugfix` on its own patch milestone — never a fourth type.
`epic` is a container, not work, and never carries gates.

## The commitment ladder is DERIVED

There are no maturity labels. Walk the gates in order; the first one not closed decides the rung —
absent → `<verb>-next`, open → `<verb>-pending`. An improvement runs `idea → design-next →
design-pending → plan-next → plan-pending → impl-next → impl-pending → closed-in-milestone →
released`.

**Ask for it with `pm-playbook ladder`.** Do not try to filter for it: the rung is computed from an
item's children, and no GitHub filter can reach across the parent/sub-issue relation.

## Invariants

| Rule | Invariant |
|---|---|
| `PM003` | `experiment` ⊕ milestone |
| `PM004` | `release-gate` ⇒ milestone |
| `PM005` | `release-gate` ⊕ `experiment` |
| `PM006` | non-core `surface:*` ⊕ core `v*` milestone |
| `PM008` | a PR to the integration branch never closes work milestoned past the cycle in flight |
| `PM010` | exactly one type label per work item |
| `PM011` | a gate's milestone equals its parent's |
| `PM012` | an `epic` never carries gates |
| `PM013` | a work item on the focused milestone carries its complete gate set |
| `PM014` | `hotfix` ⇒ `bugfix` + milestone, and ⊕ {`experiment`, `epic`} |
| `PM015` | a patch milestone holds one hotfix and its gates, nothing else |
| `PM016` | *(warn)* every gate closed but the work item still open |
| `PM105` | only an `epic` has non-gate sub-issues; only a work item has gates |

A `PreToolUse` hook in this plugin blocks the statically-detectable ones before a `gh issue
create/edit` runs. It only sees the command text, so it cannot catch a violation that depends on
the issue's *existing* labels — run `check` for that.

## The six things to get right

1. **Exactly one type label, always.** Not zero, not two. The type decides the gate set, so an
   ambiguous type makes "is this done?" unanswerable. This is the most common violation.
2. **Never milestone an experiment.** A spike's deliverable is a *finding*, not a shippable
   artifact. It feeds the spine; it never rides it. If its verdict commits work, file *that work*
   as its own issue and milestone that instead.
2b. **Never create a gate by hand.** `pm-playbook materialize` owns them and creates a complete set
   at once. A hand-made gate destroys the only thing that makes an *absent* gate meaningful, and
   PM013 depends on that meaning.
3. **Gates before code.** Gate 1 (what and why) then gate 2 (how), each closed before the next
   opens; then BDD specs RED → GREEN in gate 3. Two rules about the gates themselves (§9.6, §9.7):
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
npx @hoodiecollin/pm-playbook ladder                # the rung of every work item (no filter can do this)
npx @hoodiecollin/pm-playbook materialize --yes     # gates for the cycle in flight (idempotent)
npx @hoodiecollin/pm-playbook check --json          # every violation, each with an executable fix
npx @hoodiecollin/pm-playbook release-check vX.Y.Z  # can this milestone be tagged?
npx @hoodiecollin/pm-playbook scope-check <pr>      # is this PR landing next-cycle work on develop?
```

Run `check` before you finish any task that touched issues, and act on what it reports rather than
reporting the violations back to the user unfixed.
