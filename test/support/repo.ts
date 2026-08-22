/**
 * Throwaway repo roots and backlog fixtures for the command tests.
 *
 * Every command resolves its paths from `repoRoot`, so a test that omitted this would write into
 * the working tree's own `.pm-playbook/backlog/` and corrupt the mirror it is running inside.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";

import { backlogRoot, writeIndex, writeTable, writeTree, LABELS_FILE, MILESTONES_FILE } from "../../src/lib/backlog/store.js";
import { projectionHash } from "../../src/lib/backlog/project.js";
import type { BacklogEntity, Comment, EntityKind } from "../../src/lib/backlog/model.js";

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh repo root, removed when the file's tests finish. */
export function tempRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-playbook-test-"));
  roots.push(dir);
  return dir;
}

let counter = 0;

/**
 * A backlog entity. `kind` and `parent` default to a standalone work item, which is what most
 * assertions want; pass both together when building a gate or a sub-issue.
 */
export function entity(partial: Partial<BacklogEntity> = {}): BacklogEntity {
  counter += 1;
  const kind: EntityKind = partial.kind ?? "standalone";
  return {
    number: counter,
    kind,
    parent: null,
    title: `entity ${counter}`,
    state: "OPEN",
    labels: ["improvement"],
    milestone: null,
    body: "",
    comments: [],
    ...partial,
  };
}

export function comment(partial: Partial<Comment> = {}): Comment {
  counter += 1;
  return {
    id: counter,
    author: "someone",
    createdAt: "2026-01-01T00:00:00Z",
    body: `comment ${counter}`,
    ...partial,
  };
}

export interface SeedOptions {
  /** Written as the base snapshot. Omit to seed a tree with NO base — `push` refuses on that. */
  base?: BacklogEntity[] | "match";
  repo?: string;
  labels?: string[];
  /**
   * `check` reads this table as `{title, state}[]`, but the fakes hand out full `Milestone`s. Accept
   * the superset so a fixture can be shared between the two without a cast.
   */
  milestones?: { title: string; state: string; number?: number }[];
}

/**
 * Write a mirror into `repoRoot`.
 *
 * `base: "match"` records the base as equal to what was written, which is a clean mirror with no
 * pending edit. Passing entities instead records a *different* base, which is how a pending local
 * edit or a remote-moved conflict is set up.
 */
export function seedBacklog(
  repoRoot: string,
  entities: BacklogEntity[],
  options: SeedOptions = {},
): string {
  const root = backlogRoot(repoRoot);
  writeTree(root, new Map(entities.map((e) => [e.number, e])));

  if (options.labels) writeTable(root, LABELS_FILE, options.labels);
  if (options.milestones) writeTable(root, MILESTONES_FILE, options.milestones);

  const base = options.base === "match" ? entities : options.base;
  if (base) {
    writeIndex(root, new Map(base.map((e) => [e.number, projectionHash(e)])), options.repo ?? "owner/repo");
  }
  return root;
}
