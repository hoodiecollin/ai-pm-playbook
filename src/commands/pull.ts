/**
 * `pm-playbook pull` — materialize the backlog to disk.
 *
 * `pull` is the only thing that decides where a file lives, and the only thing that writes the base
 * snapshot. It never destroys a local edit: an edit that lost a race is set aside under
 * `conflicts/` before remote truth reclaims the canonical path.
 */

import { detectRepo, fetchBacklog, listLabels, listMilestones, requireGh } from "../lib/gh.js";
import { backlogRoot, listConflicts, readIndex, readTree, setAsideConflict, writeIndex, writeTable, writeTree, LABELS_FILE, MILESTONES_FILE } from "../lib/backlog/store.js";
import { planSync } from "../lib/backlog/plan.js";
import { projectionHash } from "../lib/backlog/project.js";
import { bool, str, type Args } from "../lib/args.js";
import type { BacklogEntity } from "../lib/backlog/model.js";

/** A filesystem-safe stamp for a conflict directory. Sortable, and unique per pull. */
function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export async function pull(args: Args, repoRoot: string): Promise<number> {
  const dry = bool(args, "dry-run");
  const json = bool(args, "json");

  await requireGh();
  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository.");
    console.error("  Pass --repo owner/name, or run inside a GitHub repo.");
    return 2;
  }

  const root = backlogRoot(repoRoot);
  const remote = new Map((await fetchBacklog(repo)).map((e) => [e.number, e]));
  const local = readTree(root);
  const base = readIndex(root);
  const plan = planSync(base, local, remote);

  if (json) {
    console.log(JSON.stringify({
      repo,
      pull: plan.pull.map((e) => e.number),
      keptLocal: plan.push.map((e) => e.number),
      conflict: plan.conflict.map((c) => c.number),
      remove: plan.remove,
      orphaned: plan.orphaned,
      unchanged: plan.unchanged.length,
    }, null, 2));
    if (dry) return 0;
  }

  if (dry) {
    report(repo, plan.pull.length, plan.push.length, plan.conflict.map((c) => c.number), plan.remove, plan.orphaned, [], true);
    return 0;
  }

  // A local edit that lost a race is preserved before anything overwrites it.
  const at = stamp();
  const setAside: string[] = [];
  for (const c of plan.conflict) setAside.push(setAsideConflict(root, c.local, at));

  /*
   * Write remote truth everywhere EXCEPT where a local edit is pending and the remote has not
   * moved — those files stay as the author left them, which is what makes `pull` safe to run
   * before `push` rather than a step that discards work.
   */
  const pending = new Set(plan.push.map((e) => e.number));
  const write = new Map<number, BacklogEntity>();
  for (const [number, entity] of remote) write.set(number, pending.has(number) ? local.get(number)! : entity);
  writeTree(root, write);

  writeTable(root, LABELS_FILE, await listLabels(repo));
  writeTable(root, MILESTONES_FILE, await listMilestones(repo));

  /*
   * The base records what the REMOTE was, not what is on disk. For a push-pending entity those
   * differ on purpose: recording remote truth is what keeps `local ≠ base` true so the pending edit
   * is still recognised as a push next time.
   *
   * Written last: a crash before this leaves a tree with no index, which forces a clean re-pull,
   * rather than an index that lies about a half-written tree.
   */
  writeIndex(root, new Map([...remote].map(([n, e]) => [n, projectionHash(e)])), repo);

  if (!json) {
    report(repo, plan.pull.length, plan.push.length, plan.conflict.map((c) => c.number), plan.remove, plan.orphaned, setAside, false);
    const outstanding = listConflicts(root);
    if (outstanding.length) {
      console.log(`\n⚠️  ${outstanding.length} unresolved conflict draft(s) under conflicts/.`);
      console.log("   Re-apply or delete them — `check` reports these as PM104 until you do.");
    }
  }
  return 0;
}

function report(
  repo: string, pulled: number, kept: number, conflicts: number[],
  removed: number[], orphaned: number[], setAside: string[], dry: boolean,
): void {
  const tag = dry ? "[dry-run] " : "";
  console.log(`${tag}pull ${repo}`);
  console.log(`  ${pulled} written from remote`);
  if (kept) console.log(`  ${kept} left as edited locally (pending push)`);
  if (conflicts.length) console.log(`  ${conflicts.length} conflicted: ${conflicts.map((n) => `#${n}`).join(", ")}`);
  for (const dir of setAside) console.log(`    set aside → ${dir}`);
  if (removed.length) console.log(`  ${removed.length} removed (gone from the remote): ${removed.map((n) => `#${n}`).join(", ")}`);
  if (orphaned.length) console.log(`  ${orphaned.length} orphaned local file(s): ${orphaned.map((n) => `#${n}`).join(", ")}`);
}
