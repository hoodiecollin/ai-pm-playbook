/**
 * `pm-playbook context <issue>` — everything an agent needs to work one issue safely.
 *
 * The point is that context is **pushed**, not fetched. A doctrine telling agents to read their
 * siblings first fails under exactly the conditions that motivate it: a parallel agent optimising
 * its own narrow task skips a discretionary read step. A command is a constraint; prose is a
 * suggestion.
 *
 * Reads the mirror and never fetches. It refuses when the mirror does not cover the neighbourhood,
 * because a pack that silently described a subset would be the blindness it exists to fix, one
 * level down.
 */

import { backlogRoot, readTree } from "../lib/backlog/store.js";
import { readCoverage, describes } from "../lib/backlog/coverage.js";
import { neighboursOf } from "../lib/backlog/neighbourhood.js";
import { DEFAULT_BUDGET, renderPack } from "../lib/backlog/pack.js";
import { BACKLOG_DIR, VENDOR_DIR } from "../lib/vendor.js";
import { bool, str, type Args } from "../lib/args.js";

export async function context(args: Args, repoRoot: string, target?: string): Promise<number> {
  const json = bool(args, "json");
  const number = Number(target);
  if (!target || !Number.isInteger(number) || number <= 0) {
    console.error("ERROR: which issue? Usage: pm-playbook context <issue>");
    return 2;
  }

  const root = backlogRoot(repoRoot);
  const entities = readTree(root);
  if (entities.size === 0) {
    console.error(`ERROR: no materialized backlog at ${VENDOR_DIR}/${BACKLOG_DIR}.`);
    console.error("  Run `pm-playbook pull` first — this command reads the mirror and never fetches.");
    return 2;
  }

  const subject = entities.get(number);
  if (!subject) {
    console.error(`ERROR: #${number} is not in the mirror.`);
    console.error("  Run `pm-playbook pull` if it is new, or check the number.");
    return 2;
  }

  const neighbours = neighboursOf(entities.values(), number);

  /*
   * The neighbourhood is only meaningful if the mirror actually holds it. An uncovered mirror would
   * produce a pack that is confidently short — which is worse than no pack, because the roster's
   * whole promise is that it is complete.
   */
  const needed = new Set([number, ...neighbours.map((n) => n.number)]);
  if (!describes(readCoverage(root), needed)) {
    console.error(`ERROR: the mirror does not cover #${number}'s neighbourhood.`);
    console.error("  The roster would be incomplete, which is the problem this command exists to fix.");
    console.error("  Run: pm-playbook pull");
    return 2;
  }

  const budget = Number(str(args, "budget") ?? DEFAULT_BUDGET);
  if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`ERROR: --budget must be a positive number of characters, got \`${str(args, "budget")}\`.`);
    return 2;
  }

  if (json) {
    console.log(JSON.stringify({ subject: number, neighbours }, null, 2));
    return 0;
  }

  process.stdout.write(renderPack(subject, neighbours, entities, { byteBudget: budget }));
  return 0;
}
