/**
 * The extraction contract (#55). Both #6's neighbourhood pack and #50's milestone report read this
 * one function, so its edge cases are the places those two could otherwise disagree.
 */

import { describe, expect, test } from "bun:test";

import { SUMMARY_HEADING, readSummary } from "../src/lib/backlog/summary.js";

const H = `### ${SUMMARY_HEADING}`;

describe("readSummary — the happy path", () => {
  test("returns the text between the slot and the next heading", () => {
    const probe = readSummary(`${H}\n\nThe thing this issue is about.\n\n### What is the need?\n\nDetail.\n`);
    expect(probe.text).toBe("The thing this issue is about.");
    expect(probe.misplaced).toBe(false);
  });

  test("a template's leading HTML comment does not count as content before the slot", () => {
    const body = `<!--\n  Instructions for filling this in.\n-->\n\n${H}\n\nSummary text.\n\n### Next\n`;
    const probe = readSummary(body);
    expect(probe.text).toBe("Summary text.");
    expect(probe.misplaced).toBe(false);
  });

  test("the slot may be the whole body", () => {
    expect(readSummary(`${H}\n\nJust this.\n`).text).toBe("Just this.");
  });
});

describe("readSummary — ends at the next heading of ANY level", () => {
  test("a shallower heading closes the section", () => {
    // The case a same-level scan swallows: `###` slot, `##` section below it.
    const probe = readSummary(`${H}\n\nSummary.\n\n## A top-level section\n\nNot the summary.\n`);
    expect(probe.text).toBe("Summary.");
  });

  test("a deeper heading closes the section too", () => {
    const probe = readSummary(`${H}\n\nSummary.\n\n#### Deeper\n\nNot the summary.\n`);
    expect(probe.text).toBe("Summary.");
  });
});

describe("readSummary — absence is null, never a guess", () => {
  test("a body with a different first heading returns null", () => {
    expect(readSummary("### What is the need?\n\nSomething.\n").text).toBeNull();
  });

  test("a body with no heading at all returns null", () => {
    expect(readSummary("Just prose, no structure at all.\n").text).toBeNull();
  });

  test("an empty body returns null", () => {
    expect(readSummary("").text).toBeNull();
  });

  test("the words in a sentence are not a heading — no substring matching", () => {
    const body = `### What is the need?\n\nPut it in plain English for the reader.\n`;
    expect(readSummary(body).text).toBeNull();
  });
});

describe("readSummary — present but unfilled is not absent", () => {
  test("an empty slot is an empty string, not null", () => {
    const probe = readSummary(`${H}\n\n### What is the need?\n\nDetail.\n`);
    expect(probe.text).toBe("");
    expect(probe.text).not.toBeNull();
  });
});

describe("readSummary — position is a separate fact from presence", () => {
  test("a slot preceded by another section is present and misplaced", () => {
    const probe = readSummary(`### Background\n\nStuff.\n\n${H}\n\nSummary.\n`);
    expect(probe.text).toBe("Summary.");
    expect(probe.misplaced).toBe(true);
  });

  test("a slot preceded by loose prose is misplaced", () => {
    const probe = readSummary(`Some preamble nobody asked for.\n\n${H}\n\nSummary.\n`);
    expect(probe.misplaced).toBe(true);
  });
});

describe("readSummary — heading level and case", () => {
  test("the level does not matter, only the text", () => {
    expect(readSummary(`## ${SUMMARY_HEADING}\n\nSummary.\n`).text).toBe("Summary.");
    expect(readSummary(`# ${SUMMARY_HEADING}\n\nSummary.\n`).text).toBe("Summary.");
  });

  test("matching is case-insensitive", () => {
    expect(readSummary("### in plain english\n\nSummary.\n").text).toBe("Summary.");
  });
});
