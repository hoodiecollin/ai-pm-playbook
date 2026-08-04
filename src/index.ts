/**
 * Programmatic API.
 *
 * Exposed so a consumer can build their own gate — a custom CI reporter, a bot that comments the
 * fix on the offending issue, a pre-commit hook — without shelling out to the CLI and parsing it.
 */

export { checkIssues, checkPullRequestScope, releaseBlockers, RULES } from "./lib/invariants.js";
export type { Violation, Severity, RuleMeta } from "./lib/invariants.js";

export {
  MATURITY_LABELS, VIEWS, SURFACE_COLORS, CORE_SURFACE, SURFACE_PREFIX,
  surfaceLabel, isCoreMilestone, parseVersion, compareMilestones, currentCycle,
} from "./lib/model.js";
export type { LabelSpec, ViewSpec } from "./lib/model.js";

export { listIssues, listMilestones, detectRepo, epicSubIssueCounts, pullRequestScope, requireGh } from "./lib/gh.js";
export type { Issue, Milestone, IssueRef, PullRequestScope } from "./lib/gh.js";

export { detectDrift, readManifest, VENDOR_DIR } from "./lib/vendor.js";
export type { Manifest, DriftReport } from "./lib/vendor.js";

export { renderStanza, KNOWN_AGENT_FILES, DEFAULT_AGENT_FILE } from "./lib/agent-files.js";

export { PLAYBOOK_ASSETS, TEMPLATE_ASSETS, packageVersion } from "./lib/paths.js";
