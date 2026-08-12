/**
 * The canonical model data — single source of truth for the label taxonomy, the views, and the
 * vocabulary the invariants are written against.
 *
 * Label descriptions ARE the process (PLAYBOOK §3.1) — they are copied verbatim onto the labels
 * so an issue is self-documenting in the GitHub UI. Do not paraphrase them here.
 */

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

/** The "what / maturity" axis (PLAYBOOK §3.1). Portable verbatim. */
export const MATURITY_LABELS: LabelSpec[] = [
  { name: "idea", color: "c5def5", description: "Speculative feature idea; needs a design note before implementation." },
  { name: "plan-next", color: "0e8a16", description: "Committed but not yet scheduled to a version milestone (milestone = scheduled)." },
  { name: "rfc", color: "5319e7", description: "Request for comment: design captured as an issue (proposals no longer committed to the repo)." },
  { name: "experiment", color: "a2eeef", description: "A spike to measure; deliverable is a decision, not a shippable artifact. Never milestoned." },
  { name: "epic", color: "6f42c1", description: "Umbrella tracking issue; decomposes via native sub-issues." },
  { name: "tech-debt", color: "fbca04", description: "Known gap or stub in shipped code." },
  { name: "perf", color: "d93f0b", description: "Performance cost / triage item." },
  { name: "config", color: "1d76db", description: "Configurable-runtime-behavior work." },
  { name: "legacy-audit", color: "5319e7", description: "Legacy audit: prune dead / product-misaligned code." },
  { name: "release-gate", color: "b60205", description: "Blocks the tag: this milestone cannot be released until it is closed." },
];

export const SURFACE_COLORS: Record<string, string> = {
  "ide-extension": "007ACC",
  website: "1d76db",
  cli: "1d76db",
  sdk: "1d76db",
  core: "1d76db",
};

export const SURFACE_PREFIX = "surface:";
/** The implicit default surface. Only *non-core* surfaces are excluded from the core spine (§6.1). */
export const CORE_SURFACE = "surface:core";

export function surfaceLabel(surface: string): LabelSpec {
  return {
    name: `${SURFACE_PREFIX}${surface}`,
    color: SURFACE_COLORS[surface] ?? "1d76db",
    description: `Product surface: ${surface}.`,
  };
}

/**
 * A "core" milestone is a version on the primary release spine (§5) — `v0.4.0`, `v1.0.0`.
 * Non-core surfaces version in their own namespace (`ext-v0.1.0`), which this deliberately misses.
 */
export function isCoreMilestone(title: string): boolean {
  return /^v\d/i.test(title.trim());
}

/** Numeric components of a `vX.Y.Z` title, or null when it is not a core milestone. */
export function parseVersion(title: string): number[] | null {
  const m = /^v(\d+(?:\.\d+)*)/i.exec(title.trim());
  if (!m) return null;
  return m[1]!.split(".").map(Number);
}

/** Compare core milestone titles by version order. Shorter sorts first (`v1` before `v1.1`). */
export function compareMilestones(a: string, b: string): number {
  const va = parseVersion(a) ?? [];
  const vb = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The `major.minor` release line a core milestone belongs to — `v1.2.1` and `v1.2.0` share one. */
function releaseLine(title: string): string | null {
  const v = parseVersion(title);
  return v ? `${v[0] ?? 0}.${v[1] ?? 0}` : null;
}

/**
 * The cycle in flight (§5.3): the lowest open core milestone whose release line has not already
 * shipped.
 *
 * DERIVED, never configured. A constant would be one more thing that drifts from the actual spine;
 * this advances on its own the moment a milestone closes. That is also its one prerequisite —
 * closing the milestone must be part of the release ritual. A milestone left open after its tag
 * freezes the cycle here and starts blocking legitimate next-cycle work, loudly, which is the
 * right direction to fail in.
 *
 * The line clause is why a *patch* milestone does not hijack the gate. Patching a released version
 * means opening a milestone that sorts BELOW the cycle, so a plain "lowest open" would name it and
 * fail every legitimate PR for as long as it stayed open. A closed milestone on the same line is
 * the evidence that line shipped — the same release-ritual prerequisite, used for a second
 * question. Note this deliberately does NOT rescue the open-after-tag case above: nothing on that
 * line is closed, so it still freezes, still loudly.
 *
 * When every open milestone is on a shipped line, fall back to the lowest of them rather than
 * returning null — null disarms PM008 entirely, and nothing can be later than the highest open
 * milestone anyway. Null stays reserved for a spine with nothing open at all.
 */
export function currentCycle(milestones: { title: string; state: string }[]): string | null {
  const core = milestones.filter((m) => isCoreMilestone(m.title));
  const shipped = new Set(
    core.filter((m) => m.state.toLowerCase() === "closed").map((m) => releaseLine(m.title)),
  );
  const open = core
    .filter((m) => m.state.toLowerCase() === "open")
    .map((m) => m.title)
    .sort(compareMilestones);
  return open.find((t) => !shipped.has(releaseLine(t))) ?? open[0] ?? null;
}

/**
 * Project views (§8). `filter` is scriptable; `group` is not — GitHub has no API for grouping, so
 * grouped boards are created ungrouped and the group-by is set once in the UI.
 */
export interface ViewSpec {
  name: string;
  layout: "table" | "board";
  filter?: string;
  group?: string;
}

export const VIEWS: ViewSpec[] = [
  { name: "Everything", layout: "table" },
  { name: "Epics", layout: "table", filter: "label:epic" },
  { name: "Planned", layout: "table", filter: "label:plan-next" },
  { name: "Labs", layout: "table", filter: "label:experiment,rfc" },
  { name: "Ideas", layout: "table", filter: "label:idea" },
  // "Can we tag?" — an open row here means the milestone it names is blocked (§5.2).
  { name: "Release gates", layout: "table", filter: "label:release-gate is:open" },
  { name: "Release spine", layout: "board", group: "Milestone" },
  { name: "Execution", layout: "board", group: "Status" },
  { name: "Surface Board", layout: "board", group: "surface:* label (multi-artifact repos only)" },
];
