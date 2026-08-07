/**
 * Drafts — issues that do not exist on GitHub yet.
 *
 * A draft has no number, which is the whole reason it needs its own shape: the tree is keyed by
 * issue number and a draft has nothing to key on until `create` succeeds. It lives under `new/`,
 * named by a slug, and its directory structure carries parentage exactly as the main tree does —
 * an epic's children sit in `subissues/`, so ordering creation is a directory walk rather than a
 * dependency graph.
 *
 * The `number` field is written back the instant GitHub returns one, *before* any follow-up call.
 * That ordering is load-bearing: `create` is the only non-idempotent operation in the system, and a
 * crash between creating an issue and linking it would otherwise duplicate the issue on retry.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BODY_FILE, SUBISSUES_DIR } from "./paths.js";
import type { Violation } from "../invariants.js";

export interface Draft {
  /** Directory name under `new/`. Human-chosen, stable, and never sent to GitHub. */
  slug: string;
  title: string;
  kind: "standalone" | "epic";
  labels: string[];
  milestone: string | null;
  body: string;
  /** Assigned by `create` and written back immediately. Non-null means "already exists". */
  number: number | null;
  children: Draft[];
}

const FENCE = "---";

export function renderDraft(d: Draft): string {
  const fields: [string, unknown][] = [
    ["title", d.title],
    ["kind", d.kind],
    ["labels", d.labels],
    ["milestone", d.milestone],
    ["number", d.number],
  ];
  return `${FENCE}\n${fields.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n${FENCE}\n${d.body}`;
}

export function parseDraft(slug: string, text: string, children: Draft[] = []): Draft {
  if (!text.startsWith(`${FENCE}\n`)) {
    throw new Error(`draft \`${slug}\`: expected a frontmatter block opening with \`${FENCE}\`.`);
  }
  const rest = text.slice(FENCE.length + 1);
  const end = rest.indexOf(`\n${FENCE}\n`);
  const bare = rest.endsWith(`\n${FENCE}`) && end === -1;
  if (end === -1 && !bare) throw new Error(`draft \`${slug}\`: unterminated frontmatter block.`);

  const head = bare ? rest.slice(0, rest.length - FENCE.length - 1) : rest.slice(0, end);
  const body = bare ? "" : rest.slice(end + FENCE.length + 2);

  const fields = new Map<string, unknown>();
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`draft \`${slug}\`: malformed frontmatter line: ${line}`);
    const key = line.slice(0, sep).trim();
    try {
      fields.set(key, JSON.parse(line.slice(sep + 1).trim()));
    } catch {
      throw new Error(`draft \`${slug}\`: field \`${key}\` is not a JSON value.`);
    }
  }

  const title = fields.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(`draft \`${slug}\`: \`title\` is required and must be a non-empty string.`);
  }
  const kind = fields.get("kind") ?? "standalone";
  if (kind !== "standalone" && kind !== "epic") {
    throw new Error(`draft \`${slug}\`: \`kind\` must be "standalone" or "epic" (a sub-issue is one nested under an epic).`);
  }
  const labels = fields.get("labels") ?? [];
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string")) {
    throw new Error(`draft \`${slug}\`: \`labels\` must be an array of strings.`);
  }
  const milestone = fields.get("milestone") ?? null;
  if (milestone !== null && typeof milestone !== "string") {
    throw new Error(`draft \`${slug}\`: \`milestone\` must be a string or null.`);
  }
  const number = fields.get("number") ?? null;
  if (number !== null && typeof number !== "number") {
    throw new Error(`draft \`${slug}\`: \`number\` must be a number or null.`);
  }

  return { slug, title, kind, labels: labels as string[], milestone, body, number, children };
}

/** Read every draft under `new/`, with an epic's children nested beneath it. */
export function readDrafts(newDir: string): Draft[] {
  if (!existsSync(newDir)) return [];
  return readdirSync(newDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readDraftDir(join(newDir, d.name), d.name))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function readDraftDir(dir: string, slug: string): Draft {
  const bodyFile = join(dir, BODY_FILE);
  if (!existsSync(bodyFile)) throw new Error(`draft \`${slug}\`: missing ${BODY_FILE}.`);

  const subDir = join(dir, SUBISSUES_DIR);
  const children = existsSync(subDir)
    ? readdirSync(subDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => readDraftDir(join(subDir, d.name), `${slug}/${d.name}`))
        .sort((a, b) => a.slug.localeCompare(b.slug))
    : [];

  return parseDraft(slug, readFileSync(bodyFile, "utf8"), children);
}

export interface DraftProblem {
  slug: string;
  message: string;
  fix: string;
}

/**
 * Validate drafts against the materialized label and milestone tables, plus structure.
 *
 * Everything here is local and offline — an unknown label must fail before any network call, not
 * after a half-created epic. Invariant violations are reported by the caller, which projects drafts
 * into issues and runs `checkIssues`; this covers what the invariants cannot see.
 */
export function validateDrafts(drafts: Draft[], labels: string[], milestones: string[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  const known = new Set(labels);
  const knownMilestones = new Set(milestones);

  const visit = (d: Draft, isChild: boolean): void => {
    for (const l of d.labels) {
      if (!known.has(l)) {
        out.push({
          slug: d.slug,
          message: `label \`${l}\` does not exist on the repository.`,
          fix: `Create it first (\`pm-playbook bootstrap --repo <o/n>\` for a canonical label), or remove it from the draft.`,
        });
      }
    }
    if (d.milestone && !knownMilestones.has(d.milestone)) {
      out.push({
        slug: d.slug,
        message: `milestone \`${d.milestone}\` does not exist on the repository.`,
        fix: `Create it: pm-playbook bootstrap --repo <o/n> --milestone ${d.milestone}`,
      });
    }
    // Structural: only an epic decomposes (§7.1, PM105). Enforced here so it cannot even be filed.
    if (d.children.length && d.kind !== "epic") {
      out.push({
        slug: d.slug,
        message: `has ${d.children.length} sub-issue draft(s) but its kind is \`${d.kind}\`. Only an epic decomposes.`,
        fix: `Set \`kind: "epic"\` on ${d.slug}/${BODY_FILE}, or move the children out.`,
      });
    }
    if (isChild && d.children.length) {
      out.push({
        slug: d.slug,
        message: "a sub-issue cannot itself have sub-issues; epics nest one level.",
        fix: `Flatten ${d.slug}/${SUBISSUES_DIR} into the parent epic.`,
      });
    }
    for (const c of d.children) visit(c, true);
  };

  for (const d of drafts) visit(d, false);
  return out;
}

/** Flatten to creation order: every epic before its children. */
export function creationOrder(drafts: Draft[]): { draft: Draft; parent: Draft | null }[] {
  const out: { draft: Draft; parent: Draft | null }[] = [];
  for (const d of drafts) {
    out.push({ draft: d, parent: null });
    for (const c of d.children) out.push({ draft: c, parent: d });
  }
  return out;
}

export type { Violation };
