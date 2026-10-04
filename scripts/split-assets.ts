#!/usr/bin/env bun
/**
 * Assemble the shippable asset tree from the canonical sources.
 *
 *   PLAYBOOK.md                    → assets/playbook/PLAYBOOK.md
 *   plugins/pm-playbook/skills/    → assets/playbook/skills/
 *   .github/ISSUE_TEMPLATE/        → assets/templates/ISSUE_TEMPLATE/
 *
 * The skills are canonical in the plugin directory because Claude Code installs plugins straight
 * from git; vendoring copies them so every other harness reads the same files. Nothing is
 * generated from prose any more, so there is no second copy that could drift.
 *
 * One check fails the build: the stanza `init` writes into AGENTS.md must name every shipped
 * skill, and only shipped skills. The stanza is how a non-Claude agent learns the skills exist, so
 * a skill it does not name is a skill no such agent will ever load.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderStanza } from "../src/lib/agent-files.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const outPlaybook = join(ROOT, "assets", "playbook");
  const outTemplates = join(ROOT, "assets", "templates", "ISSUE_TEMPLATE");
  const srcSkills = join(ROOT, "plugins", "pm-playbook", "skills");

  rmSync(outPlaybook, { recursive: true, force: true });
  mkdirSync(outPlaybook, { recursive: true });

  // --- The explainer --------------------------------------------------------
  const markdown = readFileSync(join(ROOT, "PLAYBOOK.md"), "utf8");
  if (!markdown.startsWith("# ")) throw new Error("PLAYBOOK.md must open with a `# ` title.");
  writeFileSync(join(outPlaybook, "PLAYBOOK.md"), markdown, "utf8");
  console.log(`playbook:  assets/playbook/PLAYBOOK.md (${markdown.split("\n").length} lines)`);

  // --- Skills, and the stanza that names them -------------------------------
  const skills = readdirSync(srcSkills, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const s of skills) {
    if (!existsSync(join(srcSkills, s, "SKILL.md"))) throw new Error(`skills/${s} has no SKILL.md`);
  }
  const stanza = renderStanza("0.0.0");
  const named = new Set([...stanza.matchAll(/skills\/([\w-]+)\/SKILL\.md/g)].map((m) => m[1]!));
  const unnamed = skills.filter((s) => !named.has(s));
  const dangling = [...named].filter((s) => !skills.includes(s));
  if (unnamed.length) throw new Error(`the AGENTS.md stanza (src/lib/agent-files.ts) does not name: ${unnamed.join(", ")}`);
  if (dangling.length) throw new Error(`the AGENTS.md stanza names skills that do not exist: ${dangling.join(", ")}`);
  cpSync(srcSkills, join(outPlaybook, "skills"), { recursive: true });
  console.log(`skills:    ${skills.length} → assets/playbook/skills/ (all named in the stanza)`);

  // --- Issue templates ------------------------------------------------------
  const srcTemplates = join(ROOT, ".github", "ISSUE_TEMPLATE");
  if (!existsSync(srcTemplates)) throw new Error("missing .github/ISSUE_TEMPLATE — nothing to ship");
  rmSync(dirname(outTemplates), { recursive: true, force: true });
  mkdirSync(outTemplates, { recursive: true });
  cpSync(srcTemplates, outTemplates, { recursive: true });
  console.log(`templates: .github/ISSUE_TEMPLATE → assets/templates/ISSUE_TEMPLATE`);
}

main();
