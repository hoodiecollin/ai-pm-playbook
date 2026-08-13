/**
 * The stanza is the highest-leverage text this package writes, and the easiest to leave behind.
 *
 * It lands in CLAUDE.md / AGENTS.md — always-loaded context — so an agent reads it in every session
 * whether or not the task touches project management, and it is the ONLY doctrine most sessions
 * ever see. It also carries its own version number, which means a stale block does not read as
 * stale: it reads as current and gets obeyed.
 *
 * That is exactly what shipped in 2.0.0. The vendored doctrine was rewritten for the two-axis
 * model, `renderStanza` was not, and every consumer that ran `init` got a block headed
 * "pm-playbook v2.0.0" whose invariants were the retired 1.x ones. Nothing failed — the labels the
 * block named no longer existed, so the rules it stated were unenforceable rather than wrong-looking.
 *
 * These tests hold the stanza to the taxonomy the package actually ships.
 */

import { describe, expect, test } from "bun:test";
import { BEGIN, END, renderStanza } from "../src/lib/agent-files.js";
import { TYPE_LABELS, WORK_TYPES } from "../src/lib/model.js";
import { MIGRATIONS } from "../src/lib/migrations.js";

const stanza = renderStanza("9.9.9");

describe("the stanza teaches the current taxonomy", () => {
  for (const type of WORK_TYPES) {
    test(`names the \`${type}\` work type`, () => {
      expect(stanza).toContain(type);
    });
  }

  test("states that a milestone means committed", () => {
    // The single sentence 2.0 turns on. If the stanza still says a milestone means "scheduled",
    // every agent reading it will file unscheduled-but-committed work with no milestone at all.
    expect(stanza.toLowerCase()).toContain("committed");
  });

  test("points at the vendored doctrine rather than restating it", () => {
    expect(stanza).toContain("AGENT.md");
  });

  test("routes the agent to the local mirror", () => {
    // `pull` builds a full local copy of the backlog, and for the first two releases nothing in
    // the always-loaded context mentioned it — so agents spent a round trip per question against
    // a mirror sitting unread on disk. A capability nothing routes to does not exist.
    expect(stanza).toContain("backlog/");
    expect(stanza).toContain("pull");
  });

  test("says the mirror is read-only without a reconciling write", () => {
    // The dangerous misreading is "these are files, so I can edit them to change an issue."
    expect(stanza).toContain("push");
  });

  test("is delimited so a re-init replaces it in place", () => {
    expect(stanza).toStartWith(BEGIN);
    expect(stanza).toEndWith(END);
  });
});

describe("the stanza never names a retired label", () => {
  // Derived from the migration log rather than hardcoded, so retiring a label in a future release
  // automatically extends this check to it. That is the property that makes this test worth having:
  // the next taxonomy change gets caught without anyone remembering to come back here.
  const retired = MIGRATIONS.flatMap((m) => [
    ...m.removals.map((r) => r.name),
    // A rename's source is equally gone — `tech-debt` is not a label any more either.
    ...m.renames.map((r) => r.from),
  ]);

  const live = new Set(TYPE_LABELS.map((l) => l.name));

  for (const name of [...new Set(retired)].filter((n) => !live.has(n))) {
    test(`does not mention \`${name}\``, () => {
      expect(stanza).not.toContain(`\`${name}\``);
    });
  }
});

describe("the version it claims is the version it is", () => {
  test("interpolates the version it was given", () => {
    expect(renderStanza("1.2.3")).toContain("pm-playbook v1.2.3");
  });
});
