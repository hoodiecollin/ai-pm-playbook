# @hoodiecollin/pm-playbook

A project-management model for GitHub Issues, packaged as **skills your agents load, a linter and
CLI that enforce it, and a hook that stops an agent closing the gates a person is meant to close**.

```bash
npx @hoodiecollin/pm-playbook init                        # vendor the skills + wire your agent instruction files
npx @hoodiecollin/pm-playbook bootstrap --repo owner/name # create the labels on GitHub
npx @hoodiecollin/pm-playbook check                       # exit 1 if the backlog violates an invariant
```

`init` writes files; `bootstrap` is the only step that touches GitHub, and it is idempotent.
**On 3.x? See [upgrading](#upgrading-from-3x) — 4.0 replaces the gates.**

Works with any agent harness that reads repo files — Claude Code, Cursor, Codex, Copilot, Gemini,
Windsurf, or your own. Claude Code users can also install the plugin, which delivers the same skills
natively and adds the hook:

```
/plugin marketplace add hoodiecollin/ai-pm-playbook
/plugin install pm-playbook@pm-playbook
```

---

## The model

Issues are the backlog. **Milestone = when** (a version; assigning one means committed). **Label =
what kind**: every work item is exactly one of `improvement`, `bugfix`, `experiment`. Epics group
work items as native sub-issues. No priority or size fields.

A **gate** is a sub-issue recording a decision a person has to make before work continues:

| Type | Gates | Then |
|---|---|---|
| `improvement` | **intent** (what and why — approved by reading) → **proof** (how — closes on evidence) | build: the PR |
| `bugfix` | none; a `hotfix` takes a **warrant** | fix: the PR, with a regression test |
| `experiment` | **charter** → **verdict** | the verdict is the deliverable |

The proof gate is the centre of 4.0. It holds a claims table — every claim the approach rests on,
each marked `ran`, `read`, `out-of-scope` or `assumed` — and cannot close while anything is merely
assumed. That rule comes from a review of the main project using 3.x: most accepted designs that
later failed rested on a claim about a library or runtime that nobody had run.

Full reasoning: **[PLAYBOOK.md](./PLAYBOOK.md)**.

## What `init` does

```
.pm-playbook/
  PLAYBOOK.md           ← the model and its reasons, for people
  skills/<name>/SKILL.md← the map (pm-playbook) plus nine workflow skills: file, intent, prove, build,
                          fix, experiment, next, release, check
  manifest.json         ← version + per-file hashes (drift detection)
.github/ISSUE_TEMPLATE/ ← improvement · bugfix · experiment · epic · release-gate
AGENTS.md               ← a ~35-line stanza between markers: the axes, the gates, and a table of skills
.gitignore              ← one line: .pm-playbook/backlog/
```

The stanza is the only always-loaded part. Everything else is a skill loaded when the task needs
it, because a long always-loaded doctrine degrades every unrelated task and is followed less
reliably the longer it gets. `--detect` also writes the stanza into agent files your team already
keeps (`CLAUDE.md`, `.cursorrules`, …); re-running replaces it in place between
`<!-- pm-playbook:begin -->` markers.

The skills are **copied into your repo** rather than referenced from `node_modules/`: cloud agents
and CI sandboxes often have no `node_modules`, and a committed file shows up in PR review. A manifest
of per-file hashes lets `check` tell you when the copy is stale.

## Enforcement

Prose is a suggestion; a command that exits non-zero is a constraint. Each rule has a place where it
fails:

| Rule | Invariant | Fails in |
|---|---|---|
| `PM003` | `experiment` never carries a milestone | `check` |
| `PM004` / `PM005` | `release-gate` has a milestone and never carries `experiment` | `check` |
| `PM006` | a non-core `surface:*` never rides a core `v*` milestone | `check` |
| `PM007` | an `epic` decomposes via native sub-issues *(warn)* | `check` |
| `PM008` / `PM009` | a PR to the integration branch never closes work past the cycle in flight | `scope-check` |
| `PM010` | exactly one type label per work item | `check`, hook |
| `PM011` | a gate's milestone equals its parent's | `check` |
| `PM012` | an `epic` never carries gates | `check` |
| `PM013` | a work item on the cycle in flight carries every gate it owes | `check` |
| `PM014` | `hotfix` ⇒ `bugfix` + milestone, and never `experiment` or `epic` | `check`, hook |
| `PM015` | a patch milestone holds exactly one work item | `check` |
| `PM016` | an experiment whose verdict is closed is closed *(warn)* | `check` |
| `PM017` | a work item opens with `### In plain English` *(warn)* | `check --no-remote` |
| `PM018` | a closed proof gate has no `assumed` claim and evidence on every other | `check --no-remote`, `prove` |
| `PM019` | a closed gate is not still its empty seed | `check --no-remote` |
| `PM020` | no open pre-4.0 gate, no legacy gate label | `check` |
| `PM021` | a PR that closes a `bugfix` changes a test | `pr-check` |
| `PM100`–`PM106` | vendoring, stanza, shadow backlog, pending migrations, mirror state *(warn)* | `check` |

And two that are about *who*, not *what*:

- **The hook refuses an agent's `gh issue close` on a gate** (and the REST equivalent). A closed gate
  means a person approved it, and the agent works on that person's token, so this is the only place
  the difference can be enforced. It checks the local mirror first and asks GitHub only on a miss;
  it fails open on any error. The maintainer closes gates in the UI or with a `!` command.
- **`push` refuses to close a gate** through the mirror, for the same reason.

`pm-playbook prove <n> --yes` is the one way a gate closes without a person: a proof gate whose
claims are all proven and which declares no one-way doors.

Every violation carries an executable `fix`, and `--json` emits the whole report for an agent to act
on. `PM001` and `PM002` were retired in 2.0; their numbers are never reused.

## Commands

| Command | Does |
|---|---|
| `init` | Vendor the skills and PLAYBOOK, copy issue templates, wire agent files. Offline unless `--repo` is passed. |
| `bootstrap --repo o/n --project N` | Labels, a starter milestone, and the filtered Project views. Idempotent. |
| `check` | Lint the backlog. `--no-remote` lints the mirror (the only tier that reads bodies), `--json` for agents. |
| `materialize` | Create the gates owed on a milestone, as complete sets; `--issue <n>` for an experiment. Previews; `--yes` applies. |
| `prove <gate>` | Judge a proof gate's claims table; with `--yes`, close it if nothing is left for a person. |
| `ladder` | The stage of every work item, derived from its gates. |
| `milestone [vX.Y.Z]` | What is left on a release, grouped by epic, readable on a phone. |
| `context <issue>` | An issue's whole neighbourhood, for briefing an agent before it works the issue. |
| `release-check vX.Y.Z` | "Can we tag?" Exit 1 if the milestone is gated or incomplete. |
| `pr-check <pr>` | PM021: a PR that closes a bugfix changes a test. |
| `scope-check <pr>` | PM008: no next-cycle work merged onto the integration branch. |
| `migrate` | Apply label migrations after a MAJOR upgrade. Previews; `--yes` applies. |
| `pull` / `push` | Materialize the backlog to `.pm-playbook/backlog/`; send local edits back, refusing anything that moved remotely. |
| `create` / `comment` | Publish drafts from `backlog/new/`; post a comment and re-materialize. |
| `rules` | Print the rule index. |

## CI

Every command reads issues through `GITHUB_TOKEN`, so grant the read scopes:

```yaml
permissions:
  contents: read
  issues: read
  pull-requests: read   # pr-check and scope-check read the PR
```

```yaml
# on pull_request, and on a schedule — PM013 changes when a milestone closes, with no commit
- run: npx @hoodiecollin/pm-playbook check --repo ${{ github.repository }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }

# on pull_request
- run: npx @hoodiecollin/pm-playbook pr-check ${{ github.event.pull_request.number }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }

# on pull_request into the integration branch, if you keep one
- run: npx @hoodiecollin/pm-playbook scope-check ${{ github.event.pull_request.number }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }

# in a job your release jobs `needs:` — not a separate tag-triggered workflow, which would run
# beside the release and block nothing
- run: npx @hoodiecollin/pm-playbook release-check ${{ github.ref_name }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

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
behalf. PLAYBOOK §8 says so explicitly, and `PM102` still fires on the real thing.

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


## Versioning

The model is versioned like code, because a consumer's existing issues can become violations:

| Bump | Means |
|---|---|
| **MAJOR** | An invariant or gate set changed, or a label was renamed or removed. A migration ships with it. |
| **MINOR** | A new label, rule, command or skill. |
| **PATCH** | Wording. |

Labels live in **your** GitHub, so a MAJOR release cannot fix them itself. `migrate` does, preview
first:

| Repo state | Action |
|---|---|
| only the old label exists | **rename** in place — GitHub preserves every assignment |
| **both** labels exist | **merge** — relabel each carrier, then delete the old label |
| only the new label exists | **skip** — already migrated |

It also rewrites every label description the release defines, since a renamed label keeps its old
description and the description is the process. Progress is recorded as `migratedThrough` in
`.pm-playbook/manifest.json`; `check` reports anything outstanding as `PM103`.

### Upgrading from 3.x

```bash
npx @hoodiecollin/pm-playbook@4 init        # re-vendor: PLAYBOOK + skills replace AGENT.md + reference/
npx @hoodiecollin/pm-playbook@4 migrate     # preview
npx @hoodiecollin/pm-playbook@4 migrate --yes
npx @hoodiecollin/pm-playbook@4 check       # PM020 lists open retired gates, PM013 the gates now owed
```

What `migrate` does to gates:

| 3.x label | 4.0 label | Why |
|---|---|---|
| `improvement:gate-1` (design) | `gate:intent` | Both are "what and why", decided by a person. |
| `experiment:gate-1` / `-2` | `gate:charter` / `gate:verdict` | Unchanged in substance. |
| `improvement:gate-2` (plan), `improvement:gate-3` (impl), `bugfix:gate-1` (diagnose), `bugfix:gate-2` (fix) | `gate:retired` | No 4.0 equivalent. Kept as a label so history keeps its shape, and so an old plan gate can never be read as a proof gate. |

Then close each **open** `gate:retired` as not planned, and run `materialize --yes`: an improvement
past design now owes a proof gate, and a hotfix a warrant. A plain bugfix owes nothing — add
`pr-check` to CI instead. Remove `AGENT.md` and `reference/` from `.pm-playbook/` if `init` reports
them as orphaned.

From 1.x or 2.x, the same commands work: `migrate` replays every pending migration in order.

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

Canonical sources: `PLAYBOOK.md` (the explainer), `plugins/pm-playbook/skills/` (the skills —
canonical there because Claude Code installs plugins from git), `src/lib/model.ts` (the gate sets
and labels), `src/lib/invariants.ts` (the rules). `assets/` is assembled from them by
`bun run build`, which fails if the `AGENTS.md` stanza and the skills directory disagree.

```bash
bun install
bun test          # the invariant rules, the ladder, the hook, every command
bun run build     # assemble assets/ + bundle dist/ (Node-compatible ESM)
bun run typecheck
bun run eval:prove  # replay known false premises against the prove skill (see evals/)
```

This repo publishes the model, so it does not vendor a second copy of it — see `AGENTS.md`.

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
