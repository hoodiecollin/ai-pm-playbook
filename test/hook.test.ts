/**
 * The PreToolUse guard runs on EVERY Bash call in a session, so its failure modes matter more than
 * its hit rate: a false positive blocks legitimate work, and a crash breaks the session. These
 * tests drive the real script the way Claude Code does — JSON on stdin, decision on stdout.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "plugins", "pm-playbook", "hooks", "guard-issue-mutation.mjs");

async function runHook(
  payload: unknown,
  env: Record<string, string> = {},
): Promise<{ code: number; decision: string | null; reason: string }> {
  // Unless a test supplies its own, point the gate lookup at a binary that always fails, so no test
  // ever reaches the real GitHub — and so the fail-open path is what the ordinary tests exercise.
  const proc = Bun.spawn(["node", HOOK], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PM_PLAYBOOK_GH: "false", ...env },
  });
  proc.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  await proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (!stdout.trim()) return { code, decision: null, reason: "" };
  const parsed = JSON.parse(stdout);
  return {
    code,
    decision: parsed.hookSpecificOutput?.permissionDecision ?? null,
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? "",
  };
}

const bash = (command: string) => ({ tool_name: "Bash", hook_event_name: "PreToolUse", tool_input: { command } });

describe("guard — blocks static invariant violations", () => {
  test("PM010: two work types at once", async () => {
    const r = await runHook(bash('gh issue create --label improvement,bugfix --title "x"'));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM010");
  });

  test("PM014: hotfix without bugfix", async () => {
    const r = await runHook(bash("gh issue create --label improvement,hotfix --milestone v1.2.1 --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM014");
  });

  test("PM105: a gate label filed by hand — the tool owns gate creation", async () => {
    const r = await runHook(bash("gh issue create --label improvement:gate-1 --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("materialize");
  });

  test("PM003: a milestoned experiment", async () => {
    const r = await runHook(bash("gh issue edit 12 --add-label experiment --milestone v0.5.0"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM003");
  });

  test("PM004: release-gate created without a milestone", async () => {
    const r = await runHook(bash("gh issue create --label release-gate --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM004");
  });

  test("PM005: release-gate with experiment", async () => {
    const r = await runHook(bash("gh issue create --label release-gate,experiment --milestone v1.0.0 --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM005");
  });

  test("catches a violation in the second half of a compound command", async () => {
    const r = await runHook(bash('git add -A && gh issue edit 4 --add-label improvement --add-label bugfix'));
    expect(r.decision).toBe("deny");
  });

  test("handles --flag=value form", async () => {
    const r = await runHook(bash("gh issue create --label=experiment --milestone=v0.4.0 --title=x"));
    expect(r.decision).toBe("deny");
  });

  test("handles repeated --label flags", async () => {
    const r = await runHook(bash("gh issue create --label improvement --label experiment --title x"));
    expect(r.decision).toBe("deny");
  });

  test("the denial names the fix, not just the rule", async () => {
    const r = await runHook(bash("gh issue create --label improvement --label bugfix --title x"));
    expect(r.reason).toContain("Fix:");
  });
});

describe("guard — does not block legitimate work", () => {
  const allowed = [
    ["a plain milestone assignment", "gh issue edit 4 --milestone v0.4.0"],
    ["a typed work item with a milestone", "gh issue create --label improvement --milestone v2.0.0 --title x"],
    ["an off-spine experiment", "gh issue create --label experiment --title x"],
    ["a well-formed release-gate", "gh issue create --label release-gate --milestone v1.0.0 --title x"],
    ["an unrelated gh call", "gh pr list --state open"],
    ["an unrelated command", "npm test"],
    ["listing issues", "gh issue list --label improvement"],
    ["a well-formed hotfix", "gh issue create --label bugfix --label hotfix --milestone v1.2.1 --title x"],
    ["viewing an issue", "gh issue view 12 --json labels,milestone"],
    ["a non-core surface on its own line", "gh issue create --label surface:website --milestone web-2026-08 --title x"],
  ] as const;

  for (const [name, command] of allowed) {
    test(name, async () => {
      const r = await runHook(bash(command));
      expect(r.decision).toBeNull();
      expect(r.code).toBe(0);
    });
  }

  test("THE FIX ITSELF is never blocked — --remove-label resolves PM010", async () => {
    // Regression guard: an earlier design that matched on label *mentions* would have blocked the
    // exact command that fixes the violation, making the hook impossible to get out of.
    const r = await runHook(bash("gh issue edit 4 --add-label improvement --remove-label bugfix"));
    expect(r.decision).toBeNull();
  });

  test("--remove-milestone clears the conflict for an experiment", async () => {
    const r = await runHook(bash("gh issue edit 4 --add-label experiment --remove-milestone"));
    expect(r.decision).toBeNull();
  });

  test("a label name inside a quoted body is not read as a flag", async () => {
    const r = await runHook(bash('gh issue create --title x --body "this is both improvement and bugfix shaped"'));
    expect(r.decision).toBeNull();
  });

  test("release-gate added by EDIT is allowed — the milestone may already exist", async () => {
    const r = await runHook(bash("gh issue edit 9 --add-label release-gate"));
    expect(r.decision).toBeNull();
  });
});

describe("guard — fails open, never breaks the session", () => {
  const malformed = [
    ["malformed JSON", "not json at all"],
    ["empty input", ""],
    ["missing tool_input", JSON.stringify({ tool_name: "Bash" })],
    ["a non-Bash tool", JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } })],
    ["a null command", JSON.stringify({ tool_name: "Bash", tool_input: { command: null } })],
    ["an unterminated quote", JSON.stringify(bash('gh issue create --title "unclosed'))],
  ] as const;

  for (const [name, payload] of malformed) {
    test(name, async () => {
      const r = await runHook(payload);
      expect(r.code).toBe(0);
      expect(r.decision).toBeNull();
    });
  }
});

describe("guard — a gate is closed by a human", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");

  /** A fake `gh` that answers `issue view --json labels` with the given label list. */
  function fakeGh(labels: string): string {
    const dir = mkdtempSync(join(tmpdir(), "pm-gh-"));
    const bin = join(dir, "gh");
    writeFileSync(bin, `#!/bin/sh\necho "${labels}"\n`);
    chmodSync(bin, 0o755);
    return bin;
  }

  /** A repo whose mirror holds gate #42 under work item #7. */
  function repoWithMirror(): string {
    const root = mkdtempSync(join(tmpdir(), "pm-repo-"));
    mkdirSync(join(root, ".pm-playbook", "backlog", "standalone", "7", "gates", "gate-2--42"), { recursive: true });
    return root;
  }

  const at = (command: string, cwd: string) => ({ ...bash(command), cwd });
  /** A directory with no mirror, so the lookup has to go to (fake) GitHub. */
  const empty = () => mkdtempSync(join(tmpdir(), "pm-empty-"));

  test("a hand-made 4.x gate label is refused like a legacy one", async () => {
    const r = await runHook(bash("gh issue create --label gate:intent --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("materialize");
  });

  test("the mirror answers offline: closing gate #42 is refused with no network call", async () => {
    const r = await runHook(at("gh issue close 42", repoWithMirror()));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("closed by a human");
  });

  test("on a mirror miss, GitHub answers — a gate label means refused", async () => {
    const r = await runHook(at("gh issue close 42 --comment done", empty()), { PM_PLAYBOOK_GH: fakeGh("gate:proof,improvement") });
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("prove 42");
  });

  test("closing an ordinary issue is allowed", async () => {
    const r = await runHook(at("gh issue close 42", empty()), { PM_PLAYBOOK_GH: fakeGh("improvement") });
    expect(r.decision).toBeNull();
  });

  test("the REST form is caught too", async () => {
    const r = await runHook(at("gh api -X PATCH repos/o/r/issues/42 -f state=closed", repoWithMirror()));
    expect(r.decision).toBe("deny");
  });

  test("a lookup that fails is allowed — the guard fails open", async () => {
    const r = await runHook(at("gh issue close 42", empty()));
    expect(r.decision).toBeNull();
    expect(r.code).toBe(0);
  });

  test("reopening a gate is never blocked — it is the way back", async () => {
    const r = await runHook(at("gh issue reopen 42", repoWithMirror()));
    expect(r.decision).toBeNull();
  });
});
