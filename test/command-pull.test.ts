/**
 * `pull` — the proving case for the harness, and the command with the most to lose.
 *
 * It is first because it touches five faked reads, writes a whole tree, and returns an exit code
 * that no human would notice being wrong. Scenarios 1–3 of the plan are harness properties rather
 * than `pull` properties; they live here because this is the file that installs the fake.
 */

import { describe, expect, test } from "bun:test";

import * as realGh from "../src/lib/gh.js";
import { installFakeGh } from "./support/fake-gh.js";
import { entity, seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { pull } from "../src/commands/pull.js";
import { readIndex, readTree, backlogRoot } from "../src/lib/backlog/store.js";

const gh = installFakeGh();

const run = (argv: string[], root: string) => pull(parseArgs(argv), root);

describe("the fake itself", () => {
  test("leaves un-overridden exports real, so a leak is a no-op rather than a crash", () => {
    // Scenario 3. `toBacklogEntity` is pure and tested elsewhere against node shapes; the command
    // fake must not replace it, or `backlog-fetch.test.ts` fails for reasons unrelated to itself.
    expect(typeof realGh.toBacklogEntity).toBe("function");
    expect(typeof realGh.toParentage).toBe("function");
  });
});

describe("pull — usage", () => {
  test("returns 2 when the repository cannot be determined", async () => {
    gh.reset();
    gh.set({ repo: null });
    expect(await run([], tempRepoRoot())).toBe(2);
    gh.set({ repo: "owner/repo" });
  });
});

describe("pull — dry run", () => {
  test("returns 0 and writes nothing", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = [entity({ number: 1, title: "one" })];
    gh.set({ backlog: remote });

    expect(await run(["--dry-run", "--repo", "owner/repo"], root)).toBe(0);
    expect(readTree(backlogRoot(root)).size).toBe(0);
    expect(readIndex(backlogRoot(root)).size).toBe(0);
  });

  test("--json reports the plan and still writes nothing", async () => {
    gh.reset();
    const root = tempRepoRoot();
    gh.set({ backlog: [entity({ number: 7 })] });

    const printed: string[] = [];
    const log = console.log;
    console.log = (s: string) => void printed.push(s);
    try {
      expect(await run(["--dry-run", "--json", "--repo", "owner/repo"], root)).toBe(0);
    } finally {
      console.log = log;
    }

    const report = JSON.parse(printed.join("\n"));
    expect(report.pull).toEqual([7]);
    expect(readTree(backlogRoot(root)).size).toBe(0);
  });
});

describe("pull — writing", () => {
  test("materializes the remote and records a base", async () => {
    gh.reset();
    const root = tempRepoRoot();
    gh.set({
      backlog: [entity({ number: 1, title: "one" }), entity({ number: 2, title: "two" })],
      labels: ["improvement"],
      milestones: [{ number: 1, title: "v1.0.0", state: "open" }],
    });

    expect(await run(["--repo", "owner/repo"], root)).toBe(0);

    const tree = readTree(backlogRoot(root));
    expect([...tree.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    // The base is written LAST by `pull`; its absence is what forces a clean re-pull.
    expect(readIndex(backlogRoot(root)).size).toBe(2);
  });

  test("an entity gone from the remote is removed locally, not pushed back", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const both = [entity({ number: 1 }), entity({ number: 2 })];
    seedBacklog(root, both, { base: "match" });

    gh.set({ backlog: [both[0]!] });
    expect(await run(["--repo", "owner/repo"], root)).toBe(0);

    expect([...readTree(backlogRoot(root)).keys()]).toEqual([1]);
  });

  test("a local edit with an unmoved remote survives the write", async () => {
    gh.reset();
    const root = tempRepoRoot();
    const remote = entity({ number: 1, body: "remote text" });
    const edited = { ...remote, body: "my pending edit" };
    // Base equals the REMOTE, tree holds the edit: that is a pending push.
    seedBacklog(root, [edited], { base: [remote] });

    gh.set({ backlog: [remote] });
    expect(await run(["--repo", "owner/repo"], root)).toBe(0);

    expect(readTree(backlogRoot(root)).get(1)!.body).toBe("my pending edit");
  });
});
