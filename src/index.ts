/**
 * Programmatic API.
 *
 * Exposed so a consumer can build their own gate — a custom CI reporter, a bot that comments the
 * fix on the offending issue, a pre-commit hook — without shelling out to the CLI and parsing it.
 */

export { checkIssues, checkPullRequestScope, releaseBlockers, RULES } from "./lib/invariants.js";
export type { Violation, Severity, RuleMeta } from "./lib/invariants.js";

export {
  TYPE_LABELS, GATE_LABELS, CORE_LABELS, GATES, WORK_TYPES, VIEWS,
  SURFACE_COLORS, CORE_SURFACE, SURFACE_PREFIX, surfaceLabel,
  gateLabel, allGateLabels, parseGateLabel, workTypeOf, gateOf,
  isCoreMilestone, isPatchMilestone, parseVersion, compareMilestones, currentCycle,
} from "./lib/model.js";
export type { LabelSpec, ViewSpec, WorkType, GateSpec } from "./lib/model.js";

export { ladderState, LADDER_STATES } from "./lib/ladder.js";
export type { Ladder, GateView, WorkItemView } from "./lib/ladder.js";

export { listIssues, listMilestones, detectRepo, epicSubIssueCounts, fetchParentage, pullRequestScope, requireGh } from "./lib/gh.js";
export type { Issue, Milestone, IssueRef, PullRequestScope } from "./lib/gh.js";

export { MIGRATIONS, compareSemver, pendingMigrations, planMigrations } from "./lib/migrations.js";
export type { Migration, LabelRename, LabelRemoval, LabelAction } from "./lib/migrations.js";

export { detectDrift, readManifest, VENDOR_DIR } from "./lib/vendor.js";
export type { Manifest, DriftReport } from "./lib/vendor.js";

export { renderStanza, KNOWN_AGENT_FILES, DEFAULT_AGENT_FILE } from "./lib/agent-files.js";

export { PLAYBOOK_ASSETS, TEMPLATE_ASSETS, packageVersion } from "./lib/paths.js";
