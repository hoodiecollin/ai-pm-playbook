#!/usr/bin/env bun
/**
 * bootstrap-pm.ts — provision the Roadmap Playbook PM model on a repo + GitHub Project.
 *
 * The model has TWO axes and nothing else: Milestone (when) + Labels (what/maturity), with epics
 * decomposed via native sub-issues. There are NO Priority/Size/Workstream custom fields — this
 * script does not create them, and if you are migrating a board that has them you should DELETE
 * them (and any view that depends on them) by hand. See PLAYBOOK.md.
 *
 * Idempotent: safe to re-run. Creates/updates the canonical labels (with descriptions), a starter
 * milestone, and — if a project number is given — the label-driven filtered views. Grouped boards
 * (by Milestone / Surface / Status) are created ungrouped; set their group-by once in the UI
 * (grouping is not scriptable).
 *
 * Requirements:
 *   - Bun (https://bun.sh) and the `gh` CLI, authenticated.
 *   - The gh token needs the `project` scope for the view steps:
 *       gh auth refresh -s project,read:project
 *   - Assumes a USER-owned project (`/users/<owner>/projectsV2/<n>`). For org projects, swap the
 *     REST path prefix to `orgs/<owner>`.
 *
 * Usage:
 *   bun scripts/bootstrap-pm.ts --repo owner/name [options]
 *
 * Options:
 *   --repo owner/name          (required) target repository
 *   --project <number>         ProjectV2 number to add views to (skip to do labels/milestone only)
 *   --owner <login>            project owner login (defaults to the repo owner)
 *   --surfaces "core,website"  create surface:* labels for a multi-artifact repo. Omit to skip.
 *                              (A surface = an independently shippable product face. CI is NOT a
 *                               surface.)
 *   --milestone v0.1.0         starter milestone title (default: none)
 *   --dry-run                  print what would happen; make no changes
 *
 * Example (multi-artifact repo):
 *   bun scripts/bootstrap-pm.ts --repo hoodiecollin/forgedb --project 3 \
 *     --surfaces "core,ide-extension,website" --milestone v0.4.0
 */

import { $ } from "bun";

// ---------------------------------------------------------------------------
// Canonical data (edit here — this is the single source of truth for the script)
// ---------------------------------------------------------------------------

/** The "what / maturity" axis. Descriptions ARE the process; copy verbatim. */
const MATURITY_LABELS: { name: string; color: string; description: string }[] = [
  { name: "idea", color: "c5def5", description: "Speculative feature idea; needs a design note before implementation." },
  { name: "plan-next", color: "0e8a16", description: "Committed but not yet scheduled to a version milestone (milestone = scheduled)." },
  { name: "rfc", color: "5319e7", description: "Request for comment: design captured as an issue (proposals no longer committed to the repo)." },
  { name: "experiment", color: "a2eeef", description: "A spike to measure; deliverable is a decision, not a shippable artifact. Never milestoned." },
  { name: "epic", color: "6f42c1", description: "Umbrella tracking issue; decomposes via native sub-issues." },
  { name: "tech-debt", color: "fbca04", description: "Known gap or stub in shipped code." },
  { name: "perf", color: "d93f0b", description: "Performance cost / triage item." },
  { name: "config", color: "1d76db", description: "Configurable-runtime-behavior work." },
  { name: "legacy-audit", color: "5319e7", description: "Legacy audit: prune dead / product-misaligned code." },
  { name: "release-gate", color: "b60205", description: "Blocks the tag: this milestone cannot be released until it is closed." },
];

/**
 * Views. The label invariants (PLAYBOOK §3.2) make each derived bucket a one-line filter.
 * `layout` is "table" or "board". `group` is documentation-only (grouping isn't scriptable).
 */
const VIEWS: { name: string; layout: "table" | "board"; filter?: string; group?: string }[] = [
  { name: "Everything", layout: "table" },
  { name: "Epics", layout: "table", filter: "label:epic" },
  { name: "Planned", layout: "table", filter: "label:plan-next" },
  { name: "Labs", layout: "table", filter: "label:experiment,rfc" },
  { name: "Ideas", layout: "table", filter: "label:idea" },
  // "Can we tag?" — an open row here means the milestone it names is blocked (PLAYBOOK §5.2).
  { name: "Release gates", layout: "table", filter: "label:release-gate is:open" },
  { name: "Release spine", layout: "board", group: "Milestone" },
  { name: "Execution", layout: "board", group: "Status" },
  { name: "Surface Board", layout: "board", group: "surface:* label (multi-artifact repos only)" },
];

const SURFACE_COLORS: Record<string, string> = {
  "ide-extension": "007ACC",
  website: "1d76db",
  cli: "1d76db",
  sdk: "1d76db",
  core: "1d76db",
};

const API_VERSION = "2022-11-28"; // project REST calls silently 404 without this header.

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const REPO = (args.repo as string | undefined) ?? "";
const DRY = Boolean(args["dry-run"]);
const PROJECT = args.project ? String(args.project) : undefined;

if (!REPO.includes("/")) {
  console.error("ERROR: --repo owner/name is required. See the usage header in this file.");
  process.exit(1);
}
const [REPO_OWNER] = REPO.split("/");
const PROJECT_OWNER = (args.owner as string) || REPO_OWNER;

const tag = DRY ? "[dry-run] " : "";
function log(msg: string) {
  console.log(tag + msg);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function ensureLabels() {
  console.log("\n=== Labels ===");
  const surfaces = args.surfaces
    ? String(args.surfaces).split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];
  const surfaceLabels = surfaces.map((s: string) => ({
    name: `surface:${s}`,
    color: SURFACE_COLORS[s] ?? "1d76db",
    description: `Product surface: ${s}.`,
  }));

  for (const l of [...MATURITY_LABELS, ...surfaceLabels]) {
    log(`label ${l.name.padEnd(18)} #${l.color}  ${l.description}`);
    if (DRY) continue;
    // --force updates an existing label in place → idempotent.
    await $`gh label create ${l.name} --repo ${REPO} --color ${l.color} --description ${l.description} --force`;
  }
}

async function ensureMilestone() {
  const title = args.milestone as string | undefined;
  if (!title) return;
  console.log("\n=== Milestone ===");
  const body =
    `Version release. Issues close into this milestone until it is tagged; on the roadmap ` +
    `they read as 'pending release' until the ${title} GitHub Release exists.`;
  log(`milestone ${title}`);
  if (DRY) return;

  const existing = await $`gh api repos/${REPO}/milestones --jq ${".[].title"}`.text();
  if (existing.split("\n").map((s: string) => s.trim()).includes(title)) {
    log(`milestone ${title} already exists — skipping`);
    return;
  }
  await $`gh api repos/${REPO}/milestones -f title=${title} -f description=${body}`.quiet();
  log(`created milestone ${title}`);
}

async function ensureViews() {
  if (!PROJECT) {
    console.log("\n=== Views === (skipped: no --project given)");
    return;
  }
  console.log("\n=== Project views ===");

  // Existing view names (idempotency guard).
  let existing: Set<string> = new Set();
  if (!DRY) {
    try {
      const q = `query{user(login:"${PROJECT_OWNER}"){projectV2(number:${PROJECT}){views(first:50){nodes{name}}}}}`;
      const raw = await $`gh api graphql -f query=${q}`.text();
      const nodes = JSON.parse(raw)?.data?.user?.projectV2?.views?.nodes ?? [];
      existing = new Set(nodes.map((n: { name: string }) => n.name));
    } catch {
      log("could not read existing views (continuing; creates are attempted defensively)");
    }
  }

  const path = `users/${PROJECT_OWNER}/projectsV2/${PROJECT}/views`;
  const manual: string[] = [];

  for (const v of VIEWS) {
    const detail = v.filter ? `filter: ${v.filter}` : v.group ? `group by: ${v.group} (set in UI)` : "no filter";
    if (existing.has(v.name)) {
      log(`view ${v.name} already exists — skipping`);
      if (v.group) manual.push(`${v.name} → group by ${v.group}`);
      continue;
    }
    log(`view ${v.name.padEnd(16)} [${v.layout}]  ${detail}`);
    if (v.group) manual.push(`${v.name} → group by ${v.group}`);
    if (DRY) continue;

    // REST projectsV2 views is create-only and needs the api-version header or it 404s.
    // Defensive: on any failure, fall back to a printed instruction so nothing is lost.
    const flags = ["--method", "POST", path, "-H", `X-GitHub-Api-Version: ${API_VERSION}`,
      "-f", `name=${v.name}`, "-f", `layout=${v.layout}`];
    if (v.filter) flags.push("-f", `filter=${v.filter}`);
    const res = await $`gh api ${flags}`.nothrow().quiet();
    if (res.exitCode !== 0) {
      manual.push(`${v.name} [${v.layout}]  ${detail}  (create failed — add manually)`);
      log(`  ⚠️  could not create "${v.name}" via API — see manual list below`);
    }
  }

  if (manual.length) {
    console.log("\n  Finish in the UI (grouping isn't scriptable; plus any failed creates):");
    for (const m of manual) console.log(`    • ${m}`);
  }
}

function printClosing() {
  console.log("\nDone. Reminders:");
  console.log("  • This model has NO Priority/Size/Workstream fields. If the board has them,");
  console.log("    DELETE those fields and any view that filters/groups by them.");
  console.log("  • Enforce the label invariants (PLAYBOOK §3.2): plan-next ⊕ milestone;");
  console.log("    idea ⊕ plan-next; experiment ⊕ {idea, plan-next, milestone}.");
  console.log("  • gh gotcha: `gh issue edit --milestone` only resolves OPEN milestones. For a");
  console.log("    closed one, PATCH by number: gh api -X PATCH repos/O/R/issues/N -F milestone=<num>");
  console.log("  • See PLAYBOOK.md for the full model.");
}

// ---------------------------------------------------------------------------

await ensureLabels();
await ensureMilestone();
await ensureViews();
printClosing();
