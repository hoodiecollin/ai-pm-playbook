/**
 * `pm-playbook pr-check <pr>` — what a pull request must carry, whatever branch it targets.
 *
 * Today that is one rule, PM021: a PR that closes a `bugfix` changes a test. A plain bugfix has no
 * gates, so this is where its evidence is enforced. Wire it on every pull request:
 *
 *   - run: npx @hoodiecollin/pm-playbook pr-check ${{ github.event.pull_request.number }}
 *
 * `scope-check` stays separate because it applies only to PRs into the integration branch.
 */

import { checkBugfixEvidence, DEFAULT_TEST_PATTERN } from "../lib/invariants.js";
import { detectRepo, pullRequestScope, requireGh } from "../lib/gh.js";
import { bool, str, type Args } from "../lib/args.js";

export async function prCheck(args: Args, repoRoot: string, prArg?: string): Promise<number> {
  const json = bool(args, "json");
  const pr = Number(prArg);
  if (!prArg || !Number.isInteger(pr) || pr <= 0) {
    console.error("ERROR: a pull request number is required.  usage: pm-playbook pr-check <pr>");
    return 2;
  }

  let pattern = DEFAULT_TEST_PATTERN;
  const custom = str(args, "test-pattern");
  if (custom) {
    try {
      pattern = new RegExp(custom, "i");
    } catch (err) {
      console.error(`ERROR: --test-pattern is not a valid regular expression: ${(err as Error).message}`);
      return 2;
    }
  }

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let scope;
  try {
    await requireGh();
    scope = await pullRequestScope(repo, pr);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  const violations = checkBugfixEvidence(scope, pattern);
  if (json) {
    console.log(JSON.stringify({ ok: violations.length === 0, repo, pr, violations }, null, 2));
    return violations.length ? 1 : 0;
  }

  console.log(`PR check — ${repo}#${pr}\n`);
  for (const v of violations) {
    console.log(`✗ ${v.rule} (${v.section}) #${v.issue!.number} ${v.issue!.title}`);
    console.log(`    ${v.message}`);
    console.log(`    fix: ${v.fix}\n`);
  }
  if (!violations.length) {
    const bugfixes = scope.closing.filter((c) => (c.labels ?? []).includes("bugfix"));
    console.log(bugfixes.length ? `✓ Closes bugfix ${bugfixes.map((b) => `#${b.number}`).join(", ")} and changes a test.` : "✓ Closes no bugfix.");
  }
  return violations.length ? 1 : 0;
}
