// external-modules/job-search/src/adapters/types.ts
//
// Task 11 (#1295): the portal interface every source adapter implements, plus the two pieces
// of policy shared across all of them — the fetch shape adapters are written against, and one
// status-code-to-FailureKind mapping so a login wall means the same thing no matter which
// board reported it. Pure domain-adjacent code: no SDK imports, no network, no database.
import type { FailureCause, FailureKind, Posting, SearchCriteria } from "../domain/records.js";

/**
 * The adapter-facing fetch. This is NOT the host port and NOT WHATWG fetch — the real
 * `ctx.fetch` takes one `ModuleFetchRequest` object and resolves `{status, headers,
 * bodyBase64}` with no `ok` and no `text()`. Task 13's `toFetchLike` bridges the two so base64
 * decoding lives in one place instead of in every adapter. Adapters are written against this
 * type and tested with a plain `vi.fn()`, never against real network or `ctx.fetch`.
 *
 * `init` only carries headers: a portal never POSTs, and cookies/session state are exactly
 * what this module refuses to carry (no login, ever — see `statusToKind` below).
 */
export interface FetchLike {
  (
    url: string,
    init?: { headers?: Record<string, string> }
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface CrawlResult {
  postings: Posting[];
  /** Present when the crawl stopped early. Partial results above are still kept — a failure
   * never discards what was already retrieved. */
  failure: FailureCause | null;
}

export interface Portal {
  readonly id: string;
  readonly label: string;
  readonly host: string;
  crawl(args: {
    fetch: FetchLike;
    criteria: SearchCriteria;
    lastOkAt: string | null;
    now: string;
    /** Absolute epoch ms. Check `clock() >= deadlineAt` BEFORE each page fetch and return what
     * you already have with `failure: describeFailure({kind: "deadline", ...})`. Task 2e ships
     * this to the worker as `ctx.deadlineAt` and Task 14 narrows it per portal.
     *
     * There is deliberately no `signal` here. A worker-side `AbortSignal` cannot cancel an
     * in-flight `ctx.fetch` — the request crosses JSON-RPC and `ModuleFetchRequest` carries no
     * signal field. Cancelling a request already in the host's hands is the host's job; a
     * portal's whole share of it is this cooperative check between fetches. Do not add a
     * `signal` parameter to make the two look symmetrical — it would be a parameter nothing
     * could honour. */
    deadlineAt: number;
    /** Test seam only. Defaults to `Date.now`. Production callers (Task 14's `runCrawl`) pass
     * nothing. It exists so deadline cases are deterministic without `vi.useFakeTimers()`. */
    clock?: () => number;
  }): Promise<CrawlResult>;
}

/**
 * One mapping for every adapter, so a login wall means the same thing everywhere.
 *
 * 401/403 is treated as a login wall **by policy**, not because either code proves one: the
 * module never signs in to a job board and never tries to get around an anti-bot block either,
 * so the two true causes get the identical response anyway — stop, disable, do not retry. (This
 * is a deliberate, narrower policy than a generic "401/403 might be anti-bot, not login" caution
 * elsewhere in the host-fetch layer: that caution is about not disabling a source you could
 * otherwise legitimately keep polling; this module has already decided it will never try to get
 * around either cause, so the distinction has no behavioural consequence here.)
 *
 * 404 means the fragile internal route moved or was removed — a change on the source's side
 * that needs a fix on ours, not a retry, hence `parse_failed` rather than `network`.
 *
 * Anything else (5xx, and any status this mapping does not otherwise recognise) is treated as
 * transient and retried.
 */
export function statusToKind(status: number): FailureKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "login_required";
  if (status === 404) return "parse_failed";
  return "network";
}

/**
 * Ten fetches is already generous over-fetch (L14: over-fetch and narrow locally, never trust
 * server relevance) — a source that needs more than that from one profile's crawl is a sign the
 * query needs narrowing upstream, not a bigger cap. Shared by every adapter so a future source's
 * unusually chatty pagination can't quietly turn one crawl into hundreds of requests.
 */
export const PAGE_CAP = 10;
