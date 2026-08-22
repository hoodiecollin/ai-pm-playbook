/**
 * `pm-playbook milestone [vX.Y.Z]` — what work is left on a release, readably.
 *
 * Two commands each answered half of this before: `ladder` gives every item's rung but skips epics
 * and prints past 80 columns, and `release-check` says whether a tag is possible and nothing about
 * the shape of what remains.
 *
 * It reads the mirror and **refuses rather than under-reporting**. A milestone report drawn from a
 * mirror that does not cover the milestone is exactly the failure the coverage record was added to
 * prevent — "what's left" is a claim about completeness, so a partial answer is a wrong one rather
 * than a smaller one.
 */

import { backlogRoot, readIndexRepo, readTable, readTree, MILESTONES_FILE } from "../lib/backlog/store.js";
import { readCoverage, describes } from "../lib/backlog/coverage.js";
import { buildReport } from "../lib/backlog/report.js";
import { renderReport } from "../lib/backlog/render.js";
import { expand } from "../lib/backlog/scope.js";
import { currentCycle } from "../lib/model.js";
import { BACKLOG_DIR, VENDOR_DIR } from "../lib/vendor.js";
import { bool, type Args } from "../lib/args.js";

export async function milestone(args: Args, repoRoot: string, wanted?: string): Promise<number> {
  const json = bool(args, "json");
  const root = backlogRoot(repoRoot);
  const entities = readTree(root);

  if (entities.size === 0) {
    console.error(`ERROR: no materialized backlog at ${VENDOR_DIR}/${BACKLOG_DIR}.`);
    console.error("  Run `pm-playbook pull` first — this command reads the mirror and never fetches.");
    return 2;
  }

  const milestones = readTable<{ title: string; state: string }[]>(root, MILESTONES_FILE);
  const title = wanted ?? (milestones ? currentCycle(milestones) : null);

  if (!title) {
    console.error("ERROR: which milestone?");
    console.error("  usage: pm-playbook milestone <vX.Y.Z> — or run `pull` so the cycle in flight can be derived.");
    return 2;
  }

  /*
   * "That milestone does not exist" and "that milestone has nothing open" are opposite answers and
   * must never print the same thing. Checked against the table `pull` recorded rather than against
   * the entities, so a real-but-empty milestone still reports as empty.
   */
  if (milestones && !milestones.some((m) => m.title === title)) {
    console.error(`ERROR: no milestone \`${title}\` on ${readIndexRepo(root) ?? "this repo"}.`);
    console.error(`  Known: ${milestones.map((m) => m.title).join(", ") || "(none)"}`);
    return 2;
  }

  // Does the mirror actually cover this milestone? A subset reported as the whole is the one
  // failure this command must not have.
  const scope = { target: { kind: "milestone" as const, title }, kinds: new Set<never>() };
  const needed = expand(entities.values(), scope);
  const coverage = readCoverage(root);
  if (!describes(coverage, needed)) {
    console.error(`ERROR: the mirror does not cover ${title}, so "what's left" would be a guess.`);
    console.error(`  Run: pm-playbook pull --milestone ${title}`);
    return 2;
  }

  const report = buildReport(entities.values(), title);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  // Emitted exactly as built. The whole design rests on these bytes being stable, so nothing is
  // decorated, timestamped, or reordered here.
  process.stdout.write(renderReport(report));
  return 0;
}
