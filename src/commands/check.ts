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
import { VENDOR_DIR, detectDrift } from "../lib/vendor.js";
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
        fix: "npx ai-pm-playbook init",
      });
    }
    for (const f of drift.missing) {
      out.push({
        rule: "PM100", severity: "warn", section: "—", file: `${VENDOR_DIR}/${f}`,
        message: "Vendored file is missing but recorded in the manifest.",
        fix: "npx ai-pm-playbook init",
      });
    }
    for (const f of drift.modified) {
      out.push({
        rule: "PM100", severity: "warn", section: "—", file: `${VENDOR_DIR}/${f}`,
        message: "Vendored file was edited locally; it no longer matches the packaged doctrine.",
        fix: "Revert it, or re-run `npx ai-pm-playbook init --force` to take the packaged version.",
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
      fix: `npx ai-pm-playbook init --agent-files ${file}`,
    });
  }

  // PM102 — a markdown shadow backlog.
  for (const name of SHADOW_BACKLOGS) {
    if (!existsSync(join(repoRoot, name))) continue;
    out.push({
      rule: "PM102", severity: "warn", section: "§11", file: name,
      message: `${name} looks like a shadow backlog. Issues are the backlog; a markdown list is a second source of truth that drifts.`,
      fix: `Move its live entries to issues (\`gh issue create\`) and delete ${name}. Derived, generated roadmaps are fine — mark them generated.`,
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
