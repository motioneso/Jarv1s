### Task 15: Score stage, the single-pass handler, and surfacing

Two things land here. The scoring stage, in the same shape as Task 14 — a pure function over a fake
store. Then the module's queue handlers: `crawl.run`, which runs crawl → triage → score for **one**
profile inside one invocation because it has no other choice; and `crawl.sweep`, which exists because
schedules fan out one job per _user_, not per profile, so something has to list the actor's own
profiles and walk them.

**Those are two declared queues, not one queue with two handlers.** A schedule can only ever reach
the handler of the queue it names — `job-reconciler.ts` resolves `queueByName.get(schedule.queue)`
and calls `boss.schedule(queue.name, …)`, and the job handler always invokes `queue.handler` with no
per-job override. A manifest that declares only `job-search.crawl-run` and points the schedule at it
makes `crawl.sweep` **unreachable code**, and the scheduled job arrives at `crawl.run` with
`params: {}` and no profile to crawl. That is the single most likely way this module ships looking
fine and never runs.

**Depends on:** Task 2b (`ctx.notify`), Task 2e (`ctx.deadlineAt`), Task 8 (`triage`), Task 9
(`buildScorePrompt`, `parseScoreResult`, `SCORE_SCHEMA`), Task 10 (`buildBriefingContribution`,
`newMatchCount`), Task 13 (`JobSearchStore`, `validateProfileInput`), Task 14 (`runCrawl`,
`EmbedPort`).

**Files**

- Create: `external-modules/job-search/src/worker/stages/score.ts`
- Create: `external-modules/job-search/src/worker/handlers/pass.ts` — `crawl.run` and `crawl.sweep`
- Create: `external-modules/job-search/src/worker/job-input.ts` — the queue-envelope parser
- Create: `external-modules/job-search/src/worker/handlers/briefing.ts`
- Create: `external-modules/job-search/src/worker/handlers/matches.ts` — `matches.list` and
  `match.set-state`, the board's only route to the database
- Modify: `external-modules/job-search/src/worker/index.ts` — register the handlers
- Modify: `external-modules/job-search/jarvis.module.json` — three queues, three tools, the schedule
- Test: `tests/unit/job-search-score-stage.test.ts`, `…-pass-handler.test.ts`,
  `…-job-input.test.ts`, `…-match-handler.test.ts`

**Contracts**

```ts
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
        error: "needs_config" | "validation_failed" | "provider_error" | "usage_limited" | "aborted";
      }
  >;
}

/** Task 2b's `ctx.notify` verbatim. `key` is required here even though the port makes `href`
 * optional: Task 2b dedupes on `key`, so omitting it makes every pass post a fresh
 * "N new matches" row instead of updating one. Use `new-matches:${profileId}`. */
export interface NotifyPort {
  post(input: { key: string; title: string; body: string; href?: string }): Promise<void>;
}

/** The platform's hard cap, enforced PARENT-SIDE per invocation:
 * `worker-rpc-host.ts` exports `AI_CALLS_PER_INVOCATION_CAP = 8` and returns
 * `{ok:false, error:"usage_limited"}` on call nine. So this is the budget for the WHOLE
 * invocation — for a sweep, that is every profile put together, not eight each. */
export const AI_CALL_BUDGET = 8;

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
}): Promise<{
  scored: number;
  deferred: number;
  failed: number;
  /** AI calls actually made. The sweep subtracts this from its remaining budget, so a stage
   *  that under-reports silently blows the platform cap on the next profile. */
  aiCallsUsed: number;
  /** Set when the stage stopped for a reason the user should be told about, rather than
   * because it ran out of postings. Rendered by Task 20's degraded strip. */
  halted: null | {
    reason: "needs_config" | "usage_limited" | "deadline" | "aborted" | "provider_error";
    detail: string;
  };
}>;

export async function contributeToBriefing(deps: {
  store: JobSearchStore;
  detail: "count" | "top" | "full";
}): Promise<BriefingContribution>;
```

```ts
// job-input.ts — the QUEUE envelope. Task 13's validateProfileInput handles the TOOL shape.
export interface JobEnvelope {
  readonly actorUserId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
}
export function parseJobEnvelope(raw: unknown): JobEnvelope;
```

**`ctx.input` has two shapes, and this is the single easiest thing in the module to get wrong**

| Invoked via                                                          | `ctx.input` is                                   |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| an assistant tool (`apps/api/src/external-module-tools.ts:82`)       | `{...toolInput, actorUserId}`                    |
| a queue job (`apps/worker/src/external-module-job-handler.ts:88-96`) | `{actorUserId, jobKind, idempotencyKey, params}` |

A handler written against the tool shape reads `input.profileId` on a queue job and finds nothing,
because the profile id is one level down in `params`. It does not crash — it silently does nothing.

**Constraints — the envelope parser**

- **Strict.** The host builds this object itself from exactly four literals
  (`external-module-job-handler.ts:88-96`), so any other shape means the contract changed under us,
  and running against a shape we do not understand is worse than failing. Allowed-key set of exactly
  `actorUserId`, `jobKind`, `idempotencyKey`, `params`.
- **`actorUserId` is first-class here and is never stripped.** The rule that a validator must
  _tolerate_ a host-spread `actorUserId` applies to **tool input schemas**, where the host adds it to
  a module-authored shape. This envelope is host-authored end to end. Do not harmonise the two.
- **`deadlineAt` is not in this envelope.** Task 2e ships it in the `module.invoke` params beside
  `input` and the SDK exposes it as `ctx.deadlineAt`. If a future change moves it into the input
  envelope, it must join the allowed-key set in the same edit or **every job fails on an unknown
  key**.
- `params: {}` is valid (the host writes `params: job.data.params ?? {}`); **absent** is not; and
  `params: []` must be rejected, because `typeof [] === "object"` slips through a naive check and
  every `params.profileId` read afterwards is silently `undefined`.

**Constraints — the score stage**

- Sequence: `embedQuery` the criteria text and the profile's `context_summary` → similarity maps
  against stored posting vectors → `triage` → take at most `min(budget, AI_CALL_BUDGET)` of the
  selected postings → `buildScorePrompt` → `ai.generateStructured({schema: SCORE_SCHEMA, prompt,
tierHint: "reasoning"})` → branch on the envelope → `parseScoreResult` → `upsertMatch`.
- **Five typed errors, four behaviours: `needs_config`, `usage_limited` and `aborted` end the stage;
  `validation_failed` is per-posting; `provider_error` gets exactly one retry across the whole
  stage** — not one per posting, or a provider that is down is hammered for every remaining posting.
  Write it as an explicit `switch` on `result.error`, not a truthiness check.
- **The retry needs a labelled inner loop.** "Retry the same posting" and "move to the next posting"
  are different instructions, and a bare `continue` inside the switch means the second one — it
  silently drops the posting it claims to retry while every call-counting assertion still passes. A
  `retriedProviderError` flag enforces the once rule; an `attempt <= 2` bound guarantees termination
  if someone later edits the flag wrong.
- **Check `callsUsed >= Math.min(budget, AI_CALL_BUDGET)` before every call, including the retry.**
  Taking `min(budget, AI_CALL_BUDGET)` postings up front bounds the _initial_ calls only; one retry
  on top of a full batch is one call over both the stage budget and the host cap. The host increments
  its counter **before** the check (`worker-rpc-host.ts:212-214`), so a rejected attempt still spends
  budget.
- **Cancellation is a number.** Check `clock() < deadlineAt` before each call and halt `"deadline"`
  when it passes. That check stops a call that has not started; a call already in flight is stopped
  by the host, which owns the invocation's `AbortController` (Task 2e). There is no `ctx.signal`, and
  `ctx.ai.generateStructured` accepts no signal parameter (`packages/module-sdk/src/worker.ts:38`).
  Do not go looking for one.
- **Never write a partial score.** A parse failure increments `failed` and leaves the posting
  `unscored` so the next pass retries it; a halt leaves the untouched postings `unscored`, not
  `failed`, because marking them failed hides them from that retry.
- **Notify only when this invocation actually produced matches** — post if and only if `scored > 0`,
  and the count in the body is the number of matches **created during this invocation**, not
  `newMatchCount` read fresh from the store. A store-wide count re-announces yesterday's unread
  matches every six hours, and a pass that scored nothing still posts. One `notify.post` per pass,
  keyed `new-matches:${profileId}`.
- `contributeToBriefing` reads the store and delegates entirely to `buildBriefingContribution` — no
  string assembly in the handler.

**Constraints — the pass handlers**

- **`CRAWL_SHARE = 0.4`.** The invocation's time is split rather than shared first-come-first-served:
  crawling is many cheap HTTP calls, scoring is a few expensive model calls, so an overrunning crawl
  is always the thing to cut — fresh postings with no scores is worse than slightly stale postings
  that are scored. **`CRAWL_SHARE` is a share of TIME; `AI_CALL_BUDGET` is a count of CALLS.** They
  are different resources and are never traded against each other; the crawl stage makes no AI calls.
- `crawl.run` parses the envelope, **requires `params.profileId` itself** (the queue `paramsSchema`
  DSL has no "required" concept, so `{type:"object",fields:{…}}` accepts `{}`), and runs both stages
  for that one profile with the full `AI_CALL_BUDGET`.
- `crawl.sweep` takes no params. It lists profiles via the store — never a parameter, since a
  schedule cannot carry one — filters to `state === "active"` **in the handler** (`listProfiles()` +
  filter, not a `listActiveProfiles` store method: the store contract is closed and "active" is a
  domain predicate), and spends the invocation's eight calls across them sequentially from a
  persisted rotation cursor.
- **`listProfiles` must return a deterministic order** (Task 13 pins `ORDER BY created_at, id`). The
  cursor is an **index** into that list; a non-deterministic order makes it point at a different
  profile every sweep and the rotation degenerates into random selection — which still passes any
  test that only counts calls.
- **Count the calls at the port, not at the return value.** Wrap `ctx.ai` once before the loop in a
  `countingAi(inner)` that increments **before** awaiting, so a call that throws or is aborted still
  counts as spent. The host's own counter is private to the parent RPC closure
  (`worker-rpc-host.ts:111`, incremented at `:212`) and the worker cannot read it. Budget arithmetic
  reads `ai.used()`; returned usage is for reporting only. Deriving remaining budget from returned
  usage double-spends after a throw and blows past the host cap, at which point the sweep looks
  broken for a reason nothing logged.
- **A profile that receives zero budget is legal** — skipped without an error, first in line next
  sweep. Without that, "rotation" means the first profile is scored every six hours and the last one
  never is.
- **One profile throwing must not stop the sweep.** Catch per profile, push the cause onto the
  returned summary, continue. Nothing is written to the store: the closed interface has no
  failure-note method and `ProfileState` has no error member, and inventing either here is a silent
  widening of a deliberately closed contract. The cursor still advances past it, so a permanently
  broken profile cannot starve the others.
- **The sweep honours the deadline, and the cursor points at the first profile not _started_.** Break
  out of the loop when `clock() >= ctx.deadlineAt` as well as when the budget is exhausted, and
  persist `stoppedAt` as the index of the first profile the loop never began — not the last one it
  finished, and not an index advanced past a profile that was cut short. Advancing past an unstarted
  profile is how one profile is skipped every sweep in a way no call-count assertion notices.
- `runProfileStages` takes the wrapped `ai` port as an argument rather than reaching for `ctx.ai`,
  and must never issue a call when its remaining budget is zero.

**Constraints — the match handlers, the board's only route to the database**

Until a declared handler calls Task 13's `listMatches` / `setMatchState` they are unreachable code:
the web bundle receives only `{hostActions, assistantSurface?}`
(`apps/web/src/external-modules/loader.ts:11-20`) and has no database access of any kind.

- **The read and the write take different transports, and this is forced, not chosen.** A
  `risk: "read"` tool executes inline on `POST /api/ai/assistant-tools/:name/invoke`. A `write` or
  `destructive` tool does **not**: the route creates a pending assistant action and returns **403
  with `blockedReason: "confirmation_required"`** before ever reaching `execute`
  (`packages/ai/src/routes.ts:645-668`). A board that calls
  `invokeTool("job-search.match.dismiss")` gets `{kind: "blocked"}` and the match is never dismissed
  — a button that does nothing, on a path where nothing errors. Writes from a module's own surface go
  through the manual-run queue endpoint, exactly as finance does
  (`external-modules/finance/src/web/api.ts:1-8`).
- `matches.list` — `risk: "read"`, called with `invokeTool`, returns board records.
- `match.set-state` — one handler, two ways in: the **board** enqueues
  `runQueue("job-search.match-state", "match.set-state", {matchId, state})`; the **assistant** reaches
  it through the `job-search.match.dismiss` write tool, where the confirmation prompt is the correct
  consent boundary rather than an obstacle.
- **`limit` is required, with no default.** Clamp 1..100 in the schema and **re-check in the
  handler**: the queue path's params DSL has no numeric bounds and never validated it. A handler that
  quietly substitutes a default lets an unbounded board read ship as an omission rather than fail.
- **Scope the read by `profileId`, not by `limit` alone.** RLS confines this to the actor's own rows,
  so the risk is one of the actor's _other_ profiles leaking into this profile's board — still wrong,
  and invisible in a single-profile test.
- **`SETTABLE_STATES = ["new", "saved", "dismissed"]`, enforced in the handler.** The queue's params
  DSL types `state` as `string` because the DSL has no enum, so an unvalidated handler accepts
  `state: "anything"` straight from a manual-run body into the database.
- Both handlers must be **registered** in `src/worker/index.ts` under the manifest's names. A handler
  that exists but is not registered fails at runtime with `unknown handler`, and nothing at install
  time catches it.
- The `crawl.run-now` tool and the `crawl.run` queue are **different handler names on purpose** — the
  tool receives the tool shape, the queue receives the envelope, and one handler serving both would
  have to sniff its own input. Register `crawl.run-now` as a thin wrapper that validates with Task
  13's `validateProfileInput` and calls the same internal function.

**Manifest additions** (verbatim)

```jsonc
"assistantTools": [
  {
    "name": "job-search.crawl.run-now",
    "permissionId": "job-search.crawl.run-now",
    "description": "Crawl this search profile's enabled job boards now.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "profileId": { "type": "string" } }, "required": ["profileId"]
    },
    "handler": "crawl.run-now"
  },
  {
    // The board's read. `risk: "read"` is not a preference — it is the whole reason this
    // works from the browser at all.
    "name": "job-search.matches.list",
    "permissionId": "job-search.matches.list",
    "description": "List scored matches for a search profile.",
    "risk": "read",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "profileId": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
      },
      "required": ["profileId", "limit"]
    },
    "handler": "matches.list"
  },
  {
    // The ASSISTANT path only ("dismiss that one" in chat, then confirm). The board does NOT
    // call this — a write tool 403s from the browser.
    "name": "job-search.match.dismiss",
    "permissionId": "job-search.match.dismiss",
    "description": "Dismiss a match so it leaves the board.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "matchId": { "type": "string" } }, "required": ["matchId"]
    },
    "handler": "match.set-state"
  }
],
"worker": {
  "queues": [
    {
      "name": "job-search.crawl-run", "handler": "crawl.run", "retryLimit": 2,
      // The board's "Search now" enqueues through POST /api/modules/:id/queues/:name/run,
      // which is gated on this flag and is the ONLY enqueue path that exists.
      "allowManualRun": true,
      // Task 2e. A pass is two portals of paged HTTP plus up to eight structured model calls;
      // the 30s default kills it mid-run with an empty log.
      "timeoutMs": 600000,
      // NOT JSON Schema — queue paramsSchema is the platform DSL (`isValidModuleParamsSchema`),
      // while assistantTools[].inputSchema above IS JSON Schema. Two languages, one manifest
      // file. The DSL has NO "required" concept, so this accepts `{}` too and `crawl.run` must
      // reject a missing profileId itself.
      "paramsSchema": { "type": "object", "fields": { "profileId": { "type": "identifier" } } }
    },
    {
      // The scheduled entry point. Its own queue because a schedule can only reach the handler
      // of the queue it names — there is no per-job handler override.
      "name": "job-search.crawl-sweep", "handler": "crawl.sweep", "retryLimit": 1,
      "allowManualRun": false,
      "timeoutMs": 600000,
      // Deliberately empty. The DSL rejects unknown keys, so `fields: {}` accepts `{}` and
      // nothing else.
      "paramsSchema": { "type": "object", "fields": {} }
    },
    {
      // The board's WRITE path.
      "name": "job-search.match-state", "handler": "match.set-state", "retryLimit": 2,
      "allowManualRun": true,
      "timeoutMs": 30000,
      // Two identifiers and an enum — metadata only, no posting content, per the global
      // constraint on job payloads.
      "paramsSchema": {
        "type": "object",
        "fields": { "matchId": { "type": "identifier" }, "state": { "type": "string" } }
      }
    }
  ],
  "schedules": [
    // Off the hour: every module scheduling at :00 stampedes the same minute. scope "user" fans
    // this out to one job per active user with these static params — there is no per-profile
    // scheduling, which is why the handler is a sweep.
    //
    // `queue` MUST be the sweep queue. Pointing it at job-search.crawl-run delivers a job with
    // no profileId to a handler that needs one, and leaves crawl.sweep unreachable.
    { "id": "job-search.crawl-sweep", "cron": "17 */6 * * *", "scope": "user",
      "jobKind": "job-search.crawl-sweep", "queue": "job-search.crawl-sweep" }
  ],
  "reconcileJobs": []
}
```

All four schedule fields are required by `validate.ts`: `id` and `jobKind` must match
`/^[a-z][a-z0-9_.-]{0,63}$/`, `cron` must be five fields, `scope` must be `"user"`. A schedule
missing any of them fails validation, which fails install.

**Tests — envelope** (`tests/unit/job-search-job-input.test.ts`)

1. **Reads exactly the four fields the queue path sends** and returns them unchanged.
2. **Accepts the sweep's empty `params: {}`** — empty is valid, absent is not.
3. **Rejects an unknown top-level key** (`/unknown key extra/`). The host sends four literals; a
   fifth means the contract moved.
4. **Rejects `params` that is an array, `null`, a scalar, or absent.** The array case is the one that
   matters: `typeof [] === "object"` passes a naive object check and every later `params.profileId`
   read is silently `undefined`.
5. **Rejects a tool-shaped input** `{profileId, actorUserId}` with `/unknown key profileId/`, rather
   than running against `params: undefined` and reporting success having done nothing.
6. **Rejects a missing `actorUserId`.** Everything stored is owner-scoped; there is no default.

**Tests — score stage** (`tests/unit/job-search-score-stage.test.ts`)

1. **Triage picks the batch** — only selected postings are sent to the model.
2. **`outsideFrame` from triage is persisted onto the match**, so the recall slice stays visibly
   flagged.
3. **An `{ok: true}` envelope whose `object` fails `parseScoreResult` leaves the posting `unscored`**
   and increments `failed`. It never lands as a number, and it is retried next pass.
4. **One bad result does not abort the batch** — the other postings still score.
5. **`needs_config` halts immediately** and scores nothing further; exactly one
   `generateStructured` call. Retrying is pointless — no model is configured, so every remaining call
   returns the same thing.
6. **`usage_limited` halts and leaves the rest `unscored`, not `failed`.** Asserts `failed === 0` and
   that the untouched postings still appear in `listUnscored`. Marking them failed would hide them
   from the next pass, which is fine because the cap resets per invocation.
7. **`aborted` ends the stage** — exactly one call, zero `failed`. Note what this case does _not_ do:
   it never constructs an `AbortSignal`. The module has none to give; the fake port returns the
   envelope exactly as the host's would.
8. **`provider_error` gets exactly one retry across the whole stage, on the same posting.** Asserts
   three things: that the two calls around the retry carried the **same posting id in their prompt**,
   that no posting was skipped, and that a second `provider_error` anywhere halts. A retry written as
   a bare `continue` passes a call-count assertion while silently dropping the posting it claimed to
   retry — the prompt assertion is what catches it.
9. **`validation_failed` is per-posting** — increment `failed`, leave the posting `unscored`, keep
   going. It is the one error the _model_, not the platform, caused.
10. **Never more than `budget` calls, never more than `AI_CALL_BUDGET`.** 40 candidates with
    `budget: 8` → exactly 8 calls and the remainder `deferred`. The 9th returns `usage_limited`
    anyway, so spending it to discover that is pure waste.
11. **`budget: 0` makes no calls at all** and returns `aiCallsUsed: 0` without an error. The sweep
    hands out zero when the invocation's budget is spent; that is a normal outcome.
12. **`aiCallsUsed` equals the number of `generateStructured` calls, including failures.** A retry
    counts. This is the number the sweep does its arithmetic on.
13. **A retry cannot exceed `budget`.** `budget: 1`, one candidate, first call `provider_error` →
    exactly **one** call and a `"usage_limited"` halt, not a second call it was never given.
14. **A retry cannot exceed `AI_CALL_BUDGET` either.** Eight candidates, `budget: 8`, first returns
    `provider_error` → exactly eight calls total; the retry consumes the eighth posting's call and
    the eighth posting is deferred. Without the counter this is nine, and the ninth is refused by the
    host after already being spent.
15. **A notification fires once per pass with the new-match count**, not once per match.
16. **The notification body never contains a blended number** — asserted against
    `/\b(overall|combined|score of)\b/i`.
17. **A pass that scores nothing posts no notification at all**, and a pass that scores 2 while the
    store already holds 30 unread matches says **2**. Fails against a body built from a store-wide
    `newMatchCount`, which re-announces yesterday's matches every six hours.

**Tests — pass handlers** (`tests/unit/job-search-pass-handler.test.ts`)

1. **`crawl.run` runs both stages in one invocation** — `runCrawl` then `runScore`, same `profileId`,
   from a single handler call. This is the assertion that encodes why the two stages are not two
   queue entries.
2. **The crawl deadline leaves room for scoring** — the deadline handed to `runCrawl` is meaningfully
   earlier than the one handed to `runScore`. A crawl allowed to consume the whole invocation
   produces a board full of `unscored` rows, which looks broken.
3. **`crawl.run` reads `params.profileId`, not `input.profileId`** — fed a real queue envelope.
4. **`crawl.run` rejects a missing or non-string `profileId` itself** with a typed failure — not a
   crash, not a silent no-op. The params DSL will happily deliver `{}`.
5. **`crawl.sweep` takes no params, lists the actor's own active profiles, and runs each.**
6. **`crawl.sweep` skips profiles that are not `active`** — a profile still `in_conversation` has no
   criteria, and crawling on empty criteria fetches the entire board.
7. **One profile failing does not stop the sweep** — the second profile still ran and the handler
   resolved rather than threw. A thrown handler is a pg-boss retry of the _whole_ sweep.
8. **Nine active profiles, one sweep: at most 8 AI calls in total, and the ninth is untouched.**
9. **The next sweep starts at that ninth profile** — cursor seeded from the first sweep's write.
10. **Twenty profiles across three sweeps: every profile is served at least once, and none is served
    twice before all the others have been served once.**
11. **Zero active profiles: no AI calls, no cursor write, no error.**
12. **A profile that receives zero budget is skipped without an error** and is first in line next
    sweep.
13. **The budget is counted at the port.** Profile 1 spends three calls and then throws; profile 2 is
    offered a budget of exactly **5**, not 8. Fails against every return-value-based accounting
    scheme — which is the point.
14. **The sweep stops at the deadline and the cursor points at the first profile not started.** Three
    profiles; the clock crosses `ctx.deadlineAt` during profile 2. Asserts profile 3's stages were
    never invoked and the persisted cursor is profile **2**'s index, not 3's — advancing past a
    profile that was cut short is how one profile is skipped every sweep with no assertion noticing.

**Tests — match handlers** (`tests/unit/job-search-match-handler.test.ts`, against a fake store)

1. **`matches.list` with no `limit` throws; it does not default.** Same for `0`, `101`, and `1.5`.
2. **`profileId` and `limit` reach the store unchanged** — asserted on the fake's recorded arguments,
   because a handler that reads the whole board and slices in memory passes any assertion made on the
   returned length.
3. **`match.set-state` with `state: "archived"`** (or any string outside the set) throws and calls the
   store **zero** times.
4. **Each of the three legal states calls the store exactly once with that state.**
5. **`matches.list` returns board records, never a raw store row** — id, title, company, both axis
   scores as separate fields, the reasons. Assert the returned keys explicitly: the render-from-
   records rule is only real if the record shape is pinned.

**Tests — manifest** (`tests/unit/job-search-manifest.test.ts`)

Assert through `validateExternalModuleManifest()`, **never against the raw JSON** — the validator
reconstructs the manifest from an explicit field list and silently drops what it does not recognise,
so `ok: true` proves nothing.

1. `worker.queues` has **three** entries, including handlers `crawl.run` and `crawl.sweep`.
2. **`queues[0].timeoutMs === 600000`.** If it is `undefined`, Task 2e's `validate.ts` change was not
   made and the pass dies at 30 seconds in production while passing every test here.
3. `worker.schedules[0].queue === "job-search.crawl-sweep"`.
4. `job-search.match-state` survives with `allowManualRun: true` — the board's dismiss has no other
   way in, and `allowManualRun` defaulting to false is a silent 403 at the one moment it matters.
5. **`job-search.matches.list` survives with `risk: "read"`** and `job-search.match.dismiss` with
   `risk: "write"`. The read one is load-bearing: flip it to `write` and every board read returns
   `confirmation_required` instead of matches, while every unit test above still passes.
6. **Every `schedules[].queue` names a declared queue.** Defence in depth, and be honest about which
   layer carries it: `validateWorker` already rejects an undeclared queue
   (`packages/module-registry/src/external/validate.ts:176`), so a validated install cannot reach the
   reconciler's silent `queueByName.get()` miss (`job-reconciler.ts:127`) with this defect. This
   assertion verifies the **normalized, install-time** wiring — that the name survives the field
   allowlist and still matches — not a typo the validator would already have caught.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-job-input.test.ts \
  tests/unit/job-search-score-stage.test.ts \
  tests/unit/job-search-pass-handler.test.ts \
  tests/unit/job-search-match-handler.test.ts \
  tests/unit/job-search-manifest.test.ts        # exit 0
```
