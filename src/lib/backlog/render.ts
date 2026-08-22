/**
 * The report, as the exact block that gets emitted.
 *
 * Two constraints shape everything here, and both come from where this output is actually read.
 *
 * **It must be byte-identical for the same model.** A slash command's output reaches a reader only
 * when the model retypes it, so the instruction is "emit this verbatim" — and that is only worth
 * saying if the bytes are stable. A difference between two runs must mean the backlog moved.
 *
 * **It must be narrow.** Roughly 40 columns is what a phone shows before wrapping, and a fixed-width
 * table past 80 columns is precisely what made `ladder` unreadable there. So: markdown, no table,
 * no alignment padding that assumes a monospace viewport.
 */

import type { ItemLine, Report } from "./report.js";

/** Hard ceiling on any emitted line. Well inside a phone viewport once markdown is rendered. */
export const MAX_WIDTH = 60;

/** A summary longer than this is clipped — and says so. Silent truncation is forbidden (§6/#6). */
const SUMMARY_BUDGET = 240;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_BUDGET) return flat;
  return `${flat.slice(0, SUMMARY_BUDGET).trimEnd()}… (clipped — see the issue)`;
}

/** Wrap to MAX_WIDTH on word boundaries, so no emitted line can exceed the budget. */
function wrap(text: string, indent: string): string[] {
  const width = MAX_WIDTH - indent.length;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(indent + line);
      line = word;
    }
  }
  if (line) out.push(indent + line);
  return out;
}

/** `1✓ 2· 3·` — closed and open marks, absent gates omitted. Same vocabulary as `ladder`. */
function gateMarks(item: ItemLine): string {
  if (!item.gates.length) return "no gates yet";
  return item.gates.map((g) => `${g.n}${g.closed ? "✓" : "·"}`).join(" ");
}

function renderItem(item: ItemLine, out: string[]): void {
  out.push(`- **#${item.number}** — ${item.rung}`);
  out.push(...wrap(item.title, "  "));
  out.push("");
  // An absent summary is stated rather than omitted: a missing purpose is itself worth seeing on a
  // milestone review, and #55's contract returns nothing rather than guessing.
  out.push(...wrap(item.summary === null ? "_No summary on this issue._" : clip(item.summary), "  "));
  out.push("");
  out.push(`  gates: ${gateMarks(item)}`);
  out.push("");
}

export function renderReport(report: Report): string {
  const out: string[] = [];

  out.push(`## ${report.milestone} — what's left`);
  out.push("");

  if (!report.buckets.length) {
    out.push("Nothing open on this milestone.");
    out.push("");
    return out.join("\n");
  }

  for (const bucket of report.buckets) {
    if (bucket.epic) {
      out.push(`### Epic #${bucket.epic.number}`);
      out.push(...wrap(bucket.epic.title, ""));
      out.push("");
      out.push(...wrap(
        bucket.epic.summary === null ? "_No summary on this epic._" : clip(bucket.epic.summary),
        "",
      ));
      out.push("");
    } else {
      out.push("### Standalone");
      out.push("");
    }

    if (bucket.improvements.length) {
      out.push("**Improvements**");
      out.push("");
      for (const item of bucket.improvements) renderItem(item, out);
    }
    if (bucket.bugfixes.length) {
      out.push("**Bugfixes**");
      out.push("");
      for (const item of bucket.bugfixes) renderItem(item, out);
    }
  }

  const total = report.buckets.reduce((n, b) => n + b.improvements.length + b.bugfixes.length, 0);
  out.push(`_${total} open work item(s)._`);
  out.push("");

  return out.join("\n");
}
