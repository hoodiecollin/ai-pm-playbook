/**
 * `pm-playbook migrate` — apply GitHub-side label migrations after a MAJOR upgrade.
 *
 * Labels live in the consumer's repo, so a doctrine release that renames one cannot fix itself:
 * `bootstrap` writes labels by name and would simply add the new one alongside the old, leaving
 * every existing issue on the stale taxonomy. This command closes that gap.
 *
 * It is **preview-first**. Renames are cheap to reverse; merges and removals are not — a removal
 * strips a label off real issues — so nothing is written until `--yes`. That is also why the
 * preview prints the blast radius (which issues carry the label) rather than just a count.
 */

import { MIGRATIONS, pendingMigrations, planMigrations, type LabelAction } from "../lib/migrations.js";
import { readManifest, setMigratedThrough } from "../lib/vendor.js";
import { packageVersion } from "../lib/paths.js";
import {
  deleteLabel, detectRepo, listIssues, listLabels, relabelIssue, renameLabel, requireGh,
} from "../lib/gh.js";
import { bool, str, type Args } from "../lib/args.js";

export async function migrate(args: Args, repoRoot: string): Promise<number> {
  const json = bool(args, "json");
  const apply = bool(args, "yes");
  const installed = packageVersion();

  const manifest = readManifest(repoRoot);
  if (!manifest) {
    console.error("ERROR: this repo has not adopted the playbook yet — run `npx @hoodiecollin/pm-playbook init` first.");
    return 2;
  }

  const from = manifest.migratedThrough ?? manifest.version;
  const pending = pendingMigrations(from, installed, MIGRATIONS);

  if (pending.length === 0) {
    const msg = `No pending label migrations (migrated through v${from}, installed v${installed}).`;
    console.log(json ? JSON.stringify({ ok: true, pending: [], note: msg }, null, 2) : `✓ ${msg}`);
    return 0;
  }

  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  let actions: LabelAction[];
  try {
    await requireGh();
    const [labels, issues] = await Promise.all([listLabels(repo), listIssues(repo, "all")]);
    // Migrations touch closed issues too: history stays queryable, so it stays correct.
    actions = planMigrations(pending, labels, issues.map((i) => ({ number: i.number, labels: i.labels })));
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  const work = actions.filter((a) => a.kind !== "skip");

  if (json) {
    console.log(JSON.stringify({
      ok: true, repo, from, to: installed, applied: apply,
      migrations: pending.map((m) => ({ version: m.version, summary: m.summary })),
      actions,
    }, null, 2));
    if (!apply) return 0;
  } else {
    console.log(`Label migrations — ${repo}`);
    console.log(`Migrated through v${from}; installed v${installed}.\n`);
    for (const m of pending) console.log(`  v${m.version} — ${m.summary}`);
    console.log("");

    for (const a of actions) {
      const n = a.affected.length;
      const scope = n ? `  (${n} issue${n === 1 ? "" : "s"}: ${a.affected.slice(0, 10).join(", ")}${n > 10 ? ", …" : ""})` : "";
      switch (a.kind) {
        case "rename": console.log(`  rename  ${a.from} → ${a.to}${scope}`); break;
        case "merge":  console.log(`  MERGE   ${a.from} → ${a.to} — ${a.reason}${scope}`); break;
        case "remove": console.log(`  REMOVE  ${a.from} — ${a.reason}${scope}`); break;
        case "skip":   console.log(`  skip    ${a.from} — ${a.reason}`); break;
      }
    }
    console.log("");

    if (work.length === 0) {
      console.log("Nothing to do on this repo — recording progress.");
    } else if (!apply) {
      const destructive = work.filter((a) => a.kind !== "rename").length;
      console.log(`${work.length} action(s) to apply${destructive ? `, ${destructive} of them destructive` : ""}.`);
      console.log("This was a preview. Re-run with --yes to apply.");
      return 0;
    }
  }

  // --- Apply ---------------------------------------------------------------
  try {
    for (const a of work) {
      if (a.kind === "rename") {
        console.log(`  renaming ${a.from} → ${a.to}`);
        await renameLabel(repo, a.from, a.to!);
      } else if (a.kind === "merge") {
        for (const n of a.affected) {
          console.log(`  #${n}: ${a.from} → ${a.to}`);
          await relabelIssue(repo, n, a.to!, a.from);
        }
        console.log(`  deleting ${a.from}`);
        await deleteLabel(repo, a.from);
      } else if (a.kind === "remove") {
        console.log(`  deleting ${a.from} (was on ${a.affected.length} issue(s))`);
        await deleteLabel(repo, a.from);
      }
    }
  } catch (err) {
    // Stop at the first failure rather than pressing on: a half-applied rename is recoverable by
    // re-running (the plan is idempotent), but recording success over it would not be.
    console.error(`\nERROR while applying: ${(err as Error).message}`);
    console.error("Progress was NOT recorded. Fix the cause and re-run — the plan is idempotent.");
    return 2;
  }

  setMigratedThrough(repoRoot, installed);
  console.log(`\n✓ Applied. Recorded migratedThrough = v${installed}.`);
  console.log("  Commit the updated .pm-playbook/manifest.json.");

  // Saying this out loud is the point. A migration that reports success while half the upgrade is
  // still owed reads as "done", and the half nobody was told about is the structural half.
  if (work.some((a) => a.from === "rfc" || a.from === "idea" || a.from === "plan-next")) {
    console.log("");
    console.log("LABELS are migrated. The STRUCTURAL half of 2.0 is manual and is not done:");
    console.log("  1. Every work item needs exactly one type label (`improvement` / `bugfix` /");
    console.log("     `experiment`). The merges above typed most of them; `check` names the rest (PM010).");
    console.log("  2. Each former `rfc` issue becomes a gate-1 sub-issue of the work item it designs.");
    console.log("     Nothing can infer that pairing, so it is a read-and-move pass.");
    console.log("  3. Work already on the cycle in flight needs its gate set:");
    console.log("     pm-playbook materialize --yes");
    console.log("");
    console.log("Run `pm-playbook check` — PM010 and PM013 enumerate exactly what is still owed.");
  }
  return 0;
}

/** Exported for `check` (PM103) so the warning and the command agree on what is pending. */
export function pendingForRepo(repoRoot: string, installed: string) {
  const manifest = readManifest(repoRoot);
  if (!manifest) return [];
  return pendingMigrations(manifest.migratedThrough ?? manifest.version, installed, MIGRATIONS);
}
