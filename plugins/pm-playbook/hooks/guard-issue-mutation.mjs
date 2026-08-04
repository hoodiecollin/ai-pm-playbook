#!/usr/bin/env node
/**
 * PreToolUse guard — block `gh issue create/edit` calls that would violate a label invariant.
 *
 * WHY THIS IS PLAIN .mjs AND NOT TYPESCRIPT
 * Claude Code installs plugins straight from git, with no build step and no `npm install`. A hook
 * has to be runnable the instant it lands on disk, with nothing but the Node that ships with the
 * user's machine. So this file is committed as executable JavaScript with zero dependencies — the
 * one place in this repo that does not go through the TypeScript build.
 *
 * WHAT IT CAN AND CANNOT SEE
 * The hook receives only the command TEXT, never the repository. So it catches violations that are
 * self-evident in the command itself — `--label plan-next --milestone v0.4.0` — and cannot catch
 * one that depends on the issue's existing state, e.g. `gh issue edit 7 --milestone v0.4.0` where
 * #7 already carries `plan-next`. That residue is what `pm-playbook check` is for. A fast, partial,
 * always-correct gate beats a slow, complete one that makes every Bash call wait on the network.
 *
 * FAILURE POSTURE
 * Any parse failure, unexpected input, or internal error exits 0 silently. A hook that breaks a
 * user's session because it could not understand a command is worse than no hook at all.
 */

const DOC = "https://github.com/hoodiecollin/ai-pm-playbook#why-the-linter-is-the-load-bearing-piece";

/** Read all of stdin. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Deny the tool call with a reason Claude will read and act on. */
function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/**
 * Split a shell command on `&&`, `||`, `;` and `|` so a compound line is checked segment by
 * segment. Without this, `git commit && gh issue edit ...` would be missed.
 * Quote-aware, so a separator inside a quoted --body is not treated as a boundary.
 */
function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote && command[i - 1] !== "\\") quote = null;
      current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments;
}

/** Tokenize one segment, respecting quotes. */
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote && segment[i - 1] !== "\\") quote = null;
      else current += c;
      has = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has || current) tokens.push(current);
      current = "";
      has = false;
      continue;
    }
    current += c;
  }
  if (has || current) tokens.push(current);
  return tokens;
}

/**
 * Extract the labels being ADDED and the milestone being SET.
 *
 * Only additive flags count. `--remove-label plan-next` is the fix for PM001, so treating it as a
 * label mention would block the very command that resolves the violation.
 */
function parseIssueMutation(tokens) {
  const gh = tokens.indexOf("gh");
  if (gh === -1) return null;
  if (tokens[gh + 1] !== "issue") return null;
  const verb = tokens[gh + 2];
  if (verb !== "create" && verb !== "edit") return null;

  const labels = new Set();
  const removed = new Set();
  let milestone = null;
  let milestoneRemoved = false;

  for (let i = gh + 3; i < tokens.length; i++) {
    const t = tokens[i];
    let flag = t;
    let inline = null;
    const eq = t.indexOf("=");
    if (t.startsWith("--") && eq !== -1) {
      flag = t.slice(0, eq);
      inline = t.slice(eq + 1);
    }
    const value = () => inline ?? tokens[++i] ?? "";

    if (flag === "--label" || flag === "-l" || flag === "--add-label") {
      for (const l of value().split(",")) {
        const name = l.trim();
        if (name) labels.add(name);
      }
    } else if (flag === "--remove-label") {
      for (const l of value().split(",")) {
        const name = l.trim();
        if (name) removed.add(name);
      }
    } else if (flag === "--milestone" || flag === "-m") {
      milestone = value().trim() || null;
    } else if (flag === "--remove-milestone") {
      milestoneRemoved = true;
    }
  }

  // A label both added and removed in one command is incoherent; trust the removal.
  for (const r of removed) labels.delete(r);
  if (milestoneRemoved) milestone = null;

  return { verb, labels, milestone };
}

/** Evaluate the statically-detectable invariants. Returns a reason string, or null if clean. */
function evaluate({ labels, milestone }) {
  const has = (l) => labels.has(l);
  const scheduled = milestone !== null;
  const violations = [];

  if (has("plan-next") && scheduled) {
    violations.push(
      `PM001 — \`plan-next\` cannot coexist with a milestone (\`${milestone}\`). Assigning a milestone IS scheduling, so the label must come off in the same command.\n` +
        `  Fix: drop \`--label plan-next\`, or add \`--remove-label plan-next\` if editing.`,
    );
  }
  if (has("idea") && has("plan-next")) {
    violations.push(
      "PM002 — `idea` cannot coexist with `plan-next`. Speculative and committed are opposite rungs of the ladder.\n" +
        "  Fix: pick one. An accepted RFC (Gate 1) means it is committed — use `plan-next` alone.",
    );
  }
  if (has("experiment")) {
    const conflicts = ["idea", "plan-next"].filter(has);
    if (scheduled) conflicts.push(`a milestone (\`${milestone}\`)`);
    if (conflicts.length) {
      violations.push(
        `PM003 — \`experiment\` cannot coexist with ${conflicts.join(", ")}. A spike's deliverable is a decision, not a shippable artifact: it feeds the release spine, it never rides it.\n` +
          "  Fix: leave the spike off the spine. If its conclusion commits real work, file THAT as its own issue and milestone it.",
      );
    }
  }
  if (has("release-gate")) {
    const conflicts = ["idea", "plan-next", "experiment"].filter(has);
    if (conflicts.length) {
      violations.push(
        `PM005 — \`release-gate\` cannot coexist with ${conflicts.join(", ")}. A release obligation is committed by definition, so it is never speculative or unscheduled.\n` +
          "  Fix: remove the conflicting label(s).",
      );
    }
  }
  // PM004 (release-gate requires a milestone) is checked only on `create`: an `edit` that adds the
  // label may be paired with a milestone the issue already has, which this hook cannot see.
  return violations.length ? violations.join("\n\n") : null;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  if (payload?.tool_name !== "Bash") process.exit(0);
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command.includes("gh")) process.exit(0);

  for (const segment of splitSegments(command)) {
    if (!segment.includes("gh")) continue;
    const mutation = parseIssueMutation(tokenize(segment));
    if (!mutation) continue;

    // PM004 is safe to assert on create, where the full label set is in front of us.
    if (mutation.verb === "create" && mutation.labels.has("release-gate") && mutation.milestone === null) {
      deny(
        "Blocked by pm-playbook (PM004).\n\n" +
          "PM004 — `release-gate` requires a milestone. A gate blocks a *specific* tag, so it is meaningless without naming the one it blocks.\n" +
          "  Fix: add `--milestone <vX.Y.Z>`.\n\n" +
          `Reference: ${DOC}`,
      );
    }

    const reason = evaluate(mutation);
    if (reason) {
      deny(`Blocked by pm-playbook — this would create an invariant violation.\n\n${reason}\n\nReference: ${DOC}`);
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
