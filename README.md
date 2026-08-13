# @hoodiecollin/pm-playbook

A portable project-management model for GitHub Issues — packaged so **your agents read it and a
linter enforces it**.

```bash
npx @hoodiecollin/pm-playbook init                        # vendor the doctrine + wire your agent instruction files
npx @hoodiecollin/pm-playbook bootstrap --repo owner/name # create the 13 labels on GitHub
npx @hoodiecollin/pm-playbook check                       # exit 1 if the backlog violates an invariant
```

`init` writes files; `bootstrap` is the only step that touches GitHub, and it is idempotent.
**Already on 1.x? See [upgrading](#upgrading-from-1x) — 2.0 renames and retires labels.**

Works with any agent harness that reads repo files — Claude Code, Cursor, Codex, Copilot, Gemini,
Windsurf, or your own. No MCP server to run.

Claude Code users can additionally install the plugin, which adds slash commands and a hook that
blocks invariant-violating `gh issue` calls *before they run*:

```
/plugin marketplace add hoodiecollin/ai-pm-playbook
/plugin install pm-playbook@pm-playbook
```

---

## Why this isn't a normal dependency

Two payloads, two delivery mechanics:

| Payload | Consumer | How it ships |
|---|---|---|
| The doctrine (`PLAYBOOK.md`) | your **agent's context window** | vendored into `.pm-playbook/`, committed, version-stamped |
| The provisioner + linter | your **GitHub and your CI** | ordinary `npx` bin |

The doctrine is **copied into your repo rather than referenced from `node_modules/`**, on purpose:
cloud agents, CI containers and review sandboxes routinely have no `node_modules`; a committed file
is diffable, so a doctrine change shows up in PR review; and every harness can read repo files while
none reliably resolve a package path out of prose.

The cost of copying is drift, so it's paid for with a manifest — package version plus a SHA-256 per
file. `check` compares them and tells you to re-run `init`. That's the lockfile pattern applied to
prose.

## What `init` does

```
.pm-playbook/
  AGENT.md              ← the router your agents read first (short, always loadable)
  PLAYBOOK.md           ← the full doctrine
  reference/            ← 13 sections, loaded on demand
  manifest.json         ← version + per-file hashes (drift detection)
.github/ISSUE_TEMPLATE/ ← improvement · bugfix · experiment · epic · release-gate
AGENTS.md               ← a ~20-line pointer stanza between markers
.gitignore              ← one line: .pm-playbook/backlog/ (see below)
```

The stanza is a **pointer plus the invariants**, never the doctrine itself. Always-loaded context is
the scarcest resource in a repo — spending 500 lines of it on project management would degrade every
unrelated task. The pointer costs ~20 lines and buys progressive disclosure.

`--detect` also writes any agent file your team already keeps (`CLAUDE.md`,
`.github/copilot-instructions.md`, `.cursorrules`, `GEMINI.md`, …). Re-running is idempotent:
the stanza sits between `<!-- pm-playbook:begin -->` markers, so your own content is never touched.

## Why the linter is the load-bearing piece

Prose in a context window is a suggestion. A command that exits non-zero is a constraint.

The playbook's invariants are already boolean expressions over labels and milestones, so they're
executable — and agents self-correct against a failing check far more reliably than against a
paragraph they half-loaded.

| Rule | Invariant | §
|---|---|---|
| `PM003` | `experiment` ⊕ milestone | 4 |
| `PM004` | `release-gate` ⇒ milestone | 3.2 |
| `PM005` | `release-gate` ⊕ `experiment` | 3.2 |
| `PM006` | non-core `surface:*` ⊕ core `v*` milestone | 6.1 |
| `PM007` | an `epic` decomposes via native sub-issues *(warn)* | 7.1 |
| `PM008` | a PR to the integration branch never closes work milestoned past the cycle in flight | 5.3 |
| `PM009` | a PR references next-cycle work it doesn't close *(warn)* | 5.3 |
| `PM010` | exactly one type label per work item | 3.1 |
| `PM011` | a gate's milestone equals its parent's | 9 |
| `PM012` | an `epic` never carries gates | 7.1 |
| `PM013` | a work item on the focused milestone carries its complete gate set | 9 |
| `PM014` | `hotfix` ⇒ `bugfix` + milestone, and ⊕ {`experiment`, `epic`} | 5.6 |
| `PM015` | a patch milestone holds one hotfix and its gates, nothing else | 5.6 |
| `PM016` | every gate closed but the work item still open *(warn)* | 9 |
| `PM100` | vendored doctrine matches the installed package *(warn)* | — |
| `PM101` | agent instruction files carry the stanza *(warn)* | — |
| `PM102` | no markdown shadow backlog *(warn)* | 11 |
| `PM103` | label migrations from a newer version have been applied *(warn)* | — |
| `PM104` | no unresolved backlog conflict drafts *(warn)* | 11 |
| `PM105` | only an `epic` has non-gate sub-issues; only a work item has gates | 7.1 |

`PM001` and `PM002` were retired in 2.0 along with the `plan-next` and `idea` labels. **Their
numbers are burned, never reused** — a CI config or agent prompt that still names `PM001` should
stop matching rather than silently match a different rule.

Every violation carries an **executable fix**, and `--json` emits the whole report — that's the
agent-facing interface. A harness can feed violations straight back to a model:

```jsonc
{
  "rule": "PM013",
  "severity": "error",
  "message": "#42 is on the cycle in flight (`v2.1.0`) but is missing gate(s) 2, 3 of 3. …",
  "fix": "npx @hoodiecollin/pm-playbook materialize --milestone v2.1.0"
}
```

## Commands

| Command | Does |
|---|---|
| `init` | Vendor the doctrine, copy issue templates, wire agent files. **Local and offline** unless `--repo` is passed. |
| `bootstrap --repo o/n --project N` | Provision labels, a starter milestone, and the filtered Project views. Idempotent. |
| `check` | Lint the backlog. `--no-remote` for local-only, `--json` for agents, `--strict` to fail on warnings. |
| `materialize` | Create a milestone's gate sub-issues, as complete sets. Idempotent and resumable. Previews; `--yes` applies. |
| `ladder` | Where every work item sits on the commitment ladder — derived from gate state, so no filter can answer it. |
| `release-check vX.Y.Z` | "Can we tag?" Exit 1 if the milestone is gated or incomplete. |
| `scope-check <pr>` | Cycle-scope gate: refuse a PR that lands next-cycle work on the integration branch. |
| `migrate` | Apply label renames/removals after a MAJOR upgrade. Previews by default; `--yes` applies. |
| `pull` | Materialize the backlog to `.pm-playbook/backlog/` and record the base snapshot. |
| `push` | Send local edits back. Refuses any issue whose remote also moved. Previews; `--yes` applies. |
| `comment <issue> --body-file f` | Post a new comment and re-materialize. Refuses a stale read or an unpushed local edit. Previews; `--yes` posts. |
| `create` | Publish drafts under `backlog/new/`. Validates offline first. Previews; `--yes` applies. |
| `rules` | Print the rule index. |

`init` deliberately does **not** touch GitHub unless you pass `--repo`: provisioning labels mutates
shared team state and should be a decision, not a side effect of installing a dependency.

## CI

Every command reads issues and milestones through the `GITHUB_TOKEN`, so the workflow has to say
so. A repo whose default workflow permissions are contents-only fails with `Resource not
accessible by integration (repository.issues)` — grant the read scopes at the top of the file:

```yaml
permissions:
  contents: read
  issues: read
```

```yaml
- run: npx @hoodiecollin/pm-playbook check --repo ${{ github.repository }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

And as a tag gate (§5.2):

```yaml
- run: npx @hoodiecollin/pm-playbook release-check ${{ github.ref_name }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

**Mind where that step goes (§5.5).** Two workflows triggered by the same tag push are
independent, so putting this in its own tag-triggered workflow means it runs *beside* your release
workflow while artifacts build and publish — it fails loudly and blocks nothing. To make it an
actual gate, put it in a job your release jobs `needs:`, in your release tool's pre-release hook,
or behind a required status check. Running it parallel-and-loud is a legitimate choice; running it
that way *by accident* is the one to avoid.

And on pull requests targeting the integration branch (§5.3) — this refuses to land next-cycle work
on `develop`. The cycle in flight is derived from the lowest open core milestone on an unreleased
line, so there is no constant to keep updated and a patch milestone does not hijack it:

```yaml
- run: npx @hoodiecollin/pm-playbook scope-check ${{ github.event.pull_request.number }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

`scope-check` reads the pull request as well, so that job additionally needs
`pull-requests: read`.

## The local backlog mirror

`pull` materializes every issue — bodies, labels, milestones, epics, sub-issues and comment threads
— into a tree agents can read and edit without a round trip per question:

```
.pm-playbook/backlog/
  standalone/42/body.md          epics/12/body.md
  standalone/_/41/…  ← closed    epics/12/subissues/15/body.md
  new/<slug>/body.md             ← drafts with no number yet; `create` publishes them
  .sync/                         ← the base (one projection hash per issue), label + milestone tables
```

**This is not a shadow backlog, and the distinction is precise: a second copy is a shadow backlog
when it can disagree with Issues *indefinitely*.** This one can't. It's gitignored rather than
committed, `pull` overwrites it from GitHub, and `push` refuses outright the moment both sides have
moved. A `TASKS.md` has none of those properties — nothing overwrites it and nothing refuses on its
behalf. §11 says so explicitly, and `PM102` still fires on the real thing.

**Conflicts are refused, never merged.** There is no field-level reconciliation and no local-wins
flag. A refused edit isn't lost — the next `pull` sets it aside under `conflicts/`, restores remote
truth to the canonical path, and `PM104` keeps reporting it until you resolve it. The comparison is
a hash of exactly what we claim to own, comment threads included, since a gate is argued and
evidenced in its thread — so a new comment does block a stale body push, on purpose.

**New comments travel back; existing ones still don't.** `comment <issue> --body-file f` posts one
and re-materializes. Editing someone else's comment stays out of scope, and a not-yet-posted comment
has no author or id to put in a file — which is why adding one is a command rather than a file you
drop in the tree. It refuses when the thread has moved since your last pull, and when the target has
an unpushed local edit: commenting would move the remote, and the next `pull` would then see both
sides moved and file your own edit as a conflict. That hazard is invisible to a bare
`gh issue comment`, which is the point.

The payoff beyond speed: **`check --no-remote` now lints the real backlog.** It used to skip every
issue-level invariant without a network, so a sandbox or air-gapped CI job could only check doctrine
wiring. `PM105` is only checkable at all this way, because parentage isn't in the REST issue list.
Both tiers lint the same scope — open issues, or everything under `--all-states` — so the offline
answer and the CI answer agree. `PM105` is the deliberate exception: parentage is structural, so a
closed epic is still resolved as a parent even when it is outside the linted scope.

## The Claude Code plugin (optional)

The vendored-doctrine path above already works in Claude Code — this adds enforcement *earlier* in
the loop.

```
/plugin marketplace add hoodiecollin/ai-pm-playbook
/plugin install pm-playbook@pm-playbook
```

| Component | What it does |
|---|---|
| **Skill** `pm-playbook` | The always-true core, loaded on demand. Defers to `.pm-playbook/` when the repo has it, since that copy is version-pinned to what the project actually adopted. |
| `/pm-playbook:check` | Runs the linter and *fixes* what it finds, rather than reporting it back. |
| `/pm-playbook:promote` | Moves an issue up the ladder as one atomic edit, so a promotion can't half-apply. |
| `/pm-playbook:gate` | Writes the next open gate's artifact, grounded in the code, after a dedup check. |
| `/pm-playbook:release` | "Can we tag?", separating *gated* from *incomplete*. |
| **Hook** (`PreToolUse`) | Blocks `gh issue create/edit` that would violate a label invariant — before the issue exists. |

The hook sees only the command text, never the repo. That is deliberate: it catches what is
self-evident in the command (`--label improvement --label bugfix`) instantly and offline, and
leaves state-dependent violations to `check`. A fast partial gate beats a complete one that makes
every Bash call wait on the network. It fails open on anything it cannot parse — a hook that breaks
your session is worse than no hook.

It also never blocks the *fix*: `--remove-label bugfix` passes, because the
guard reads only additive flags. There's a regression test pinning exactly that.

## The model, in one paragraph

All work is **GitHub Issues**, organized by **exactly two orthogonal axes — Milestone (*when*, the
release spine) and Labels (*what kind / maturity*) — and nothing else decomposes work.** Epics
decompose via GitHub **native sub-issues** (not checkboxes, not a field); the **Project board is a
view**, never a second source of truth. There are **no Priority/Size/Workstream fields** — they're
a parallel source of truth that drifts. Labels carry hard **invariants** and **`experiment` never
rides the spine** — a spike's deliverable is a decision, not an artifact; its conclusion feeds the
spine. **Milestones = versions** ("scheduled"; closed ≠ shipped until the Release is tagged).
Distinct shippable faces are **`surface:*`** labels, each on its own release line and **excluded
from the core milestone + changelog**. Nothing gets coded until a **design-doc** (what/why) then an
**implementation-plan** (how) exist as issues, then **BDD spec-first RED→GREEN**. Prioritize on
**engineering merit, never demand**. If the product **publishes artifacts its own built output
depends on**, the default branch must stay *releasable* — publish eagerly or hold the **publish
gap** off trunk, prove it with an **outside-repo reclose**, and label anything that blocks a tag
**`release-gate`**.

Full text: **[PLAYBOOK.md](./PLAYBOOK.md)**.

## Versioning

The doctrine is versioned like code, because consumers' existing issues can become violations:

| Bump | Means |
|---|---|
| **MAJOR** | An invariant changed, or a label was renamed/removed. Your backlog may now fail `check`; a migration note ships with the release. |
| **MINOR** | A new label, rule, or section. |
| **PATCH** | Wording. |

Because labels live in **your** GitHub rather than in this package, a MAJOR release that renames or
retires one cannot fix itself — `bootstrap` writes labels by name and would just add the new one
alongside the old, leaving every existing issue on the stale taxonomy. `migrate` closes that:

```bash
npx @hoodiecollin/pm-playbook migrate          # preview: shows every action and its blast radius
npx @hoodiecollin/pm-playbook migrate --yes    # apply
```

It is preview-first because the three rename cases are not equally reversible:

| Repo state | Action |
|---|---|
| only the old label exists | **rename** in place — GitHub preserves every assignment |
| **both** labels exist | **merge** — relabel each carrier, then delete the old label |
| only the new label exists | **skip** — already migrated, so re-running is safe |

Progress is recorded as `migratedThrough` in `.pm-playbook/manifest.json`, tracked separately from
`version` so that `init` (which rewrites the doctrine) and `migrate` (which rewrites GitHub) can
run in either order without one erasing the other's evidence of pending work. `check` reports
anything outstanding as `PM103`.

### Upgrading from 1.x

2.0 replaces the maturity taxonomy with work types and gates. **Labels go 19 → 13**: `tech-debt`,
`perf`, `config`, `legacy-audit`, `enhancement` and `documentation` fan in onto `improvement`, `bug`
becomes `bugfix`, and `rfc`, `idea` and `plan-next` are retired along with GitHub's six stock
labels. The renames preserve every issue assignment.

```bash
npm i -D @hoodiecollin/pm-playbook@2
npx @hoodiecollin/pm-playbook init                          # re-vendor the doctrine
npx @hoodiecollin/pm-playbook migrate                       # preview the label changes
npx @hoodiecollin/pm-playbook migrate --yes                 # apply them
npx @hoodiecollin/pm-playbook bootstrap --repo owner/name   # create the new gate labels
npx @hoodiecollin/pm-playbook check --repo owner/name       # names everything still owed
```

**`migrate` handles the label half only, and says so when it finishes.** The structural half cannot
be automated and `check` enumerates it for you:

| Owed | Why no tool can do it | Reported as |
|---|---|---|
| Give every work item one type label | The merges type most of them; the rest need intent read | `PM010` |
| Make each former `rfc` issue the gate-1 sub-issue of the item it designs | Nothing records that pairing | — |
| Materialize gate sets for work in flight | Safe to automate, but only after the two above | `PM013` |

The last step is one command once the types are assigned:

```bash
npx @hoodiecollin/pm-playbook materialize --yes
```

A migration that half-applies while reporting success is worse than one that states its scope, so
`migrate` prints the outstanding structural work rather than exiting quietly.

## Programmatic use

```ts
import {
  checkIssues, currentCycle, epicSubIssueCounts, fetchParentage, listIssues, listMilestones,
} from "@hoodiecollin/pm-playbook";

const repo = "owner/name";
const violations = checkIssues(
  await listIssues(repo),
  await epicSubIssueCounts(repo),
  await fetchParentage(repo),
  currentCycle(await listMilestones(repo)),
);
```

**The last three arguments are optional, and omitting one silently skips the rules that need it** —
`checkIssues(issues)` alone runs the label rules and no structural ones, reporting a clean backlog
it never actually examined. `fetchParentage` is the important one: `gh issue list` cannot return an
issue's parent, so without it every gate and hierarchy rule is inert.

## Developing

`PLAYBOOK.md` is the **one** hand-edited copy of the doctrine. `assets/` is generated from it —
`bun run build` splits it into `reference/` and verifies that every section is routed from
`agent/AGENT.template.md` and that every router pointer resolves. A mismatch fails the build.

```bash
bun install
bun test          # the invariant rules
bun run build     # generate assets/ + bundle dist/ (Node-compatible ESM)
bun run typecheck
```

This repo publishes the doctrine, so it does not vendor a second copy of it — see `AGENTS.md`.

### Releasing

**Pushing the tag is the release.** `.github/workflows/release.yml` publishes to npm using npm's
OIDC trusted publishing, so there is no `NPM_TOKEN` in this repo and nothing to rotate — npm
verifies the workflow identity instead of a stored string, and `--provenance` records which commit
and which run produced the tarball.

```bash
# bump all four versioned assets first: package.json, the plugin manifest,
# the marketplace entry, and this repo's own stanza (`init` refreshes that one).
npx @hoodiecollin/pm-playbook release-check vX.Y.Z   # exit 1 if the milestone is gated or incomplete
git tag vX.Y.Z && git push origin vX.Y.Z
```

The workflow refuses to publish when the tag and `package.json` disagree — that check runs before
the registry is touched, because a published version cannot be withdrawn.

Two things this depends on, both outside CI: the trusted publisher must be configured once on
npmjs.com against **this repo and the filename `release.yml`** (renaming the file breaks publishing
until the config is updated), and the milestone still has to be closed by hand after the tag —
`check` fails on the next push otherwise, since closing a milestone is what triggers the
`materialize` pass for the new cycle.

## License

MIT
