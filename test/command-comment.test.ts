/**
 * `comment` — five refusals, each with its own exit code, and none of them observable from the
 * output alone if the code is wrong.
 *
 * `local-pending` is the reason the command exists: posting a comment on an issue with an unpushed
 * body edit moves the remote projection, so the next `pull` classifies the issue as a conflict and
 * demotes the author's own edit through a path that looks exactly like a teammate's race.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installFakeGh } from "./support/fake-gh.js";
import { entity, seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { comment } from "../src/commands/comment.js";

const gh = installFakeGh();

const bodyFile = (() => {
  const path = join(mkdtempSync(join(tmpdir(), "pm-comment-")), "body.md");
  writeFileSync(path, "a reply worth posting\n", "utf8");
  return path;
})();

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = () => {};
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const run = (argv: string[], root: string, target = "1") =>
  capture(() => comment(parseArgs(["--repo", "owner/repo", "--body-file", bodyFile, ...argv]), root, target));

describe("comment — argument handling", () => {
  test("a missing --body-file is 2: bodies travel by file, never by argument", async () => {
    const { code } = await capture(() =>
      comment(parseArgs(["--repo", "owner/repo"]), tempRepoRoot(), "1"));
    expect(code).toBe(2);
    expect(gh.mutations()).toEqual([]);
  });

  test("an unreadable body file is 2", async () => {
    const { code } = await capture(() =>
      comment(parseArgs(["--repo", "owner/repo", "--body-file", "/nonexistent/x.md"]), tempRepoRoot(), "1"));
    expect(code).toBe(2);
  });
});

describe("comment — the refusal ladder", () => {
  test("no base snapshot is 2", async () => {
    gh.reset();
    const root = tempRepoRoot();
    gh.set({ backlog: [entity({ number: 1 })] });
    const { code } = await run([], root);
    expect(code).toBe(2);
    expect(gh.mutations()).toEqual([]);
  });

  test("an issue never pulled is 2 — the number refers to nothing we know", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const known = entity({ number: 1 });
    seedBacklog(root, [known], { base: "match" });
    gh.set({ backlog: [known] });

    const { code } = await run([], root, "999");
    expect(code).toBe(2);
    expect(gh.mutations()).toEqual([]);
  });

  test("an issue gone from the remote is 1", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const known = entity({ number: 1 });
    seedBacklog(root, [known], { base: "match" });
    gh.set({ backlog: [] });

    const { code } = await run([], root);
    expect(code).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });

  test("a remote that moved since the last pull is 1 — re-read before you reply", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const base = entity({ number: 1, title: "as pulled" });
    seedBacklog(root, [base], { base: [base] });
    gh.set({ backlog: [{ ...base, title: "someone else edited it" }] });

    const { code } = await run([], root);
    expect(code).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });

  test("an unpushed local body edit is 1 — the comment would demote it", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = entity({ number: 1, body: "as published" });
    seedBacklog(root, [{ ...remote, body: "my unpushed edit" }], { base: [remote] });
    gh.set({ backlog: [remote] });

    const { code } = await run([], root);
    expect(code).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });
});

describe("comment — the happy path", () => {
  test("preview is 0 and posts nothing", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const clean = entity({ number: 1 });
    seedBacklog(root, [clean], { base: "match" });
    gh.set({ backlog: [clean] });

    const { code } = await run([], root);
    expect(code).toBe(0);
    expect(gh.callsTo("addComment")).toEqual([]);
  });

  test("--yes posts exactly once, with the file as written", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const clean = entity({ number: 1 });
    seedBacklog(root, [clean], { base: "match" });
    gh.set({ backlog: [clean] });

    const { code } = await run(["--yes"], root);
    expect(code).toBe(0);

    const posted = gh.callsTo("addComment");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.args[1]).toBe(1);
    expect(posted[0]!.args[2]).toBe("a reply worth posting\n");
  });
});
