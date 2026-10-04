#!/usr/bin/env bun
/**
 * Replay real false premises against the `prove` skill.
 *
 * Each case in `evals/prove/cases/` is an approach that a 3.x gate ACCEPTED in forgedb and that
 * later turned out to rest on something false. The runner checks the repo out at the commit the
 * approach was written against, hands an agent the intent and the approach, and asks it to write
 * the proof gate following the skill. A case passes when the false claim does not come back as
 * proven: it is left `assumed`, or the agent's evidence disproves it.
 *
 *   bun run eval:prove                       # every case, with the skill
 *   bun run eval:prove --case forgedb-388    # one case
 *   bun run eval:prove --baseline            # also run the 3.x-style "write a plan" prompt, to compare
 *
 * Costs real model calls and runs the agent's probes (which may compile Rust) in a throwaway
 * checkout that holds only the case's commit, with `gh` disconnected, so no run can read the later
 * history that disproved the premise. The agent gets Bash, so run this only against a repo you trust.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { evaluateProof } from "../src/lib/claims.js";

interface Case {
  id: string;
  repo: string;
  issue: number;
  commit: string;
  intent: string;
  approach: string;
  falseClaim: string;
  groundTruth: string;
  claimPattern: string;
  disproofPattern: string;
  probeHint: string;
}

interface Outcome {
  id: string;
  mode: "skill" | "baseline";
  pass: boolean;
  reason: string;
  output: string;
}

const ROOT = join(import.meta.dir, "..");
const CASES = join(ROOT, "evals", "prove", "cases");
const RESULTS = join(ROOT, "evals", "prove", ".results");
const SKILL = readFileSync(join(ROOT, "plugins", "pm-playbook", "skills", "prove", "SKILL.md"), "utf8")
  .replace(/^---[\s\S]*?---\n/, "");

const argv = process.argv.slice(2);
const only = argv.includes("--case") ? argv[argv.indexOf("--case") + 1] : null;
const baseline = argv.includes("--baseline");
const forgedb = argv.includes("--forgedb") ? argv[argv.indexOf("--forgedb") + 1]! : join(homedir(), "Projects", "forgedb");

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

function skillPrompt(c: Case): string {
  return [
    "You are working in a checkout of this repository at the commit the approach below was written against.",
    "Work only inside the current directory: other copies of the project on this machine are off limits.",
    "Follow the skill below to write the PROOF gate for this improvement. Steps that touch GitHub (finding the",
    "gate, editing it, running `pm-playbook prove`) do not apply here: instead, reply with the complete gate body",
    "in markdown — Approach, Claims table, Spike, Pre-mortem, One-way doors — and nothing else.",
    "",
    "<skill>",
    SKILL,
    "</skill>",
    "",
    "<intent>",
    c.intent,
    "</intent>",
    "",
    "<proposed-approach>",
    c.approach,
    "</proposed-approach>",
  ].join("\n");
}

function baselinePrompt(c: Case): string {
  return [
    "You are working in a checkout of this repository; work only inside the current directory.",
    "Below is the need and an approach a design review has",
    "already accepted. Write the implementation plan for it: files to change, build order, interfaces, and the",
    "test scenarios. Reply with the plan in markdown and nothing else.",
    "",
    "<need>", c.intent, "</need>", "",
    "<accepted-design>", c.approach, "</accepted-design>",
  ].join("\n");
}

/**
 * A hermetic checkout of the case's commit: the tree only, re-committed as the sole commit of a
 * fresh repository. A worktree would share forgedb's object database — every LATER commit,
 * including the one that disproved the premise — and an agent that reads `git log origin/develop`
 * is answering from the future, which is exactly what the first run of this eval did.
 */
function checkout(c: Case): string {
  const dir = mkdtempSync(join(tmpdir(), `eval-${c.id}-`));
  const tar = spawnSync("git", ["-C", forgedb, "archive", "--format=tar", c.commit], { maxBuffer: 1024 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`git archive ${c.commit} failed`);
  const x = spawnSync("tar", ["-x", "-C", dir], { input: tar.stdout });
  if (x.status !== 0) throw new Error("tar -x failed");
  git(["init", "-q"], dir);
  git(["add", "-A"], dir);
  git(["-c", "user.name=eval", "-c", "user.email=eval@invalid", "commit", "-qm", `${c.repo} @ ${c.commit.slice(0, 10)}`], dir);
  return dir;
}

function runAgent(prompt: string, cwd: string): string {
  // `gh` is pointed at an empty config so the issue tracker — where every one of these premises was
  // eventually disproved — is out of reach. Inherit stderr so a hang or an auth failure is visible;
  // capture stdout, which is the answer.
  const ghConfig = mkdtempSync(join(tmpdir(), "eval-gh-"));
  const r = spawnSync(
    "claude",
    ["-p", prompt, "--output-format", "text", "--allowedTools", "Bash", "Read", "Grep", "Glob", "Write", "Edit", "Task"],
    {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_CONFIG_DIR: ghConfig, GH_TOKEN: "", GITHUB_TOKEN: "" },
    },
  );
  rmSync(ghConfig, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`claude exited ${r.status}`);
  return r.stdout;
}


function gradeSkill(c: Case, output: string): { pass: boolean; reason: string } {
  const claim = new RegExp(c.claimPattern, "i");
  const disproof = new RegExp(c.disproofPattern, "i");
  const rows = evaluateProof(output).rows.filter((r) => claim.test(r.claim));
  const disproved = rows.find((r) => disproof.test(`${r.claim} ${r.evidence}`));
  if (disproved) return { pass: true, reason: `disproved in the table: "${disproved.claim}" — ${disproved.evidence}` };
  const assumed = rows.find((r) => r.status === "assumed");
  if (assumed) return { pass: true, reason: `left assumed, so the gate cannot close: "${assumed.claim}"` };
  // Weaker: the disproof is in the text but not on the claim's own row. Counted, and labelled.
  if (disproof.test(output)) return { pass: true, reason: "weak — disproved outside the claims table" };
  if (rows.length) return { pass: false, reason: `marked ${rows.map((r) => r.status).join("/")} without disproving it` };
  return { pass: false, reason: "the false premise is not in the claims table at all" };
}

function gradeBaseline(c: Case, output: string): { pass: boolean; reason: string } {
  return new RegExp(c.disproofPattern, "i").test(output)
    ? { pass: true, reason: "the plan noticed the premise is false" }
    : { pass: false, reason: "the plan builds on the premise" };
}

const cases: Case[] = readdirSync(CASES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(CASES, f), "utf8")) as Case)
  .filter((c) => !only || c.id === only);
if (!cases.length) throw new Error(only ? `no case ${only}` : "no cases");

const outcomes: Outcome[] = [];
for (const c of cases) {
  console.log(`\n=== ${c.id} @ ${c.commit.slice(0, 10)} — ${c.falseClaim}`);
  for (const mode of baseline ? (["skill", "baseline"] as const) : (["skill"] as const)) {
    // A fresh checkout per run, so the baseline never sees the skill run's probes.
    const dir = checkout(c);
    try {
      const output = runAgent(mode === "skill" ? skillPrompt(c) : baselinePrompt(c), dir);
      const g = mode === "skill" ? gradeSkill(c, output) : gradeBaseline(c, output);
      outcomes.push({ id: c.id, mode, ...g, output });
      console.log(`  ${g.pass ? "PASS" : "FAIL"} [${mode}] ${g.reason}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}


mkdirSync(RESULTS, { recursive: true });
const file = join(RESULTS, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(outcomes, null, 2) + "\n");

console.log("\n=== summary");
for (const mode of ["skill", "baseline"] as const) {
  const rows = outcomes.filter((o) => o.mode === mode);
  if (rows.length) console.log(`  ${mode}: ${rows.filter((o) => o.pass).length}/${rows.length} caught`);
}
console.log(`  full outputs: ${file}`);
process.exit(outcomes.some((o) => o.mode === "skill" && !o.pass) ? 1 : 0);
