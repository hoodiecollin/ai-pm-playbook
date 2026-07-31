# Roadmap Playbook — the ForgeDB project-management model, generalized

The canonical, portable version of the project-management approach worked out on **ForgeDB**.
Any repo can adopt it. It is a *system*, not a board: GitHub **Issues** are the backlog, a small
**label** vocabulary and **milestones** are the only two axes that organize them, and a
**documentation discipline** keeps every claim honest.

> **The rule:** code + git history is *ground truth*. Every other artifact — a board card, a
> label, a roadmap doc, an RFC, a memory note — is a *claim* about ground truth and must point
> back to it. When a claim disagrees with the code, the claim is wrong.

---

## 1. The two-axis core (the whole model)

**All work is GitHub Issues, organized by exactly two orthogonal axes — and nothing else
decomposes work:**

| Axis | Mechanism | Answers |
|---|---|---|
| **When** | **Milestone** = a version release (the *release spine*, §5) | *Is this scheduled, and for which release?* |
| **What kind / maturity** | **Labels** (§3) | *What is this, and how committed are we?* |

Plus one structural mechanism and one hard rule:

- **Epics decompose via GitHub *native sub-issues*** (§7) — the real `Parent issue` /
  `Sub-issues progress` link, **not** task-list checkboxes and **not** a Project field.
- **The Project board is a *view* over issues, never a second source of truth** (§8).

**There are no `Priority`, `Size`, or `Workstream`/`Area` custom fields.** Earlier versions of
this model (and the ForgeDB board itself, until 2026-07-30) carried them; they were **deleted**.
They created a parallel decomposition scheme — a second source of truth that drifts — and tempted
work to be sliced by a guessed number instead of by *when it ships* and *what it is*. If you are
migrating a board that has them, **remove the fields and any view that depends on them** (§8, and
GAP-AUDIT.md for the per-project list).

Why so spartan: two axes you can read off an issue at a glance, with mechanical rules between
them, beat a rich field matrix nobody keeps current. Everything downstream — the roadmap page,
the changelog, "what do I do next" — is *derived* from these two axes, not tracked separately.

---

## 2. The commitment ladder (the maturity gradient)

The labels encode one idea: work is ranked by *distance from shipped*. This **commitment ladder**
is the spine of the "what/maturity" axis:

```
  speculative       committed          scheduled           shipping             shipped
  ───────────       ─────────          ─────────           ────────             ───────
  label: idea   →   label: plan-next → milestone assigned → merged / closed    → GitHub Release
  (needs an RFC)    (unscheduled)      (drop plan-next)     (into the milestone)  (roadmap flips)
```

| Rung | Means | Promotion gate → next rung |
|---|---|---|
| **`idea`** | Speculative. Not committed. | **Gate 1:** an accepted **design-doc** (`rfc` issue — §9). |
| **`plan-next`** | Committed, but not yet scheduled to a version. | Assign a **milestone** (and **drop `plan-next`** — §3.2). |
| **milestone** | Scheduled into a specific release. | **Gate 2:** a reviewed **implementation-plan** → start work. |
| **In flight** | Being built (**Gate 3:** BDD specs RED → GREEN — §9). | Merge; the issue **closes into** its milestone. |
| **Closed-in-milestone** | Done in code, but roadmap reads *"pending release"*. | **Tag the GitHub Release** for the milestone. |
| **Released** | Shipped reality. | — |

Copy this framing into every milestone description:

> *"Issues close into this milestone until it is tagged; on the roadmap they read as 'pending
> release' until the vX.Y.Z GitHub Release exists."*

**Why it matters:** "done" is ambiguous. The ladder splits it into *code-complete* (issue closed)
and *shipped* (release tagged), so the roadmap never over-promises. (`experiment` is **not** a rung
on this ladder — it is off-spine entirely; see §4.)

---

## 3. Labels — the "what / maturity" axis

Labels are **self-documenting**: each label's *description* is the process. The bootstrap script
writes these descriptions for you.

### 3.1 The taxonomy (portable verbatim)

| Label | Color | Description (this text is the process) |
|---|---|---|
| `idea` | `#c5def5` | Speculative feature idea; needs a design note before implementation. |
| `plan-next` | `#0e8a16` | Committed but not yet scheduled to a version milestone (milestone = scheduled). |
| `rfc` | `#5319e7` | Request for comment: design captured as an issue (proposals no longer committed to the repo). |
| `experiment` | `#a2eeef` | A spike to measure; deliverable is a decision, not a shippable artifact. Never milestoned (§4). |
| `epic` | `#6f42c1` | Umbrella tracking issue; decomposes via native sub-issues. |
| `tech-debt` | `#fbca04` | Known gap or stub in shipped code. |
| `perf` | `#d93f0b` | Performance cost / triage item. |
| `config` | `#1d76db` | Configurable-runtime-behavior work. |
| `legacy-audit` | `#5319e7` | Legacy audit: prune dead / product-misaligned code. |

Plus GitHub's stock labels (`bug`, `documentation`, `enhancement`, `good first issue`, `help
wanted`, `question`, `duplicate`, `invalid`, `wontfix`) and the **`surface:*`** delivery labels
(§6).

### 3.2 Label invariants (the integrity rules)

These mutual-exclusions keep the two axes clean and make every derived view trivial to filter.
**Enforce them on every issue:**

- **`plan-next` ⊕ milestone.** `plan-next` means *committed but unscheduled*. The moment you
  assign a milestone the item is scheduled — **drop `plan-next`.** They must never coexist.
- **`idea` ⊕ `plan-next`.** Speculative and committed are opposites. Pick one.
- **`experiment` ⊕ {`idea`, `plan-next`, milestone}.** A spike you've committed to running is no
  longer merely speculative, isn't feature work in a queue, and never rides the spine (§4).

A consequence worth naming: because `plan-next` never has a milestone, "everything committed but
unscheduled" is *exactly* the `plan-next` filter — no compound query needed.

---

## 4. Experiments never ride the release spine

**Doctrine (locked on ForgeDB 2026-07-30).** A milestone ships **features / fixes / perf** —
things that produce a binary a user installs. An **`experiment` is a spike to *measure*; its
deliverable is a *decision*, not a shippable artifact.** Therefore:

- An `experiment` issue is **never** placed on a `v*` milestone. Experiments run as an
  **unscheduled research track**, parallel to the spine.
- The experiment's *measured conclusion* may **commit new feature work** — and **that** feature,
  not the spike, is what gets a milestone.
- **Never anchor a milestone's theme on an experiment's hoped-for outcome.** You cannot schedule
  a feature whose existence the experiment has not yet decided. (Real error this corrected: a
  storage-model experiment was proposed as a release *anchor* — wrong; it *feeds* the release, it
  isn't *on* it.)

**The discipline test:** if an issue's primary output is a **measurement / evaluation / verdict**,
it's an `experiment` (off-spine). If it's **shippable code that ships regardless of any
measurement**, it's a feature / `perf` / `config` item (on-spine).

**Experiment method must be fair.** Since the deliverable is a decision, the measurement has to be
apples-to-apples (e.g. match durability/transaction semantics across anything you benchmark) — a
verdict from an unfair comparison is worse than none.

---

## 5. Milestones = the release spine (the "when" axis)

- **A milestone is a version** (`v0.3.0`, `v1.0.0`), never a theme or a sprint.
- **Assigning a milestone == "scheduled."** It is the *only* signal that something is scheduled.
- **Keep a forward spine of open milestones.** ForgeDB runs `v0.4.0 → v0.7.0` open ahead of the
  current release so scheduled work has a home. **1.0 is a horizon**, not yet a milestone, until
  its contents are real.
- Each milestone gets a **descriptive body** stating what ships and the "pending release until
  tagged" semantics (§2).
- **Closed ≠ shipped.** An issue closes *into* a milestone when its code merges; the roadmap keeps
  reading "pending release" until you cut the **GitHub Release** tag.

### 5.1 Release mechanics (portable principles)

- **Conventional commits → a generated changelog** (ForgeDB uses `git-cliff` → `CHANGELOG.md`).
  One source, two surfaces: the GitHub Release body *and* the website changelog render from it.
- **The changelog and roadmap scope-filter out non-core surfaces** (`website`, extension,
  packaging) so only core `v*` work headlines — mirrors the surface-exclusion rule in §6.
- **For published-artifact products, dry-run the publish before tagging** (e.g. an outside-repo
  install/build, or `cargo publish --dry-run`). Green in-tree ≠ an installed user can build.
- **Beware the closed-vs-released race.** A page that reads "Next" from the live Releases API will
  show a just-tagged version as *Next* until the Release actually publishes (build lag) — another
  reason "closed" and "released" are distinct rungs. Trigger roadmap refreshes on **Release
  completion**, not tag push.

---

## 6. Surfaces — the delivery axis (`surface:*` labels)

A **Surface** designates a *distinct, independently shippable product surface* — a face of the
product a user touches (core lib, IDE extension, marketing site), one that may have its **own
release cadence and tag namespace**. Modeled as **labels**, only when a repo **ships more than one
artifact**; a single-artifact repo has one implicit surface (`core`) and needs no labels.

> **Why "surface," not "channel":** *"release channel"* already means a **stability stream**
> (stable / beta / nightly / canary) — an orthogonal concept that must stay separable (you can
> ship a beta *of* the extension). A Surface is a shippable *face*, not a maturity tier. And
> **"workstream" is retired** — it conflated the surface axis with subsystem decomposition.

| Surface label | Color | Covers |
|---|---|---|
| `surface:core` *(often implicit/default)* | `#1d76db` | The primary product line (core `v*` releases). |
| `surface:ide-extension` | `#007ACC` | Editor extension + language server (ships on its **own** `ext-v*` / `vscode-v*` tag line). |
| `surface:website` | `#1d76db` | Marketing + docs site (usually continuously deployed, no version tag). |
| `surface:cli` / `surface:sdk` | `#1d76db` | Any other independently shipped user-facing artifact. |

> **`ci` is *not* a surface** — CI/build tooling ships nothing to a user. It's just a labeled
> concern (`ci`), not a delivery surface. The test is "is a user touching this thing?"

### 6.1 The surface-exclusion rule (load-bearing)

**Never put a non-core `surface:*` issue on a core `v*` milestone.** A `surface:website` or
`surface:ide-extension` issue milestoned onto `v0.5.0` would read as *"done — awaiting v0.5.0"*
even though it already shipped on its own line, and it would never appear in the core changelog.
Non-core surfaces:

- ship on their **own release line / tag namespace** (or deploy continuously);
- are **excluded from the core roadmap and changelog** by a scope filter on their `surface:*`
  label;
- get their **own milestones** in their own namespace if they version at all (e.g. `ext-v0.1.0`).

The **Surface Board** view groups by these labels.

---

## 7. Epics & the roadmap view

### 7.1 Epics decompose via native sub-issues

An **`epic`** is an umbrella issue and a **top-level container that MAY span releases** — don't
force it to be atomic; its children ship incrementally, each carrying **its own milestone**.

- **Children are linked as GitHub *native sub-issues*** (`Parent issue` / `Sub-issues progress`;
  `gh api repos/OWNER/REPO/issues/N/sub_issues`, POST needs the child's REST `id`, not its
  number). **Not** task-list checkboxes (secondary, drift-prone) and **not** a Project field.
- **Standalone issues** (bug fixes, one-offs with no epic parent) are top-level too.

Epic body shape (skeleton in `.github/ISSUE_TEMPLATE/epic.md`):

1. **`> ## ✅ Decisions locked (YYYY-MM-DD)`** — a blockquoted block of settled decisions at the
   top, each with a ✅ and a one-line rationale; supersedes stale discussion below it.
2. **Summary** — what it delivers, with a **release-blocking** flag if applicable.
3. **Current state (ground truth)** — where the code actually is *right now*.
4. **Children** — linked as native sub-issues (the "Sub-issues progress" bar rolls them up).
5. **Upstream / downstream** — relationships to other epics.

### 7.2 The roadmap is derived, EPIC-PRIMARY

The roadmap (e.g. a website `/roadmap` page) is **computed from the two axes + native sub-issue
structure**, never maintained by hand. Epics are the top-level unit; standalone issues sit
alongside. Forward **status buckets are derived** from state + labels + milestone — and the label
invariants (§3.2) make each bucket a one-line filter:

| Bucket | Derivation (filter) |
|---|---|
| **Shipped** | closed + released (compact release cards; closed epics with children) |
| **Active** | scheduled (has a milestone) and/or in flight |
| **Planned** | `plan-next` (committed, unscheduled — and by invariant, milestone-free) |
| **Labs** | `experiment` or `rfc` |
| **Ideas** | `idea` |

Scope-filter out non-core `surface:*` labels (§6.1) so the core roadmap stays about the core.

---

## 8. The board is a view

The **backlog lives in Issues.** The Project board adds **saved views** — that's its only job.
With Priority/Size/Area gone, views are driven by the two axes (labels + milestone) and Status,
and thanks to the invariants they're trivial filters:

| View | Layout | Filter / grouping | Answers |
|---|---|---|---|
| **Everything** | Table | *(none)* | The full backlog. |
| **Release spine** | Board/Table | *group by Milestone* | "What's scheduled, by version?" |
| **Epics** | Table | `label:epic` | The epic-primary top level. |
| **Planned** | Table | `label:plan-next` | Committed, not yet scheduled. |
| **Labs** | Table | `label:experiment,rfc` | The research track (off-spine). |
| **Ideas** | Table | `label:idea` | Speculative backlog. |
| **Surface Board** *(multi-artifact repos)* | Board | *group by `surface:*` label* | Work by shippable surface. |
| **Execution** | Board | *group by Status* | Kanban of in-flight work. |

`Status` (Todo / In Progress / Done) is GitHub's native execution field — kept as a light
in-flight indicator, **not** a decomposition axis. The filtered views are scriptable (§ bootstrap
script); the *grouped* boards (by Milestone / Surface / Status) need a one-time group-by in the UI.

---

## 9. The design → plan → spec doctrine

> **Nothing gets coded until two artifacts exist, in series: a *design-doc*, then an
> *implementation-plan*. Both live as issues, never as committed files.**

Design and planning are **two distinct deliverables**. Doing them *in series before any code* is
what surfaces gotchas while they're cheap and makes the coding fast and unambiguous. Three gates:

- **Gate 1 — design-doc (WHAT & WHY).** An **`rfc` issue**: problem, desired behavior, solution
  *shape*, alternatives, and explicit **non-goals/limits**. Solution-shaped, not code-shaped.
  Catches **conceptual** gotchas. **Accepted →** drop `idea`, add `plan-next`.
- **Gate 2 — implementation-plan (HOW).** Written after the design is accepted and the item is
  scheduled, *before* code: files to touch, build order, dependencies/blockers, interfaces, and
  **the BDD scenarios to write**. Catches **execution** gotchas. Lives on the issue.
- **Gate 3 — BDD spec-first, RED → GREEN.** Write the scenarios as failing specs (**RED**),
  implement to **GREEN**, refactor under green. The specs *are* the acceptance criteria, so "done"
  is unambiguous and regression-proof.

**Why it works:** each stage's output is the next's input, so nothing is re-derived. Design kills
conceptual surprises; the plan kills execution surprises; RED locks intent as executable truth
before implementation exists.

**No `has-design` / `needs-design` / effort labels.** State is **derived from ground truth**: does
an accepted design-doc exist (past Gate 1)? an implementation-plan on the issue (Gate 2)? passing
specs (Gate 3, read from CI)? A status label is a claim a human must remember to update; the
**artifact's existence is the signal**. And **effort labels are banned** — effort isn't reliably
knowable, and a guess mis-steers scoping.

**Where design lives:** the design-doc is the `rfc` issue — **never** a committed `proposal-*.md`.
The only design docs in the tree are **durable architecture references for *shipped* features**
(`ARCHITECTURE.md`). When a feature ships, fold its durable design into `ARCHITECTURE.md` and
**close the `rfc`**.

---

## 10. Documentation discipline

- **Design docs live as `rfc` issues, not files** (§9). Filing one is a small workflow: a dedup
  check against existing issues, the body template, and the epic cross-link.
- **Two roadmap docs**, both deferring to Issues as authoritative:
  - **`VERSION_ROADMAP.md`** — the *honest state* of the current release effort: situation →
    scope (locked) → complete → still deferred.
  - **`WHAT_IT_IS.md`** — an "is / isn't" account: per-feature guarantees *and* honest limits,
    with a standing *"verify maturity claims against the code"* and *"where the README
    over-promises, this doc wins."*
- **`CONTRIBUTING.md`** states the two-axis model, the label ladder + invariants, the design→plan→
  spec doctrine, and the RFC-as-issue rule. It's where a newcomer learns the system.

---

## 11. Operating disciplines

Standing rules that keep Issues the single, always-current source of truth:

- **Backlog lives in Issues — no markdown backlog.** No `TASKS.md` / `TODO.md` shadow list. Ask
  "what's next" with `gh issue list --state open` (filter by label / milestone), not a file.
- **Auto-file issues for new work.** When you commit to a piece of work, `gh issue create` first
  (`tech-debt` for grounded gaps, `idea` for speculative features), *then* implement — don't wait
  to be asked.
- **Re-check the issue list each session.** State changes out-of-band; `gh issue list` at the
  start of relevant work so you're not acting on a stale view.
- **Proactively cross-link docs ↔ issues.** When new issues/epics give a home to claims scattered
  in docs, add the pointers **both directions** without waiting for permission — this is the
  *propagate* half of keeping sources aligned (run `sync-sources` at task boundaries).
- **Prioritize on engineering merit, not demand.** Never justify building or deferring on "demand,"
  "usage," or "when users want it" — for a pre-launch product those signals *don't exist*, so
  leaning on them smuggles in data you don't have. Justify on **scope, risk, foundational
  sequencing** (does X unblock Y), **identity fit**, and the legitimate YAGNI test: *does generated
  code / another crate actually link this?* (an in-codebase-consumer question, never a market one).

---

## 12. Adopting this in a new repo — checklist

1. Run `scripts/bootstrap-pm.ts` to create the labels (with descriptions), starter milestones,
   and the scriptable filtered views.
2. In the UI, set the **group-by** on the Release-spine / Surface / Execution boards (grouping
   isn't scriptable).
3. **If migrating an existing board: delete the `Priority`, `Size`, and `Workstream`/`Area`
   fields and every view that filters or groups by them** (GAP-AUDIT.md lists them per project).
4. Copy `.github/ISSUE_TEMPLATE/*` into the repo.
5. Define this product's **`surface:*`** labels — only if it ships more than one artifact.
6. Seed `VERSION_ROADMAP.md` + `WHAT_IT_IS.md` (§10) and put the two-axis model + doctrine into
   `CONTRIBUTING.md`.
7. Backfill: label the existing backlog along the ladder, assign milestones, and **enforce the
   invariants** (§3.2) — a `plan-next`+milestone collision is the #1 drift smell.
8. Convert epic checklists to **native sub-issues** (§7.1).

---

## 13. Anti-patterns this model exists to prevent

- **A parallel decomposition scheme** (Priority/Size/Workstream fields, a labels convention, a
  Project field) → there is **one** model: milestone + labels + native sub-issues. A second axis is
  a second source of truth that drifts.
- **`plan-next` + a milestone on the same issue** (or `idea` + `plan-next`) → violates the
  invariants (§3.2); the item's commitment state becomes ambiguous.
- **An experiment on the release spine** → experiments produce decisions, not artifacts; they feed
  the spine, never ride it (§4). Never anchor a release theme on a spike's hoped-for result.
- **Time/effort estimates** driving scope; **effort labels** → effort isn't reliably knowable.
- **Demand/usage justifications** → prioritize on engineering merit (§11).
- **Coding before designing** → design-doc then implementation-plan then BDD RED→GREEN (§9).
- **Stale status-labels** (`has-design`/`needs-design`) → state is *derived*, not stickered.
- **Doc drift** → design lives as `rfc` issues; only shipped-feature architecture is committed.
- **"Done" ambiguity** → closed-into-milestone vs released are distinct rungs.
- **Board as shadow backlog** → Issues are the backlog; the board is only a view.
- **Non-core surface work on a core milestone** → it reads "done, awaiting vX" but ships on its
  own line and never hits the core changelog (§6.1).
- **Roadmap over-promising** → `WHAT_IT_IS.md` states limits and cedes authority to the code.
