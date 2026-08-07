/**
 * `pm-playbook create` — publish drafts that have no issue number yet.
 *
 * This is the only non-idempotent operation in the system and the only one that can duplicate real
 * state, so its ordering is deliberate throughout:
 *
 *   1. Validate everything locally first — labels, milestones, structure, and the full invariant
 *      set — so an unknown label fails before any network call rather than after a half-created epic.
 *   2. Create the epic, then its children.
 *   3. Write the returned number back into the draft *immediately*, before linking. A crash between
 *      creating and linking then leaves a draft that knows it already exists, and a retry
 *      reconciles instead of creating a second copy.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { addSubIssue, createIssue, detectRepo, requireGh } from "../lib/gh.js";
import { backlogRoot, readTable, LABELS_FILE, MILESTONES_FILE } from "../lib/backlog/store.js";
import { creationOrder, readDrafts, renderDraft, validateDrafts, type Draft } from "../lib/backlog/draft.js";
import { BODY_FILE, NEW_DIR } from "../lib/backlog/paths.js";
import { checkIssues } from "../lib/invariants.js";
import { bool, str, type Args } from "../lib/args.js";
import { pull } from "./pull.js";

/** Where a draft's body.md lives, given its slug (which may be `epic/child`). */
function draftBodyPath(root: string, slug: string): string {
  const parts = slug.split("/");
  const nested = parts.length > 1 ? join(parts[0]!, "subissues", ...parts.slice(1)) : parts[0]!;
  return join(root, NEW_DIR, nested, BODY_FILE);
}

export async function create(args: Args, repoRoot: string): Promise<number> {
  const apply = bool(args, "yes");
  const root = backlogRoot(repoRoot);

  let drafts: Draft[];
  try {
    drafts = readDrafts(join(root, NEW_DIR));
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return 2;
  }

  if (!drafts.length) {
    console.log(`No drafts under ${NEW_DIR}/. Create one as ${NEW_DIR}/<slug>/${BODY_FILE}.`);
    return 0;
  }

  const labels = readTable<string[]>(root, LABELS_FILE);
  const milestones = readTable<{ title: string }[]>(root, MILESTONES_FILE);
  if (!labels || !milestones) {
    console.error("ERROR: no label/milestone tables — run `pm-playbook pull` first.");
    console.error("  Drafts are validated offline against those tables before anything is created.");
    return 2;
  }

  const problems = validateDrafts(drafts, labels, milestones.map((m) => m.title));

  /*
   * The invariants run against the drafts too. A draft projects cleanly into an issue, so the same
   * rules that govern the live backlog govern what is about to enter it — a draft carrying both
   * `plan-next` and a milestone fails here rather than becoming a violation to clean up later.
   */
  const order = creationOrder(drafts);
  const projected = order.map(({ draft }, i) => ({
    number: draft.number ?? -(i + 1),
    title: draft.title,
    state: "OPEN",
    url: `(draft ${draft.slug})`,
    labels: draft.labels,
    milestone: draft.milestone,
  }));
  const violations = checkIssues(projected).filter((v) => v.severity === "error");

  if (problems.length || violations.length) {
    console.error(`✗ ${problems.length + violations.length} problem(s). Nothing was created.\n`);
    for (const p of problems) {
      console.error(`  ${p.slug} — ${p.message}`);
      console.error(`    fix: ${p.fix}`);
    }
    for (const v of violations) {
      const slug = order[projected.findIndex((p) => p.number === v.issue?.number)]?.draft.slug ?? "?";
      console.error(`  ${v.rule} ${slug} — ${v.message}`);
      console.error(`    fix: ${v.fix}`);
    }
    return 1;
  }

  await requireGh();
  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository. Pass --repo owner/name.");
    return 2;
  }

  if (!apply) {
    console.log(`[preview] create ${repo}`);
    for (const { draft, parent } of order) {
      const status = draft.number ? `already #${draft.number} — will link only` : "new";
      const where = parent ? ` (sub-issue of ${parent.slug})` : "";
      console.log(`  ${draft.slug}${where} — ${status}`);
      console.log(`      ${draft.title}`);
      if (draft.labels.length) console.log(`      labels: ${draft.labels.join(", ")}`);
      if (draft.milestone) console.log(`      milestone: ${draft.milestone}`);
    }
    console.log("\nPreview only. Re-run with --yes to apply.");
    return 0;
  }

  const created: number[] = [];
  for (const { draft, parent } of order) {
    if (draft.number === null) {
      draft.number = await createIssue(repo, {
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
        milestone: draft.milestone,
      });
      // Before anything else can fail. This is what makes a retry safe.
      writeFileSync(draftBodyPath(root, draft.slug), renderDraft(draft), "utf8");
      created.push(draft.number);
      console.log(`  created #${draft.number} ${draft.title}`);
    } else {
      console.log(`  #${draft.number} already exists — reconciling`);
    }

    if (parent?.number) {
      await addSubIssue(repo, parent.number, draft.number);
      console.log(`      linked under #${parent.number}`);
    }
  }

  // Every draft landed, so the staging area is empty and the tree becomes the record.
  const newDir = join(root, NEW_DIR);
  if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true });

  console.log(`\n✓ ${created.length} issue(s) created. Materializing…`);
  return pull({ _: [], flags: { repo } }, repoRoot);
}
