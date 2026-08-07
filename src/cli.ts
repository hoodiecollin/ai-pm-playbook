/**
 * pm-playbook CLI.
 *
 * Ships as bundled JS so it runs under `npx` (Node >=18) and `bunx` alike — the agent-facing half
 * of this package has no runtime at all, and the provisioning half should not force a runtime
 * choice on anyone.
 */

import { parseArgs, bool, str } from "./lib/args.js";
import { findRepoRoot, packageVersion } from "./lib/paths.js";
import { setVerbose } from "./lib/sh.js";
import { RULES } from "./lib/invariants.js";
import { bootstrap } from "./commands/bootstrap.js";
import { check } from "./commands/check.js";
import { init } from "./commands/init.js";
import { migrate } from "./commands/migrate.js";
import { pull } from "./commands/pull.js";
import { push } from "./commands/push.js";
import { create } from "./commands/create.js";
import { releaseCheck } from "./commands/release-check.js";
import { scopeCheck } from "./commands/scope-check.js";

const HELP = `pm-playbook — a portable, agent-readable project-management model for GitHub Issues.

USAGE
  pm-playbook <command> [options]

COMMANDS
  init                    Adopt the playbook in this repo: vendor the doctrine into .pm-playbook/,
                          copy the issue templates, and wire the agent instruction files.
                          Local and offline unless --repo is given.
  bootstrap               Provision labels, a starter milestone, and the filtered Project views
                          on GitHub. Idempotent.
  check                   Lint the repo against the playbook invariants. Exit 1 on violations.
  pull                    Materialize the backlog (issues, epics, sub-issues, comments) to
                          .pm-playbook/backlog/ and record the base snapshot.
  push                    Send local edits back to GitHub. Refuses any entity whose remote also
                          moved. Previews by default; --yes to apply.
  create                  Publish drafts under backlog/new/. Validates labels, milestones and the
                          invariants offline first. Previews by default; --yes to apply.
  release-check <vX.Y.Z>  Can this milestone be tagged? Exit 1 if gated or incomplete.
  scope-check <pr>        Cycle-scope gate (§5.3): refuse a PR to the integration branch that
                          closes work milestoned past the cycle in flight.
  migrate                 Apply GitHub-side label migrations after a MAJOR upgrade.
                          Previews by default; --yes to apply.
  rules                   Print the rule index (id, section, severity).
  version                 Print the package version.

INIT OPTIONS
  --dir <path>            Repo root (default: nearest git root from cwd)
  --agent-files a,b       Agent instruction files to write (default: AGENTS.md)
  --detect                Also write any known agent file already present in the repo
  --no-templates          Skip copying .github/ISSUE_TEMPLATE/
  --force                 Overwrite locally-edited vendored files and existing templates
  --dry-run               Print what would change; write nothing

BOOTSTRAP OPTIONS
  --repo owner/name       (required) target repository
  --project <number>      ProjectV2 number to add views to
  --owner <login>         Project owner (default: the repo owner; user vs org is auto-detected)
  --surfaces a,b,c        Create surface:* labels — only for repos shipping >1 artifact
  --milestone vX.Y.Z      Starter milestone title
  --dry-run               Print what would happen; make no changes

MIGRATE OPTIONS
  --repo owner/name       Target repository (default: detected from the git remote)
  --yes                   Actually apply. Without it, migrate only previews.
  --json                  Emit the plan as JSON

SCOPE-CHECK OPTIONS
  --repo owner/name       Target repository (default: detected from the git remote)
  --integration-branch    Branch the gate applies to (default: develop)
  --strict                Treat the PM009 advisory tier as a failure
  --json                  Emit the report as JSON

PULL OPTIONS
  --repo owner/name       Target repository (default: detected from the git remote)
  --dry-run               Print what would change; write nothing
  --json                  Emit the plan as JSON

PUSH OPTIONS
  --repo owner/name       Target repository (default: detected from the git remote)
  --yes                   Actually apply. Without it, push only previews.
  --json                  Emit the plan as JSON

CHECK OPTIONS
  --repo owner/name       Target repository (default: detected from the git remote)
  --no-remote             Local checks only — no network, no auth
  --all-states            Also lint closed issues (use for a migration audit)
  --strict                Treat warnings as failures
  --json                  Emit the full report as JSON (the agent-facing interface)

GLOBAL
  --verbose               Echo every subprocess invocation
  -h, --help              Show this help

DOCS  https://github.com/hoodiecollin/ai-pm-playbook`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (bool(args, "verbose")) setVerbose(true);

  const command = args._[0];

  if (!command || argv.includes("-h") || argv.includes("--help") || bool(args, "help")) {
    console.log(HELP);
    return command ? 0 : 1;
  }

  const repoRoot = findRepoRoot(str(args, "dir") ?? process.cwd());

  switch (command) {
    case "init":
      return init(args, repoRoot);
    case "bootstrap":
      return bootstrap(args);
    case "check":
      return check(args, repoRoot);
    case "migrate":
      return migrate(args, repoRoot);
    case "pull":
      return pull(args, repoRoot);
    case "push":
      return push(args, repoRoot);
    case "create":
      return create(args, repoRoot);
    case "release-check":
      return releaseCheck(args, repoRoot, args._[1]);
    case "scope-check":
      return scopeCheck(args, repoRoot, args._[1]);
    case "rules":
      for (const r of RULES) {
        console.log(`${r.rule}  ${r.severity.padEnd(5)} ${r.section.padEnd(8)} ${r.summary}`);
      }
      return 0;
    case "version":
      console.log(packageVersion());
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\npm-playbook failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
