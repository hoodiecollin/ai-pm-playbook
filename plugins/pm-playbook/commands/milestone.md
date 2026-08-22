---
description: Show what work is left on a milestone — grouped by epic, readable on a phone
argument-hint: "[vX.Y.Z]"
allowed-tools: Bash
---

Show what is left on the milestone: $ARGUMENTS

1. Run `npx @hoodiecollin/pm-playbook milestone $ARGUMENTS`.

2. **If it exits 0, emit its output verbatim as your entire reply.** No preamble, no summary, no
   commentary, no reformatting, and nothing after it. The command already produced the exact block —
   it is deterministic markdown, sized for a narrow screen, and identical for the same backlog
   state.

   This matters more than it looks. A slash command's own output never reaches the reader; it
   becomes a *user* message, which the interface collapses. The only thing they see is what you
   retype. So if you rewrite the block, group it differently, or add your own summary, the answer
   arrives differently every run and stops being skimmable by shape — which is the whole reason
   this command exists rather than a prompt asking you to compile the same information.

3. **If it exits 2, relay the error and stop.** All three of its failures are real and each has its
   own remedy, so do not paper over them:
   - no mirror → `pm-playbook pull`
   - no such milestone → the message lists the ones that exist
   - the mirror does not cover the milestone → the message names the exact scoped `pull` to run

   In particular, do **not** substitute `ladder` or your own reading of the issues. A partial or
   improvised answer to "what's left" is worse than the error, because it looks like an answer.

4. Do not offer opinions about what to work on next unless asked. The command reports state; the
   ranking is the reader's.
