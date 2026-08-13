# Architecture

Durable design references for **shipped** features (§10). A feature's design lives on its `rfc`
issue while it is being built; when it ships, the parts worth keeping land here and the `rfc`
closes. Anything not yet released is not described here — check the open `rfc` issues instead.

## Shape of the package

Two halves, deliberately separable:

- **The doctrine** — `PLAYBOOK.md` plus `assets/playbook/`, vendored into a consumer's
  `.pm-playbook/` by `init`. Prose, no runtime. Agents read it out of the repo, which is why it is
  committed rather than fetched.
- **The tooling** — a bundled ESM CLI with **zero runtime dependencies**, shelling out to `gh` via
  `execFile`. It ships as `dist/cli.js` so `npx` (Node ≥18) and `bunx` behave identically.

`src/lib/invariants.ts` is the load-bearing module: every rule is a direct transcription of a
numbered PLAYBOOK section, and each violation carries an executable `fix`. Changing a rule without
changing the section it cites is a bug.

---

## The materialized backlog mirror (`v1.2.0`)

`pull`, `push`, and `create` project the GitHub backlog onto disk under a gitignored
`.pm-playbook/backlog/`, so agents can read and edit issues without a network round trip per
question. Design accepted in #1.

### Why it exists

The round-trip tax and derived-doc drift are the visible costs. The decisive one is that **the
linter was network-bound**, which capped how good the guardrails could get: `check` needed GitHub,
so the Claude Code `PreToolUse` hook had to stay deliberately partial. With a local graph `check`
runs offline and instantly — measured at **0.10s against 2.07s networked** on a 232-issue backlog —
and the hook can consult real backlog state instead of parsing command text.

### Layout

```
.pm-playbook/backlog/                       ← gitignored; `init` writes the ignore line
  .sync/
    labels.json                             ← remote label taxonomy (read-only)
    milestones.json                         ← remote milestones (read-only)
    index.json                              ← the base: repo + one projection hash per id
  standalone/
    [id]/body.md
    [id]/comment-[nnn]-[cid].md
    _/                                      ← closed
  epics/
    [id]/body.md
    [id]/subissues/[sub-id]/{body,comment-[nnn]-[cid]}.md
    [id]/subissues/_/                       ← closed sub-issues
    _/                                      ← closed epics
  new/                                      ← drafts with no number yet
  conflicts/                                ← set-aside local edits after a refused push
```

Editable content and machinery are strictly separated: `standalone/` and `epics/` are yours,
everything under `.sync/` is the tool's. The closed marker `_` composes at every level, so a closed
sub-issue of a closed epic lands at `epics/_/12/subissues/_/15`.

The nesting resolves parent linkage **structurally**: a sub-issue's parent is its containing
directory, so there is no parent field to keep consistent. "A standalone issue never has
sub-issues" is therefore unrepresentable by construction, and `PM105` exists to enforce the same
rule on backlogs that predate the feature.

### Identity is the ID; the path is derived

`.sync/index.json` keys everything by issue number. **Path is a rendered property** of state and
parentage, recomputed on every `pull`. This is what makes closing (`→ _/`), reopening, and epic
promotion ordinary moves rather than delete+create events — a path-keyed base would read every
state transition as both.

One asymmetry follows and is load-bearing: **writing interprets paths, reading does not.**
`writeTree` decides where each entity belongs and prunes whatever it did not write; `readTree`
finds every `body.md` and trusts the frontmatter. So a hand-moved directory is silently corrected
on the next `pull`, and a deleted one is restored. Deleting a local file means nothing.

### Three-state comparison

Per entity: the **base** (recorded at last `pull`), **local** now, and **remote** now. The operand
is a hash of the *materialized projection* — number, kind, parent, title, state, sorted labels,
milestone, body, and the full comment thread, canonicalized and SHA-256'd.

Two deliberate choices in that projection:

- **Not GitHub's `updatedAt`.** It moves for things we do not model, and under a
  refuse-on-any-change rule that produces false conflicts. A projection hash asserts exactly the
  claim we want: *the remote changed in something we own*.
- **Comments are included.** The accepted gate artifact is the gate issue (§9.5), but the thread is
  where a gate is argued, evidenced and reopened (§9.6) — so a body is very often written in answer
  to it, and a new comment must block a stale body push. This fires often on busy issues; being
  forced to re-read before editing is the intended behavior, not friction. The comment *ordinal* is
  excluded, because it is a position rather than an identity.

### Push refuses, never merges

| local vs base | remote vs base | outcome |
|---|---|---|
| = | = | `unchanged` |
| ≠ | = | `push` |
| = | ≠ | `pull` |
| ≠ | ≠, same hash | `unchanged` — both sides converged; someone applied the edit upstream |
| ≠ | ≠, differing | **`conflict`** — refused |

Presence resolves before content. Gone from the remote is a local deletion, never a push — an
issue can be deleted or transferred out from under us — and it splits on whether we ever saw it:
in base too means `remove`, never seen means `orphaned` (the number refers to nothing we have
pulled, so writing it would either fail or edit a stranger's issue). Absent locally is always
`pull`. Present locally with no base entry takes remote truth rather than guessing that the local
copy is an intentional edit.

Per-entity granularity — a whole-backlog check would never succeed in an active repo. There is no
field-level reconciliation and no local-wins flag. Three-way merge was rejected outright: it is
most of the engineering cost of the feature and its failure mode is silent, where refusing is
smaller, louder, and more trustworthy.

A refused edit is not lost. The next `pull` moves it to `conflicts/` and restores remote truth to
the canonical path, and `PM104` keeps warning until it is resolved — a gitignored directory quietly
accumulating abandoned edits is exactly the failure §11 exists to prevent.

**The conflict picture is two-way, not three-way**: the local edit under `conflicts/`, remote truth
at the canonical path. `.sync/index.json` stores hashes only. Detection never needed more, and a
full base tree would roughly double the mirror's disk cost (2.7 MB for a 232-issue backlog) to
serve one screen. Adding it later is additive.

### Reconciled cache, not a shadow backlog

§11 forbids a second copy of the backlog and `PM102` warns about it, so this feature needs its
carve-out stated precisely: **a second copy is a shadow backlog when it can disagree with Issues
indefinitely.** This one cannot — it is gitignored rather than committed, `pull` overwrites it from
GitHub, and `push` refuses the moment both sides move. A `TASKS.md` has none of those properties.

### `create`

The only non-idempotent operation in the system, and the only one that can duplicate real state.

Validation is **offline and total** — unknown labels and milestones are rejected against
`.sync/labels.json` and `.sync/milestones.json`, and the full invariant set runs against the drafts
— before any network call. Publication is epic-first, sub-issues second.

**The assigned number is written back into the draft immediately on return, before the sub-issue
link is made.** This ordering is load-bearing, not a nicety: a crash mid-sequence leaves a draft
that knows it already exists, so the retry reconciles instead of creating a duplicate epic.

### Fetching is always all-states

`fetchBacklog` deliberately ignores any state scoping. `planSync` resolves "gone from the remote"
by deleting the local copy, so a narrower fetch would make an out-of-scope issue indistinguishable
from a deleted one and quietly destroy the local mirror of every closed issue. Correctness beat the
volume optimization; volume remains a real concern on a much larger repo. Measured: 232 issues and
335 comments in 8.6s, 2.7 MB on disk.

The GraphQL query returns body, labels, milestone, `parent`, and comments in one paginated pass.
The `subIssues` connection is not used at all — each sub-issue reports its own `parent`, which
removes a pagination axis rather than paginating it.

### Both lint tiers see the same scope

`check` is network-authoritative by default; the snapshot stands in only under `--no-remote`.
Defaulting to a possibly-stale snapshot while GitHub is reachable would trade one drift class for
another.

Whichever tier runs, the **scope must match**: open issues, or everything under `--all-states`. An
offline answer that CI contradicts is worse than no offline answer.

`PM105` is the deliberate exception. Parentage is *structural*, not state-dependent — a closed epic
is still an epic — so `Parentage` carries its own index rather than resolving the parent through
the linted set. Resolving through the scoped set silently disarms the rule for exactly the closed
parents an audit is looking for.

### Module map

| Module | Concern |
|---|---|
| `backlog/model.ts` | the entity and comment types |
| `backlog/paths.ts` | pure path rendering from state and parentage |
| `backlog/serialize.ts` | JSON-valued frontmatter — valid YAML *and* `JSON.parse`-able, no deps |
| `backlog/project.ts` | the canonical projection and its hash |
| `backlog/plan.ts` | `planSync` — the three-state comparison; the correctness core |
| `backlog/store.ts` | reading and writing the tree; conflict set-aside; the index |
| `backlog/draft.ts` | drafts with no number yet, and their creation order |
| `backlog/lint.ts` | projecting the tree into the linter's scope |

`planSync` mirrors `planVendor`'s added/updated/conflicted/orphaned vocabulary on purpose — the
feature is `planVendor` generalized from files to entities.
