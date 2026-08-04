/**
 * Locating the package's own shipped assets at runtime.
 *
 * The CLI is bundled to `dist/cli.js`, so `import.meta.url` resolves inside `dist/` and the
 * shipped assets sit one level up. Both paths are covered by `files` in package.json.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Package root — `dist/..` when bundled, `src/lib/../..` when run from source via Bun. */
export const PACKAGE_ROOT = existsSync(join(here, "..", "package.json"))
  ? resolve(here, "..")
  : resolve(here, "..", "..");

/** The generated, shippable playbook tree that gets vendored into consumer repos. */
export const PLAYBOOK_ASSETS = join(PACKAGE_ROOT, "assets", "playbook");

/** Issue templates copied into the consumer's `.github/ISSUE_TEMPLATE/`. */
export const TEMPLATE_ASSETS = join(PACKAGE_ROOT, "assets", "templates");

export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export function packageName(): string {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { name: string };
  return pkg.name;
}

/** Walk up from `start` to find the git repo root, falling back to `start`. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
