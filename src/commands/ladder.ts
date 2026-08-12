/**
 * `pm-playbook ladder` — where every work item sits on the commitment ladder (§2).
 *
 * This command exists because of a limit rather than a preference. Under the old model the rungs
 * were labels, so "show me everything past design" was a one-line GitHub filter. Deriving the rungs
 * from gate state removes the drift that model had — and takes the filter with it: the rung is a
 * property of a work item computed from its *children*, and no issue search, saved view or Project
 * filter can reach across the parent/sub-issue relation.
 *
 * So the answer moves here. §8's board still answers "what is being worked on" from the gate labels
 * themselves, where the state genuinely is a label; this answers "what stage is each work item at",
 * which needs computation. `--json` makes it consumable by an agent or a roadmap generator, which is
 * how §7.2's buckets get computed now.
 */

import { currentCycle, gateOf, workTypeOf } from "../lib/model.js";
import { ladderState, type GateView, type WorkItemView } from "../lib/ladder.js";
import { detectRepo, fetchParentage, listMilestones, requireGh } from "../lib/gh.js";
import type { Issue } from "../lib/gh.js";
import { bool, str, type Args } from "../lib/args.js";

interface Row {
  number: number;
  title: string;
  type: string;
  state: string;
  milestone: string | null;
  /** True when the milestone IS the cycle in flight — §2's "scheduled", as opposed to committed. */
  focused: boolean;
  gates: { n: number; number: number; state: string }[];
}

export async function ladder(args: Args, repoRoot: string): Promise<number> {
  const json = bool(args, "json");
  const wanted = str(args, "milestone");
  const all = bool(args, "all-states");

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let parentage, cycle: string | null;
  try {
    await requireGh();
    parentage = await fetchParentage(repo);
    cycle = currentCycle(await listMilestones(repo));
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  const childrenOf = new Map<number, number[]>();
  for (const [child, parent] of parentage.parentOf) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
  }

  const rows: (Row & { rung: string })[] = [];
  for (const [number, issue] of [...parentage.all].sort((a, b) => a[0] - b[0])) {
    if (gateOf(issue.labels) || issue.labels.includes("epic")) continue;
    const type = workTypeOf(issue.labels);
    if (!type) continue;
    if (!all && issue.state.toUpperCase() === "CLOSED") continue;
    if (wanted && issue.milestone !== wanted) continue;

    const gates: (GateView & { number: number })[] = [];
    for (const c of childrenOf.get(number) ?? []) {
      const child = parentage.all.get(c);
      const g = child ? gateOf(child.labels) : null;
      if (child && g) {
        gates.push({ n: g.n, number: c, state: child.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN" });
      }
    }

    const view: WorkItemView = {
      number,
      type,
      state: issue.state.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN",
      milestone: issue.milestone,
      gates,
    };

    rows.push({
      number,
      title: issue.title,
      type,
      state: view.state,
      milestone: issue.milestone,
      focused: issue.milestone !== null && issue.milestone === cycle,
      gates: gates.sort((a, b) => a.n - b.n),
      rung: ladderState(view).state,
    });
  }

  if (json) {
    console.log(JSON.stringify({ repo, cycle, items: rows }, null, 2));
    return 0;
  }

  console.log(`Commitment ladder — ${repo}`);
  console.log(`Cycle in flight: ${cycle ?? "none"} (a milestone means committed; focus means scheduled)\n`);

  if (!rows.length) {
    console.log("No work items in scope.");
    return 0;
  }

  const width = Math.max(...rows.map((r) => r.rung.length));
  for (const r of rows) {
    const gates = r.gates.length
      ? r.gates.map((g) => `${g.n}${g.state === "CLOSED" ? "✓" : "·"}`).join(" ")
      : "—";
    const where = r.milestone ? `${r.milestone}${r.focused ? " ◀ focus" : ""}` : "unscheduled";
    console.log(`${r.rung.padEnd(width)}  #${String(r.number).padEnd(5)} ${gates.padEnd(9)} ${where.padEnd(18)} ${r.title}`);
  }
  console.log(`\n${rows.length} work item(s). Gate marks: ✓ closed · open, absent gates omitted.`);
  return 0;
}
