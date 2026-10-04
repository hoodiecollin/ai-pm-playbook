/**
 * Agent instruction files — the harness-agnostic delivery surface.
 *
 * There is no cross-harness API for "give the model this context," but there IS a cross-harness
 * convention: a markdown file at the repo root that the harness loads automatically. AGENTS.md is
 * the emerging shared standard; the rest are per-tool equivalents. We manage a marker-delimited
 * stanza inside whichever ones the repo uses, so the file stays the user's and we only own our
 * block.
 *
 * The stanza is deliberately a POINTER to the skills, not the doctrine itself. Always-loaded
 * context is the scarcest resource in the repo — spending hundreds of lines of it on project management
 * would degrade every unrelated task. The pointer costs ~35 lines and buys progressive disclosure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VENDOR_DIR } from "./vendor.js";

export const BEGIN = "<!-- pm-playbook:begin -->";
export const END = "<!-- pm-playbook:end -->";

/**
 * Known agent-context files, in priority order. AGENTS.md is the default because it is the only
 * one multiple vendors read; the others are written only when they already exist (`--detect`) or
 * are named explicitly.
 */
export const KNOWN_AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".cursorrules",
  ".cursor/rules/pm-playbook.mdc",
  "GEMINI.md",
  ".windsurfrules",
];

export const DEFAULT_AGENT_FILE = "AGENTS.md";

/** Agent files already present in the repo (so `--detect` can target what the team actually uses). */
export function detectAgentFiles(repoRoot: string): string[] {
  return KNOWN_AGENT_FILES.filter((f) => existsSync(join(repoRoot, f)));
}

/**
 * The skills the stanza routes to, in the order an agent meets them. `split-assets` fails the build
 * if this list and `plugins/pm-playbook/skills/` disagree.
 */
const SKILL_ROUTES: [skill: string, when: string][] = [
  ["pm-playbook", "the model, and which skill to load"],
  ["file", "filing a new issue"],
  ["intent", "writing an improvement's intent gate"],
  ["prove", "writing or closing a proof gate"],
  ["build", "implementing an improvement whose gates are closed"],
  ["fix", "fixing a bug, or a hotfix"],
  ["experiment", "a spike, benchmark or evaluation"],
  ["next", "what is left, what to do next, briefing parallel agents"],
  ["release", "tagging, the release-gate ledger, which branch to target"],
  ["check", "linting the backlog and fixing what it finds"],
];

/**
 * The stanza body.
 *
 * Every line here has to earn its place in a permanently-loaded context window, so it holds only
 * what an agent would otherwise get wrong before it thinks to load a skill: the two axes, the gate
 * table, who closes a gate, and where each workflow lives. The workflows themselves are skills,
 * loaded on demand.
 */
export function renderStanza(version: string): string {
  const routes = SKILL_ROUTES.map(([s, when]) => `| ${when} | \`${VENDOR_DIR}/skills/${s}/SKILL.md\` |`).join("\n");
  return `${BEGIN}
## Project management — pm-playbook v${version}

Work is tracked in GitHub Issues. **Milestone = when**: assigning one means committed, and the
lowest open one is the cycle in flight. **Label = what kind**: every work item carries exactly one
of \`improvement\`, \`bugfix\`, \`experiment\`. Epics group work items as native sub-issues. There are
no priority or size fields.

| Type | Gates (sub-issues, \`gate:<verb>\`) | Then |
|---|---|---|
| \`improvement\` | intent → proof | build |
| \`bugfix\` | none — a \`hotfix\` takes a warrant | fix, with a regression test |
| \`experiment\` | charter → verdict (never milestoned) | — |

**A person closes a gate, not an agent.** Gates are created only by \`pm-playbook materialize\`. A
proof gate closes on evidence through \`pm-playbook prove <n> --yes\`; for any other gate that is
ready, say so and stop. If later work shows an accepted gate was wrong, say so and ask for it to be
reopened.

Load the skill for what you are doing (Claude Code: the \`pm-playbook\` plugin provides the same):

| When | Read |
|---|---|
${routes}

\`\`\`bash
npx @hoodiecollin/pm-playbook pull     # refresh the local mirror at ${VENDOR_DIR}/backlog/ (read it, edit via push)
npx @hoodiecollin/pm-playbook check    # before finishing — exit 0 means compliant
\`\`\`
${END}`;
}


export interface StanzaResult {
  file: string;
  action: "created" | "updated" | "unchanged";
}

/**
 * What `writeStanza` would do, without doing it — so `--dry-run` reports the truth rather than a
 * guess. Derived from the same content function that performs the write, so the two cannot drift.
 */
export function planStanza(repoRoot: string, file: string, version: string): StanzaResult {
  const path = join(repoRoot, file);
  if (!existsSync(path)) return { file, action: "created" };
  const next = applyStanza(repoRoot, file, version);
  return { file, action: next === readFileSync(path, "utf8") ? "unchanged" : "updated" };
}

/**
 * Compute the post-write content.
 *
 * Marker-delimited so re-running never duplicates and never disturbs the user's own content: a
 * file with markers gets its block replaced in place; a file without them gets the stanza
 * appended; a missing file is created with a minimal header.
 */
export function applyStanza(repoRoot: string, file: string, version: string): string {
  const path = join(repoRoot, file);
  const stanza = renderStanza(version);

  if (!existsSync(path)) {
    return `# Agent instructions\n\n${stanza}\n`;
  }

  const current = readFileSync(path, "utf8");
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);

  if (start !== -1 && end !== -1 && end > start) {
    return current.slice(0, start) + stanza + current.slice(end + END.length);
  }

  const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return current + sep + stanza + "\n";
}

export function writeStanza(repoRoot: string, file: string, version: string): void {
  const path = join(repoRoot, file);
  mkdirSync(dirname(path), { recursive: true }); // nested targets: .cursor/rules/, .github/
  writeFileSync(path, applyStanza(repoRoot, file, version), "utf8");
}

/** Does this file carry a current stanza? Used by `check` (PM101). */
export function stanzaStatus(repoRoot: string, file: string, version: string): "current" | "stale" | "absent" {
  const path = join(repoRoot, file);
  if (!existsSync(path)) return "absent";
  const current = readFileSync(path, "utf8");
  if (!current.includes(BEGIN)) return "absent";
  return current.includes(renderStanza(version)) ? "current" : "stale";
}
