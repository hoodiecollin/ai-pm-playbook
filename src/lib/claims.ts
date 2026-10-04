/**
 * Reading a gate body: the proof gate's claims table and one-way-door section, and whether a gate
 * still holds nothing but its seed.
 *
 * The shapes are defined in `model.ts` (`CLAIMS_HEADING`, `CLAIM_STATUSES`, `ONE_WAY_HEADING`) and
 * nowhere else; this module only parses them. PM018, PM019 and `pm-playbook prove` all call it, so
 * the linter and the command that closes a gate cannot disagree about what counts as evidence.
 */

import { CLAIMS_COLUMNS, CLAIMS_HEADING, CLAIM_STATUSES, ONE_WAY_HEADING, ONE_WAY_NONE, type ClaimStatus } from "./model.js";

export interface ClaimRow {
  claim: string;
  /** Lowercased, backticks stripped. Not narrowed: an unknown status is itself a finding. */
  status: string;
  evidence: string;
}

export interface ProofReport {
  rows: ClaimRow[];
  /** Why the gate cannot close. Empty means the claims table is sound. */
  problems: string[];
  /** `none` lets `prove` close the gate; `declared` means a human decides; `missing` is a problem. */
  oneWay: "none" | "declared" | "missing";
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");

/** The text under a `### heading`, up to the next heading of level 1–3. Null when absent. */
export function section(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase() === want);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** The claims table's rows. The header and the `---` separator are skipped; blank rows are too. */
export function parseClaims(body: string): ClaimRow[] | null {
  const text = section(body, CLAIMS_HEADING);
  if (text === null) return null;
  const rows: ClaimRow[] = [];
  let header = true;
  for (const line of stripComments(text).split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const c = cells(line);
    if (header) {
      header = false; // the first table line is the column header
      continue;
    }
    if (c.every((x) => /^:?-*:?$/.test(x))) continue; // separator or an empty row
    rows.push({
      claim: c[0] ?? "",
      status: (c[1] ?? "").replace(/`/g, "").trim().toLowerCase(),
      evidence: c[2] ?? "",
    });
  }
  return rows;
}

/** Judge a proof gate's body. Pure, so the linter and the closer share one verdict. */
export function evaluateProof(body: string): ProofReport {
  const problems: string[] = [];
  const rows = parseClaims(body);

  if (rows === null) problems.push(`there is no \`### ${CLAIMS_HEADING}\` section`);
  else if (rows.length === 0) problems.push("the claims table has no rows");

  for (const [i, r] of (rows ?? []).entries()) {
    const name = r.claim ? `"${r.claim}"` : `row ${i + 1}`;
    if (!(CLAIM_STATUSES as readonly string[]).includes(r.status)) {
      problems.push(`${name} has status \`${r.status || "(blank)"}\`; it must be one of ${CLAIM_STATUSES.join(", ")}`);
      continue;
    }
    const status = r.status as ClaimStatus;
    if (status === "assumed") problems.push(`${name} is assumed — run something, read the code, or declare it out-of-scope`);
    else if (!r.evidence.trim()) {
      problems.push(
        status === "out-of-scope"
          ? `${name} is out-of-scope with no reason given`
          : `${name} is \`${status}\` with no evidence (${status === "ran" ? "the command and its output" : "path:line @ commit"})`,
      );
    }
  }

  const doors = section(body, ONE_WAY_HEADING);
  const doorText = doors === null ? "" : stripComments(doors).replace(/[`*_.]/g, "").trim();
  const oneWay = doorText === "" ? "missing" : doorText.toLowerCase() === ONE_WAY_NONE.toLowerCase() ? "none" : "declared";
  if (oneWay === "missing") problems.push(`\`### ${ONE_WAY_HEADING}\` is empty — write \`${ONE_WAY_NONE}\` or list them`);

  return { rows: rows ?? [], problems, oneWay };
}

/**
 * True when a gate body holds nothing a person wrote: only the tool's marker, the quoted
 * description, the seeded headings and their guidance comments, and an empty table skeleton.
 */
export function isUnfilledGate(body: string): boolean {
  const residue = stripComments(body)
    .split("\n")
    .filter((l) => !/^#{1,6}\s/.test(l)) // headings
    .filter((l) => !/^>/.test(l)) // the quoted description and parent pointer
    .filter((l) => !/^\s*\|?[\s:|-]*\|?\s*$/.test(l)) // table separators and blank rows
    .filter((l) => !(l.trim().startsWith("|") && cells(l).join("|").toLowerCase() === CLAIMS_COLUMNS.join("|").toLowerCase()))
    .join("")
    .trim();
  return residue === "";
}
