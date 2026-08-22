/**
 * The summary slot — one named heading every body opens with, and the single contract for reading it.
 *
 * Two consumers compose an issue's own summary: the milestone report (#50) and the neighbourhood
 * pack (#6). If each derived it separately they would disagree the first time a body was unusual,
 * so the extraction lives here and both read it.
 *
 * **Absence returns null, never a guess.** There is deliberately no fallback to "the first section".
 * Measured across this backlog, 18 non-gate issues opened with 13 distinct headings and three with
 * none at all; on the repository used to verify this package at scale, 128 issues opened with ~45,
 * the largest cluster covering 20%. A guess that is usually right is worse than an absence that is
 * always legible — a caller can say "this issue has no summary" and mean it.
 */

/** The heading that opens every work item and epic body. Gates and release-gates are exempt. */
export const SUMMARY_HEADING = "In plain English";

export interface SummaryProbe {
  /** The slot's content, or null when the slot is absent. Empty string means present but unfilled. */
  text: string | null;
  /** The slot exists, but something other than an HTML comment precedes it. */
  misplaced: boolean;
}

/** A markdown ATX heading line: up to six `#`, a space, then the text. */
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

/**
 * Matched on the heading TEXT, never as a substring of the body — a body that happens to use the
 * words in a sentence must not be truncated at that sentence.
 */
function isSummaryHeading(line: string): boolean {
  const m = HEADING.exec(line.trim());
  return m !== null && m[2]!.toLowerCase() === SUMMARY_HEADING.toLowerCase();
}

function isHeading(line: string): boolean {
  return HEADING.test(line.trim());
}

/**
 * Read the summary slot.
 *
 * The slot's content is everything between its heading and the next heading **of any level** —
 * not the next heading of the same level. A `###` slot followed by a `##` is the case a naive
 * same-level scan swallows, and it is exactly the shape a body gets when someone adds a top-level
 * section below.
 */
export function readSummary(body: string): SummaryProbe {
  const lines = body.split("\n");

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSummaryHeading(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return { text: null, misplaced: false };

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i]!)) {
      end = i;
      break;
    }
  }

  return {
    text: lines.slice(start + 1, end).join("\n").trim(),
    misplaced: hasContentBefore(lines, start),
  };
}

/**
 * Is there anything before the slot that a reader would see?
 *
 * HTML comments do not count. Every seeded template opens with one — they carry the instructions
 * for filling the body in and are invisible when rendered, so treating them as content would report
 * every correctly-filled template as misplaced.
 */
function hasContentBefore(lines: string[], start: number): boolean {
  let inComment = false;
  for (const raw of lines.slice(0, start)) {
    const line = raw.trim();
    if (!line) continue;

    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    return true;
  }
  return false;
}
