/**
 * `create` — the only non-idempotent operation in the system, so its refusals matter more than its
 * happy path.
 *
 * It validates offline first, against the label and milestone tables `pull` recorded, and runs the
 * invariants over the *projected* issues — so a draft that would enter the backlog as a violation
 * is refused before anything is created rather than becoming cleanup later.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { installFakeGh } from "./support/fake-gh.js";
import { seedBacklog, tempRepoRoot } from "./support/repo.js";
import { parseArgs } from "../src/lib/args.js";
import { create } from "../src/commands/create.js";
import { backlogRoot } from "../src/lib/backlog/store.js";
import { renderDraft, type Draft } from "../src/lib/backlog/draft.js";
import { BODY_FILE, NEW_DIR } from "../src/lib/backlog/paths.js";

const gh = installFakeGh();

function draft(partial: Partial<Draft> = {}): Draft {
  return {
    slug: "a-draft", title: "A draft", kind: "standalone",
    labels: ["improvement"], milestone: null, body: "text", number: null, children: [],
    ...partial,
  };
}

/** Seed the tables `create` validates against, plus one draft under `new/`. */
function withDraft(d: Draft): string {
  const root = tempRepoRoot();
  seedBacklog(root, [], {
    base: "match",
    labels: ["improvement", "bugfix", "experiment", "epic"],
    milestones: [{ title: "v1.0.0", state: "open" }],
  });
  const path = join(backlogRoot(root), NEW_DIR, d.slug, BODY_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderDraft(d), "utf8");
  return root;
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (s: unknown) => void lines.push(String(s));
  console.error = (s: unknown) => void lines.push(String(s));
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const run = (argv: string[], root: string) =>
  capture(() => create(parseArgs(["--repo", "owner/repo", ...argv]), root));

describe("create — preview creates nothing", () => {
  test("a valid draft previews as 0 with no mutation", async () => {
    gh.reset();
    const { code, out } = await run([], withDraft(draft()));
    expect(code).toBe(0);
    expect(out).toContain("[preview]");
    expect(gh.mutations()).toEqual([]);
  });
});

describe("create — offline validation refuses before the network", () => {
  test("an unknown label is exit 1 and nothing is created", async () => {
    gh.reset();
    const { code } = await run([], withDraft(draft({ labels: ["not-a-real-label"] })));
    expect(code).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });

  test("an unknown milestone is exit 1 and nothing is created", async () => {
    gh.reset();
    const { code } = await run([], withDraft(draft({ milestone: "v9.9.9" })));
    expect(code).toBe(1);
    expect(gh.mutations()).toEqual([]);
  });

  test("a draft that would violate an invariant is exit 1 — PM003 on a projected issue", async () => {
    gh.reset();
    // An experiment never carries a milestone (§4). Caught against the projection, before creation.
    const { code, out } = await run([], withDraft(draft({ labels: ["experiment"], milestone: "v1.0.0" })));
    expect(code).toBe(1);
    expect(out).toContain("PM003");
    expect(gh.mutations()).toEqual([]);
  });
});

describe("create --yes — applies", () => {
  test("creates the draft once", async () => {
    gh.reset();
    gh.set({ nextIssueNumber: 500 });
    const { code } = await run(["--yes"], withDraft(draft()));
    expect(code).toBe(0);
    expect(gh.callsTo("createIssue")).toHaveLength(1);
  });
});
