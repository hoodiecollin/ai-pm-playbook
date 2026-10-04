/**
 * `pm-playbook prove <gate>` — judge a proof gate, and close it when no human decision is left.
 *
 * Closing a gate is otherwise a human act: the plugin's hook refuses an agent's `gh issue close` on
 * any gate, because "closed means approved" is only true if the approver is a person. A proof gate
 * is the one exception, and only when two things hold:
 *
 *   - every claim in its table was RUN or READ, or explicitly declared out of scope — so there is
 *     nothing left to approve but evidence, which a tool can check as well as a person can;
 *   - it declares no one-way doors. A choice that is expensive to reverse is a judgement, and a
 *     judgement goes to a human however good the evidence is.
 *
 * Everything else exits 1 with the reason, so an agent learns exactly what is still owed. The
 * judgement itself is `evaluateProof`, which PM018 also uses: the command that closes a gate and
 * the rule that audits it afterwards cannot disagree.
 */

import { evaluateProof } from "../lib/claims.js";
import { closeIssue, detectRepo, issueDetail, requireGh } from "../lib/gh.js";
import { gateLabel } from "../lib/model.js";
import { bool, str, type Args } from "../lib/args.js";

const PROOF = gateLabel("improvement", 2);

export async function prove(args: Args, repoRoot: string, target: string | undefined): Promise<number> {
  const json = bool(args, "json");
  const apply = bool(args, "yes");
  const number = Number(target);
  if (!target || !Number.isInteger(number) || number <= 0) {
    console.error("Usage: pm-playbook prove <gate-number> [--yes]");
    return 2;
  }

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let issue;
  try {
    await requireGh();
    issue = await issueDetail(repo, number);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  if (!issue.labels.includes(PROOF)) {
    console.error(`ERROR: #${number} is not a proof gate (no \`${PROOF}\` label). Only a proof gate closes on evidence;`);
    console.error("  every other gate is closed by a human.");
    return 2;
  }

  const report = evaluateProof(issue.body);
  const closable = report.problems.length === 0 && report.oneWay === "none";
  const result = {
    gate: number,
    state: issue.state,
    claims: report.rows,
    problems: report.problems,
    oneWayDoors: report.oneWay,
    closable,
    closed: false,
  };

  if (issue.state.toUpperCase() === "CLOSED") {
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`#${number} is already closed.${report.problems.length ? ` (PM018 would still flag: ${report.problems.join("; ")})` : ""}`);
    return 0;
  }

  if (!json) {
    console.log(`Proof gate #${number} — ${issue.title}\n`);
    const counts = new Map<string, number>();
    for (const r of report.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    console.log(`  claims: ${report.rows.length}${counts.size ? ` (${[...counts].map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}`);
    console.log(`  one-way doors: ${report.oneWay}`);
    for (const p of report.problems) console.log(`  ✗ ${p}`);
    console.log("");
  }

  if (report.problems.length) {
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log("Not closable: the approach still rests on something unproven. Fix the rows above, then re-run.");
    return 1;
  }
  if (report.oneWay === "declared") {
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log("The evidence is complete, but one-way doors are declared — that is a human decision.");
      console.log(`Ask the maintainer to review and close #${number} themselves.`);
    }
    return 1;
  }
  if (!apply) {
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Closable. Re-run with --yes to close #${number}.`);
    return 0;
  }

  try {
    await closeIssue(
      repo,
      number,
      `Closed by \`pm-playbook prove\`: ${report.rows.length} claim(s), none assumed, and no one-way doors declared.`,
    );
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }
  result.closed = true;
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`✓ Closed #${number}.`);
  return 0;
}
