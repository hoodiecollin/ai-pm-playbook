/**
 * `pm-playbook push` — send local edits back to GitHub.
 *
 * Two refusals define this command, and both are unconditional:
 *
 *   1. **A moved remote wins.** If an entity changed on both sides, it is refused outright. There
 *      is no merge, no field-level reconciliation, and no "local wins" flag. The edit survives —
 *      the next `pull` sets it aside under `conflicts/` — but it does not land.
 *   2. **An invalid backlog never ships.** The invariants run against the post-push state before
 *      any mutation, so a local edit cannot create a violation that `check` would then have to
 *      catch after the fact.
 *
 * Previews by default and applies under `--yes`, matching `migrate` — both mutate shared team
 * state, which should be a decision rather than a side effect of running a command.
 */

import { detectRepo, fetchBacklog, requireGh, updateIssue } from "../lib/gh.js";
import { backlogRoot, readIndex, readTree, writeIndex, writeTree } from "../lib/backlog/store.js";
import { planSync } from "../lib/backlog/plan.js";
import { projectionHash } from "../lib/backlog/project.js";
import { checkIssues } from "../lib/invariants.js";
import { asIssue, snapshot } from "../lib/backlog/lint.js";
import { bool, str, type Args } from "../lib/args.js";
import type { BacklogEntity } from "../lib/backlog/model.js";

export async function push(args: Args, repoRoot: string): Promise<number> {
  const apply = bool(args, "yes");
  const json = bool(args, "json");

  await requireGh();
  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository.");
    console.error("  Pass --repo owner/name, or run inside a GitHub repo.");
    return 2;
  }

  const root = backlogRoot(repoRoot);
  const base = readIndex(root);
  if (base.size === 0) {
    console.error("ERROR: no base snapshot — nothing to compare against.");
    console.error("  Run `pm-playbook pull` first; push refuses without a base it can trust.");
    return 2;
  }

  const remoteList = await fetchBacklog(repo);
  const remote = new Map(remoteList.map((e) => [e.number, e]));
  const local = readTree(root);
  const plan = planSync(base, local, remote);

  /*
   * Validate the state the push would PRODUCE: local for everything being sent, remote for
   * everything else. Linting only the changed entities would miss a cross-issue rule.
   */
  const resulting = new Map(remote);
  for (const e of plan.push) resulting.set(e.number, e);

  /*
   * Scope matches `check`: open issues, plus anything this push actually sends whatever its state.
   *
   * Linting every closed issue too would make one historical violation — a long-closed issue that
   * still carries `plan-next` beside its milestone, say — permanently refuse every unrelated push
   * in the repo. The rules describe live work. What is *being sent* is judged regardless of state,
   * so a push still cannot introduce a new violation onto a closed issue.
   */
  const { parentage } = snapshot(resulting.values(), repo, "all");
  const sending = new Set(plan.push.map((e) => e.number));
  const inScope = [...resulting.values()].filter((e) => e.state === "OPEN" || sending.has(e.number));

  const violations = checkIssues(inScope.map((e) => asIssue(e, repo)), null, parentage)
    .filter((v) => v.severity === "error");

  if (json) {
    console.log(JSON.stringify({
      repo,
      push: plan.push.map((e) => ({ number: e.number, title: e.title })),
      conflict: plan.conflict.map((c) => c.number),
      orphaned: plan.orphaned,
      violations,
      applied: apply && violations.length === 0,
    }, null, 2));
  }

  if (violations.length) {
    if (!json) {
      console.error(`✗ ${violations.length} invariant violation(s) in the state this push would produce.`);
      console.error("  Nothing was sent. Fix these locally, then push again.\n");
      for (const v of violations) {
        console.error(`  ${v.rule} #${v.issue?.number ?? "?"} — ${v.message}`);
        console.error(`    fix: ${v.fix}`);
      }
    }
    return 1;
  }

  if (!json) {
    const tag = apply ? "" : "[preview] ";
    console.log(`${tag}push ${repo}`);
    if (!plan.push.length) console.log("  nothing to send");
    for (const e of plan.push) {
      const was = remote.get(e.number)!;
      console.log(`  #${e.number} ${e.title}`);
      for (const field of changedFields(e, was)) console.log(`      ${field}`);
    }
    if (plan.conflict.length) {
      console.log(`\n  ✗ refused — the remote also moved: ${plan.conflict.map((c) => `#${c.number}`).join(", ")}`);
      console.log("    Run `pull` to take remote truth; your edit is set aside under conflicts/.");
    }
    if (plan.orphaned.length) {
      console.log(`\n  ! orphaned local file(s), never sent: ${plan.orphaned.map((n) => `#${n}`).join(", ")}`);
    }
    if (!apply) console.log("\nPreview only. Re-run with --yes to apply.");
  }

  // A conflict is the same condition whether or not we were going to apply, so it exits the same
  // way. An agent reading only the exit code must not see a refusal as success.
  if (!apply) return plan.conflict.length ? 1 : 0;

  for (const e of plan.push) await updateIssue(repo, e, remote.get(e.number)!);

  /*
   * Re-fetch and rewrite the base. Without this the entities we just sent still read as
   * `local ≠ base` and the next push would resend them.
   */
  const after = new Map((await fetchBacklog(repo)).map((e) => [e.number, e]));
  writeTree(root, after);
  writeIndex(root, new Map([...after].map(([n, e]) => [n, projectionHash(e)])), repo);

  if (!json) console.log(`\n✓ ${plan.push.length} issue(s) updated; base snapshot refreshed.`);
  return plan.conflict.length ? 1 : 0;
}

function changedFields(local: BacklogEntity, remote: BacklogEntity): string[] {
  const out: string[] = [];
  if (local.title !== remote.title) out.push(`title: ${remote.title} → ${local.title}`);
  if (local.body !== remote.body) out.push("body: edited");
  const added = local.labels.filter((l) => !remote.labels.includes(l));
  const removed = remote.labels.filter((l) => !local.labels.includes(l));
  if (added.length) out.push(`labels +${added.join(" +")}`);
  if (removed.length) out.push(`labels -${removed.join(" -")}`);
  if (local.milestone !== remote.milestone) out.push(`milestone: ${remote.milestone ?? "none"} → ${local.milestone ?? "none"}`);
  return out;
}
