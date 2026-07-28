// external-modules/job-search/src/worker/handlers/matches.ts
//
// Task 15 (#1299): matches.list and match.set-state — the board's only route to the database.
// Until these are registered, `apps/web/src/external-modules/loader.ts` hands the web bundle
// only `{hostActions, assistantSurface?}` and it has no database access of any kind.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { Match } from "../../domain/records.js";
import type { JobSearchStore } from "../../domain/store-port.js";
import { looksLikeJobEnvelope, parseJobEnvelope } from "../job-input.js";
import { InputError, stripEnvelope } from "../validate.js";

// Ruling N5: the board's REST route ends at `boundedAssistantToolResultData`
// (packages/ai/src/routes.ts), which THROWS AWAY the structured result and substitutes
// `{text: "…truncated"}` once the rendered form passes 16 000 characters. A board that hits that
// substitution has no matches to render at all, not a short list — so every constant below is
// bounded by that render cap, not by taste, and `MATCHES_LIST_MAX_LIMIT` is re-checked here even
// though `limit`'s schema maximum is also lowered in jarvis.module.json: the queue path's params
// DSL has no numeric bounds and never validates it, so a handler that trusted the schema alone
// would accept an unbounded board read from a manually-run job.
//
// `renderToolResult` (packages/module-sdk/src/index.ts) renders a uniform flat array of scalar
// fields as a markdown table, not `JSON.stringify` — every field is a table cell, so a single
// unbounded string field (a scraped posting's title, or its company name) is just as capable of
// blowing the render cap as an unbounded reason. `title`/`company` come straight from a crawled
// posting, which this module does not control the length of, so they get the same treatment.
//
// See tests/unit/job-search-match-handler.test.ts's worst-case render-survival test for the
// arithmetic these were tuned against — every text field (including `url`) at its cap, rendered
// through the real markdown-table format, targeting <=80% of the 16 000-char cap rather than
// merely under it, so a field added later doesn't silently blow the budget.
//
// N39 ("a field belongs in the list row only if the list renders it"): `board.tsx` never renders
// `fitReason`/`wantReason` — the table shows Fit/Want as sortable numeric columns only, and the
// only reason-consumer is the inspector, open for one match at a time behind `job-search.match.get`
// (#1330, below). Reasons are therefore gone from `BoardMatch` entirely, not merely re-truncated;
// `REASON_MAX_CHARS` no longer exists here because there is nothing left in this row to bound.
//
// Removing reasons frees enough of the render budget that `MATCHES_LIST_MAX_LIMIT` could legally
// move well past its #1330-era value of 15 — re-run against the real `renderToolResult` with the
// N39 row shape `{id, title, company, fit, want, outsideFrame, state, url}` (title/company/url
// still at their caps, worst-case state literal), the true <=80% ceiling is 30 rows (79.7% at 30,
// 82.3% at 31). The constant stays at its pre-N39 value of 15 for now regardless — strictly safe
// under the new, smaller row (a fixed row count with fewer fields only ever renders shorter, never
// longer) but not yet the real number. It is deliberately NOT bumped in this commit: `board.tsx`'s
// own `MATCHES_LIMIT` must move to the identical value in the SAME commit or the board throws
// `InputError` on every read, and `board.tsx` is held by another lane until it clears. The number
// to land alongside that sync is 25 (66.5% of the render cap — comparable headroom below the true
// 30-row ceiling to the margin the original 15-vs-17 pair left below ITS ceiling), not the bare
// maximum: board row count is a product question (#1333, paging, is explicitly out of scope here),
// and headroom below a hard boundary is what keeps one future field addition from being the commit
// that silently blows the cap. See tests/unit/job-search-match-handler.test.ts's worst-case
// render-survival test for the arithmetic.
export const MATCHES_LIST_MAX_LIMIT = 15;
export const TITLE_MAX_CHARS = 80;
export const COMPANY_MAX_CHARS = 60;
// N39 also asked whether `URL_MAX_CHARS` truncation is still earning its keep now that the reason
// budget is freed — checked, not assumed: an untruncated worst-case URL (2000 chars, a generous
// ceiling browsers/servers commonly reject past) renders at ~209% of the cap at only 15 rows, so
// dropping truncation is not affordable at any plausible row count. It stays.
//
// Real crawled/custom posting URLs are far shorter than this in practice (linkedin.ts strips
// tracking query params before storage) — this cap exists for the render-survival worst case,
// not because a legitimate URL is expected to approach it. Unlike a truncated title or reason, a
// truncated URL is not a shorter version of a working link; it is a broken one. That is an
// accepted, rare degradation against the alternative (a board that renders no rows at all above
// the render cap), not a claim that a cut-off link is still useful.
export const URL_MAX_CHARS = 200;

/** Enforced in the handler because the queue's params DSL has no enum for `state` and the
 * manifest's own `paramsSchema` fix (an `enum` type) still leaves the manual-run body path,
 * which the platform never re-validates against `jarvis.module.json` at request time. Does not
 * include `"unscored"` — that is a scoring precondition a user never sets directly. */
export const SETTABLE_STATES = ["new", "seen", "dismissed"] as const;
const SETTABLE_STATES_SET: ReadonlySet<string> = new Set(SETTABLE_STATES);

const MATCHES_LIST_KEYS = new Set(["profileId", "limit"]);

// N39: no `fitReason`/`wantReason` here — `board.tsx` never renders them (verified by grep, not
// assumed), so they don't belong on the row's type at all. They live only on `MatchDetail`, below.
export interface BoardMatch {
  id: string;
  title: string;
  company: string;
  fit: number | null;
  want: number | null;
  outsideFrame: boolean;
  state: Match["state"];
  url: string;
}

// #1330: the untruncated detail behind job-search.match.get, opened when the inspector needs
// the full reason a BoardMatch row can't carry (as of N39, can't carry at all, not just
// truncated). Deliberately not `BoardMatch` plus fields — keeping it a separate type documents
// that this shape is exempt from the row-count/render-cap arithmetic above (one record, not up
// to fifteen, so nothing here needs `truncateText`).
export interface MatchDetail {
  id: string;
  title: string;
  company: string;
  url: string;
  fit: number | null;
  want: number | null;
  fitReason: string;
  wantReason: string;
  outsideFrame: boolean;
  state: Match["state"];
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function requireProfileId(input: Record<string, unknown>): string {
  const value = input.profileId;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("profileId is required");
  }
  return value;
}

/** No default — an omitted, zero, fractional, or over-cap `limit` all throw. A handler that
 * silently substituted a default the first time this was raised is how an unbounded board read
 * ships as an omission instead of a failure someone notices. */
function requireLimit(input: Record<string, unknown>): number {
  const value = input.limit;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MATCHES_LIST_MAX_LIMIT
  ) {
    throw new InputError(`limit must be an integer between 1 and ${MATCHES_LIST_MAX_LIMIT}`);
  }
  return value;
}

function requireMatchId(input: Record<string, unknown>): string {
  const value = input.matchId;
  if (typeof value !== "string" || value.length === 0) {
    throw new InputError("matchId is required");
  }
  return value;
}

function requireSettableState(value: unknown): Match["state"] {
  if (typeof value !== "string" || !SETTABLE_STATES_SET.has(value)) {
    throw new InputError(`state must be one of: ${SETTABLE_STATES.join(", ")}`);
  }
  return value as Match["state"];
}

/** `risk: "read"` — called with `invokeTool` directly from the browser, which is the whole
 * reason this works from the board at all (a `write`/`destructive` tool 403s before `execute`).
 * Scoped by `profileId`, not by `limit` alone: RLS already confines every row to the actor's own,
 * but nothing stops one of the actor's OTHER profiles' matches from leaking into this profile's
 * board without this. Returns board records shaped from `Match` + `Posting`, never a raw store
 * row — the render-from-structured-records rule is only real if the shape returned here is
 * pinned by a test that names every key. */
export function createMatchesListHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    for (const key of Object.keys(input)) {
      if (!MATCHES_LIST_KEYS.has(key)) {
        throw new InputError(`unknown key: ${key}`);
      }
    }
    const profileId = requireProfileId(input);
    const limit = requireLimit(input);

    const matches = await store.listMatches(profileId, limit);
    const postings = await store.getPostings(matches.map((match) => match.postingId));

    const items: BoardMatch[] = [];
    for (const match of matches) {
      const posting = postings.get(match.postingId);
      // A posting looked up by an id its own match still references but that has since been
      // removed is simply absent from the returned map (store-port.ts's own comment on
      // `getPostings`) — skipped here, the same "no posting, no item" rule
      // `domain/surface.ts`'s `matchItem` already applies to the briefing.
      if (posting === undefined) continue;
      items.push({
        id: match.id,
        title: truncateText(posting.title, TITLE_MAX_CHARS),
        company: truncateText(posting.company, COMPANY_MAX_CHARS),
        fit: match.fit,
        want: match.want,
        outsideFrame: match.outsideFrame,
        state: match.state,
        url: truncateText(posting.url, URL_MAX_CHARS)
      });
    }

    return { items };
  };
}

const MATCH_GET_KEYS = new Set(["matchId"]);

/** #1330: `risk: "read"`, one match by id, untruncated. Exists so the row can stay a capped
 * summary without the full Fit/Want reason becoming permanently unreachable — the inspector
 * calls this on open rather than the board ever fetching every match's full text up front, which
 * would just reproduce the render-cap problem `MATCHES_LIST_MAX_LIMIT` exists to avoid.
 *
 * Not-found (a wrong-owner id, a deleted match, or — #1329 — an unscored row's synthetic
 * posting-id "match id", which is never a real row) returns `{matchId, match: null}` rather than
 * throwing, matching `resume.get`'s own not-found idiom: the caller has one outcome to handle
 * either way, "nothing more to show here." */
export function createMatchGetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    for (const key of Object.keys(input)) {
      if (!MATCH_GET_KEYS.has(key)) {
        throw new InputError(`unknown key: ${key}`);
      }
    }
    const matchId = requireMatchId(input);

    const match = await store.getMatch(matchId);
    if (match === null) {
      return { matchId, match: null };
    }
    const posting = (await store.getPostings([match.postingId])).get(match.postingId);
    if (posting === undefined) {
      // Same "no posting, no item" rule as matches.list — a match whose posting has since been
      // removed has nothing left to show a title, company, or link for.
      return { matchId, match: null };
    }

    const detail: MatchDetail = {
      id: match.id,
      title: posting.title,
      company: posting.company,
      url: posting.url,
      fit: match.fit,
      want: match.want,
      fitReason: match.fitReason,
      wantReason: match.wantReason,
      outsideFrame: match.outsideFrame,
      state: match.state
    };
    return { matchId, match: detail };
  };
}

/** One handler, two ways in, because the read and the write are forced onto different
 * transports (a `write` tool 403s with `confirmation_required` before `execute`, so a board
 * calling a write tool directly would silently do nothing):
 *
 * - The **board** enqueues the manual-run queue `job-search.match-state` with
 *   `{matchId, state}` — `ctx.input` is the four-field job envelope, `state` one level down in
 *   `params`, validated against `SETTABLE_STATES`.
 * - The **assistant** reaches this through the `job-search.match.dismiss` write tool, whose
 *   `inputSchema` declares `matchId` only — no `state` field exists on that tool at all, because
 *   the confirmation prompt in front of it is the consent boundary for "dismiss" specifically,
 *   not a generic state setter. That path always sets `state: "dismissed"`.
 *
 * Distinguishing the two is done on shape, not on a caller-supplied flag: a queue envelope always
 * has exactly `{actorUserId, jobKind, idempotencyKey, params}`; the tool shape never does. */
export function createMatchSetStateHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const raw = ctx.input;
    let matchId: string;
    let state: Match["state"];

    if (looksLikeJobEnvelope(raw)) {
      const envelope = parseJobEnvelope(raw);
      matchId = requireMatchId(envelope.params);
      state = requireSettableState(envelope.params.state);
    } else {
      const input = stripEnvelope(raw);
      for (const key of Object.keys(input)) {
        if (key !== "matchId") {
          throw new InputError(`unknown key: ${key}`);
        }
      }
      matchId = requireMatchId(input);
      state = "dismissed";
    }

    await store.setMatchState(matchId, state);
    return { matchId, state };
  };
}
