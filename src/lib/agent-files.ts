/**
 * Agent instruction files — the harness-agnostic delivery surface.
 *
 * There is no cross-harness API for "give the model this context," but there IS a cross-harness
 * convention: a markdown file at the repo root that the harness loads automatically. AGENTS.md is
 * the emerging shared standard; the rest are per-tool equivalents. We manage a marker-delimited
 * stanza inside whichever ones the repo uses, so the file stays the user's and we only own our
 * block.
 *
 * The stanza is deliberately a POINTER plus the invariants, not the doctrine itself. Always-loaded
 * context is the scarcest resource in the repo — spending 500 lines of it on project management
 * would degrade every unrelated task. The pointer costs ~20 lines and buys progressive disclosure.
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
 * The stanza body.
 *
 * Every line here has to earn its place in a permanently-loaded context window. What is included:
 * where the full doctrine lives, when to read it, the invariants an agent would otherwise violate
 * silently, and the command that proves compliance. Nothing else.
 */
export function renderStanza(version: string): string {
  return `${BEGIN}
## Project management — pm-playbook v${version}

Issue tracking in this repo follows the **pm-playbook** two-axis model. The full doctrine is
vendored at \`${VENDOR_DIR}/\` and is authoritative; this block is only a summary.

**Before you create, label, milestone, or close an issue — read \`${VENDOR_DIR}/AGENT.md\`.**
It is a short router: load only the reference section relevant to what you are doing.

**The two axes, and nothing else, organize work:**
- **Milestone** = *when* (a version release — the release spine). Assigning one means "scheduled."
- **Labels** = *what kind / how committed*. Epics decompose via **native sub-issues**, never
  checkboxes and never a Project field.
- There are **no Priority / Size / Workstream fields**. Do not propose adding any.

**Invariants — violating one is a bug, not a style preference:**
- \`plan-next\` and a milestone never coexist. Assigning a milestone means dropping \`plan-next\`.
- \`idea\` and \`plan-next\` never coexist.
- \`experiment\` never carries \`idea\`, \`plan-next\`, or a milestone. A spike's deliverable is a
  decision; it feeds the release spine, it never rides it.
- \`release-gate\` always has a milestone, and never carries \`idea\` / \`plan-next\` / \`experiment\`.
  An open \`release-gate\` means its milestone **cannot be tagged**.
- A non-core \`surface:*\` issue never rides a core \`v*\` milestone.

**Verify before opening a PR** — exit code 0 means compliant:

\`\`\`bash
npx ai-pm-playbook check
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
