# `prove` evals

Each case is an approach that a pm-playbook 3.x gate accepted in forgedb, and that later turned out
to rest on something false. `bun run eval:prove` checks forgedb out at the commit the approach was
written against, gives an agent the intent and the approach, and asks it to write a proof gate
following `plugins/pm-playbook/skills/prove/SKILL.md`. A case passes when the false claim does not
come back as proven — it is left `assumed`, or the agent's own evidence disproves it.

The grade is a regular expression over the claims table, so it is a screen, not a verdict: a run
that disproves the premise in words the pattern does not anticipate is graded "weak" or missed.
Read the transcripts in `.results/` before drawing a conclusion.
`--baseline` also runs a 3.x-style "write the implementation plan" prompt for comparison.

| Case | False premise | Notes |
|---|---|---|
| `forgedb-388` | a process-wide `syn::File` cache saves ~19.7 s | `syn::File` is not `Send`; the step took ~40 ms, not 184 ms |
| `forgedb-335` | a cdylib copied next to the consumer survives cache GC | rustc stamps an absolute `LC_ID_DYLIB`. Reviewers caught this before the gate closed, so the approach text comes from epic #332 and the pre-review revision |
| `forgedb-328` | a bare `[workspace]` table lets generated crates build under a parent workspace | true for the transformer alone, false for crates a consumer path-depends on; disproved later in #355 |
| `forgedb-367` | no harness can allocate a pty, so the widget is tested by hand | `script(1)` allocates one. The commit is the integration branch just before the implementation merge, because the close-time commit contains the disproof |
| `forgedb-519` | `allFeatures` is verified because `cargo check --all-features` passes | a proxy; Serena never forwarded the setting |

Requires a local forgedb clone (`--forgedb <path>`, default `~/Projects/forgedb`) and an
authenticated `claude` CLI. The agent runs with Bash in a throwaway worktree. Outputs go to
`.results/`, which is gitignored.
