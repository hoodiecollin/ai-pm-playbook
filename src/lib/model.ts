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

/** The three kinds of work (PLAYBOOK §3.1). Every work item carries exactly one. */
export type WorkType = "improvement" | "bugfix" | "experiment";

export interface GateSpec {
  /** 1-based ordinal. Gates are an ordered sequence; the number is part of the label. */
  n: number;
  /** The verb the derived ladder names this gate with (§2). `design` → `design-next`. */
  verb: string;
  /** Copied verbatim onto the gate label. §3.1: the description IS the process. */
  description: string;
  /**
   * The body a materialized gate opens with.
   *
   * Gates are created by the tool, so nobody is prompted by an issue template — this is where the
   * prompting has to live instead. An empty gate would be a checkbox; a seeded one asks the
   * questions the gate exists to force.
   */
  seed: string;
}

/**
 * The gate sequence per work type — the single table the whole model is generated from.
 *
 * Label names, label descriptions, gate counts, ladder state names and the completeness rule all
 * read this and nothing else, so adding a fourth work type is a row here rather than new logic.
 */
export const GATES: Record<WorkType, GateSpec[]> = {
  improvement: [
    {
      n: 1, verb: "design",
      description: "Gate 1 — the design: problem, desired behavior, solution shape, alternatives, non-goals. Closed means accepted.",
      seed: [
        "### Problem",
        "<!-- What is wrong or missing, in plain English. Not the solution. -->",
        "",
        "### Desired behavior",
        "",
        "### Solution shape",
        "<!-- Solution-SHAPED, not code-shaped. File lists and signatures belong to gate 2. -->",
        "",
        "### Alternatives considered",
        "",
        "### Non-goals & limits",
        "<!-- What this deliberately does not do. The most-skipped section and the most useful one. -->",
      ].join("\n"),
    },
    {
      n: 2, verb: "plan",
      description: "Gate 2 — the implementation plan: files, build order, interfaces, blockers, and the BDD scenarios to write. Closed means accepted.",
      seed: [
        "### Files to create / modify",
        "",
        "### Build order",
        "<!-- Each step independently reviewable, each leaving the suite green. -->",
        "",
        "### Interfaces / signatures",
        "",
        "### Dependencies & blockers",
        "",
        "### BDD scenarios (gate 3 seed)",
        "<!-- Given / When / Then. These ARE the acceptance criteria. -->",
        "",
        "### Execution gotchas",
      ].join("\n"),
    },
    {
      n: 3, verb: "impl",
      description: "Gate 3 — the build: scenarios RED, implement to GREEN, refactor under green. Closing it closes the work item.",
      seed: [
        "### RED",
        "<!-- The scenarios from gate 2, written as failing specs. Link the commit. -->",
        "",
        "### GREEN",
        "",
        "### Deviations from the plan",
        "<!-- Anything gate 2 got wrong. This is the feedback that makes the next plan better. -->",
      ].join("\n"),
    },
  ],
  bugfix: [
    {
      n: 1, verb: "diagnose",
      description: "Gate 1 — the diagnosis: reproduction, root cause, blast radius. For a hotfix this also carries the warrant. Closed means understood.",
      seed: [
        "### Reproduction",
        "<!-- Exact steps or inputs. If it cannot be reproduced, it cannot be diagnosed. -->",
        "",
        "### Root cause",
        "<!-- The mechanism, cited to a file and line. Not the symptom. -->",
        "",
        "### Blast radius",
        "",
        "### Warrant (hotfix only)",
        "<!-- Why waiting for the next scheduled release is unacceptable, in damage rather than time.",
        "     And what the fix will NOT touch: no public API, schema, config surface or dependency. -->",
      ].join("\n"),
    },
    {
      n: 2, verb: "fix",
      description: "Gate 2 — the fix, spec-first: the regression test fails before and passes after. Closing it closes the work item.",
      seed: [
        "### The regression test",
        "<!-- Written FIRST, from the reproduction above. Failing before, passing after — that is what",
        "     mechanically proves the fix is bounded. -->",
        "",
        "### The fix",
        "",
        "### Forward-port (hotfix only)",
        "<!-- A hotfix lands on `main` and is then merged forward. Not done until both carry it, or the",
        "     next release silently regresses the bug. -->",
      ].join("\n"),
    },
  ],
  experiment: [
    {
      n: 1, verb: "research",
      description: "Gate 1 — the charter: the question (which must be able to come back \"no\"), the decision it informs, the method, the scope bound, and what happens to any code produced.",
      seed: [
        "### The question",
        "<!-- Phrased so that \"no\" is a real possible answer. A question that can only come back yes",
        "     is not research, it is a plan wearing a costume. -->",
        "",
        "### The decision this informs",
        "",
        "### Method, and what \"fair\" means here",
        "<!-- §4 requires apples-to-apples. Say what would make the comparison dishonest. -->",
        "",
        "### Scope bound",
        "<!-- How far this goes before it stops and reports, expressed in work rather than time. -->",
        "",
        "### Disposal of any code produced",
        "<!-- POC code lives on `spike/<issue>-<slug>` and NEVER merges. The branch dies at verdict. -->",
      ].join("\n"),
    },
    {
      n: 2, verb: "evaluate",
      description: "Gate 2 — the verdict: what was done, the answer, its limits, and the disposition. A verdict is required to close, because the verdict IS the deliverable.",
      seed: [
        "### What was done",
        "",
        "### The answer",
        "",
        "### Limits",
        "<!-- What this does NOT establish. A finding used beyond its limits is worse than no finding. -->",
        "",
        "### Disposition",
        "<!-- Exactly one: COMMITS work (link the issues filed) · KILLS it (link what was closed as not",
        "     planned) · INCONCLUSIVE (say what would decide it). -->",
      ].join("\n"),
    },
  ],
};

export const WORK_TYPES = Object.keys(GATES) as WorkType[];

/** `improvement:gate-2`. Prefixed because the per-type descriptions describe different work (§3.1). */
export function gateLabel(type: WorkType, n: number): string {
  return `${type}:gate-${n}`;
}

/** Every gate label name, in type-then-ordinal order. */
export function allGateLabels(): string[] {
  return WORK_TYPES.flatMap((t) => GATES[t].map((g) => gateLabel(t, g.n)));
}

/** The type and ordinal a gate label names, or null when it is not a gate label. */
export function parseGateLabel(label: string): { type: WorkType; n: number } | null {
  const [type, tail] = label.split(":");
  if (!tail || !WORK_TYPES.includes(type as WorkType)) return null;
  const m = /^gate-(\d+)$/.exec(tail);
  if (!m) return null;
  const n = Number(m[1]);
  return GATES[type as WorkType].some((g) => g.n === n) ? { type: type as WorkType, n } : null;
}

/** The work type an issue's labels declare, or null when none or more than one is present. */
export function workTypeOf(labels: string[]): WorkType | null {
  const found = WORK_TYPES.filter((t) => labels.includes(t));
  return found.length === 1 ? found[0]! : null;
}

/** Is this issue a gate? True iff it carries any `{type}:gate-{n}` label. */
export function gateOf(labels: string[]): { type: WorkType; n: number } | null {
  for (const l of labels) {
    const g = parseGateLabel(l);
    if (g) return g;
  }
  return null;
}

/** The "what" axis (PLAYBOOK §3.1). Portable verbatim — the descriptions are the process. */
export const TYPE_LABELS: LabelSpec[] = [
  { name: "improvement", color: "0e8a16", description: "Work that makes the product better: features, refactors, performance, debt. Three gates: design → plan → impl." },
  { name: "bugfix", color: "d73a4a", description: "A defect in behavior that already exists. Two gates: diagnose → fix." },
  { name: "experiment", color: "a2eeef", description: "Work whose deliverable is a finding, not a shippable artifact. Two gates: research → evaluate. Never milestoned." },
  { name: "hotfix", color: "b60205", description: "A bugfix in released behavior that cannot wait: bounded, warranted, on its own patch milestone. Never alone — always with `bugfix`." },
  { name: "epic", color: "6f42c1", description: "Umbrella tracking issue; decomposes via native sub-issues. Not a work type, and never carries gates of its own." },
  { name: "release-gate", color: "b60205", description: "Blocks the tag: this milestone cannot be released until it is closed." },
];

/** The seven gate labels, generated from `GATES` so the two can never disagree. */
export const GATE_LABELS: LabelSpec[] = WORK_TYPES.flatMap((t) =>
  GATES[t].map((g) => ({ name: gateLabel(t, g.n), color: "ededed", description: g.description })),
);

/** Everything `bootstrap` creates, minus the dynamic `surface:*` set. */
export const CORE_LABELS: LabelSpec[] = [...TYPE_LABELS, ...GATE_LABELS];

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

/**
 * A patch milestone — `v1.2.1`, not `v1.2.0` (§5.6).
 *
 * The patch component being non-zero is the whole test. A two-component title (`v1.2`) names the
 * line rather than a patch on it, so its missing component reads as zero and it is not one.
 */
export function isPatchMilestone(title: string): boolean {
  const v = parseVersion(title);
  return v !== null && (v[2] ?? 0) > 0;
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

/** `label:a,b,c` — GitHub's OR form. Generated so a new gate can never be missed from a filter. */
const ANY_GATE = `label:${allGateLabels().join(",")}`;
const NO_GATE = allGateLabels().map((l) => `-label:${l}`).join(" ");

/**
 * The saved views (§8).
 *
 * **The derived ladder is not expressible here, and that is a deliberate limit rather than an
 * omission.** A bucket like "past design" is a property of a work item computed from its
 * *children*, and no GitHub filter can reach across the parent/sub-issue relation. So the views
 * split by audience: the board answers "what is being worked on" from the gates themselves, where
 * the state IS a label and a filter works; `pm-playbook ladder` answers "what stage is each work
 * item at", which needs computation; and the roadmap (§7.2) computes its own buckets.
 *
 * Every work-item view excludes gates. A three-item milestone whose gates all showed up would
 * render as twelve rows, and the roadmap would read as four times the work.
 */
export const VIEWS: ViewSpec[] = [
  { name: "Everything", layout: "table" },
  { name: "Work items", layout: "table", filter: NO_GATE },
  { name: "Epics", layout: "table", filter: "label:epic" },
  { name: "Labs", layout: "table", filter: "label:experiment" },
  { name: "Hotfixes", layout: "table", filter: "label:hotfix" },
  // The execution view that replaces the maturity-label boards: an open gate IS work in progress.
  { name: "Open gates", layout: "table", filter: `${ANY_GATE} is:open` },
  // "Can we tag?" — an open row here means the milestone it names is blocked (§5.2).
  { name: "Release gates", layout: "table", filter: "label:release-gate is:open" },
  { name: "Release spine", layout: "board", filter: NO_GATE, group: "Milestone" },
  { name: "Execution", layout: "board", group: "Status" },
  { name: "Surface Board", layout: "board", group: "surface:* label (multi-artifact repos only)" },
];
