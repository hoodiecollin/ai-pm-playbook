/**
 * `pm-playbook bootstrap` — provision the model on a repo + GitHub Project.
 *
 * Idempotent: safe to re-run. Creates/updates the canonical labels (with their descriptions, which
 * ARE the process), an optional starter milestone, and the label-driven filtered views.
 *
 * The model has TWO axes and nothing else, so this script never creates Priority/Size/Workstream
 * fields. If you are migrating a board that has them, delete them by hand — see PLAYBOOK §8.
 *
 * Requires the `gh` CLI, authenticated. Project views additionally need the `project` scope:
 *   gh auth refresh -s project,read:project
 */

import { CORE_LABELS, MAX_LABEL_DESCRIPTION, VIEWS, surfaceLabel } from "../lib/model.js";
import { ownerType, requireGh } from "../lib/gh.js";
import { run, tryRun } from "../lib/sh.js";
import { bool, list, str, type Args } from "../lib/args.js";

const API_VERSION = "2022-11-28"; // project REST calls silently 404 without this header.

export async function bootstrap(args: Args, repoArg?: string): Promise<number> {
  const repo = repoArg ?? str(args, "repo");
  if (!repo || !repo.includes("/")) {
    console.error("ERROR: --repo owner/name is required.");
    return 2;
  }

  const dry = bool(args, "dry-run");
  const tag = dry ? "[dry-run] " : "";
  const project = str(args, "project");
  const repoOwner = repo.split("/")[0]!;
  const projectOwner = str(args, "owner") ?? repoOwner;

  await requireGh();

  // --- Labels --------------------------------------------------------------
  console.log("\n=== Labels ===");
  const surfaces = list(args, "surfaces") ?? [];
  const labels = [...CORE_LABELS, ...surfaces.map(surfaceLabel)];

  /*
   * A label that fails to write leaves the repo half-provisioned, and every downstream check reads
   * a missing label as "nothing is labelled that way" rather than "the label was never created".
   * So failures are counted and returned as a non-zero exit rather than warned past — §5.5: a
   * report is not a gate, and CI only notices what changes the exit code.
   */
  let failed = 0;

  for (const l of labels) {
    console.log(`${tag}label ${l.name.padEnd(18)} #${l.color}  ${l.description}`);
    // Caught here rather than at the API, because GitHub rejects an over-long description with an
    // opaque 422 and the name of the offending field is the only useful part of the message.
    if (l.description.length > MAX_LABEL_DESCRIPTION) {
      console.error(`  ⚠️  ${l.name}: description is ${l.description.length} chars; GitHub's limit is ${MAX_LABEL_DESCRIPTION}.`);
      failed += 1;
      continue;
    }
    if (dry) continue;
    // --force updates an existing label in place → idempotent.
    const res = await tryRun("gh", [
      "label", "create", l.name,
      "--repo", repo,
      "--color", l.color,
      "--description", l.description,
      "--force",
    ]);
    if (!res.ok) {
      console.error(`  ⚠️  failed to write label ${l.name}: ${res.stderr.trim()}`);
      failed += 1;
    }
  }

  // --- Milestone -----------------------------------------------------------
  const milestone = str(args, "milestone");
  if (milestone) {
    console.log("\n=== Milestone ===");
    // §2: this framing is what makes "closed" and "released" distinct rungs. Copy it verbatim.
    const body =
      `Version release. Issues close into this milestone until it is tagged; on the roadmap ` +
      `they read as 'pending release' until the ${milestone} GitHub Release exists.`;
    console.log(`${tag}milestone ${milestone}`);
    if (!dry) {
      const existing = await run("gh", ["api", `repos/${repo}/milestones?state=all`, "--jq", ".[].title"]);
      if (existing.split("\n").map((s) => s.trim()).includes(milestone)) {
        console.log(`  milestone ${milestone} already exists — skipping`);
      } else {
        const res = await tryRun("gh", [
          "api", `repos/${repo}/milestones`,
          "-f", `title=${milestone}`,
          "-f", `description=${body}`,
        ]);
        console.log(res.ok ? `  created milestone ${milestone}` : `  ⚠️  ${res.stderr.trim()}`);
      }
    }
  }

  // --- Project views -------------------------------------------------------
  if (!project) {
    console.log("\n=== Project views === (skipped: no --project given)");
  } else {
    console.log("\n=== Project views ===");
    // A user-vs-org mismatch here returns a bare 404 that reads like a permissions failure.
    const kind = await ownerType(projectOwner);
    console.log(`  owner ${projectOwner} resolved as ${kind === "orgs" ? "organization" : "user"}`);

    let existing = new Set<string>();
    if (!dry) {
      const root = kind === "orgs" ? "organization" : "user";
      const q = `query{${root}(login:"${projectOwner}"){projectV2(number:${project}){views(first:50){nodes{name}}}}}`;
      const res = await tryRun("gh", ["api", "graphql", "-f", `query=${q}`]);
      if (res.ok) {
        try {
          const nodes = JSON.parse(res.stdout)?.data?.[root]?.projectV2?.views?.nodes ?? [];
          existing = new Set(nodes.map((n: { name: string }) => n.name));
        } catch {
          console.log("  could not parse existing views (continuing; creates are attempted defensively)");
        }
      } else {
        console.log("  could not read existing views (continuing; creates are attempted defensively)");
      }
    }

    const path = `${kind}/${projectOwner}/projectsV2/${project}/views`;
    const manual: string[] = [];

    for (const v of VIEWS) {
      const detail = v.filter ? `filter: ${v.filter}` : v.group ? `group by: ${v.group} (set in UI)` : "no filter";
      if (existing.has(v.name)) {
        console.log(`  view ${v.name} already exists — skipping`);
        if (v.group) manual.push(`${v.name} → group by ${v.group}`);
        continue;
      }
      console.log(`${tag}  view ${v.name.padEnd(16)} [${v.layout}]  ${detail}`);
      if (v.group) manual.push(`${v.name} → group by ${v.group}`);
      if (dry) continue;

      const flags = [
        "api", "--method", "POST", path,
        "-H", `X-GitHub-Api-Version: ${API_VERSION}`,
        "-f", `name=${v.name}`,
        "-f", `layout=${v.layout}`,
      ];
      if (v.filter) flags.push("-f", `filter=${v.filter}`);
      const res = await tryRun("gh", flags);
      if (!res.ok) {
        manual.push(`${v.name} [${v.layout}]  ${detail}  (create failed — add manually)`);
        console.log(`    ⚠️  could not create "${v.name}" via API: ${res.stderr.trim().split("\n")[0]}`);
      }
    }

    if (manual.length) {
      console.log("\n  Finish in the UI (grouping isn't scriptable; plus any failed creates):");
      for (const m of manual) console.log(`    • ${m}`);
    }
  }

  console.log("\nReminders:");
  console.log("  • This model has NO Priority/Size/Workstream fields. If the board has them,");
  console.log("    DELETE those fields and any view that filters/groups by them.");
  console.log("  • Enforce the label invariants — `pm-playbook check --repo " + repo + "`.");
  console.log("  • gh gotcha: `gh issue edit --milestone` only resolves OPEN milestones. For a");
  console.log("    closed one, PATCH by number: gh api -X PATCH repos/O/R/issues/N -F milestone=<num>");

  if (failed) {
    console.error(`\n\u2717 ${failed} label(s) could not be written \u2014 this repo is only partly provisioned.`);
    return 1;
  }
  return 0;
}
