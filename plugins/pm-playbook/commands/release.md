---
description: Check whether a milestone can be tagged, and report exactly what is blocking it
argument-hint: "<vX.Y.Z>"
allowed-tools: Bash, Read
---

Determine whether milestone `$ARGUMENTS` can be released.

1. Run `npx ai-pm-playbook release-check $ARGUMENTS`. It separates two different failures, and the
   distinction matters:
   - **Open `release-gate` issues** — release *obligations* (publishing artifacts, reconciling a
     version line, proving a reclose, rotating a credential). An open one means the milestone
     **cannot be tagged** even if every feature on it is closed.
   - **Open non-gate issues** — the milestone is simply incomplete.
2. Report each blocker with its issue number and what it needs.
3. If it comes back clean, **do not conclude the release is safe on that alone.** Green in-tree has
   never proven a product is releasable. If this project publishes artifacts that its own built
   output depends on, the only proof is an **outside-repo reclose**: from a clean directory, with
   the *published* tool, run the real user path — install → scaffold → generate → build — and
   confirm every dependency resolves from the registry. Ask whether that has been done.
4. If the project holds the publish gap off trunk, remind the user of the order, which is the whole
   point of the branch: **publish the artifacts → then merge `develop` → `main` → then tag.**
   Publishing after the merge reintroduces the window the branch exists to eliminate.

Do not tag anything yourself. Report the state and let the user run the release.
