# @hoodiecollin/pm-playbook

A portable project-management model for GitHub Issues — packaged so **your agents read it and a
linter enforces it**.

```bash
npx @hoodiecollin/pm-playbook init          # vendor the doctrine + wire your agent instruction files
npx @hoodiecollin/pm-playbook check         # exit 1 if the backlog violates an invariant
```

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
.github/ISSUE_TEMPLATE/ ← idea · rfc · implementation-plan · epic
AGENTS.md               ← a ~20-line pointer stanza between markers
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
| `PM001` | `plan-next` ⊕ milestone | 3.2 |
| `PM002` | `idea` ⊕ `plan-next` | 3.2 |
| `PM003` | `experiment` ⊕ {`idea`, `plan-next`, milestone} | 3.2 / 4 |
| `PM004` | `release-gate` ⇒ milestone | 3.2 |
| `PM005` | `release-gate` ⊕ {`idea`, `plan-next`, `experiment`} | 3.2 |
| `PM006` | non-core `surface:*` ⊕ core `v*` milestone | 6.1 |
| `PM007` | an `epic` decomposes via native sub-issues *(warn)* | 7.1 |
| `PM008` | a PR to the integration branch never closes work milestoned past the cycle in flight | 5.3 |
| `PM009` | a PR references next-cycle work it doesn't close *(warn)* | 5.3 |
| `PM100` | vendored doctrine matches the installed package *(warn)* | — |
| `PM101` | agent instruction files carry the stanza *(warn)* | — |
| `PM102` | no markdown shadow backlog *(warn)* | 11 |
| `PM103` | label migrations from a newer version have been applied *(warn)* | — |

Every violation carries an **executable fix**, and `--json` emits the whole report — that's the
agent-facing interface. A harness can feed violations straight back to a model:

```jsonc
{
  "rule": "PM001",
  "severity": "error",
  "message": "`plan-next` coexists with milestone `v0.4.0`. …",
  "fix": "Assigning a milestone IS scheduling. Drop the label: gh issue edit 42 --remove-label plan-next"
}
```

## Commands

| Command | Does |
|---|---|
| `init` | Vendor the doctrine, copy issue templates, wire agent files. **Local and offline** unless `--repo` is passed. |
| `bootstrap --repo o/n --project N` | Provision labels, a starter milestone, and the filtered Project views. Idempotent. |
| `check` | Lint the backlog. `--no-remote` for local-only, `--json` for agents, `--strict` to fail on warnings. |
| `release-check vX.Y.Z` | "Can we tag?" Exit 1 if the milestone is gated or incomplete. |
| `scope-check <pr>` | Cycle-scope gate: refuse a PR that lands next-cycle work on the integration branch. |
| `migrate` | Apply label renames/removals after a MAJOR upgrade. Previews by default; `--yes` applies. |
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

And on pull requests targeting the integration branch (§5.3) — this refuses to land next-cycle work
on `develop`. The cycle in flight is derived from the lowest open core milestone, so there is no
constant to keep updated:

```yaml
- run: npx @hoodiecollin/pm-playbook scope-check ${{ github.event.pull_request.number }}
  env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

`scope-check` reads the pull request as well, so that job additionally needs
`pull-requests: read`.

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
| `/pm-playbook:rfc` | Files a Gate 1 design-doc, grounded in the code, after a dedup check. |
| `/pm-playbook:release` | "Can we tag?", separating *gated* from *incomplete*. |
| **Hook** (`PreToolUse`) | Blocks `gh issue create/edit` that would violate `PM001`–`PM005` — before the issue exists. |

The hook sees only the command text, never the repo. That is deliberate: it catches what is
self-evident in the command (`--label plan-next --milestone v0.4.0`) instantly and offline, and
leaves state-dependent violations to `check`. A fast partial gate beats a complete one that makes
every Bash call wait on the network. It fails open on anything it cannot parse — a hook that breaks
your session is worse than no hook.

It also never blocks the *fix*: `--remove-label plan-next --milestone v0.4.0` passes, because the
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

## Programmatic use

```ts
import { checkIssues, listIssues, RULES } from "@hoodiecollin/pm-playbook";

const violations = checkIssues(await listIssues("owner/name"));
```

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

## License

MIT
