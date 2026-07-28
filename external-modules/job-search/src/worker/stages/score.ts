// external-modules/job-search/src/worker/stages/score.ts
//
// Task 15 (#1299): the score stage. A function, not a handler — like Task 14's crawl stage,
// nothing here appears in the manifest; `handlers/pass.ts` composes this with `runCrawl` inside
// one invocation.
//
// L9 is structural here too: `parseScoreResult` (Task 9) already rejects a blended field at the
// domain layer, and this file adds nothing that could reintroduce one — no sort key, no derived
// "rank", never a field named anything but `fit`/`want` on what gets written or announced.
import { triage } from "../../domain/triage.js";
import type { SearchCriteria } from "../../domain/records.js";
import type { JobSearchStore } from "../../domain/store-port.js";
import { buildScorePrompt, parseScoreResult, SCORE_SCHEMA } from "../../domain/score.js";
import { buildBriefingContribution } from "../../domain/surface.js";
import type { EmbedPort } from "./crawl.js";

/** The AI dependency, typed as the REAL host contract. `ctx.ai.generateStructured` returns an
 * envelope, never a bare object, and never throws for a modelling failure — it reports one.
 * Typing this as `Promise<unknown>` is how a module ends up doing `result.fit` on
 * `{ok: false, error: "needs_config"}` and writing `undefined` into a score column. */
export interface AiPort {
  generateStructured(input: {
    schema: Record<string, unknown>;
    prompt: string;
    maxOutputTokens?: number;
    tierHint?: "reasoning" | "interactive" | "economy";
  }): Promise<
    | { ok: true; object: unknown }
    | {
        ok: false;
        error:
          | "needs_config"
          | "validation_failed"
          | "provider_error"
          | "usage_limited"
          | "aborted";
      }
  >;
}

/** Task 2b's `ctx.notify` verbatim. `key` is required here even though the port makes `href`
 * optional: Task 2b dedupes on `key`, so omitting it makes every pass post a fresh
 * "N new matches" row instead of updating one. */
export interface NotifyPort {
  post(input: { key: string; title: string; body: string; href?: string }): Promise<void>;
}

/** What one pass will spend on reading postings, kept safely under the platform's own
 * per-invocation guard (`worker-rpc-host.ts`: `AI_CALLS_PER_INVOCATION_CAP`, which returns
 * `{ok:false, error:"usage_limited"}` once exceeded). This is the budget for the WHOLE
 * invocation — for a sweep, that is every profile put together, not this many each.
 *
 * Sized so a first crawl reads the board it just found rather than a seventh of it: the
 * crawler routinely returns well over a hundred postings, and at the old value of 8 a user
 * watched a board where all but seven rows said "Not read yet" — which reads as broken, not
 * as thorough. What actually stops a pass is the invocation deadline (`runScore` halts with
 * `reason: "deadline"` and defers the rest to the next pass), and that is the honest bound:
 * a wall clock, not an arbitrary count. */
export const AI_CALL_BUDGET = 200;

/** How many unscored postings (with an embedding already) are pulled as triage's candidate
 * pool. Deliberately much larger than any realistic `budget`: triage's own selection, not this
 * number, is what bounds the model calls — a pool too small here would silently starve the
 * recall slice of candidates to choose from. */
const CANDIDATE_POOL_LIMIT = 500;

export interface RunScoreResult {
  scored: number;
  deferred: number;
  failed: number;
  /** AI calls actually made. The sweep subtracts this from its remaining budget, so a stage
   * that under-reports silently blows the platform cap on the next profile. */
  aiCallsUsed: number;
  /** Set when the stage stopped for a reason the user should be told about, rather than
   * because it ran out of postings. Rendered by Task 20's degraded strip. */
  halted: null | {
    reason: "needs_config" | "usage_limited" | "deadline" | "aborted" | "provider_error";
    detail: string;
  };
}

export interface BriefingContribution {
  headline: string;
  items: Array<{ id: string; title: string; detail: string; href?: string }>;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** One representative string per criteria set for `embedQuery` — the retrieval-side counterpart
 * of `crawl.ts`'s `embeddingTextFor`. No test pins this exact composition (only that a criteria
 * vector and a context vector end up compared against each posting's stored embedding does); if
 * triage quality later needs a different composition, change it here. */
function criteriaEmbeddingText(criteria: SearchCriteria): string {
  return [
    criteria.titles.join(", "),
    criteria.seniority.join(", "),
    criteria.locations.join(", "),
    criteria.mustHave.join(", "),
    criteria.niceToHave.join(", "),
    criteria.wantNarrative
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export async function runScore(deps: {
  store: JobSearchStore;
  embed: EmbedPort;
  ai: AiPort;
  notify: NotifyPort;
  profileId: string;
  /** Calls this stage may spend. Never larger than AI_CALL_BUDGET minus whatever the
   *  invocation already spent. Zero is legal and means "make no AI calls at all". */
  budget: number;
  now: string;
  deadlineAt: number;
  clock: () => number;
}): Promise<RunScoreResult> {
  const { store, embed, ai, notify, profileId, budget, now, deadlineAt, clock } = deps;

  // Never larger than the platform's own per-invocation cap, regardless of what the caller
  // passed — this is the second layer under the sweep's own arithmetic, not a substitute for it.
  const scoreBudget = Math.min(budget, AI_CALL_BUDGET);

  if (scoreBudget <= 0) {
    // A normal outcome (the sweep hands out zero when its budget is spent), not an error — and
    // deliberately returned before any store or embed call: there is nothing this invocation
    // could do with a candidate list it has no budget to act on.
    return { scored: 0, deferred: 0, failed: 0, aiCallsUsed: 0, halted: null };
  }

  const profile = await store.getProfile(profileId);
  if (profile === null) {
    throw new Error(`runScore: profile ${profileId} not found`);
  }

  const candidates = await store.listUnscoredPostingsWithEmbeddings(
    profileId,
    CANDIDATE_POOL_LIMIT
  );
  if (candidates.length === 0) {
    return { scored: 0, deferred: 0, failed: 0, aiCallsUsed: 0, halted: null };
  }

  const resume = await store.getLatestResume(profileId);
  const resumeText = resume?.content ?? "";
  // Fit is judged against the résumé and nothing else, so with none on file there is no basis
  // for a number at all. The prompt still asks the model for `fit: 0` (the schema requires both
  // axes), but 0 is a SCORE — on the board it sits in the same column, in the same shape, as a
  // 0 the model reasoned its way to, and it sorts as the worst possible match. Persisting null
  // instead is the difference between "we read this and it's a terrible fit" and "we have
  // nothing to judge it with"; the column is nullable precisely so that distinction can be
  // stored rather than flattened. `fitReason` still carries the model's own explanation of the
  // absence, which is what the inspector shows in place of the number.
  const hasResume = resumeText.trim().length > 0;
  const contextText = profile.contextSummary ?? "";

  const criteriaText = criteriaEmbeddingText(profile.criteria);
  if (criteriaText.length === 0) {
    // Unreachable through the product — `isReadyToCrawl` will not activate a profile whose
    // criteria are empty, so nothing can have been crawled for one either. Loud rather than
    // silent all the same: a scored pass built on no criteria at all is meaningless, and the
    // alternative (embedding "") is a host `invalid_rpc` that surfaces as an opaque
    // `handler_failed` for the entire sweep.
    throw new Error(`runScore: profile ${profileId} has no criteria text to embed`);
  }
  const criteriaVector = await embed.embedQuery(criteriaText);
  // A profile is crawlable without ever having narrated its situation: `isReadyToCrawl` asks
  // only for criteria plus an enabled portal, and `context_summary` is written exclusively by
  // the `profile.set-context` tool during the onboarding conversation. So null here is an
  // ordinary state, not a broken one — and embedding "" is NOT the neutral way to express it
  // (the host rejects an empty string with `invalid_rpc`, which took the whole crawl down).
  //
  // Absent context means absent profile signal. Every candidate scores 0, which leaves the
  // recall bucket empty by construction (it needs profile >= OUTSIDE_FRAME_PROFILE_MIN) and
  // lets triage rank on criteria alone. That is the honest degradation: the recall case exists
  // to surface roles outside your stated criteria that match who you are, and without a
  // "who" there is nothing for it to match against.
  const contextVector = contextText.length > 0 ? await embed.embedQuery(contextText) : null;

  const criteriaSimilarity = new Map(
    candidates.map((posting) => [posting.id, cosineSimilarity(criteriaVector, posting.embedding)])
  );
  const profileSimilarity = new Map(
    candidates.map((posting) => [
      posting.id,
      contextVector === null ? 0 : cosineSimilarity(contextVector, posting.embedding)
    ])
  );

  const { selected, deferred: triageDeferred } = triage({
    postings: candidates,
    criteriaSimilarity,
    profileSimilarity,
    budget: scoreBudget
  });

  let scored = 0;
  let failed = 0;
  let aiCallsUsed = 0;
  let unreached = 0;
  let halted: RunScoreResult["halted"] = null;
  let retriedProviderError = false;

  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    if (entry === undefined) {
      throw new Error(`runScore: no selected posting at index ${index}`);
    }
    const { posting, outsideFrame } = entry;

    if (halted !== null) {
      unreached++;
      continue;
    }

    if (clock() >= deadlineAt) {
      halted = {
        reason: "deadline",
        detail: "The invocation ran out of time before scoring every selected posting."
      };
      unreached++;
      continue;
    }

    if (aiCallsUsed >= scoreBudget) {
      // The stage simply ran out of turns — a normal outcome, not something to flag via
      // `halted`. Everything from here on is deferred, exactly like a posting triage never
      // selected.
      unreached++;
      continue;
    }

    const prompt = buildScorePrompt({
      posting,
      criteria: profile.criteria,
      resume: resumeText,
      context: contextText
    });

    let attempt = 1;
    scoreThisPosting: while (attempt <= 2) {
      aiCallsUsed++;
      const result = await ai.generateStructured({
        schema: SCORE_SCHEMA,
        prompt,
        tierHint: "reasoning"
      });

      if (result.ok) {
        try {
          const parsed = parseScoreResult(result.object);
          await store.upsertMatch(profileId, {
            profileId,
            postingId: posting.id,
            fit: hasResume ? parsed.fit : null,
            want: parsed.want,
            fitReason: parsed.fitReason,
            wantReason: parsed.wantReason,
            outsideFrame,
            state: "new",
            scoredAt: now
          });
          scored++;
        } catch {
          // A parse failure is the model's fault, not the platform's — increment `failed` and
          // leave the posting unscored so the next pass retries it. Never a partial write.
          failed++;
        }
        break scoreThisPosting;
      }

      // An explicit switch on the typed error, not a truthiness check — five distinct causes,
      // four distinct behaviours (Constraints).
      switch (result.error) {
        case "needs_config":
          halted = {
            reason: "needs_config",
            detail: "No model is configured, so scoring cannot proceed."
          };
          break scoreThisPosting;
        case "usage_limited":
          halted = {
            reason: "usage_limited",
            detail: "The model usage cap for this pass was reached."
          };
          break scoreThisPosting;
        case "aborted":
          halted = { reason: "aborted", detail: "Scoring was aborted before it finished." };
          break scoreThisPosting;
        case "validation_failed":
          // The one error the model, not the platform, caused — per-posting, keep going.
          failed++;
          break scoreThisPosting;
        case "provider_error":
          if (retriedProviderError) {
            // A genuine SECOND provider error anywhere in the stage — the one retry is spent.
            halted = {
              reason: "provider_error",
              detail:
                "The model provider failed twice in this pass; the one allotted retry was already used."
            };
            break scoreThisPosting;
          }
          if (aiCallsUsed < scoreBudget) {
            // Retry the SAME posting — a labelled `continue` on the inner loop, never the outer
            // one, so the posting this attempt claimed to retry is never silently skipped.
            retriedProviderError = true;
            attempt++;
            continue scoreThisPosting;
          }
          // No budget left to spend on the retry: this reads as running out of turns, not as
          // the provider itself being the reason the stage stopped.
          halted = {
            reason: "usage_limited",
            detail: "The retry for a provider error would have exceeded this pass's call budget."
          };
          break scoreThisPosting;
        default: {
          const exhaustiveCheck: never = result.error;
          throw new Error(`runScore: unhandled ai error ${String(exhaustiveCheck)}`);
        }
      }
    }
  }

  const deferred = triageDeferred + unreached;

  // Notify only when this invocation actually produced matches, and only with the count it
  // itself created — never a store-wide `newMatchCount`, which would re-announce yesterday's
  // unread matches every six hours even on a pass that scored nothing.
  if (scored > 0) {
    await notify.post({
      key: `new-matches:${profileId}`,
      title: scored === 1 ? "1 new job match" : `${scored} new job matches`,
      body: `${scored} new posting${scored === 1 ? " was" : "s were"} read and added to your board this pass.`
    });
  }

  return { scored, deferred, failed, aiCallsUsed, halted };
}

export async function contributeToBriefing(deps: {
  store: JobSearchStore;
  detail: "count" | "top" | "full";
}): Promise<BriefingContribution> {
  const { store, detail } = deps;

  // Only an active profile can have produced anything new to brief — a profile still
  // `in_conversation` has no criteria and has never crawled.
  const profiles = (await store.listProfiles()).filter((profile) => profile.state === "active");

  const shaped = await Promise.all(
    profiles.map(async (profile) => {
      const matches = await store.listMatches(profile.id, BRIEFING_MATCH_READ_LIMIT);
      const postings = await store.getPostings(matches.map((match) => match.postingId));
      return { id: profile.id, name: profile.name, matches, postings };
    })
  );

  const degraded = (
    await Promise.all(profiles.map((profile) => store.listPortals(profile.id)))
  ).flatMap((portals) => portals.map((portal) => portal.cause).filter((cause) => cause !== null));

  // Delegates entirely to Task 10's shaping — no string assembly here, and none in the thin
  // `handlers/briefing.ts` wrapper either.
  return buildBriefingContribution({ profiles: shaped, detail, degraded });
}

/** How many of a profile's matches the briefing reads before `buildBriefingContribution`'s own
 * per-detail-level trimming (top 3 / full / count only) runs. Generous on purpose: trimming to
 * what actually renders is that function's job, not this read's. */
const BRIEFING_MATCH_READ_LIMIT = 200;
