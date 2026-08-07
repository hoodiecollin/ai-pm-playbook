/**
 * `pm-playbook check` — lint a repo against the playbook invariants.
 *
 * Two tiers, because they have different requirements:
 *   - LOCAL  (no network, no auth): vendored-doctrine drift, agent-file wiring, shadow backlogs.
 *   - REMOTE (needs `gh`):          the label invariants over live issues.
 *
 * `--no-remote` runs only the local tier, so the check is still useful in a sandbox or a
 * network-isolated CI job. Exit 0 = compliant, 1 = violations, 2 = the tool could not run.
 *
 * `--json` emits the whole report as one object. This is the agent-facing interface: a harness can
 * feed the violations straight back to a model, and every violation carries an executable `fix`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_AGENT_FILE, detectAgentFiles, stanzaStatus } from "../lib/agent-files.js";
import { RULES, checkIssues, type Violation } from "../lib/invariants.js";
import { detectRepo, epicSubIssueCounts, listIssues, requireGh } from "../lib/gh.js";
import { BACKLOG_DIR, VENDOR_DIR, detectDrift } from "../lib/vendor.js";
import { backlogRoot, listConflicts, readIndexRepo, readTree } from "../lib/backlog/store.js";
import { pendingForRepo } from "./migrate.js";
import { packageVersion } from "../lib/paths.js";
import { bool, str, type Args } from "../lib/args.js";

/** §11: "Backlog lives in Issues — no markdown backlog." These filenames are the usual offenders. */
const SHADOW_BACKLOGS = ["TODO.md", "TASKS.md", "BACKLOG.md", "ROADMAP.md"];

function localChecks(repoRoot: string, version: string): Violation[] {
  const out: Violation[] = [];

  // PM100 — vendored doctrine drift.
  const drift = detectDrift(repoRoot, version);
  if (drift.vendored) {
    if (drift.versionMismatch) {
      out.push({
        rule: "PM100", severity: "warn", section: "—", file: `${VENDOR_DIR}/manifest.json`,
        message: `Vendored doctrine is v${drift.vendoredVersion} but the installed package is v${version}. Your agents are reading stale rules.`,
        fix: "npx @hoodiecollin/pm-playbook init",
      });
    }
    for (const f of drift.missing) {
      out.push({
        rule: "PM100", severity: "warn", section: "—", file: `${VENDOR_DIR}/${f}`,
        message: "Vendored file is missing but recorded in the manifest.",
        fix: "npx @hoodiecollin/pm-playbook init",
      });
    }
    for (const f of drift.modified) {
      out.push({
        rule: "PM100", severity: "warn", section: "—", file: `${VENDOR_DIR}/${f}`,
        message: "Vendored file was edited locally; it no longer matches the packaged doctrine.",
        fix: "Revert it, or re-run `npx @hoodiecollin/pm-playbook init --force` to take the packaged version.",
      });
    }
  }

  // PM101 — agent instruction wiring. Absent vendoring means `init` was never run at all; that is
  // reported once as a missing default rather than as noise across every known agent file.
  const agentFiles = [...new Set([DEFAULT_AGENT_FILE, ...detectAgentFiles(repoRoot)])];
  for (const file of agentFiles) {
    const status = stanzaStatus(repoRoot, file, version);
    if (status === "current") continue;
    out.push({
      rule: "PM101", severity: "warn", section: "—", file,
      message:
        status === "absent"
          ? `${file} has no pm-playbook stanza — agents reading it will not know the model exists.`
          : `${file} carries a stanza from a different version.`,
      fix: `npx @hoodiecollin/pm-playbook init --agent-files ${file}`,
    });
  }

  // PM103 — a MAJOR upgrade renamed or retired labels and the repo's GitHub is still on the old
  // taxonomy. Distinct from PM100 because the fix is a GitHub mutation, not another `init`.
  for (const m of pendingForRepo(repoRoot, version)) {
    out.push({
      rule: "PM103", severity: "warn", section: "—", file: `${VENDOR_DIR}/manifest.json`,
      message: `Label migration for v${m.version} has not been applied: ${m.summary}`,
      fix: "npx @hoodiecollin/pm-playbook migrate        # preview, then re-run with --yes",
    });
  }

  // PM104 — conflict drafts that nobody has resolved. A gitignored directory quietly accumulating
  // abandoned edits is the §11 failure the whole feature is built to avoid, arrived at by accretion.
  const conflicts = listConflicts(backlogRoot(repoRoot));
  if (conflicts.length) {
    out.push({
      rule: "PM104", severity: "warn", section: "§11", file: `${VENDOR_DIR}/${BACKLOG_DIR}/conflicts`,
      message: `${conflicts.length} unresolved conflict draft(s): ${conflicts.join(", ")}. Each is a local edit that lost a race and is waiting on a decision.`,
      fix: "Re-apply each edit to the current issue and delete the draft, or delete it if it is no longer wanted.",
    });
  }

  // PM102 — a markdown shadow backlog.
  for (const name of SHADOW_BACKLOGS) {
    if (!existsSync(join(repoRoot, name))) continue;
    out.push({
      rule: "PM102", severity: "warn", section: "§11", file: name,
      message: `${name} looks like a shadow backlog. Issues are the backlog; a markdown list is a second source of truth that drifts.`,
      fix: `Move its live entries to issues (\`gh issue create\`) and delete ${name}. Derived, generated roadmaps are fine — mark them generated, or materialize the real backlog with \`pm-playbook pull\`.`,
    });
  }

  return out;
}

export async function check(args: Args, repoRoot: string): Promise<number> {
  const version = packageVersion();
  const json = bool(args, "json");
  const noRemote = bool(args, "no-remote");
  const warnAsError = bool(args, "strict");
  const state = bool(args, "all-states") ? "all" : "open";

  const violations: Violation[] = localChecks(repoRoot, version);
  let repo: string | null = null;
  let scanned = 0;
  const notes: string[] = [];

  /*
   * Offline, the materialized backlog stands in for the network.
   *
   * This is what the whole feature buys: `--no-remote` used to skip every issue-level invariant,
   * so a sandbox or an air-gapped CI job could only lint doctrine wiring. With a snapshot it lints
   * the real backlog — and PM105 becomes checkable at all, since parentage is only knowable here.
   *
   * The default path stays network-authoritative on purpose: linting a snapshot that might be
   * hours stale, when GitHub is reachable, would trade one drift class for another.
   */
  if (noRemote) {
    const root = backlogRoot(repoRoot);
    const entities = readTree(root);
    if (entities.size) {
      repo = readIndexRepo(root);
      scanned = entities.size;
      const issues = [...entities.values()].map((e) => ({
        number: e.number,
        title: e.title,
        state: e.state,
        url: `https://github.com/${repo ?? "unknown/unknown"}/issues/${e.number}`,
        labels: e.labels,
        milestone: e.milestone,
      }));
      const parentOf = new Map(
        [...entities.values()].filter((e) => e.parent !== null).map((e) => [e.number, e.parent!]),
      );
      violations.push(...checkIssues(issues, null, parentOf));
      notes.push(`Linted the materialized backlog at ${VENDOR_DIR}/${BACKLOG_DIR} — run \`pull\` if it may be stale.`);
    }
  }

  if (!noRemote) {
    repo = str(args, "repo") ?? (await detectRepo(repoRoot));
    if (!repo) {
      if (!json) {
        console.error("ERROR: could not determine the repository.");
        console.error("  Pass --repo owner/name, or run inside a GitHub repo, or use --no-remote.");
      }
      return 2;
    }
    try {
      await requireGh();
      const issues = await listIssues(repo, state);
      scanned = issues.length;
      const counts = await epicSubIssueCounts(repo);
      if (counts === null) notes.push("PM007 skipped: sub-issue counts unavailable (schema or token scope).");
      violations.push(...checkIssues(issues, counts));
    } catch (err) {
      if (!json) console.error(`ERROR: ${(err as Error).message}`);
      return 2;
    }
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warn");
  const failed = errors.length > 0 || (warnAsError && warnings.length > 0);

  if (json) {
    console.log(JSON.stringify({
      ok: !failed,
      version,
      repo,
      issuesScanned: scanned,
      counts: { error: errors.length, warn: warnings.length },
      notes,
      violations,
      rules: RULES,
    }, null, 2));
    return failed ? 1 : 0;
  }

  // Human output — grouped by severity, each violation carrying its executable fix.
  console.log(`pm-playbook check v${version}${repo ? ` — ${repo}` : ""}${noRemote ? " (local only)" : ""}`);
  if (scanned) console.log(`Scanned ${scanned} ${state === "all" ? "" : "open "}issue(s).`);
  console.log("");

  for (const group of [errors, warnings]) {
    for (const v of group) {
      const icon = v.severity === "error" ? "✗" : "!";
      const where = v.issue ? `#${v.issue.number} ${v.issue.title}` : v.file ?? "";
      console.log(`${icon} ${v.rule} ${v.section !== "—" ? `(${v.section}) ` : ""}${where}`);
      console.log(`    ${v.message}`);
      console.log(`    fix: ${v.fix}`);
      if (v.issue) console.log(`    ${v.issue.url}`);
      console.log("");
    }
  }

  for (const n of notes) console.log(`note: ${n}`);

  if (!violations.length) {
    console.log("✓ No violations.");
    return 0;
  }
  console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  if (!failed) console.log("Warnings do not fail the run; use --strict to treat them as errors.");
  return failed ? 1 : 0;
}
