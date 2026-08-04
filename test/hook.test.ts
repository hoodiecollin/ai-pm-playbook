/**
 * The PreToolUse guard runs on EVERY Bash call in a session, so its failure modes matter more than
 * its hit rate: a false positive blocks legitimate work, and a crash breaks the session. These
 * tests drive the real script the way Claude Code does — JSON on stdin, decision on stdout.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "plugins", "pm-playbook", "hooks", "guard-issue-mutation.mjs");

async function runHook(payload: unknown): Promise<{ code: number; decision: string | null; reason: string }> {
  const proc = Bun.spawn(["node", HOOK], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
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
  test("PM001: plan-next together with a milestone", async () => {
    const r = await runHook(bash('gh issue create --label plan-next --milestone v0.4.0 --title "x"'));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM001");
  });

  test("PM002: idea together with plan-next", async () => {
    const r = await runHook(bash("gh issue create --label idea,plan-next --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM002");
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

  test("PM005: release-gate with plan-next", async () => {
    const r = await runHook(bash("gh issue create --label release-gate,plan-next --milestone v1.0.0 --title x"));
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("PM005");
  });

  test("catches a violation in the second half of a compound command", async () => {
    const r = await runHook(bash('git add -A && gh issue edit 4 --add-label plan-next --milestone v0.4.0'));
    expect(r.decision).toBe("deny");
  });

  test("handles --flag=value form", async () => {
    const r = await runHook(bash("gh issue create --label=plan-next --milestone=v0.4.0 --title=x"));
    expect(r.decision).toBe("deny");
  });

  test("handles repeated --label flags", async () => {
    const r = await runHook(bash("gh issue create --label idea --label plan-next --title x"));
    expect(r.decision).toBe("deny");
  });

  test("the denial names the fix, not just the rule", async () => {
    const r = await runHook(bash("gh issue create --label plan-next --milestone v0.4.0 --title x"));
    expect(r.reason).toContain("Fix:");
  });
});

describe("guard — does not block legitimate work", () => {
  const allowed = [
    ["a plain milestone assignment", "gh issue edit 4 --milestone v0.4.0"],
    ["plan-next with no milestone", "gh issue create --label plan-next --title x"],
    ["an off-spine experiment", "gh issue create --label experiment --title x"],
    ["a well-formed release-gate", "gh issue create --label release-gate --milestone v1.0.0 --title x"],
    ["an unrelated gh call", "gh pr list --state open"],
    ["an unrelated command", "npm test"],
    ["listing issues", "gh issue list --label plan-next"],
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

  test("THE FIX ITSELF is never blocked — --remove-label resolves PM001", async () => {
    // Regression guard: an earlier design that matched on label *mentions* would have blocked the
    // exact command that fixes the violation, making the hook impossible to get out of.
    const r = await runHook(bash("gh issue edit 4 --remove-label plan-next --milestone v0.4.0"));
    expect(r.decision).toBeNull();
  });

  test("--remove-milestone clears the conflict for an experiment", async () => {
    const r = await runHook(bash("gh issue edit 4 --add-label experiment --remove-milestone"));
    expect(r.decision).toBeNull();
  });

  test("a label name inside a quoted body is not read as a flag", async () => {
    const r = await runHook(bash('gh issue create --title x --body "we should drop plan-next when milestoning"'));
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
