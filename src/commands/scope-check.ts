/**
 * `pm-playbook scope-check <pr>` — the cycle-scope gate (§5.3).
 *
 * Wire it on pull requests targeting the integration branch:
 *
 *   - run: npx ai-pm-playbook scope-check ${{ github.event.pull_request.number }}
 *
 * The gate reads the MILESTONE, not the branch name. The schedule already lives on the issue, so
 * consulting it beats duplicating it into a version-named branch — which is precisely the
 * parallel-decomposition anti-pattern §5.3 exists to prevent.
 *
 * The cycle in flight is DERIVED (lowest open core milestone), never configured, so there is no
 * constant to update and nothing that can drift from the actual spine.
 */

import { currentCycle } from "../lib/model.js";
import { checkPullRequestScope, type Violation } from "../lib/invariants.js";
import { detectRepo, listIssues, listMilestones, pullRequestScope, requireGh } from "../lib/gh.js";
import { bool, str, type Args } from "../lib/args.js";

const DEFAULT_INTEGRATION_BRANCH = "develop";

export async function scopeCheck(args: Args, repoRoot: string, prArg?: string): Promise<number> {
  const json = bool(args, "json");
  const strict = bool(args, "strict");
  const integration = str(args, "integration-branch") ?? DEFAULT_INTEGRATION_BRANCH;

  const pr = Number(prArg);
  if (!prArg || !Number.isInteger(pr) || pr <= 0) {
    console.error("ERROR: a pull request number is required.  usage: pm-playbook scope-check <pr>");
    return 2;
  }

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let scope, cycle: string | null, open;
  try {
    await requireGh();
    scope = await pullRequestScope(repo, pr);
    // The gate only applies to the integration branch; bail before spending two more API calls.
    if (scope.baseRefName !== integration) {
      const note = `PR #${pr} targets \`${scope.baseRefName}\`, not the integration branch \`${integration}\` — the cycle-scope gate does not apply.`;
      console.log(json ? JSON.stringify({ ok: true, repo, pr, applicable: false, note }, null, 2) : `✓ ${note}`);
      return 0;
    }
    cycle = currentCycle(await listMilestones(repo));
    open = await listIssues(repo, "open");
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  if (cycle === null) {
    // No open core milestone means the spine has no cycle in flight, so "later than the cycle" has
    // no referent. Pass, but say so — a spine with nothing open is itself worth noticing.
    const note = "No open core `v*` milestone, so there is no cycle in flight to gate against. Open the next milestone to re-arm this check.";
    console.log(json ? JSON.stringify({ ok: true, repo, pr, applicable: false, note }, null, 2) : `! ${note}`);
    return 0;
  }

  const violations: Violation[] = checkPullRequestScope(scope, cycle, open);
  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warn");
  const failed = errors.length > 0 || (strict && warnings.length > 0);

  if (json) {
    console.log(JSON.stringify({
      ok: !failed, repo, pr, applicable: true,
      integrationBranch: integration, cycle,
      closes: scope.closing, violations,
    }, null, 2));
    return failed ? 1 : 0;
  }

  console.log(`Cycle-scope gate — ${repo}#${pr} → ${integration}`);
  console.log(`Cycle in flight: ${cycle} (derived: lowest open core milestone)\n`);

  for (const v of [...errors, ...warnings]) {
    console.log(`${v.severity === "error" ? "✗" : "!"} ${v.rule} (${v.section}) #${v.issue!.number} ${v.issue!.title}`);
    console.log(`    ${v.message}`);
    console.log(`    fix: ${v.fix}`);
    console.log(`    ${v.issue!.url}\n`);
  }

  if (!violations.length) {
    const closes = scope.closing.length
      ? scope.closing.map((c) => `#${c.number} (${c.milestone ?? "no milestone"})`).join(", ")
      : "nothing";
    console.log(`✓ Closes ${closes} — none milestoned past ${cycle}.`);
    return 0;
  }
  if (!failed) console.log("Warnings do not fail the run; use --strict to treat them as errors.");
  return failed ? 1 : 0;
}
