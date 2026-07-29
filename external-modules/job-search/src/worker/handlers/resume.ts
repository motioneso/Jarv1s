// external-modules/job-search/src/worker/handlers/resume.ts
//
// Task 16 (#1300): job-search.resume.set and job-search.resume.get.
// Task #108 addition: resume.set-from-attachment, the queue-only handler behind the Profile
// screen's upload/paste UI (resume-editor.tsx). The browser cannot call resume.set directly —
// it is risk:"write" and 403s on the REST tool-invoke lane — and cannot put résumé text in a
// queue payload either (CLAUDE.md's metadata-only-job-payload invariant). So the browser
// uploads the text to the user's own vault first (POST /api/chat/attachments — bytes never
// touch the DB or a pg-boss payload, see packages/chat/src/attachments-routes.ts) and this
// handler is only ever handed the resulting {profileId, attachmentId}, resolving the actual
// text via ctx.attachments.readText — never accepting content as a param itself.
//
// `resume.get` is `risk: "read"` and DOES return résumé text to the assistant — that is
// intended, the point is letting the user talk about their own résumé. What it must never do
// is reach an adapter: this file imports only the store port and the shared validate helpers,
// nothing from src/adapters/ or worker/ports.ts, so the crawl path has no way to read a
// résumé even by accident.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import type { JobSearchStore } from "../../domain/store-port.js";
import { parseJobEnvelope } from "../job-input.js";
import { AI_CALL_BUDGET, runScore, type RunScoreResult } from "../stages/score.js";
import { InputError, stripEnvelope, validateProfileInput } from "../validate.js";
import { requireNoUnknownKeys, requireProfileId, requireString } from "./profile.js";

const RESUME_SET_FIELDS = new Set(["profileId", "content"]);

function requireResumeContent(input: Record<string, unknown>): string {
  const value = input.content;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError("content is required");
  }
  return value;
}

/** The versioned write shared by both entry points below: bump `version` (store.setResume keeps
 * the prior row, never overwrites it), then score against the new résumé so the board reflects it
 * without waiting for a crawl. Everything scored before this moment has an empty Fit, because Fit
 * is judged against the résumé and there wasn't one — and those rows are past the ordinary scoring
 * stage for good, because "unscored" means "no match row exists". Left alone, saving a résumé
 * would leave the board looking exactly as broken as it did before.
 *
 * Task #110 — the rescore has to happen in THIS invocation. The only scheduled rescorer is
 * `job-search.crawl-sweep`, up to six hours away (see the cron entry in jarvis.module.json) —
 * nowhere near good enough right after the exact feature that was supposed to fix the board.
 * `ModuleWorkerContext` has no enqueue capability at all (packages/module-sdk/src/worker.ts:
 * auth/fetch/kv/ai/db/embed/attachments/notify, nothing that queues another job), so "hand off a
 * rescore job" was never on the table — that's also why this queue's `timeoutMs` was raised to
 * 600000 (the same ceiling `job-search.crawl-run` already uses; see jarvis.module.json) instead of
 * the old 30s. `runScore` needs no crawl and no portals, so it gets the whole invocation's
 * budget/deadline rather than a carved-out share.
 *
 * A scoring failure must never take the save down with it: the résumé is already committed by
 * the time this runs, so a rescore problem is caught, never rethrown, and reported as a
 * structured cause on the result instead of a swallowed error — the caller can see scoring
 * failed, and why, without the save itself reading as failed.
 *
 * That catch is NOT enough on its own, and the guards below are what a live run proved is
 * missing. `ctx.deadlineAt` is not a soft budget: it is the exact instant the runtime kills the
 * invocation (packages/module-registry/src/external/worker-runtime.ts throws
 * `ExternalModuleWorkerError: External module worker timeout`), so a model call in flight when
 * the deadline lands dies with the whole handler, catch included.
 *
 * The headroom that prevents that now lives in `runScore` itself (`MIN_CALL_RESERVE_MS`), which
 * refuses to START a call it cannot finish and sizes the reserve from the longest call it has
 * actually measured this run. This handler therefore hands over `ctx.deadlineAt` unmodified: it
 * used to subtract a fixed 45s of its own, and once the loop reserves properly the two stack —
 * a minute and a half of an invocation spent on nothing, and a rescore that winds down while it
 * still had time to score. One layer of headroom, in the loop that knows how long a call takes.
 *
 * Partial is the normal outcome here either way, not the exceptional one — a 156-posting board is
 * ~20 minutes of model calls against a 600s ceiling — and whatever this pass does not reach is
 * picked up by the next crawl or sweep.
 *
 * The other guard is the identical-content short-circuit: a timeout kill is not catchable, so the
 * handler CAN be re-entered by a queue retry after the résumé row has already committed. Without
 * it, each retry bumps the version again and writes a byte-identical row (observed live: an
 * identical version 2). `resume-set` also carries `retryLimit: 0` for the same reason — re-running
 * 10 minutes of model calls buys nothing — but the check belongs here too, because it is equally
 * right for a user who uploads the same file twice.
 *
 * The second guard is the repair pass, and what it must NOT be is a delete. Postings scored before
 * the profile had a résumé carry an empty Fit forever, because "unscored" means "no match row
 * exists" — so the obvious repair is to throw those rows away and let the next pass read them as
 * fresh. That was built, and it is a user-visible defect: deleting is instant, scoring is ~9s a
 * posting, so a 116-row board fell to 56 within five seconds of the save and crept back one row
 * every nine seconds. Bounding the delete only made the hole smaller, never absent. So the repair
 * scores those rows *in place* instead (`candidates: "unfitted"`), and `upsertMatch` overwrites
 * them — the board's row count never moves at all, whatever the invocation manages to get through.
 * Whatever it does not reach keeps its existing row and is picked up by the next crawl or sweep. */

async function saveResumeContent(
  store: JobSearchStore,
  ctx: ModuleWorkerContext,
  profileId: string,
  content: string
): Promise<Record<string, unknown>> {
  const profile = await store.getProfile(profileId);
  if (!profile) {
    throw new InputError("profileId not found");
  }

  const previous = await store.getLatestResume(profileId);
  const unchanged = previous != null && previous.content === content;
  const resume =
    previous != null && unchanged ? previous : await store.setResume(profileId, content);

  const scoreDeadlineAt = ctx.deadlineAt;

  // Two passes, because they answer different questions and neither should starve the other: the
  // repair pass re-scores the Fit-empty backlog now that there is a résumé to judge against, and
  // the ordinary pass picks up anything crawled but never scored at all. Repair runs first — those
  // rows are the ones already on the user's board with a visibly empty Fit, and they are the whole
  // reason a résumé upload triggers scoring in the first place.
  //
  // On an unchanged re-save the repair pass is skipped: a byte-identical résumé cannot change a
  // score, so re-spending a model call per posting would buy nothing. The ordinary pass still runs,
  // because a re-upload is a perfectly good moment to score postings that were never scored.
  let rescore: Record<string, unknown>;
  try {
    let scored = 0;
    let deferred = 0;
    let failed = 0;
    let aiCallsUsed = 0;
    let halted: RunScoreResult["halted"] = null;

    const passes: Array<"unfitted" | "unscored"> = unchanged
      ? ["unscored"]
      : ["unfitted", "unscored"];

    for (const candidates of passes) {
      // A scoring failure must never take the save down with it, so the whole thing is inside one
      // try/catch — but the budget arithmetic has to survive between passes, which is why the
      // counters live outside the loop rather than being summed at the end.
      const result: RunScoreResult = await runScore({
        store,
        embed: ctx.embed,
        ai: ctx.ai,
        notify: ctx.notify,
        profileId,
        budget: AI_CALL_BUDGET - aiCallsUsed,
        now: new Date().toISOString(),
        deadlineAt: scoreDeadlineAt,
        clock: () => Date.now(),
        candidates
      });
      scored += result.scored;
      failed += result.failed;
      aiCallsUsed += result.aiCallsUsed;
      // Deferred is not additive across passes in the way the others are — each pass reports its
      // own leftovers, and the last one to report is the one describing what is genuinely still
      // waiting once both have run.
      deferred = result.deferred;

      // A halt is the provider being unusable, the budget being spent, or the clock running out.
      // None of those get better on the next pass, so stop rather than making a second doomed run
      // of model calls.
      if (result.halted) {
        halted = result.halted;
        break;
      }
    }

    rescore = { ok: true, scored, deferred, failed, aiCallsUsed, halted };
  } catch (error) {
    rescore = { ok: false, cause: error instanceof Error ? error.message : String(error) };
  }

  return {
    profileId,
    version: resume.version,
    updatedAt: resume.updatedAt,
    unchanged,
    rescore
  };
}

export function createResumeSetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const input = stripEnvelope(ctx.input);
    requireNoUnknownKeys(input, RESUME_SET_FIELDS);
    const profileId = requireProfileId(input);
    const content = requireResumeContent(input);

    return saveResumeContent(store, ctx, profileId, content);
  };
}

const RESUME_SET_FROM_ATTACHMENT_FIELDS = new Set(["profileId", "attachmentId"]);

/** Queue-only (job-search.resume-set); no assistantTools entry names it — the browser reaches
 * this exclusively through runQueue, never the tool-invoke lane. `ctx.attachments.readText` is
 * always present on `ModuleWorkerContext` (packages/module-sdk/src/worker.ts) and resolves
 * non-null once the host's RPC handler is built with a `readAttachmentText` function — that was
 * wired for the synchronous tool-dispatch path from the start (apps/api/src/external-module-
 * tools.ts) and, as of #109 (commit 913a4330), for the queue-processing path too (apps/worker/
 * src/worker.ts). If it ever resolves null in production, that means an attachment the browser
 * uploaded genuinely isn't readable (missing/expired), not a wiring gap — the "Couldn't read the
 * uploaded résumé file" error below still applies, just for that narrower reason. */
export function createResumeSetFromAttachmentHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const { params } = parseJobEnvelope(ctx.input);
    requireNoUnknownKeys(params, RESUME_SET_FROM_ATTACHMENT_FIELDS);
    const profileId = requireProfileId(params);
    const attachmentId = requireString(params, "attachmentId");

    const attachment = await ctx.attachments.readText(attachmentId);
    if (!attachment) {
      throw new InputError("Couldn't read the uploaded résumé file — try again.");
    }
    if (attachment.text.trim().length === 0) {
      throw new InputError("The uploaded résumé file was empty.");
    }

    return saveResumeContent(store, ctx, profileId, attachment.text);
  };
}

export function createResumeGetHandler(store: JobSearchStore) {
  return async (ctx: ModuleWorkerContext): Promise<Record<string, unknown>> => {
    const { profileId } = validateProfileInput(ctx.input);

    const resume = await store.getLatestResume(profileId);
    if (!resume) {
      return { profileId, resume: null };
    }

    return {
      profileId,
      resume: {
        version: resume.version,
        content: resume.content,
        updatedAt: resume.updatedAt
      }
    };
  };
}
