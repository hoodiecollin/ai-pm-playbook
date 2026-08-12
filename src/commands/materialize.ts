/**
 * `pm-playbook materialize` — create a work item's gate sub-issues, as a complete set (§9).
 *
 * **Gates are never created by hand**, and that is the point rather than a convenience. If a human
 * could file one, "gate absent" would mean either *not materialized yet* or *nobody wrote it*, and
 * nothing could tell the two apart — the same failure §5.2 describes for the asset ledger, where an
 * absent row and a "no change" row look identical and mean opposite things. Tool-only creation is
 * what lets PM013 be trusted.
 *
 * Two triggers, and the asymmetry is deliberate (§9):
 *   - **Spine types** (`improvement`, `bugfix`) materialize by MILESTONE, defaulting to the cycle in
 *     flight. Cycle rollover is therefore the moment the next batch of work gets its gates.
 *   - **`experiment`** materializes by DECISION, one issue at a time via `--issue`, because it never
 *     carries a milestone and the mechanical trigger can never fire for it.
 *
 * §5.5 constrains the implementation: creating N sub-issues can fail partway, so this must be
 * re-runnable rather than all-or-nothing. It is idempotent two ways — it only creates gates that are
 * missing, and it ADOPTS an orphan gate (created, but never linked, because the run died in between)
 * instead of creating a second copy of it.
 */

import { GATES, currentCycle, gateLabel, gateOf, workTypeOf, type WorkType } from "../lib/model.js";
import { addSubIssue, createIssue, detectRepo, fetchParentage, issueBody, listMilestones, requireGh } from "../lib/gh.js";
import type { Issue } from "../lib/gh.js";
import { bool, str, type Args } from "../lib/args.js";

/** The marker that makes an unlinked gate recoverable. Written into every gate body on creation. */
const PARENT_MARKER = (parent: number) => `<!-- pm-playbook:gate parent=#${parent} -->`;

function gateTitle(type: WorkType, n: number, parentTitle: string): string {
  const verb = GATES[type][n - 1]!.verb;
  return `Gate ${n} — ${verb}: ${parentTitle}`;
}

function gateBody(type: WorkType, n: number, parent: Issue): string {
  const spec = GATES[type][n - 1]!;
  return [
    PARENT_MARKER(parent.number),
    "",
    `> ${spec.description}`,
    `> Parent: #${parent.number}`,
    "",
    spec.seed,
    "",
  ].join("\n");
}

interface Pending {
  parent: Issue;
  type: WorkType;
  n: number;
  /** An already-created but unlinked gate to adopt rather than re-create. */
  orphan: number | null;
}

export async function materialize(args: Args, repoRoot: string): Promise<number> {
  const apply = bool(args, "yes");
  const json = bool(args, "json");
  const only = str(args, "issue");
  const wanted = str(args, "milestone");

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let parentage, milestone: string | null;
  try {
    await requireGh();
    parentage = await fetchParentage(repo);
    milestone = only ? null : (wanted ?? currentCycle(await listMilestones(repo)));
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  if (!only && milestone === null) {
    console.error("ERROR: no milestone to materialize.");
    console.error("  There is no open core `v*` milestone, so there is no cycle in flight. Pass");
    console.error("  --milestone <vX.Y.Z>, or --issue <n> for an experiment (which never carries one).");
    return 2;
  }

  // Which work items are in scope. `--issue` is the by-decision path and takes exactly one.
  const targets: Issue[] = [];
  if (only) {
    const issue = parentage.all.get(Number(only));
    if (!issue) {
      console.error(`ERROR: #${only} is not an issue on ${repo}.`);
      return 2;
    }
    targets.push(issue);
  } else {
    for (const i of parentage.all.values()) {
      if (i.milestone === milestone && i.state.toUpperCase() === "OPEN") targets.push(i);
    }
  }

  const childrenOf = new Map<number, number[]>();
  for (const [child, parent] of parentage.parentOf) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
  }

  /*
   * Gates that exist but were never linked — the partial-failure residue this command has to resume
   * from rather than duplicate. A gate is created and then linked in two calls, so a crash between
   * them leaves a real gate with no parent, which every later run would otherwise read as "missing"
   * and create again.
   *
   * The bodies are fetched here and nowhere else on purpose: this reads one issue per ORPHAN, and
   * orphans only exist after a failure. The happy path pays nothing.
   */
  const orphans = new Map<string, number>();
  const candidates = [...parentage.all].filter(([n, i]) => gateOf(i.labels) && !parentage.parentOf.has(n));
  for (const [n, i] of candidates) {
    const body = await issueBody(repo, n).catch(() => "");
    const m = /pm-playbook:gate parent=#(\d+)/.exec(body);
    if (m) orphans.set(`${m[1]}:${gateOf(i.labels)!.n}`, n);
  }

  const pending: Pending[] = [];
  const skipped: string[] = [];

  for (const parent of targets.sort((a, b) => a.number - b.number)) {
    if (parent.labels.includes("epic")) {
      skipped.push(`#${parent.number} is an \`epic\` — an epic groups work, it never gates it (PM012).`);
      continue;
    }
    if (gateOf(parent.labels)) {
      skipped.push(`#${parent.number} is itself a gate.`);
      continue;
    }
    const type = workTypeOf(parent.labels);
    if (!type) {
      skipped.push(`#${parent.number} carries no single work type, so its gate set is undefined (PM010).`);
      continue;
    }
    if (type === "experiment" && !only) {
      skipped.push(`#${parent.number} is an \`experiment\` — materialize it by decision: --issue ${parent.number}`);
      continue;
    }

    const present = new Set<number>();
    for (const c of childrenOf.get(parent.number) ?? []) {
      const g = gateOf(parentage.all.get(c)?.labels ?? []);
      if (g) present.add(g.n);
    }

    for (const spec of GATES[type]) {
      if (present.has(spec.n)) continue;
      pending.push({ parent, type, n: spec.n, orphan: orphans.get(`${parent.number}:${spec.n}`) ?? null });
    }
  }

  if (json) {
    console.log(JSON.stringify({
      repo, milestone, apply,
      create: pending.map((p) => ({ parent: p.parent.number, type: p.type, gate: p.n, adopt: p.orphan })),
      skipped,
    }, null, 2));
    if (!apply) return 0;
  } else {
    console.log(`Materialize gates — ${repo}${milestone ? ` ${milestone}` : ` #${only}`}\n`);
    for (const s of skipped) console.log(`  skip  ${s}`);
    if (skipped.length) console.log("");
    if (!pending.length) {
      // "Nothing to do" and "nothing was eligible" are opposite outcomes and must never print the
      // same line — a run that skipped everything would otherwise read as a clean bill of health.
      const eligible = targets.length - skipped.length;
      console.log(
        eligible > 0
          ? `✓ All ${eligible} work item(s) in scope already carry their complete gate set.`
          : "! Nothing was eligible — every work item in scope was skipped for a reason above.",
      );
      return 0;
    }
    for (const p of pending) {
      const verb = p.orphan ? `adopt #${p.orphan} as` : "create";
      console.log(`  ${verb.padEnd(16)} ${gateLabel(p.type, p.n)} under #${p.parent.number} ${p.parent.title}`);
    }
    console.log("");
    if (!apply) {
      console.log(`${pending.length} gate(s) to materialize. Re-run with --yes to apply.`);
      return 0;
    }
  }

  if (!pending.length) return 0;

  let created = 0;
  for (const p of pending) {
    const label = gateLabel(p.type, p.n);
    try {
      // Adopt first: an orphan is a gate a previous run created and failed to link, so re-creating
      // it would leave a duplicate that nothing later can distinguish from the real one.
      const number =
        p.orphan ??
        (await createIssue(repo, {
          title: gateTitle(p.type, p.n, p.parent.title),
          body: gateBody(p.type, p.n, p.parent),
          labels: [label],
          milestone: p.parent.milestone,
        }));
      await addSubIssue(repo, p.parent.number, number);
      console.log(`  ✓ #${number}  ${label} under #${p.parent.number}`);
      created += 1;
    } catch (err) {
      console.error(`  ✗ ${label} under #${p.parent.number}: ${(err as Error).message}`);
      console.error("    Re-run this command — it resumes rather than restarting.");
      return 1;
    }
  }

  console.log(`\n✓ ${created} gate(s) materialized.`);
  return 0;
}
