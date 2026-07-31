# pm-playbook

The ForgeDB project-management model, reverse-engineered and generalized into a portable system
any of your repos can adopt.

| File | What it is |
|---|---|
| **[PLAYBOOK.md](./PLAYBOOK.md)** | The canonical methodology — the two-axis core, labels + invariants, experiments-off-spine, the release spine, surfaces, epics via native sub-issues, the design→plan→spec doctrine, operating disciplines. The reference every project points to. |
| **[scripts/bootstrap-pm.ts](./scripts/bootstrap-pm.ts)** | Idempotent Bun script that provisions labels, milestones, and the scriptable filtered views for a repo+project. |
| **[.github/ISSUE_TEMPLATE/](./.github/ISSUE_TEMPLATE/)** | Reusable issue templates: `idea`, `rfc` (design-doc / Gate 1), `implementation-plan` (Gate 2), `epic` (native sub-issues + "Decisions locked / ground truth" skeleton). |

## The one-paragraph version

All work is **GitHub Issues**, organized by **exactly two orthogonal axes — Milestone (*when*, the
release spine) and Labels (*what kind / maturity*) — and nothing else decomposes work.** Epics
decompose via GitHub **native sub-issues** (not checkboxes, not a field); the **Project board is a
view**, never a second source of truth. There are **no Priority/Size/Workstream fields** — they're
a parallel source of truth that drifts. Labels carry hard **invariants** (`plan-next` ⊕ milestone;
`idea` ⊕ `plan-next`; `experiment` ⊕ everything committed) and **`experiment` never rides the
spine** — a spike's deliverable is a decision, not an artifact; its conclusion feeds the spine.
**Milestones = versions** ("scheduled"; closed ≠ shipped until the Release is tagged). Distinct
shippable faces are **`surface:*`** labels (core / ide-extension / website), each on its own
release line and **excluded from the core milestone + changelog**. Nothing gets coded until a
**design-doc** (what/why) then an **implementation-plan** (how) exist as issues, then **BDD
spec-first RED→GREEN**. Prioritize on **engineering merit, never demand**.

## Quick start on a repo

```bash
bun install
bun run bootstrap --repo <owner>/<name> --project <N> \
  --surfaces "core,ide-extension,website" --milestone v0.1.0
# then set group-by on the Release-spine / Surface / Execution boards in the UI,
# and (if migrating) delete any Priority/Size/Workstream fields + their views.
```
