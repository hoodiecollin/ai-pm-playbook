#!/usr/bin/env bun
/**
 * Generate the shippable asset tree from the canonical sources.
 *
 *   PLAYBOOK.md                → assets/playbook/PLAYBOOK.md
 *                              → assets/playbook/reference/NN-slug.md   (one per `## ` section)
 *   agent/AGENT.template.md    → assets/playbook/AGENT.md
 *   .github/ISSUE_TEMPLATE/    → assets/templates/ISSUE_TEMPLATE/
 *
 * PLAYBOOK.md stays the ONE hand-edited copy of the doctrine — splitting is mechanical, so there
 * is no second copy to drift. The section→filename map below is explicit rather than slugified,
 * because the filenames are a public interface: they are referenced from AGENT.md, they land in
 * every consumer's repo, and an auto-slug that shifts when a heading is reworded would silently
 * break every pointer. Adding a section to PLAYBOOK.md without adding it here fails the build.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Section number → shipped filename. Renaming a value is a BREAKING change for consumers. */
const SECTION_FILES: Record<number, string> = {
  1: "01-two-axis-core.md",
  2: "02-commitment-ladder.md",
  3: "03-labels.md",
  4: "04-experiments.md",
  5: "05-release-spine.md",
  6: "06-surfaces.md",
  7: "07-epics-and-roadmap.md",
  8: "08-board-is-a-view.md",
  // Renamed in 2.0.0: the old name spelled out `improvement`'s gate verbs, which are wrong for
  // two of the three work types. A MAJOR is the one release where a breaking rename is free.
  9: "09-gates.md",
  10: "10-documentation.md",
  11: "11-operating-disciplines.md",
  12: "12-adopting.md",
  13: "13-anti-patterns.md",
};

interface Section {
  number: number;
  heading: string;
  body: string;
}

function splitSections(markdown: string): { preamble: string; sections: Section[] } {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (/^## /.test(line)) starts.push(i);
  });

  const preamble = lines.slice(0, starts[0] ?? lines.length).join("\n").trim();
  const sections: Section[] = [];

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = starts[s + 1] ?? lines.length;
    const heading = lines[from]!.replace(/^##\s+/, "").trim();
    const match = /^(\d+)\.\s*/.exec(heading);
    if (!match) {
      throw new Error(`PLAYBOOK.md: section heading is not numbered: "${heading}"`);
    }
    sections.push({
      number: Number(match[1]),
      heading,
      body: lines.slice(from, to).join("\n").replace(/\n*---\s*$/, "").trim(),
    });
  }

  return { preamble, sections };
}

function main(): void {
  const playbookPath = join(ROOT, "PLAYBOOK.md");
  const templatePath = join(ROOT, "agent", "AGENT.template.md");
  const outPlaybook = join(ROOT, "assets", "playbook");
  const outReference = join(outPlaybook, "reference");
  const outTemplates = join(ROOT, "assets", "templates", "ISSUE_TEMPLATE");

  const markdown = readFileSync(playbookPath, "utf8");
  const { preamble, sections } = splitSections(markdown);

  // --- Validate the map against the actual document --------------------------
  const found = new Set(sections.map((s) => s.number));
  const mapped = new Set(Object.keys(SECTION_FILES).map(Number));
  const missing = [...found].filter((n) => !mapped.has(n));
  const extra = [...mapped].filter((n) => !found.has(n));
  if (missing.length) {
    throw new Error(
      `PLAYBOOK.md has section(s) ${missing.join(", ")} with no filename in SECTION_FILES.\n` +
        `Add them to scripts/split-assets.ts — filenames are a public interface, so they are chosen, not derived.`,
    );
  }
  if (extra.length) {
    throw new Error(`SECTION_FILES maps section(s) ${extra.join(", ")} that no longer exist in PLAYBOOK.md.`);
  }

  // --- Write the split reference ---------------------------------------------
  rmSync(outPlaybook, { recursive: true, force: true });
  mkdirSync(outReference, { recursive: true });

  for (const section of sections) {
    const file = SECTION_FILES[section.number]!;
    const header =
      `<!-- Generated from PLAYBOOK.md §${section.number}. Do not edit; edit the playbook and rebuild. -->\n` +
      `<!-- Part of the pm-playbook doctrine. Full document: ../PLAYBOOK.md · Map: ../AGENT.md -->\n\n`;
    writeFileSync(join(outReference, file), header + section.body + "\n", "utf8");
  }
  console.log(`reference: ${sections.length} section(s) → assets/playbook/reference/`);

  // --- Ship the whole document too, for anyone who wants it end to end -------
  writeFileSync(join(outPlaybook, "PLAYBOOK.md"), markdown, "utf8");
  console.log(`playbook:  assets/playbook/PLAYBOOK.md (${markdown.split("\n").length} lines)`);
  if (!preamble.startsWith("# ")) throw new Error("PLAYBOOK.md must open with a `# ` title.");

  // --- Router: copy verbatim, but only if every pointer resolves -------------
  const router = readFileSync(templatePath, "utf8");
  const referenced = new Set([...router.matchAll(/reference\/([\w.-]+\.md)/g)].map((m) => m[1]!));
  const generated = new Set(Object.values(SECTION_FILES));

  const dangling = [...referenced].filter((f) => !generated.has(f));
  const unlisted = [...generated].filter((f) => !referenced.has(f));
  if (dangling.length) {
    throw new Error(`agent/AGENT.template.md points at non-existent reference file(s): ${dangling.join(", ")}`);
  }
  if (unlisted.length) {
    throw new Error(
      `agent/AGENT.template.md does not route to: ${unlisted.join(", ")}\n` +
        `Every shipped section needs a row in the router, or agents will never load it.`,
    );
  }
  writeFileSync(join(outPlaybook, "AGENT.md"), router.replace(/^<!--[\s\S]*?-->\n/, ""), "utf8");
  console.log(`router:    assets/playbook/AGENT.md (${referenced.size} pointers verified)`);

  // --- Issue templates ------------------------------------------------------
  const srcTemplates = join(ROOT, ".github", "ISSUE_TEMPLATE");
  if (!existsSync(srcTemplates)) throw new Error("missing .github/ISSUE_TEMPLATE — nothing to ship");
  rmSync(dirname(outTemplates), { recursive: true, force: true });
  mkdirSync(outTemplates, { recursive: true });
  cpSync(srcTemplates, outTemplates, { recursive: true });
  console.log(`templates: .github/ISSUE_TEMPLATE → assets/templates/ISSUE_TEMPLATE`);
}

main();
