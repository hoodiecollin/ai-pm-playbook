---
description: File a design-doc as an rfc issue (Gate 1) — what and why, before any code
argument-hint: "<what you want to design>"
allowed-tools: Bash, Read, Grep, Glob
---

File a **design-doc** for: $ARGUMENTS

This is **Gate 1** of the design → plan → spec doctrine. A design-doc is *solution-shaped, not
code-shaped*: it catches conceptual gotchas while they are still cheap. It lives as an **`rfc`
issue**, never as a committed `proposal-*.md`.

1. **Dedup first.** `gh issue list --state all --search "<keywords>"`. If something close already
   exists, link to it and ask whether to extend it rather than opening a second one.
2. **Ground it in the code.** Read the relevant source before writing. The "current state" section
   must describe where the code actually is, not where you assume it is.
3. **Write the body** with these sections:
   - **Problem** — what is wrong or missing, and who it affects.
   - **Desired behavior** — what "solved" looks like, observably.
   - **Solution shape** — the approach, at the level of components and responsibilities. Not an
     implementation. No file lists, no function signatures; those are Gate 2.
   - **Alternatives considered** — with the reason each was rejected.
   - **Non-goals / limits** — explicit. This section is what stops scope creep later.
4. **Create it** with the `rfc` label:
   `gh issue create --label rfc --title "..." --body "..."`
   - Add `idea` too **only if** it is still speculative. If you are confident it will be built,
     leave `idea` off — do not add `plan-next` yet, because that is what accepting the RFC means.
   - Never add a milestone. An unaccepted design is not scheduled work.
5. If it belongs to an epic, link it as a **native sub-issue** of that epic.

When the design is **accepted**, that is the Gate 1 promotion: drop `idea`, add `plan-next`
(`/pm-playbook:promote`). Do not write code until Gate 2 — an implementation-plan — also exists.
