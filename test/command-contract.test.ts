/**
 * The exit-code convention, asserted across every command in scope.
 *
 * `--json` and the exit code together are the agent-facing interface, and the convention below was
 * read off the existing commands rather than invented:
 *
 *   0  the command ran and the answer is yes / nothing to do
 *   1  the command ran and the answer is NO — violations, conflicts, a gated milestone
 *   2  the command could not run — usage error, no repository, no base snapshot
 *
 * This file needs no fake at all: every case here fails before reaching the network. That makes it
 * the broadest coverage per line in the suite, and it pins the convention before any behavior test
 * relies on it.
 *
 * `init` and `bootstrap` are out of scope by design (#47): `init` writes real files across a repo
 * and `bootstrap` provisions GitHub state, and neither is where the exit-code risk sits.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseArgs } from "../src/lib/args.js";
import { backlogRoot } from "../src/lib/backlog/store.js";
import { renderDraft } from "../src/lib/backlog/draft.js";
import { BODY_FILE, NEW_DIR } from "../src/lib/backlog/paths.js";
import { tempRepoRoot } from "./support/repo.js";

import { check } from "../src/commands/check.js";
import { comment } from "../src/commands/comment.js";
import { create } from "../src/commands/create.js";
import { ladder } from "../src/commands/ladder.js";
import { materialize } from "../src/commands/materialize.js";
import { migrate } from "../src/commands/migrate.js";
import { pull } from "../src/commands/pull.js";
import { push } from "../src/commands/push.js";
import { releaseCheck } from "../src/commands/release-check.js";
import { scopeCheck } from "../src/commands/scope-check.js";

/**
 * `--repo ""` is what makes this fake-free: every command treats an empty repository string as
 * undetectable and returns before it would shell out to `gh`.
 */
const undetectable = ["--repo", ""];

const COMMANDS: [string, (root: string) => Promise<number>][] = [
  ["check", (root) => check(parseArgs(undetectable), root)],
  ["comment", (root) => comment(parseArgs(undetectable), root, "1")],
  ["ladder", (root) => ladder(parseArgs(undetectable), root)],
  ["materialize", (root) => materialize(parseArgs(undetectable), root)],
  ["migrate", (root) => migrate(parseArgs(undetectable), root)],
  ["pull", (root) => pull(parseArgs(undetectable), root)],
  ["push", (root) => push(parseArgs(undetectable), root)],
  ["release-check", (root) => releaseCheck(parseArgs(undetectable), root, "v1.0.0")],
  ["scope-check", (root) => scopeCheck(parseArgs(undetectable), root, "1")],
];

describe("exit code 2 — the command could not run", () => {
  for (const [name, invoke] of COMMANDS) {
    test(`${name} returns 2 when the repository cannot be determined`, async () => {
      expect(await invoke(tempRepoRoot())).toBe(2);
    });
  }
});

/*
 * `create` is deliberately not in the loop above. It reads the draft directory before it ever looks
 * for a repository, so with no drafts it returns 0 — and that is the convention working, not a hole
 * in it: "nothing to do" is an answer, not a failure to run.
 */
describe("exit code — create resolves its own preconditions first", () => {
  test("no drafts is 0, not 2 — nothing to do is an answer", async () => {
    expect(await create(parseArgs(undetectable), tempRepoRoot())).toBe(0);
  });

  test("a draft with no label/milestone tables is 2 — it cannot validate offline", async () => {
    const root = tempRepoRoot();
    const path = join(backlogRoot(root), NEW_DIR, "a-draft", BODY_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      renderDraft({
        slug: "a-draft", title: "A draft", kind: "standalone",
        labels: ["improvement"], milestone: null, body: "text", number: null, children: [],
      }),
      { encoding: "utf8" },
    );
    expect(await create(parseArgs(undetectable), root)).toBe(2);
  });
});

describe("exit code 2 — missing required arguments", () => {
  test("release-check without a milestone returns 2", async () => {
    expect(await releaseCheck(parseArgs([]), tempRepoRoot(), undefined)).toBe(2);
  });
  test("scope-check without a PR returns 2", async () => {
    expect(await scopeCheck(parseArgs([]), tempRepoRoot(), undefined)).toBe(2);
  });
  test("comment without a target returns 2", async () => {
    expect(await comment(parseArgs([]), tempRepoRoot(), undefined)).toBe(2);
  });
});

describe("exit code 2 — push refuses without a base it can trust", () => {
  test("no base snapshot returns 2, naming pull as the remedy", async () => {
    const errors: string[] = [];
    const err = console.error;
    console.error = (s: string) => void errors.push(String(s));
    try {
      expect(await push(parseArgs(["--repo", "owner/repo"]), tempRepoRoot())).toBe(2);
    } finally {
      console.error = err;
    }
    expect(errors.join("\n")).toContain("pull");
  });
});
