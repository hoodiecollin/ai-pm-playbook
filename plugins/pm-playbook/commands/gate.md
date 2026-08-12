---
description: Write the next open gate's artifact — grounded in the code, before the code
argument-hint: "<issue-number> | <what you want to work on>"
allowed-tools: Bash, Read, Grep, Glob
---

Advance the gates for: $ARGUMENTS

Gates are sub-issues (PLAYBOOK §9). **Which gate you are writing is a fact about the tree**, not a
choice — so find it before writing anything.

1. **Locate the work item.** If given a number, `gh issue view <n> --json number,title,labels,milestone,state`.
   If given a description, `gh issue list --state all --search "<keywords>"` first — if something
   close already exists, extend it rather than opening a second one.

2. **Read the rung.** `npx @hoodiecollin/pm-playbook ladder --json` and find the item. The rung names
   the gate you are about to write:

   | Rung | Write |
   |---|---|
   | `idea` | Nothing yet — it has no milestone, so it is not committed. Ask whether to commit it. |
   | `design-next` / `diagnose-next` / `research-next` | Gate 1 |
   | `plan-next` / `fix-next` / `evaluate-next` | Gate 2 |
   | `impl-next` | Gate 3 |
   | `*-pending` | The gate is open — finish and close **that** one. |

3. **If the gates do not exist yet**, materialize them. Never create one by hand:
   ```
   npx @hoodiecollin/pm-playbook materialize --yes                # spine types, cycle in flight
   npx @hoodiecollin/pm-playbook materialize --issue <n> --yes    # an experiment, by decision
   ```

4. **Ground it in the code.** Read the relevant source *before* writing. A gate that describes where
   you assume the code is, rather than where it is, poisons every gate after it (§9.7).

5. **Write into the gate issue's body**, following the seeded headings already in it. Respect what
   each gate is for:
   - **Gate 1 is solution-SHAPED, never code-shaped.** No file lists, no signatures — those are
     gate 2, and putting them here is how a design stops being reviewable as a design.
   - **Gate 2 is code-shaped**, and its BDD scenarios are what gate 3 writes first as RED.
   - **Gate 3 is RED → GREEN**, in that order, with the deviations from gate 2 recorded.

6. **Run the verify half of the reconciliation first** (§9.7) — check every claim the gate will rest
   on against the code, and fix what has drifted *before* writing, not after.

7. **Closing a gate means approved.** Close it only on the user's word. Closing the last gate closes
   the work item, and one PR should close both.
