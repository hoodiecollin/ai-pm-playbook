---
description: Assemble an issue's neighbourhood before working it — or before fanning out across several
argument-hint: "<issue-number>"
allowed-tools: Bash, Read, Grep, Glob
---

Assemble context for: $ARGUMENTS

Run this **before** touching an issue, and before dispatching any agent at one. §9.8 is the rule it
implements: context is pushed, never fetched, because an agent optimising its own narrow task skips
a discretionary read step — which is exactly the condition that makes the context necessary.

1. Run `npx @hoodiecollin/pm-playbook context $ARGUMENTS`.

2. **If it exits 2, stop and relay the error.** Every failure means the pack would be incomplete,
   and an incomplete roster is worse than none — it reads as the whole neighbourhood.
   - no mirror, or the issue is not in it → `pm-playbook pull`
   - the mirror does not cover the neighbourhood → `pm-playbook pull`

3. **Read the roster in full.** It names *every* neighbour and is never truncated. Anything under
   "Not expanded" is still a real neighbour — expand any of them with
   `pm-playbook context <issue>` before assuming it does not matter.

4. **When fanning out, put the pack in each agent's brief.** Do not tell an agent to run this
   command itself; hand it the output. That is the whole mechanism.

## What an agent may conclude from a pack

- It **may** produce gate 1 material — a design stating what it would disturb across its
  neighbourhood.
- It **may not** jump to implementation across a neighbourhood it can only see the edge of.
- Two agents proposing conflicting designs for coupled issues is the expected outcome. Surface the
  conflict; do not let either side quietly resolve it.

## At gate 2, write the code map onto the issue

Entry points, call paths, and the files that must change — each cited by path, with the commit it
was derived at. The next agent reads the map instead of rediscovering it.

A map is a claim about ground truth and therefore rots. Re-check it at the next gate boundary
(§9.7). A stale map that reads as current is the §9.6 failure in a new location.
