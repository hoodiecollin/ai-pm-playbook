/**
 * `pm-playbook comment <issue> --body-file <path>` — post a new comment, then re-materialize.
 *
 * The mirror is otherwise read-only in one direction: an agent can read a whole thread and cannot
 * reply to it. Gate acceptances, review answers and evidence all live in comments (§9.6), so the
 * thing the doctrine asks for most often was the one thing the tool could not do.
 *
 * **This is not sugar over `gh issue comment`.** Commenting on an issue that has an unpushed local
 * body edit moves the remote projection, so the next `pull` classifies it as a conflict, sets the
 * edit aside under `conflicts/`, and restores remote truth over it — the author's work demoted by
 * their own comment, down a path indistinguishable from a teammate's race. Nothing outside the
 * mirror can see that coming. The refusal that prevents it is the reason this command exists.
 *
 * Every refusal is decided by `planComment`, which is pure and tested; this file reads a file,
 * prints, and calls it.
 */

import { readFileSync } from "node:fs";

import { addComment, detectRepo, fetchBacklog, requireGh } from "../lib/gh.js";
import { ancestorsOf, backlogRoot, readIndex, readTree } from "../lib/backlog/store.js";
import { planComment, type CommentRefusal } from "../lib/backlog/plan.js";
import { entityDir } from "../lib/backlog/paths.js";
import { bool, str, type Args } from "../lib/args.js";
import { pull } from "./pull.js";

/** What each refusal means and what to do about it. Exit 2 is "unusable input"; 1 is "state says no". */
const REFUSALS: Record<CommentRefusal, { code: 1 | 2; message: string; fix: string }> = {
  "no-base": {
    code: 2,
    message: "no base snapshot — nothing to check this against.",
    fix: "Run `pm-playbook pull` first.",
  },
  unknown: {
    code: 2,
    message: "that issue has never been pulled, so it refers to nothing we know.",
    fix: "Check the number, then run `pm-playbook pull` if it is new.",
  },
  gone: {
    code: 1,
    message: "that issue is in the base snapshot but gone from the remote — deleted or transferred.",
    fix: "Run `pm-playbook pull` to reconcile.",
  },
  "remote-moved": {
    code: 1,
    message: "the issue moved since your last pull — most often, someone else commented.",
    fix: "Run `pm-playbook pull` and re-read the thread before replying.",
  },
  "local-pending": {
    code: 1,
    message:
      "that issue has a local edit you have not pushed.\n" +
      "  Commenting would move the remote, and the next `pull` would then see both sides moved —\n" +
      "  filing your edit as a conflict under conflicts/ and restoring remote truth over it.",
    fix: "Run `pm-playbook push` to send the edit, or revert it, then comment.",
  },
};

export async function comment(args: Args, repoRoot: string, target?: string): Promise<number> {
  const apply = bool(args, "yes");
  const json = bool(args, "json");

  const issue = Number(target);
  if (!target || !Number.isInteger(issue) || issue <= 0) {
    console.error("ERROR: which issue? Usage: pm-playbook comment <issue> --body-file <path>");
    return 2;
  }

  /*
   * `--body-file` with nothing after it parses as the boolean `true` (`args.ts`), so a missing path
   * and a malformed flag land here together. Naming the flag is more useful than "file not found".
   */
  const bodyFile = str(args, "body-file");
  if (!bodyFile) {
    console.error("ERROR: --body-file <path> is required.");
    console.error("  Bodies travel by file, never by argument — they exceed argv limits and contain");
    console.error("  everything that mangles a shell.");
    return 2;
  }

  let body: string;
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    console.error(`ERROR: could not read ${bodyFile}.`);
    return 2;
  }

  // Trimmed only to decide emptiness; what gets posted is the file as written.
  if (!body.trim()) {
    console.error(`ERROR: ${bodyFile} is empty.`);
    return 2;
  }

  await requireGh();
  const repo = str(args, "repo") ?? (await detectRepo(repoRoot));
  if (!repo) {
    console.error("ERROR: could not determine the repository.");
    console.error("  Pass --repo owner/name, or run inside a GitHub repo.");
    return 2;
  }

  const root = backlogRoot(repoRoot);
  const base = readIndex(root);
  const local = readTree(root);
  const remote = new Map((await fetchBacklog(repo)).map((e) => [e.number, e]));

  const plan = planComment(base, local, remote, issue);

  if (!plan.ok) {
    const { code, message, fix } = REFUSALS[plan.refusal];
    if (json) {
      console.log(JSON.stringify({ repo, issue, refusal: plan.refusal, applied: false }, null, 2));
    } else {
      console.error(`✗ #${issue} — ${message}`);
      console.error(`  fix: ${fix}`);
      console.error("\nNothing was posted.");
    }
    return code;
  }

  /*
   * The DIRECTORY, never a filename. The id is GitHub's to assign, and the ordinal that would name
   * the file is a property of the finished thread (`paths.ts`) — so the file this creates cannot be
   * named until after it exists.
   */
  const dir = entityDir(plan.target, ancestorsOf(plan.target, remote));

  if (json) {
    console.log(JSON.stringify({
      repo, issue, title: plan.target.title, dir, applied: apply,
    }, null, 2));
  } else {
    console.log(`${apply ? "" : "[preview] "}comment ${repo}#${issue}`);
    console.log(`  ${plan.target.title}`);
    console.log(`  → ${dir}/`);
    console.log(`\n${body.trimEnd()}\n`);
  }

  if (!apply) {
    if (!json) console.log("Preview only. Re-run with --yes to post.");
    return 0;
  }

  const id = await addComment(repo, issue, body);
  if (!json) console.log(`✓ posted${id === null ? "" : ` (comment ${id})`}. Materializing…`);

  // A full pull, as `create` does. It never destroys — a refused edit is set aside, not lost — so
  // this changes *when* an unrelated conflict surfaces, never *whether* it does.
  return pull({ _: [], flags: { repo } }, repoRoot);
}
