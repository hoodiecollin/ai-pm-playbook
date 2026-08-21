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
- **Milestone** = *when*. Assigning one means **committed**. *Focus* — the milestone being the
  cycle in flight — is what means scheduled. There is no label for "committed but unscheduled."
- **Labels** = *what kind*. Epics decompose via **native sub-issues**, never checkboxes and never
  a Project field.
- There are **no Priority / Size / Workstream fields**. Do not propose adding any.

**Every work item carries exactly one type, and the type decides its gates:**

| Type | Gates |
|---|---|
| \`improvement\` | design → plan → impl |
| \`bugfix\` | diagnose → fix (\`hotfix\` is a bounded form of this) |
| \`experiment\` | research → evaluate (never milestoned) |

Each gate is a sub-issue labelled \`{type}:gate-{n}\`. A closed gate means approved. The tree is
exactly three levels: epic → work item → gate.

**The commitment ladder is DERIVED from gate state — there are no maturity labels.** Walk the
gates in order; the first not closed decides the rung. Ask for it with \`pm-playbook ladder\`; no
GitHub filter can compute it.

**Invariants — violating one is a bug, not a style preference:**
- Exactly **one** type label per work item — never zero, never two (PM010). An \`epic\`, a gate and
  a \`release-gate\` are not work items for this purpose and need no type.
- \`experiment\` never carries a milestone. A spike's deliverable is a finding; it feeds the
  release spine, it never rides it (PM003).
- **Never create a gate by hand** — \`pm-playbook materialize\` owns them and creates a complete
  set at once. A hand-made gate destroys the meaning of an absent one.
- A gate's milestone equals its parent's (PM011); an \`epic\` never carries gates (PM012).
- \`release-gate\` always has a milestone and never carries \`experiment\`. An open \`release-gate\`
  means its milestone **cannot be tagged** (PM004/PM005).
- A non-core \`surface:*\` issue never rides a core \`v*\` milestone (PM006).

**Read the backlog from the local mirror when it exists.** \`${VENDOR_DIR}/backlog/\` holds every
issue body and comment as files — grep it instead of spending an API round trip per question. It is
gitignored and machine-local, so its absence means "not pulled here yet", never "no issues", and it
goes stale as soon as anyone else moves an issue. Reading is local; **writing is not** — edit and
\`push\` (it refuses when both sides moved), or use \`gh\` directly.

\`\`\`bash
npx @hoodiecollin/pm-playbook pull     # refresh the mirror (idempotent)
npx @hoodiecollin/pm-playbook check    # verify before opening a PR — exit 0 means compliant
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
