// external-modules/job-search/src/domain/records.ts
//
// Task 5 (#1289): the shared vocabulary. Every later task in Phases 2-6 imports its types
// from this one file. This is pure domain code — no SDK imports, no network, no database
// access. If a later task needs `@jarv1s/module-sdk`, that import does not belong here.
//
// Two invariants are structural to this file, not decoration:
//
//   - Fit and Want are two independent axes and are NEVER blended (L9). There is no
//     combined/overall/total/average score anywhere below, as a field, a helper, or a
//     derived getter, and there must never be one added.
//   - A failure is a structured cause, never a bare string or boolean. `describeFailure`
//     is the one place that builds `FailureCause.summary`/`nextAction`, and it is
//     deterministic string assembly, never a model call — the board renders `cause.summary`
//     and `cause.nextAction` verbatim, so a screenshot of a failure is reproducible.
//
// NOTE (ledger N4): this file deliberately does NOT define a canonical `Profile` type.
// `job_search_profiles` (Task 4) is the richest table, but no task in this phase needs the
// full shape yet — inventing one here to fill a gap that isn't load-bearing would just be
// another ad-hoc shape for later tasks to drift against.

export type FailureKind =
  | "rate_limited"
  | "login_required"
  | "parse_failed"
  | "network"
  /** The run ran out of time, not out of luck. Everything retrieved so far is kept and the
   *  portal is NEVER disabled — a slow crawl is not a broken source. Task 11's adapters
   *  produce this when `clock() >= deadlineAt` before a page fetch. */
  | "deadline";

/** Never a bare "failed". Every field here answers a question the user will
 * otherwise have to ask: what broke, how much did we get, when did it last
 * work, and what happens next. */
export interface FailureCause {
  kind: FailureKind;
  sourceId: string;
  /** Human-readable, rendered verbatim. Built from these fields, not by a model. */
  summary: string;
  retrieved: number;
  expected: number | null;
  lastOkAt: string | null;
  nextAction: string;
  retryAt: string | null;
  /** login_required is terminal: we do not sign in to job boards, so the
   * portal disables itself rather than retrying forever. */
  disabled: boolean;
}

export interface SearchCriteria {
  titles: string[];
  seniority: string[];
  locations: string[];
  remote: "required" | "preferred" | "no-preference" | "onsite-ok";
  compFloorCents: number | null;
  excludeCompanies: string[];
  mustHave: string[];
  niceToHave: string[];
  dealbreakers: string[];
  /** Free text the model uses for Want, that no filter acts on. */
  wantNarrative: string;
}

export interface Posting {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  body: string;
  postedAt: string | null;
}

export interface Match {
  id: string;
  profileId: string;
  postingId: string;
  fit: number | null;
  want: number | null;
  fitReason: string;
  wantReason: string;
  outsideFrame: boolean;
  state: "unscored" | "new" | "seen" | "dismissed";
  scoredAt: string | null;
}

// This is a PAGE size, not the size of the board. It used to be both, which is the whole reason it
// needs saying: the board asked for one page and rendered it, so a profile with 167 matches showed
// 25 rows and a search that added dozens left the count sitting on the same number — a working
// search that looked broken. The page size is still pinned by the render cap below, because that
// cap is per response; the board now walks the pages (web/read-board.ts) instead of stopping at the
// first one, and `matches.list` returns `hasMore` so it knows when to stop.
//
// N43: this is the ONE definition of the matches.list page size. worker/handlers/matches.ts's
// requireLimit rejects any request above it, and web/screens/board.tsx is the only caller — both
// import this constant rather than each carrying their own literal, so the two can never drift
// out of sync again (a999a081 shipped 15 in the handler while board.tsx still sent 40, and every
// board load threw InputError). The value, 25, is the measured <=80% render-cap ceiling for the
// reason-free N39 row minus the same headroom margin the project used elsewhere (see
// worker/handlers/matches.ts's comment and tests/unit/job-search-match-handler.test.ts for the
// arithmetic) — not a number to change here without re-running that measurement.
export const MATCHES_LIST_MAX_LIMIT = 25;

export interface PortalState {
  sourceId: string;
  enabled: boolean;
  lastOkAt: string | null;
  cause: FailureCause | null;
}

/**
 * Deliberately time-only (L15's timezone rule is about storage, not this): `retryAt` is
 * already a wall-clock instant computed by the caller in the right timezone, so slicing
 * `HH:MM` out of it is safe display trimming, not a UTC-as-local bug. "Retrying at 10:40"
 * reads better than a full timestamp, and the board already shows the crawl date.
 */
function clock(iso: string): string {
  return iso.slice(11, 16);
}

/** One shared retry phrase, reused verbatim inside more than one kind's copy so the board
 * never shows two different guesses about when a retry happens. */
function retryPhrase(retryAt: string | null): string {
  return retryAt ? `Retrying at ${clock(retryAt)}.` : "Retrying on the next scheduled crawl.";
}

export function describeFailure(input: {
  kind: FailureKind;
  sourceId: string;
  sourceLabel: string;
  retrieved: number;
  expected: number | null;
  lastOkAt: string | null;
  retryAt: string | null;
}): FailureCause {
  const { kind, sourceId, sourceLabel: label, retrieved, expected, lastOkAt, retryAt } = input;
  const retry = retryPhrase(retryAt);
  const kept = `${retrieved} posting${retrieved === 1 ? "" : "s"} already retrieved were kept.`;

  switch (kind) {
    case "rate_limited":
      return {
        kind,
        sourceId,
        summary:
          expected === null
            ? `${label} rate-limited us after ${retrieved} postings. ${retry}`
            : `${label} rate-limited us after ${retrieved} of about ${expected} postings. ${retry}`,
        retrieved,
        expected,
        lastOkAt,
        nextAction: retry,
        retryAt,
        disabled: false
      };

    case "login_required":
      // Terminal by policy, not by circumstance: the spec forbids signing in to a job
      // board, so a retry would fail identically forever. retryAt is forced to null
      // regardless of what the caller passed — a caller cannot schedule a retry for a
      // wall we will never pass.
      return {
        kind,
        sourceId,
        summary: `${label} asked for an account before showing postings, so I stopped. I will not sign in to a job board on your behalf.`,
        retrieved,
        expected,
        lastOkAt,
        nextAction: "Disabled. Turn it back on if you want to try again.",
        retryAt: null,
        disabled: true
      };

    case "parse_failed":
      // The source answered — this is not an outage — but its layout changed and we
      // could not read the results. What was already retrieved before the parse broke is
      // kept, and the fix has to happen on our side, not by retrying against the source.
      return {
        kind,
        sourceId,
        summary: `${label} answered, but its page layout changed and I could not read the results. The ${kept}`,
        retrieved,
        expected,
        lastOkAt,
        nextAction: `This needs a fix on our side. ${retry}`,
        retryAt,
        disabled: false
      };

    case "network":
      return {
        kind,
        sourceId,
        summary: `${label} could not be reached. The ${kept} ${retry}`,
        retrieved,
        expected,
        lastOkAt,
        nextAction: retry,
        retryAt,
        disabled: false
      };

    case "deadline":
      // Not brokenness (L16): disabled stays false, retryAt is preserved verbatim — never
      // forced to null the way login_required forces it — and the copy must not use any
      // word that reads as the portal being down.
      return {
        kind,
        sourceId,
        summary: `${label} ran out of time before finishing this crawl. The ${kept}`,
        retrieved,
        expected,
        lastOkAt,
        nextAction: "Picking up where I left off on the next crawl.",
        retryAt,
        disabled: false
      };

    default: {
      // Exhaustiveness guard: a `FailureKind` gaining a member without a matching case
      // here is a compile error, not a silent runtime gap — this is the exact regression
      // (round 6, finding 12) that test case 3 exists to catch at the type level too.
      const exhaustiveCheck: never = kind;
      throw new Error(`Unhandled failure kind: ${String(exhaustiveCheck)}`);
    }
  }
}
