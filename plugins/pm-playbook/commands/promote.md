---
description: Move an issue up the commitment ladder, maintaining the label invariants
argument-hint: "<issue-number> [to <rung>]"
allowed-tools: Bash, Read
---

Promote issue `$ARGUMENTS` one rung up the commitment ladder, **without breaking an invariant**.

The ladder:

```
idea  →  plan-next  →  milestone assigned  →  merged/closed  →  GitHub Release
```

Steps:

1. Read the issue's current state: `gh issue view <n> --json number,title,labels,milestone,state`.
2. Determine the current rung and the target rung. If the user named a target, use it; otherwise
   promote by exactly one.
3. Apply the transition **as a single `gh issue edit`**, because each one is a paired operation and
   a half-applied promotion is precisely what the invariants forbid:

   | From → To | Command shape |
   |---|---|
   | `idea` → `plan-next` | `--remove-label idea --add-label plan-next` |
   | `plan-next` → scheduled | `--remove-label plan-next --milestone <vX.Y.Z>` |
   | unlabeled → scheduled | `--milestone <vX.Y.Z>` |

4. **Check the gate for the rung you are entering** and refuse to promote past an unmet one:
   - Entering `plan-next` requires **Gate 1** — an accepted design-doc (`rfc` issue). If none
     exists, say so and offer `/pm-playbook:rfc` instead of promoting.
   - Entering a milestone requires **Gate 2** — an implementation-plan on the issue. If absent,
     flag it; the promotion is still valid, but coding must not start.
5. Never promote an `experiment`. Its deliverable is a decision, not a shippable artifact — it has
   no rung on this ladder. If its conclusion commits real work, file *that* as a new issue and
   promote the new one.
6. Confirm with `npx @hoodiecollin/pm-playbook check --repo <owner>/<name>`.

Report what changed in one or two lines, including the milestone if you assigned one.
