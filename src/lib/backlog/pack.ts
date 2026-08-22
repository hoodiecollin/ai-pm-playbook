/**
 * The context pack — two layers, and the split between them is the design.
 *
 * **The roster is complete and never truncated.** One line per neighbour, always, with an explicit
 * count of what was not expanded and the command to expand it. This is the property that cannot be
 * traded for size: silent truncation recreates the exact blindness the pack exists to fix, and an
 * agent that does not know a neighbour exists is the failure being fixed.
 *
 * **Depth is rationed**, composed of each neighbour's own summary rather than its raw body. A raw
 * excerpt says what a neighbour *contains*, not how it constrains you, and body length is wildly
 * uneven (p50=1,621 chars, max=40,931 on forgedb). Breadth is free — a roster line runs about 1% of
 * a body — so only depth is budgeted.
 */

import { readSummary } from "./summary.js";
import { expandable, withSummaries, type Neighbour } from "./neighbourhood.js";
import type { BacklogEntity } from "./model.js";

export interface PackOptions {
  /** Backstop only, never the primary mechanism. Depth shrinks; the roster never does. */
  byteBudget: number;
}

export const DEFAULT_BUDGET = 24_000;

const RELATION_LABEL: Record<Neighbour["relation"], string> = {
  "mention": "mentions / mentioned by",
  "epic-parent": "epic parent",
  "epic-sibling": "epic sibling",
  "surface": "same surface",
  "milestone": "same milestone",
};

function rosterLine(n: Neighbour): string {
  const state = n.state === "CLOSED" ? "closed" : n.rung ?? "open";
  return `- #${n.number} [${state}] ${n.title} — ${RELATION_LABEL[n.relation]}`;
}

export function renderPack(
  subject: BacklogEntity,
  neighbours: Neighbour[],
  entities: Map<number, BacklogEntity>,
  options: PackOptions = { byteBudget: DEFAULT_BUDGET },
): string {
  const out: string[] = [];

  out.push(`# Context for #${subject.number} — ${subject.title}`);
  out.push("");
  const own = readSummary(subject.body).text;
  out.push(own === null ? "_This issue has no summary section._" : own);
  out.push("");

  // --- Roster: complete, always -------------------------------------------------------------
  out.push(`## Neighbourhood — ${neighbours.length} issue(s)`);
  out.push("");
  if (!neighbours.length) {
    out.push("_Nothing else in the backlog references or shares context with this issue._");
    out.push("");
  } else {
    for (const n of neighbours) out.push(rosterLine(n));
    out.push("");
  }

  // --- Depth: ranked, budgeted, and honest about what it left out ----------------------------
  const candidates = withSummaries(expandable(neighbours), entities);
  const expanded: Neighbour[] = [];
  let spent = out.join("\n").length;

  for (const n of candidates) {
    const block = depthBlock(n);
    if (spent + block.length > options.byteBudget) break;
    expanded.push(n);
    spent += block.length;
  }

  if (expanded.length) {
    out.push(`## In depth — ${expanded.length} of ${candidates.length} open neighbour(s)`);
    out.push("");
    for (const n of expanded) out.push(depthBlock(n));
  }

  /*
   * Everything not expanded is named as a count with the command to expand it. A pack that quietly
   * stopped would read as a complete answer, which is the failure this whole command exists to
   * prevent — one level down.
   */
  const held = neighbours.length - expanded.length;
  if (held > 0) {
    out.push(`## Not expanded — ${held} issue(s)`);
    out.push("");
    const closed = neighbours.filter((n) => n.state === "CLOSED").length;
    if (closed) {
      out.push(`${closed} closed (roster only, by design — closed work is reference, not context).`);
    }
    const overflow = candidates.length - expanded.length;
    if (overflow > 0) out.push(`${overflow} open neighbour(s) past the size budget.`);
    out.push("");
    out.push("Every one of them is listed in the roster above. To read any of them in full:");
    out.push("");
    out.push("    pm-playbook context <issue>");
    out.push("");
  }

  return out.join("\n");
}

function depthBlock(n: Neighbour): string {
  const lines = [`### #${n.number} — ${n.title}`, ""];
  lines.push(`_${RELATION_LABEL[n.relation]}${n.rung ? ` · ${n.rung}` : ""}_`);
  lines.push("");
  // Absence is stated rather than guessed at. §9.6's contract returns nothing when the slot is
  // missing, and a fallback to "the first section" is 13 different things across this backlog.
  lines.push(n.summary === null || n.summary === undefined
    ? "_No summary section on this issue._"
    : n.summary);
  lines.push("");
  return lines.join("\n");
}
