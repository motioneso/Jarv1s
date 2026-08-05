// external-modules/job-search/src/worker/handlers/pass.ts
//
// Task 15 (#1299): the queue handlers that actually run a pass — `crawl.run` (one profile, full
// budget), `crawl.sweep` (the actor's own active profiles, rotated across sweeps), and
// `crawl.run-now` (the tool-shaped twin of `crawl.run`, registered under its own handler name
// because the tool and the queue receive different `ctx.input` shapes and one handler serving
// both would have to sniff its own input).
//
// This file, not `stages/crawl.ts` or `stages/score.ts`, is where the crawl and score stages are
// composed and where the AI-call budget is actually rationed — the stages only ever see a
// `budget` number and an `ai` port; they have no idea whether they are one profile out of one or
// one profile out of twenty.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { customPortal } from "../../adapters/custom.js";
import { freehirePortal } from "../../adapters/freehire.js";
import { linkedinPortal } from "../../adapters/linkedin.js";
import type { Portal } from "../../adapters/types.js";
import type { CriteriaRescoreEntry, JobSearchStore, Profile } from "../../domain/store-port.js";
import { parseJobEnvelope } from "../job-input.js";
import { toFetchLike } from "../ports.js";
import { runCrawl, type CrawlSummary, type EmbedPort } from "../stages/crawl.js";
import {
  AI_CALL_BUDGET,
  runScore,
  type AiPort,
  type NotifyPort,
  type RunScoreResult
} from "../stages/score.js";
import { InputError, validateProfileInput } from "../validate.js";

// A share of TIME, never traded against AI_CALL_BUDGET (a count of CALLS) — the crawl stage
// makes no AI calls at all. Crawling is many cheap HTTP calls, scoring is a few expensive model
// calls, so an overrunning crawl is always the thing to cut: fresh postings with no scores is
// worse than slightly stale postings that got scored.
export const CRAWL_SHARE = 0.4;

export interface PassResult {
  crawl: CrawlSummary;
  score: RunScoreResult;
  /** The Fit-empty repair pass (#110), or null when the profile has no résumé — with nothing to
   *  judge Fit against there is no repair to make, only the same null written back. */
  refit: RunScoreResult | null;
}

/** `ai.used()` reads calls made through THIS wrapper only, incremented before the underlying
 * call is awaited so a call that throws still counts as spent — matching
 * `worker-rpc-host.ts`'s own counter, which increments before its own cap check. Budget
 * arithmetic in `crawl.sweep` reads this, never the return value of a stage: a stage that threw
 * mid-call still spent the call, and deriving remaining budget from a return value double-spends
 * after a throw. */
interface CountingAiPort extends AiPort {
  used(): number;
}

function makeCountingAi(inner: AiPort): CountingAiPort {
  let used = 0;
  return {
    generateStructured: (input) => {
      used++;
      return inner.generateStructured(input);
    },
    used: () => used
  };
}

/** Two built-in portals plus one `customPortal` per row the profile has registered (Task 24,
 * #1309). `source.sourceId` — not `source.id` — becomes `Portal.id`: `sourceId` is the full
 * "custom:"-prefixed id that matches `job_search_portals.source_id`'s format (store-port.ts's own
 * comment on `CustomSource`); `id` is the bare row uuid, which would silently desync this
 * source's health-tracking row from every other place it is looked up by id. `ai` reaches
 * `customPortal` by closure here, never by widening the shared `Portal.crawl` args that every
 * built-in portal would then also carry, unused (custom.ts's own header note). */
async function buildPortals(
  store: JobSearchStore,
  profileId: string,
  ai: AiPort
): Promise<Portal[]> {
  const customSources = await store.listCustomSources(profileId);
  return [
    freehirePortal,
    linkedinPortal,
    ...customSources.map((source) =>
      customPortal(
        { id: source.sourceId, label: source.label, host: source.host, url: source.url },
        ai
      )
    )
  ];
}

/** Runs crawl-then-score for exactly one profile inside one invocation — `ModuleWorkerContext`
 * has no jobs port, so the two stages cannot be separate queued steps handing off to each other.
 * Takes the wrapped `ai` port as an argument rather than reaching for `ctx.ai` directly: the
 * sweep needs to thread the SAME wrapper (and its running `used()` count) across every profile it
 * visits in one invocation, and a version of this function that reached for `ctx.ai` itself could
 * not be handed that shared wrapper. */
async function runProfileStages(input: {
  store: JobSearchStore;
  fetch: ReturnType<typeof toFetchLike>;
  embed: EmbedPort;
  ai: CountingAiPort;
  notify: NotifyPort;
  profileId: string;
  /** Calls this profile's score stage may spend. Computed by the caller as
   *  `AI_CALL_BUDGET - ai.used()` — never a fixed per-profile share. */
  budget: number;
  now: string;
  crawlDeadlineAt: number;
  scoreDeadlineAt: number;
  clock: () => number;
}): Promise<PassResult> {
  const {
    store,
    fetch,
    embed,
    ai,
    notify,
    profileId,
    budget,
    now,
    crawlDeadlineAt,
    scoreDeadlineAt,
    clock
  } = input;

  const portals = await buildPortals(store, profileId, ai);

  const crawl = await runCrawl({
    store,
    portals,
    fetch,
    embed,
    profileId,
    now,
    deadlineAt: crawlDeadlineAt,
    clock
  });

  // `runScore` itself returns a no-op result without touching the store or the ai port when
  // `budget <= 0` — no special case needed here for a profile handed zero remaining budget.
  const score = await runScore({
    store,
    embed,
    ai,
    notify,
    profileId,
    budget,
    now,
    deadlineAt: scoreDeadlineAt,
    clock
  });

  // Then repair the Fit-empty backlog (#110). Postings scored before the profile had a résumé keep
  // an empty Fit forever on their own: the ordinary candidate query is a NOT EXISTS over the match
  // table, so a row that exists is past scoring for good. `resume.set` repairs as many as its own
  // invocation can get through and leaves the rest — this is where the remainder is picked up, one
  // crawl or sweep at a time, until there is no backlog left and this scores nothing.
  //
  // Guarded on the résumé existing, and that guard is not cosmetic: with no résumé the scoring
  // stage writes `fit: null` by design, so this would re-write every row identically and spend one
  // model call per posting doing it, on every pass, forever.
  //
  // Second, on the budget the ordinary pass did not spend — fresh postings from this very crawl are
  // the more time-sensitive of the two, and the backlog has been waiting for hours already.
  const resume = await store.getLatestResume(profileId);
  const refit =
    resume && resume.content.trim().length > 0
      ? await runScore({
          store,
          embed,
          ai,
          notify,
          profileId,
          budget: budget - score.aiCallsUsed,
          now,
          deadlineAt: scoreDeadlineAt,
          clock,
          candidates: "unfitted"
        })
      : null;

  return { crawl, score, refit };
}

function requireProfileIdFromParams(params: Record<string, unknown>): string {
  const profileId = params.profileId;
  if (typeof profileId !== "string" || profileId.length === 0) {
    throw new InputError("profileId is required");
  }
  return profileId;
}

/** Shared by `crawl.run` and `crawl.run-now`: one profile, the full per-invocation budget. The
 * crawl deadline is a `CRAWL_SHARE` slice of the time between now and the invocation's own
 * deadline — meaningfully earlier than the score deadline (`ctx.deadlineAt` itself) so an
 * overrunning crawl cannot consume the whole invocation and leave every posting `unscored`. */
async function runSingleProfilePass(
  store: JobSearchStore,
  ctx: ModuleWorkerContext,
  profileId: string
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const clock = (): number => Date.now();
  const start = clock();
  const crawlDeadlineAt = start + Math.floor((ctx.deadlineAt - start) * CRAWL_SHARE);

  const ai = makeCountingAi(ctx.ai);

  const result = await runProfileStages({
    store,
    fetch: toFetchLike(ctx),
    embed: ctx.embed,
    ai,
    notify: ctx.notify,
    profileId,
    budget: AI_CALL_BUDGET,
    now,
    crawlDeadlineAt,
    scoreDeadlineAt: ctx.deadlineAt,
    clock
  });

  // `refit` is reported, not dropped. It used to be omitted here on the reasoning that the repair
  // pass is background maintenance the user did not ask for — but once a replaced résumé makes
  // every existing score stale, the repair pass IS the work, and the ordinary `score` stage
  // legitimately reports 0 because a fully-matched board has no unscored postings left. Measured
  // live: a crawl re-read 68 roles against a new résumé and reported `"scored": 0`, which reads as
  // "nothing happened" to the user and as "the fix did not work" to anyone debugging it.
  return { crawl: result.crawl, score: result.score, refit: result.refit };
}

export interface CriteriaRescoreResult extends Record<string, unknown> {
  readonly mode: "rescore";
  readonly claimed: boolean;
  readonly processed: Array<{
    profileId: string;
    ok: boolean;
    score?: RunScoreResult;
    error?: string;
  }>;
  readonly aiCallsUsed: number;
}

export async function runCriteriaRescore(
  store: JobSearchStore,
  ctx: ModuleWorkerContext,
  leaseToken: string,
  onlyProfileId?: string
): Promise<CriteriaRescoreResult> {
  const claimed = await store.claimCriteriaRescore(leaseToken);
  if (claimed === null) {
    return { mode: "rescore", claimed: false, processed: [], aiCallsUsed: 0 };
  }

  const ai = makeCountingAi(ctx.ai);
  const completed: CriteriaRescoreEntry[] = [];
  const processed: Array<{
    profileId: string;
    ok: boolean;
    score?: RunScoreResult;
    error?: string;
  }> = [];
  try {
    for (const entry of claimed) {
      if (onlyProfileId !== undefined && entry.profileId !== onlyProfileId) continue;
      if (Date.now() >= ctx.deadlineAt || ai.used() >= AI_CALL_BUDGET) break;
      try {
        const score = await runScore({
          store,
          embed: ctx.embed,
          ai,
          notify: ctx.notify,
          profileId: entry.profileId,
          budget: AI_CALL_BUDGET - ai.used(),
          now: new Date().toISOString(),
          deadlineAt: ctx.deadlineAt,
          clock: () => Date.now(),
          notifyOnMatches: false,
          criteriaSnapshot: entry.criteria
        });
        processed.push({ profileId: entry.profileId, ok: true, score });
        if (score.deferred === 0 && score.failed === 0 && score.halted === null) {
          completed.push(entry);
        }
      } catch (error) {
        processed.push({
          profileId: entry.profileId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } finally {
    await store.finishCriteriaRescore(leaseToken, completed);
  }

  return { mode: "rescore", claimed: true, processed, aiCallsUsed: ai.used() };
}

/** The queue handler (`job-search.crawl-run`). Reads `params.profileId`, never `input.profileId`
 * — a queue job's `ctx.input` is the four-field envelope, and the profile id is one level down.
 * The params DSL has no "required" concept (`{type:"object",fields:{…}}` accepts `{}`), so this
 * validates `profileId` itself rather than trusting the manifest schema to have done it. */
export function createCrawlRunHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const envelope = parseJobEnvelope(ctx.input);
    const profileId = requireProfileIdFromParams(envelope.params);
    return runSingleProfilePass(store, ctx, profileId);
  };
}

/** The tool handler (`job-search.crawl.run-now`) — a thin wrapper that validates the TOOL shape
 * with Task 13's `validateProfileInput` and calls the identical internal function `crawl.run`
 * uses. A distinct handler name from `crawl.run` on purpose: the tool receives
 * `{...toolInput, actorUserId}`, the queue receives the envelope, and one handler serving both
 * would have to sniff its own input to tell them apart. */
export function createCrawlRunNowHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const { profileId } = validateProfileInput(ctx.input);
    return {
      ...(await runSingleProfilePass(store, ctx, profileId)),
      statusText: "Search completed"
    };
  };
}

/** The scheduled entry point for both the six-hour crawl and the ten-minute rescore continuation.
 * Both are metadata-only user schedules on the existing crawl-sweep queue; `jobKind` selects
 * whether each active profile runs crawl+score or pending criteria snapshots run score alone.
 * The invocation-wide AI budget keeps either mode bounded and sequential. */
export function createCrawlSweepHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    // Both schedules intentionally carry no params. A malformed envelope is a host/protocol bug,
    // so validate the complete shape before using jobKind to choose the mode.
    const envelope = parseJobEnvelope(ctx.input);
    const rescoreOnly = envelope.jobKind === "job-search.rescore-sweep";

    if (rescoreOnly) {
      return runCriteriaRescore(store, ctx, envelope.idempotencyKey);
    }

    const now = new Date().toISOString();
    const clock = (): number => Date.now();
    const fetch = toFetchLike(ctx);
    const ai = makeCountingAi(ctx.ai);

    const activeProfiles: Profile[] = (await store.listProfiles()).filter(
      (profile) => profile.state === "active"
    );

    // No cursor read and no cursor write: there is nothing to rotate through, and touching the
    // cursor here would give a future empty-then-nonempty transition a stale starting point for
    // no reason.
    if (activeProfiles.length === 0) {
      return { processed: [], aiCallsUsed: 0 };
    }

    const cursor = await store.getSweepCursor();
    let index = cursor % activeProfiles.length;
    const processed: Array<{
      profileId: string;
      ok: boolean;
      score?: RunScoreResult;
      error?: string;
    }> = [];

    while (index < activeProfiles.length) {
      // Neither check below has started this profile yet, so a break here leaves `index`
      // pointing at the first profile NOT started — exactly what the persisted cursor must be.
      if (clock() >= ctx.deadlineAt) break;
      if (ai.used() >= AI_CALL_BUDGET) break;

      const profile = activeProfiles[index];
      if (profile === undefined) {
        throw new Error(`crawl.sweep: no profile at index ${index}`);
      }

      const profileStart = clock();
      const crawlDeadlineAt =
        profileStart + Math.floor((ctx.deadlineAt - profileStart) * CRAWL_SHARE);

      try {
        await runProfileStages({
          store,
          fetch,
          embed: ctx.embed,
          ai,
          notify: ctx.notify,
          profileId: profile.id,
          budget: AI_CALL_BUDGET - ai.used(),
          now,
          crawlDeadlineAt,
          scoreDeadlineAt: ctx.deadlineAt,
          clock
        });
        processed.push({ profileId: profile.id, ok: true });
      } catch (error) {
        // One profile failing must not stop the sweep. Nothing is written to the store for it —
        // the closed JobSearchStore interface has no failure-note method and ProfileState has no
        // error member, and inventing either here would be a silent widening of a deliberately
        // closed contract.
        processed.push({
          profileId: profile.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (clock() >= ctx.deadlineAt) {
        // This profile was started but cut short by the deadline partway through (or finished
        // right at the boundary) — it is not "finished", so the cursor must not advance past it.
        // The next sweep retries it in full rather than skipping straight to the one after.
        break;
      }

      index++;
    }

    await store.setSweepCursor(index % activeProfiles.length);

    return { processed, aiCallsUsed: ai.used() };
  };
}
