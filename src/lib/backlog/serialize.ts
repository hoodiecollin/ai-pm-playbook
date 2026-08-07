/**
 * Frontmatter serialization for the materialized backlog.
 *
 * Every value is JSON-encoded, which makes the block simultaneously valid YAML — JSON scalars and
 * flow sequences are a YAML subset — and parseable with `JSON.parse` and no dependency. That
 * matters more than it looks: issue titles routinely contain colons, quotes and emoji, all of which
 * break naive `key: value` writing, and a title that fails to round-trip reads as a local edit on
 * the next `pull` and manufactures a conflict out of nothing.
 *
 * The body is stored verbatim after the closing fence, with no blank line inserted, so that parsing
 * is an exact inverse of rendering down to trailing whitespace and CRLF.
 */

import type { BacklogEntity, Comment, EntityKind, EntityState } from "./model.js";

const FENCE = "---";

export type EntityFrontmatter = Omit<BacklogEntity, "comments">;

/** Fixed key order — a stable rendering means re-pulling an unchanged issue is a no-op diff. */
const BODY_KEYS = ["number", "kind", "parent", "title", "state", "labels", "milestone"] as const;
const COMMENT_KEYS = ["id", "author", "createdAt"] as const;

function renderFrontmatter(pairs: [string, unknown][], body: string): string {
  const lines = pairs.map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${body}`;
}

/**
 * Split a document into its frontmatter map and its verbatim body.
 *
 * Only the *leading* fence pair is structural; a `---` inside the body is ordinary content, which
 * is why this scans for the terminator line by line rather than reaching for a regex over the file.
 */
function splitFrontmatter(text: string, what: string): { fields: Map<string, unknown>; body: string } {
  if (!text.startsWith(`${FENCE}\n`)) {
    throw new Error(`${what}: expected a frontmatter block opening with \`${FENCE}\`.`);
  }

  const rest = text.slice(FENCE.length + 1);
  const terminator = rest.indexOf(`\n${FENCE}\n`);
  // A file that is nothing but frontmatter still terminates, just with no body after it.
  const endsBare = rest.endsWith(`\n${FENCE}`) && terminator === -1;
  if (terminator === -1 && !endsBare) {
    throw new Error(`${what}: unterminated frontmatter block — no closing \`${FENCE}\`.`);
  }

  const head = endsBare ? rest.slice(0, rest.length - FENCE.length - 1) : rest.slice(0, terminator);
  const body = endsBare ? "" : rest.slice(terminator + FENCE.length + 2);

  const fields = new Map<string, unknown>();
  for (const line of head.split("\n")) {
    if (line.trim() === "") continue;
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`${what}: malformed frontmatter line: ${line}`);
    const key = line.slice(0, sep).trim();
    const raw = line.slice(sep + 1).trim();
    try {
      fields.set(key, JSON.parse(raw));
    } catch {
      throw new Error(`${what}: frontmatter field \`${key}\` is not a JSON value: ${raw}`);
    }
  }

  return { fields, body };
}

function require$<T>(fields: Map<string, unknown>, key: string, what: string, check: (v: unknown) => boolean): T {
  if (!fields.has(key)) throw new Error(`${what}: frontmatter is missing required field \`${key}\`.`);
  const v = fields.get(key);
  if (!check(v)) throw new Error(`${what}: frontmatter field \`${key}\` has the wrong type.`);
  return v as T;
}

const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number";
const isStringOrNull = (v: unknown) => v === null || typeof v === "string";
const isNumberOrNull = (v: unknown) => v === null || typeof v === "number";
const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

export function renderBody(e: BacklogEntity): string {
  const pairs = BODY_KEYS.map((k) => [k, e[k]] as [string, unknown]);
  return renderFrontmatter(pairs, e.body);
}

export function parseBody(text: string): EntityFrontmatter {
  const what = "issue";
  const { fields, body } = splitFrontmatter(text, what);
  return {
    number: require$<number>(fields, "number", what, isNumber),
    kind: require$<EntityKind>(fields, "kind", what, isString),
    parent: require$<number | null>(fields, "parent", what, isNumberOrNull),
    title: require$<string>(fields, "title", what, isString),
    state: require$<EntityState>(fields, "state", what, isString),
    labels: require$<string[]>(fields, "labels", what, isStringArray),
    milestone: require$<string | null>(fields, "milestone", what, isStringOrNull),
    body,
  };
}

export function renderComment(c: Comment): string {
  const pairs = COMMENT_KEYS.map((k) => [k, c[k]] as [string, unknown]);
  return renderFrontmatter(pairs, c.body);
}

export function parseComment(text: string): Comment {
  const what = "comment";
  const { fields, body } = splitFrontmatter(text, what);
  return {
    id: require$<number>(fields, "id", what, isNumber),
    author: require$<string>(fields, "author", what, isString),
    createdAt: require$<string>(fields, "createdAt", what, isString),
    body,
  };
}
