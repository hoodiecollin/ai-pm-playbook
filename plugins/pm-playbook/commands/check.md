---
description: Lint the backlog against the pm-playbook invariants and fix what it finds
argument-hint: "[--strict] [--all-states]"
allowed-tools: Bash, Read, Edit
---

Run the pm-playbook invariant linter and **fix** the violations — do not just report them.

1. Run `npx @hoodiecollin/pm-playbook check --json $ARGUMENTS`. Use `--json`: every violation carries an
   executable `fix` field.
2. If it exits 0 with no violations, say so in one line and stop.
3. Otherwise, work through them:
   - **Errors first**, then warnings.
   - Each violation's `fix` is a real command. Read it before running it — some are `gh issue edit`
     calls you can execute directly, others (`PM102`, `PM103`) describe a judgment call.
   - `PM102` (shadow backlog) means moving live entries into issues and deleting the file. Do not
     delete a file that is *generated* — check whether it is derived output first.
   - `PM103` (pending label migrations) mutates shared team state. Run
     `npx @hoodiecollin/pm-playbook migrate` to preview it and **show the user the plan** rather than
     applying it with `--yes` yourself.
4. Re-run `check` to confirm you are green.

If a violation looks wrong, say why rather than working around it — a false positive in the linter
is a bug worth reporting, and silencing it locally hides it from everyone else.
