/**
 * `push` — the command with the most to destroy and the exit code most likely to be read by a
 * script rather than a person.
 *
 * The assertion that matters throughout: a preview sends nothing. "Previewed and posted nothing" is
 * only checkable because the fake remembers what it was asked to do.
 */

import { describe, expect, test } from "bun:test";

import { installFakeGh } from "./support/fake-gh.js";
import { entity, seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { push } from "../src/commands/push.js";

const gh = installFakeGh();

async function silent<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

const run = (argv: string[], root: string) => silent(() => push(parseArgs(["--repo", "owner/repo", ...argv]), root));

describe("push — preview sends nothing", () => {
  test("a pending edit previews as 0 with no mutation", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = entity({ number: 1, title: "as published" });
    const edited = { ...remote, title: "my local edit" };
    seedBacklog(root, [edited], { base: [remote] });
    gh.set({ backlog: [remote] });

    expect(await run([], root)).toBe(0);
    expect(gh.mutations()).toEqual([]);
  });

  test("nothing pending is also 0 with no mutation", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const clean = entity({ number: 1 });
    seedBacklog(root, [clean], { base: "match" });
    gh.set({ backlog: [clean] });

    expect(await run([], root)).toBe(0);
    expect(gh.mutations()).toEqual([]);
  });
});

describe("push --yes — applies", () => {
  test("sends exactly the pending entity", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = entity({ number: 1, title: "as published" });
    const untouched = entity({ number: 2 });
    const edited = { ...remote, title: "my local edit" };
    seedBacklog(root, [edited, untouched], { base: [remote, untouched] });
    gh.set({ backlog: [remote, untouched] });

    expect(await run(["--yes"], root)).toBe(0);

    const sent = gh.callsTo("updateIssue");
    expect(sent).toHaveLength(1);
    expect((sent[0]!.args[1] as { number: number }).number).toBe(1);
  });
});

describe("push — refusals", () => {
  test("a conflict is exit 1 and nothing is sent for it", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const base = entity({ number: 1, title: "base" });
    const mine = { ...base, title: "my edit" };
    const theirs = { ...base, title: "their edit" };
    // Both sides moved away from base: refused, never merged.
    seedBacklog(root, [mine], { base: [base] });
    gh.set({ backlog: [theirs] });

    expect(await run([], root)).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });

  test("a conflict exits 1 even with --yes — a refusal must not read as success", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const base = entity({ number: 1, title: "base" });
    seedBacklog(root, [{ ...base, title: "mine" }], { base: [base] });
    gh.set({ backlog: [{ ...base, title: "theirs" }] });

    expect(await run(["--yes"], root)).toBe(1);
    expect(gh.callsTo("updateIssue")).toEqual([]);
  });

  test("a push that would produce a violation is refused, exit 1, nothing sent", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = entity({ number: 1, labels: ["experiment"], milestone: null });
    // PM003: an experiment never carries a milestone. The edit would introduce the violation.
    const edited = { ...remote, milestone: "v1.0.0" };
    seedBacklog(root, [edited], { base: [remote] });
    gh.set({ backlog: [remote] });

    expect(await run([], root)).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });
});
