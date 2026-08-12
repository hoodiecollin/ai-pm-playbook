---
description: Advance a work item, keeping the invariants and the gate sequence intact
argument-hint: "<issue-number>"
allowed-tools: Bash, Read
---

Advance issue `$ARGUMENTS` to its next state, **without breaking an invariant**.

**The ladder is derived, so there is nothing to relabel.** Under this model a rung is computed from
the milestone and the gate sub-issues (§2) — there is no `idea` or `plan-next` label to move. What
"promoting" means now is one of exactly three real actions:

| To move from | Do this |
|---|---|
| `idea` → committed | Assign a milestone. That IS the commitment (§1). |
| committed → gated | `npx @hoodiecollin/pm-playbook materialize --yes` once its milestone is the cycle in flight. |
| `<verb>-pending` → next rung | **Close that gate.** A closed gate means approved — so this is the user's call, never yours. |

Steps:

1. `npx @hoodiecollin/pm-playbook ladder --json` and find the item. That is its current rung; do not
   infer one from labels, because no label carries it.
2. Take exactly one step. If the next step is closing a gate, confirm with the user first — closing
   a gate asserts that its artifact is *accepted*, which is a judgement, not a state transition.
3. **Never advance an `experiment` onto the spine.** Its deliverable is a finding (§4). If its
   verdict commits work, file *that* as its own issue and milestone that one.
4. **Never create a gate by hand** to make an item look further along. `materialize` owns them, and
   a hand-made gate destroys the only thing that makes an absent gate meaningful (§9.3).
5. Confirm with `npx @hoodiecollin/pm-playbook check --repo <owner>/<name>`.

Report what changed in one or two lines, including the milestone if you assigned one.
