/**
 * `pm-playbook release-check <milestone>` — "can we tag?" as a command instead of a memory.
 *
 * PLAYBOOK §5.2: an open `release-gate` on a milestone means that milestone cannot be tagged, even
 * when every feature on it is closed. This is the mechanical check a tag workflow runs.
 *
 * It deliberately reports the *open non-gate* work separately: unfinished features mean the
 * milestone is incomplete, which is a different failure from being gated, and conflating the two
 * makes the output useless for deciding what to do next.
 */

import { detectRepo, listIssues, requireGh } from "../lib/gh.js";
import { releaseBlockers } from "../lib/invariants.js";
import { bool, str, type Args } from "../lib/args.js";

export async function releaseCheck(args: Args, repoRoot: string, milestone?: string): Promise<number> {
  const json = bool(args, "json");

  if (!milestone) {
    console.error("ERROR: a milestone is required.  usage: pm-playbook release-check <vX.Y.Z>");
    return 2;
  }

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  try {
    await requireGh();
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  const open = await listIssues(repo, "open");
  const onMilestone = open.filter((i) => i.milestone === milestone);
  const gates = releaseBlockers(open, milestone);
  const incomplete = onMilestone.filter((i) => !i.labels.includes("release-gate"));
  const releasable = gates.length === 0 && incomplete.length === 0;

  if (json) {
    console.log(JSON.stringify({
      repo, milestone, releasable,
      gates: gates.map((i) => ({ number: i.number, title: i.title, url: i.url })),
      incomplete: incomplete.map((i) => ({ number: i.number, title: i.title, url: i.url })),
    }, null, 2));
    return releasable ? 0 : 1;
  }

  console.log(`Release readiness — ${repo} ${milestone}\n`);

  if (gates.length) {
    console.log(`✗ ${gates.length} open release-gate(s) — this milestone CANNOT be tagged:`);
    for (const i of gates) console.log(`    #${i.number} ${i.title}\n      ${i.url}`);
    console.log("");
  }
  if (incomplete.length) {
    console.log(`✗ ${incomplete.length} open issue(s) still on the milestone:`);
    for (const i of incomplete) console.log(`    #${i.number} ${i.title}`);
    console.log("");
  }

  if (releasable) {
    console.log("✓ No open release-gates and no open issues on this milestone.");
    console.log("");
    console.log("Reminder (§5.2): green in-tree is not proof of releasable. If this product publishes");
    console.log("artifacts its own built output depends on, run the outside-repo reclose — from a clean");
    console.log("directory, with the PUBLISHED tool: install → scaffold → generate → build.");
    return 0;
  }
  return 1;
}
