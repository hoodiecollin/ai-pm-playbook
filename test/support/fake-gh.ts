/**
 * The single fake for `src/lib/gh.ts`, and the only place a command test mocks anything.
 *
 * Why the fake sits at `gh.ts` rather than at `sh.ts`: a test written against the subprocess layer
 * encodes `gh` argv, so rewording a query breaks tests that care about nothing of the kind. Faking
 * the module above it keeps a test written against *"the backlog is these entities"*.
 *
 * ## `mock.module` is process-global — this is the whole reason this file exists
 *
 * Bun imports every test file before running any test, so a top-level `await mock.module(...)`
 * anywhere applies EVERYWHERE. Registering this fake at module scope was measured to break eight
 * tests in `backlog-fetch.test.ts`, a file that exercises the real `toBacklogEntity` and knows
 * nothing about commands — and it did so even when that file was listed first on the command line.
 *
 * Three things confine it, and all three are wrapped here so no caller can get them wrong:
 *
 *   1. registration happens in `beforeAll`, never at module scope;
 *   2. `mock.restore()` runs in `afterAll`;
 *   3. the fake is built by SPREADING the real module, so anything not overridden stays real and a
 *      leak degrades to a no-op instead of a crash.
 *
 * (3) also removes a maintenance obligation: a partial fake fails at *import* time with
 * `SyntaxError: Export named 'updateIssue' not found`, so a hand-listed fake would rot silently
 * every time `gh.ts` gains an export.
 */

import { afterAll, beforeAll, mock } from "bun:test";

import * as realGh from "../../src/lib/gh.js";
import type { BacklogEntity } from "../../src/lib/backlog/model.js";
import type { Issue, Milestone } from "../../src/lib/gh.js";

type GhModule = typeof realGh;

export interface Call {
  fn: string;
  args: unknown[];
}

/** What the networked half of `gh.ts` returns. Anything omitted falls back to an empty answer. */
export interface FakeData {
  repo?: string | null;
  issues?: Issue[];
  milestones?: Milestone[];
  labels?: string[];
  backlog?: BacklogEntity[];
  parentage?: realGh.Parentage;
  subIssueCounts?: Map<number, number> | null;
  prScope?: realGh.PullRequestScope;
  /** Number handed back by `createIssue`, incremented per call. */
  nextIssueNumber?: number;
}

export interface FakeGh {
  /** Every faked call, in order. */
  calls: Call[];
  /** Only the calls that would have changed GitHub. */
  mutations(): Call[];
  /** Calls to one function, in order. */
  callsTo(fn: string): Call[];
  /** Replace the canned data mid-test. */
  set(data: FakeData): void;
  reset(): void;
}

/** The four that write to GitHub. `migrate`'s label verbs are asserted in its own file. */
const MUTATING = new Set(["updateIssue", "createIssue", "addComment", "addSubIssue"]);

/**
 * Install the fake for the calling test file.
 *
 * Call at describe scope; it registers its own `beforeAll`/`afterAll`. The returned handle is
 * populated by the time any test body runs.
 */
export function installFakeGh(initial: FakeData = {}): FakeGh {
  const calls: Call[] = [];
  let data: FakeData = { ...initial };
  let counter = data.nextIssueNumber ?? 1000;

  const record = <T>(fn: string, value: T) => (...args: unknown[]): T => {
    calls.push({ fn, args });
    return value;
  };
  const recordAsync = <T>(fn: string, value: () => T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ fn, args });
    return value();
  };

  const handle: FakeGh = {
    calls,
    mutations: () => calls.filter((c) => MUTATING.has(c.fn)),
    callsTo: (fn) => calls.filter((c) => c.fn === fn),
    set: (next) => {
      data = { ...data, ...next };
      if (next.nextIssueNumber !== undefined) counter = next.nextIssueNumber;
    },
    reset: () => {
      calls.length = 0;
    },
  };

  beforeAll(async () => {
    await mock.module("../../src/lib/gh.js", () => ({
      ...realGh,

      // --- environment -----------------------------------------------------------------------
      requireGh: recordAsync("requireGh", () => undefined),
      // `??` would be wrong here: `repo: null` is a configured answer meaning "could not detect",
      // and must not fall through to the default the way an absent key does.
      detectRepo: recordAsync("detectRepo", () => (data.repo === undefined ? "owner/repo" : data.repo)),
      ownerType: recordAsync("ownerType", () => "users" as const),

      // --- reads -----------------------------------------------------------------------------
      listIssues: recordAsync("listIssues", () => data.issues ?? []),
      listMilestones: recordAsync("listMilestones", () => data.milestones ?? []),
      listLabels: recordAsync("listLabels", () => data.labels ?? []),
      issueBody: recordAsync("issueBody", () => ""),
      fetchBacklog: recordAsync("fetchBacklog", () => data.backlog ?? []),
      fetchParentage: recordAsync("fetchParentage", () =>
        data.parentage ?? { parentOf: new Map(), all: new Map() }),
      epicSubIssueCounts: recordAsync("epicSubIssueCounts", () => data.subIssueCounts ?? null),
      pullRequestScope: recordAsync("pullRequestScope", () => {
        if (!data.prScope) throw new Error("pullRequestScope not configured for this test");
        return data.prScope;
      }),

      // --- writes ----------------------------------------------------------------------------
      updateIssue: recordAsync("updateIssue", () => undefined),
      createIssue: recordAsync("createIssue", () => (counter += 1)),
      addComment: recordAsync("addComment", () => (counter += 1)),
      addSubIssue: recordAsync("addSubIssue", () => undefined),
      relabelIssue: recordAsync("relabelIssue", () => undefined),
      renameLabel: recordAsync("renameLabel", () => undefined),
      deleteLabel: recordAsync("deleteLabel", () => undefined),
    } satisfies Partial<GhModule> as GhModule));
  });

  afterAll(() => {
    mock.restore();
  });

  // `record` is used only by the synchronous shape above; keep it referenced so the helper does not
  // drift out of use unnoticed if a synchronous export is ever added to gh.ts.
  void record;

  return handle;
}
