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
// substitution has no matches to render at all, not a short list — so both constants below are
// bounded by that render cap, not by taste, and both are re-checked here even though `limit`'s
// schema maximum is also lowered in jarvis.module.json: the queue path's params DSL has no
// numeric bounds and never validates it, so a handler that trusted the schema alone would accept
// an unbounded board read from a manually-run job.
//
// See tests/unit/job-search-match-handler.test.ts's worst-case render-survival test for the
// arithmetic this was tuned against.
export const MATCHES_LIST_MAX_LIMIT = 40;
export const REASON_MAX_CHARS = 400;

/** Enforced in the handler because the queue's params DSL has no enum for `state` and the
 * manifest's own `paramsSchema` fix (an `enum` type) still leaves the manual-run body path,
 * which the platform never re-validates against `jarvis.module.json` at request time. Does not
 * include `"unscored"` — that is a scoring precondition a user never sets directly. */
export const SETTABLE_STATES = ["new", "seen", "dismissed"] as const;
const SETTABLE_STATES_SET: ReadonlySet<string> = new Set(SETTABLE_STATES);

const MATCHES_LIST_KEYS = new Set(["profileId", "limit"]);

export interface BoardMatch {
  id: string;
  title: string;
  company: string;
  fit: number | null;
  want: number | null;
  fitReason: string;
  wantReason: string;
  outsideFrame: boolean;
  state: Match["state"];
}

function truncateReason(value: string, max: number): string {
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
        title: posting.title,
        company: posting.company,
        fit: match.fit,
        want: match.want,
        fitReason: truncateReason(match.fitReason, REASON_MAX_CHARS),
        wantReason: truncateReason(match.wantReason, REASON_MAX_CHARS),
        outsideFrame: match.outsideFrame,
        state: match.state
      });
    }

    return { items };
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
