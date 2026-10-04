/**
 * The canonical model data — single source of truth for the label taxonomy, the gate sets, the
 * views, and the vocabulary the invariants are written against.
 *
 * Label descriptions ARE the process (PLAYBOOK §3) — they are copied verbatim onto the labels so an
 * issue is self-documenting in the GitHub UI. Do not paraphrase them here.
 */

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

/** The three kinds of work (PLAYBOOK §3). Every work item carries exactly one. */
export type WorkType = "improvement" | "bugfix" | "experiment";

export interface GateSpec {
  /** 1-based position in the type's sequence. Ordering only — it is not part of the label. */
  n: number;
  /** The gate's name. Its label is `gate:<verb>`, and the ladder says `<verb>-next` / `-pending`. */
  verb: string;
  /** The full prose, used in the materialized gate's body. §3: the description IS the process. */
  description: string;
  /**
   * The same thing, said in ≤100 characters, because that is GitHub's hard cap on a label
   * description and it rejects the whole write rather than truncating. Kept separate from
   * `description` rather than derived from it: a machine-truncated sentence loses its verb and
   * stops being the process, which is the only reason the label carries a description at all.
   */
  labelDescription: string;
  /**
   * The body a materialized gate opens with.
   *
   * Gates are created by the tool, so nobody is prompted by an issue template — this is where the
   * prompting has to live instead. An empty gate would be a checkbox; a seeded one asks the
   * questions the gate exists to force.
   */
  seed: string;
  /** Owed only by a `hotfix`. The warrant is the one bugfix decision a human has to make. */
  hotfixOnly?: boolean;
}

/**
 * The proof gate's claims table — defined once, here, because the seed, PM018, `pm-playbook prove`
 * and the `prove` skill all read it. A second description of the shape is a second thing to drift.
 *
 * The statuses are the point of the table. `ran` and `read` are evidence; `out-of-scope` is a
 * deliberate decision that the claim does not matter, which has to be sayable or the only way to
 * clear an `assumed` row is to invent evidence for it. `assumed` blocks closing.
 */
export const CLAIMS_HEADING = "Claims";
export const CLAIMS_COLUMNS = ["Claim", "Status", "Evidence"] as const;
export const CLAIM_STATUSES = ["ran", "read", "out-of-scope", "assumed"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * The proof gate's one-way-door section. `None` (exactly, case-insensitively) is the only content
 * that lets `prove` close the gate itself; anything else means a human decides.
 */
export const ONE_WAY_HEADING = "One-way doors";
export const ONE_WAY_NONE = "None";

/** Marks a gate created by 4.x tooling. The body rules (PM018/PM019) only read gates carrying it. */
export const GATE_MARKER_VERSION = "v4";

/**
 * The first line of every materialized gate. It names the parent so a gate created but never
 * linked (a run that died in between) can be adopted rather than duplicated, and it carries the
 * model version so the body rules never judge a gate written under older rules.
 */
export function gateMarker(parent: number): string {
  return `<!-- pm-playbook:gate ${GATE_MARKER_VERSION} parent=#${parent} -->`;
}

/** Matches the marker of any version, capturing the parent number. */
export const GATE_MARKER_RE = /pm-playbook:gate (?:v\d+ )?parent=#(\d+)/;

export function hasCurrentGateMarker(body: string): boolean {
  return body.includes(`pm-playbook:gate ${GATE_MARKER_VERSION} parent=#`);
}

/**
 * The gate sequence per work type — the single table the whole model is generated from.
 *
 * A gate exists only where a human has to decide something the agent cannot, and where deciding it
 * first is cheaper than deciding it after. Anything else is evidence (which the agent produces) or
 * status (which the tool derives). That rule is why a plain bugfix has no gates: its decisions are
 * proven by a failing-then-passing test and reviewed on the PR, which is where they actually get
 * reviewed.
 */
export const GATES: Record<WorkType, GateSpec[]> = {
  improvement: [
    {
      n: 1, verb: "intent",
      description: "Intent — the problem, the outcome, the acceptance examples and the non-goals. A human decides this; closed means accepted.",
      labelDescription: "Intent: problem, outcome, acceptance examples, non-goals. A human closes it.",
      seed: [
        "<!-- Keep this short — under ~400 words. It is approved by reading, so it must be readable.",
        "     How it will work is NOT decided here; that is the proof gate, which closes on evidence. -->",
        "",
        "### Problem",
        "<!-- What is wrong or missing, and for whom. Not the solution. -->",
        "",
        "### Outcome",
        "<!-- What is true when this is done, observable from outside the code. -->",
        "",
        "### Acceptance examples",
        "<!-- Given / When / Then. These become the first failing tests in the build. -->",
        "",
        "### Non-goals",
        "<!-- What this deliberately does not do. -->",
      ].join("\n"),
    },
    {
      n: 2, verb: "proof",
      description: "Proof — the approach, and evidence for every claim it rests on. Closes only when no claim is merely assumed.",
      labelDescription: "Proof: the approach and evidence for every claim. Cannot close while a claim is assumed.",
      seed: [
        "<!-- The approach is proven here, not argued. A claim about a tool, a runtime, a library or",
        "     this codebase is evidence only once something was RUN or the code was READ at a commit. -->",
        "",
        "### Approach",
        "<!-- How it will work, in a few sentences. -->",
        "",
        `### ${CLAIMS_HEADING}`,
        "<!-- Every claim the approach depends on. Status is one of:",
        "       ran          — the command, and its output or a CI link",
        "       read         — path:line @ commit",
        "       out-of-scope — why it does not matter",
        "       assumed      — not yet proven. Blocks closing. -->",
        "",
        `| ${CLAIMS_COLUMNS.join(" | ")} |`,
        `|${CLAIMS_COLUMNS.map(() => "---").join("|")}|`,
        "",
        "### Spike",
        "<!-- Branch and commit of any throwaway probe code (`spike/<issue>-<slug>`). It never merges. -->",
        "",
        "### Pre-mortem",
        "<!-- Assume this shipped and failed. What broke? Each answer becomes a claim above or a non-goal. -->",
        "",
        `### ${ONE_WAY_HEADING}`,
        `<!-- Choices that are expensive to reverse once shipped: a public API, an on-disk format, a published`,
        `     name. Write \`${ONE_WAY_NONE}\` if there are none — then \`pm-playbook prove\` may close this gate.`,
        "     Anything else means a human closes it. -->",
      ].join("\n"),
    },
  ],
  bugfix: [
    {
      n: 1, verb: "warrant", hotfixOnly: true,
      description: "Warrant (hotfix only) — why this cannot wait for the next release, and what the fix will not touch. A human decides.",
      labelDescription: "Warrant (hotfix only): why it cannot wait, and what the fix will not touch.",
      seed: [
        "### Reproduction",
        "<!-- Exact steps or inputs against the released version. -->",
        "",
        "### Damage",
        "<!-- What harm accrues while this waits for the next scheduled release: data loss, a security",
        "     hole, a broken install, wrong output users act on. Damage, never duration. -->",
        "",
        "### Bound",
        "<!-- What the fix will NOT touch: no public API, schema, config surface, dependency bump or new",
        "     capability. If it must touch one of those, it is not a hotfix. -->",
      ].join("\n"),
    },
  ],
  experiment: [
    {
      n: 1, verb: "charter",
      description: "Charter — the question (which must be able to come back \"no\"), the decision it informs, the method, the scope bound, and what happens to any code produced.",
      labelDescription: "Charter: the question, the decision it informs, the method, the bound.",
      seed: [
        "### The question",
        "<!-- Phrased so that \"no\" is a real possible answer. -->",
        "",
        "### The decision this informs",
        "",
        "### Method, and what \"fair\" means here",
        "<!-- Say what would make the comparison dishonest. -->",
        "",
        "### Scope bound",
        "<!-- How far this goes before it stops and reports, in work rather than time. -->",
        "",
        "### Disposal of any code produced",
        "<!-- POC code lives on `spike/<issue>-<slug>` and never merges. The branch dies at the verdict. -->",
      ].join("\n"),
    },
    {
      n: 2, verb: "verdict",
      description: "Verdict — what was done, the answer, its limits, and the disposition. The verdict IS the deliverable.",
      labelDescription: "Verdict: the answer, its limits, the disposition. The verdict IS the work.",
      seed: [
        "### What was done",
        "",
        "### The answer",
        "",
        "### Limits",
        "<!-- What this does NOT establish. -->",
        "",
        "### Disposition",
        "<!-- Exactly one: COMMITS work (link the issues filed) · KILLS it (link what was closed as not",
        "     planned) · INCONCLUSIVE (say what would decide it). -->",
      ].join("\n"),
    },
  ],
};

export const WORK_TYPES = Object.keys(GATES) as WorkType[];

/** The prefix every gate label carries. */
export const GATE_PREFIX = "gate:";

/**
 * A gate from before 4.0. The 4.0 migration renames every legacy gate label that has no 4.x
 * equivalent onto this one, so history keeps its shape (a closed gate is still a gate) while no old
 * gate can be read as a new one. An OPEN retired gate is PM020.
 */
export const RETIRED_GATE = "gate:retired";

/** `gate:proof`. The verb alone names the gate: no two types share one. */
export function gateLabel(type: WorkType, n: number): string {
  const spec = GATES[type].find((g) => g.n === n);
  if (!spec) throw new Error(`${type} has no gate ${n}`);
  return `${GATE_PREFIX}${spec.verb}`;
}

/** Every live gate label name, in type-then-ordinal order. Excludes `gate:retired`. */
export function allGateLabels(): string[] {
  return WORK_TYPES.flatMap((t) => GATES[t].map((g) => gateLabel(t, g.n)));
}

/** The gates a work item owes, given its type and labels. A plain bugfix owes none. */
export function gatesFor(type: WorkType, labels: string[]): GateSpec[] {
  const hotfix = labels.includes("hotfix");
  return GATES[type].filter((g) => !g.hotfixOnly || hotfix);
}

export interface GateRef {
  /** Null only for a retired gate, which belongs to no 4.x type. */
  type: WorkType | null;
  /** Position in the type's sequence; 0 for a retired gate, which no ladder walks. */
  n: number;
  verb: string;
  retired: boolean;
}

/** The gate a label names, or null when it is not a gate label. */
export function parseGateLabel(label: string): GateRef | null {
  if (label === RETIRED_GATE) return { type: null, n: 0, verb: "retired", retired: true };
  // A pre-4.0 label on a repo that has not migrated yet. It is still a gate structurally — reading
  // it as a plain sub-issue would report every old gate as a PM105 violation — but it is no stage
  // of the 4.x model, so it is treated exactly like `gate:retired` until `migrate` renames it.
  if (isLegacyGateLabel(label)) return { type: null, n: 0, verb: "legacy", retired: true };
  if (!label.startsWith(GATE_PREFIX)) return null;
  const verb = label.slice(GATE_PREFIX.length);
  for (const type of WORK_TYPES) {
    const spec = GATES[type].find((g) => g.verb === verb);
    if (spec) return { type, n: spec.n, verb, retired: false };
  }
  return null;
}

/**
 * A gate label from before 4.0 — `improvement:gate-2` and friends. After `migrate` none should
 * exist; one appearing means a repo that has not migrated, or a hand-made label.
 */
export function isLegacyGateLabel(label: string): boolean {
  return /^(improvement|bugfix|experiment):gate-\d+$/.test(label);
}

/** The work type an issue's labels declare, or null when none or more than one is present. */
export function workTypeOf(labels: string[]): WorkType | null {
  const found = WORK_TYPES.filter((t) => labels.includes(t));
  return found.length === 1 ? found[0]! : null;
}

/** Is this issue a gate? True iff it carries a `gate:*` label, including `gate:retired`. */
export function gateOf(labels: string[]): GateRef | null {
  for (const l of labels) {
    const g = parseGateLabel(l);
    if (g) return g;
  }
  return null;
}

/**
 * GitHub's hard cap on a label description. It rejects the entire write with a 422 rather than
 * truncating, so an over-long description is not a cosmetic problem — it means the label is never
 * created, and `bootstrap` leaves the repo half-provisioned.
 */
export const MAX_LABEL_DESCRIPTION = 100;

/** The "what" axis (PLAYBOOK §3). Portable verbatim — the descriptions are the process. */
export const TYPE_LABELS: LabelSpec[] = [
  { name: "improvement", color: "0e8a16", description: "Makes the product better: features, refactors, perf, debt. Gates: intent → proof, then build." },
  { name: "bugfix", color: "d73a4a", description: "A defect in existing behavior. No gates: the PR carries a test that fails before, passes after." },
  { name: "experiment", color: "a2eeef", description: "Deliverable is a finding, not an artifact. Gates: charter → verdict. Never milestoned." },
  { name: "hotfix", color: "b60205", description: "Urgent bugfix in released behavior, on its own patch milestone. One gate: the warrant." },
  { name: "epic", color: "6f42c1", description: "Umbrella tracking issue; decomposes via sub-issues. Not a work type, and never carries gates." },
  { name: "release-gate", color: "b60205", description: "Blocks the tag: this milestone cannot be released until it is closed." },
];

/** The five live gate labels, generated from `GATES` so the two can never disagree. */
export const GATE_LABELS: LabelSpec[] = WORK_TYPES.flatMap((t) =>
  GATES[t].map((g) => ({ name: gateLabel(t, g.n), color: "ededed", description: g.labelDescription })),
);

/**
 * `gate:retired`. Not provisioned by `bootstrap` — a fresh repo has no history to retire — but the
 * 4.0 migration writes this description onto it, so the label explains itself in the UI.
 */
export const RETIRED_GATE_LABEL: LabelSpec = {
  name: RETIRED_GATE,
  color: "cfd3d7",
  description: "A gate from before pm-playbook 4.0, kept as history. An open one should be closed as not planned.",
};

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
/** The implicit default surface. Only *non-core* surfaces are excluded from the core spine (§6). */
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
 * A patch milestone — `v1.2.1`, not `v1.2.0` (§5).
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
 * The cycle in flight (§5): the lowest open core milestone whose release line has not already
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
const NO_GATE = [...allGateLabels(), RETIRED_GATE].map((l) => `-label:${l}`).join(" ");

/**
 * The saved views (§8).
 *
 * **The derived ladder is not expressible here, and that is a deliberate limit rather than an
 * omission.** A bucket like "past design" is a property of a work item computed from its
 * *children*, and no GitHub filter can reach across the parent/sub-issue relation. So the views
 * split by audience: the board answers "what is being worked on" from the gates themselves, where
 * the state IS a label and a filter works; `pm-playbook ladder` answers "what stage is each work
 * item at", which needs computation; and the roadmap (§7) computes its own buckets.
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
  // "Can we tag?" — an open row here means the milestone it names is blocked (§5).
  { name: "Release gates", layout: "table", filter: "label:release-gate is:open" },
  { name: "Release spine", layout: "board", filter: NO_GATE, group: "Milestone" },
  { name: "Execution", layout: "board", group: "Status" },
  { name: "Surface Board", layout: "board", group: "surface:* label (multi-artifact repos only)" },
];
