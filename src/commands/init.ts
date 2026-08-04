/**
 * `pm-playbook init` — adopt the playbook in a repo.
 *
 * Local and offline by default: it vendors the doctrine, copies the issue templates, and wires the
 * agent instruction files. It deliberately does NOT touch GitHub unless `--repo` is given, because
 * provisioning labels and milestones is a mutation of shared team state and should be a decision,
 * not a side effect of installing a dependency.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { DEFAULT_AGENT_FILE, detectAgentFiles, planStanza, writeStanza } from "../lib/agent-files.js";
import { PLAYBOOK_ASSETS, TEMPLATE_ASSETS, packageName, packageVersion } from "../lib/paths.js";
import { VENDOR_DIR, planVendor, writeVendor } from "../lib/vendor.js";
import { bool, list, str, type Args } from "../lib/args.js";
import { bootstrap } from "./bootstrap.js";

function copyTree(src: string, dest: string, dry: boolean, force: boolean): string[] {
  if (!existsSync(src)) return [];
  const written: string[] = [];
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) {
      written.push(...copyTree(from, to, dry, force));
      continue;
    }
    if (existsSync(to) && !force) continue; // never clobber a team's customised template
    written.push(to);
    if (dry) continue;
    mkdirSync(dest, { recursive: true });
    copyFileSync(from, to);
  }
  return written;
}

export async function init(args: Args, repoRoot: string): Promise<number> {
  const dry = bool(args, "dry-run");
  const force = bool(args, "force");
  const version = packageVersion();
  const tag = dry ? "[dry-run] " : "";
  const rel = (p: string) => relative(repoRoot, p) || ".";

  console.log(`pm-playbook v${version} → ${repoRoot}\n`);

  // 1. Vendor the doctrine ---------------------------------------------------
  console.log("=== Doctrine ===");
  const plan = planVendor(repoRoot, PLAYBOOK_ASSETS);

  if (plan.conflicted.length && !force) {
    console.error(`ERROR: ${plan.conflicted.length} vendored file(s) were edited locally:`);
    for (const f of plan.conflicted) console.error(`  • ${VENDOR_DIR}/${f}`);
    console.error(
      "\nRefusing to overwrite deliberate local edits. Either revert them, or re-run with --force\n" +
        "to take the packaged version. (If you meant to customise the doctrine permanently, keep a\n" +
        "patch outside this directory — `init` owns everything under it.)",
    );
    return 1;
  }

  const changes = plan.added.length + plan.updated.length + plan.conflicted.length;
  if (changes === 0) {
    console.log(`  ${VENDOR_DIR}/ already current (v${version})`);
  } else {
    for (const f of plan.added) console.log(`${tag}  + ${VENDOR_DIR}/${f}`);
    for (const f of [...plan.updated, ...plan.conflicted]) console.log(`${tag}  ~ ${VENDOR_DIR}/${f}`);
  }
  for (const f of plan.orphaned) {
    console.log(`${tag}  ! ${VENDOR_DIR}/${f} — no longer shipped; safe to delete`);
  }
  if (!dry && changes > 0) writeVendor(repoRoot, PLAYBOOK_ASSETS, version, packageName());

  // 2. Issue templates -------------------------------------------------------
  if (!bool(args, "no-templates")) {
    console.log("\n=== Issue templates ===");
    // TEMPLATE_ASSETS already contains the `ISSUE_TEMPLATE/` directory, so the destination is
    // `.github`, not `.github/ISSUE_TEMPLATE`.
    const written = copyTree(TEMPLATE_ASSETS, join(repoRoot, ".github"), dry, force);
    if (written.length === 0) console.log("  all present — skipping (use --force to overwrite)");
    for (const f of written) console.log(`${tag}  + ${rel(f)}`);
  }

  // 3. Agent instruction files ----------------------------------------------
  console.log("\n=== Agent instructions ===");
  const explicit = list(args, "agent-files");
  const detected = bool(args, "detect") ? detectAgentFiles(repoRoot) : [];
  // Default to AGENTS.md — the one file multiple harnesses read. --detect adds whatever the team
  // already keeps, so Cursor/Copilot/Claude users get the stanza without naming their tool.
  const targets = [...new Set([...(explicit ?? [DEFAULT_AGENT_FILE]), ...detected])];

  for (const file of targets) {
    const { action } = planStanza(repoRoot, file, version);
    console.log(`${tag}  ${action === "unchanged" ? "=" : action === "created" ? "+" : "~"} ${file} (${action})`);
    if (!dry && action !== "unchanged") writeStanza(repoRoot, file, version);
  }

  // 4. Optional GitHub provisioning -----------------------------------------
  const repo = str(args, "repo");
  if (repo) {
    const code = await bootstrap(args, repo);
    if (code !== 0) return code;
  }

  // 5. Next steps ------------------------------------------------------------
  console.log("\n" + "─".repeat(72));
  console.log("Done. Next:");
  console.log(`  1. Commit ${VENDOR_DIR}/ and ${targets.join(", ")} — agents read them from the repo,`);
  console.log("     which is why they must not be gitignored.");
  if (!repo) {
    console.log("  2. Provision labels/milestones/views on GitHub:");
    console.log("       npx @hoodiecollin/pm-playbook bootstrap --repo <owner>/<name> --project <N>");
  } else {
    console.log("  2. Set group-by on the Release spine / Surface / Execution boards in the UI.");
  }
  console.log("  3. Add the check to CI:  npx @hoodiecollin/pm-playbook check --repo <owner>/<name>");
  console.log(`  4. Read ${VENDOR_DIR}/AGENT.md yourself — it is the map your agents will use.`);
  return 0;
}
