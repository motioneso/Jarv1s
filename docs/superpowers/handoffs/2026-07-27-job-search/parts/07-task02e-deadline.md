### Task 2e: Invocation stall budget, per-lane isolation, and a deadline the module can see

**A blocker for Phase 4, not a nice-to-have.** `ExternalModuleWorkerRuntime.run()` caps every
external-module invocation at 30 s of wall clock (`worker-runtime.ts:88-92`,
`this.options.invocationTimeoutMs ?? 30_000`; neither construction site overrides it —
`apps/api/src/external-module-tools.ts:38`, `apps/worker/src/worker.ts:211`). That clock keeps running
while the **host** services the module's own RPCs back to it: every `fetch.request`, every
`ai.generateStructured`. A handler doing nothing but waiting on the host is charged for the wait and
then killed.

Three problems share this one seam, and this task fixes all three:

1. **One pass cannot fit.** A worker handler cannot enqueue (D2), so crawl → triage → score must run
   in a single invocation (Task 15) — up to ten HTTP requests per portal plus up to eight
   `ai.generateStructured` calls (C1), any one of which routinely takes 10–30 s. The pass is killed
   long before it finishes, at a different point every time, because whether it trips depends only on
   model latency. **And the failure is invisible**: an audit row of `failed / handler_error` with
   nothing in the API log, because `runHandler` in `packages/ai/src/gateway/gateway.ts` swallows
   handler throws with a bare `catch {}`. Confirm it by comparing timestamps — if the audit
   `occurred_at` precedes the matching `ai.structured usage` line, the AI finished after the
   invocation was already dead. There is no bug in the module.
2. **Every call to a module shares one lane** (B1). While a six-hourly crawl runs, the user's own chat
   tool calls queue behind it — "the assistant hangs when I ask about my job search".
3. **Nothing tells the module how long it has** (D1, B6). Task 14's per-portal deadline and Task 15's
   `CRAWL_SHARE` both depend on a value that does not exist anywhere in the protocol today. And the
   module could not cancel host-held work even with a signal: no module-facing port accepts one and
   an `AbortSignal` cannot cross JSON-RPC. The deadline the module can see and the cancellation of
   work the host is holding are two different problems; both are solved here, the second host-side.

**Depends on:** Task 2 (its `apps/worker/src/external-module-invoke.ts` becomes the only worker-side
caller of `runtime.invoke`). Tasks 11, 13, 14 and 15 depend on this.

**Files**

- Modify: `packages/module-registry/src/external/worker-runtime.ts` — the timeout in `run()` (:88-92),
  the per-module maps in `invoke()`/`run()`/`start()`/`failProcess()`, and the `module.invoke` params
  written to stdin (:100-102)
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — signal RPC start/finish to the
  runtime so the stall budget can be suspended; accept the invocation's host-side `AbortSignal` as a
  fourth handler argument and forward it into the pinned fetch call (:134) and the AI request
- Modify: `packages/module-sdk/src/worker.ts` — read `deadlineAt` off the invoke params; put
  `deadlineAt` (a number, and nothing else) on `ModuleWorkerContext`
- Modify: `apps/worker/src/external-module-job-handler.ts` — pass `lane: "queue"` and the queue's
  declared ceiling
- Modify: `apps/api/src/external-module-tools.ts` — pass `lane: "tool"`
- Modify: `apps/worker/src/external-module-invoke.ts` — takes `lane` as a required argument and
  forwards it; the job handler passes `"queue"`, the briefing adapter passes `"briefing"`
- Modify: `packages/module-registry/src/external/validate.ts` — accept, validate and clamp
  `queues[].timeoutMs`
- Modify: `packages/module-sdk/src/index.ts` — `timeoutMs?: number` on the queue declaration type;
  `ExternalModuleAiRequest` gains an optional host-side `signal`
- Test: `tests/unit/external-module-invocation-budget.test.ts`

**Contracts**

```ts
// worker-runtime.ts — replaces the single `invocationTimeoutMs` option.
export interface ExternalModuleWorkerRuntimeOptions {
  /** Max time the module may go WITHOUT progress. Suspended while a host RPC is in
   *  flight, so host latency is never charged to the module. Default 30_000. */
  readonly invocationStallMs?: number;
  /** Absolute ceiling on one invocation regardless of progress. Default 120_000. */
  readonly invocationHardTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly logger?: { warn(data: Record<string, unknown>, message?: string): void };
}

/** A lane is a SEPARATE CHILD PROCESS, not a separate promise chain over a shared one.
 *  Sharing a child across lanes is a cross-actor leak, not a queuing nicety — see Constraints.
 *
 *  THREE lanes, not two. `briefing` exists because Task 2's briefing invoker is a third caller
 *  of `invoke()` and it must not sit behind the queue lane: briefing composition is on a user's
 *  morning path, and a six-hourly crawl in the queue lane can legitimately hold that lane for
 *  minutes. Putting it in `tool` instead would be cheaper by one warm child, but it would let a
 *  slow briefing delay the assistant's own tool calls, which is the exact failure this task was
 *  opened to fix. */
export type WorkerLane = "queue" | "tool" | "briefing";

/** Ceiling on any queue's declared `timeoutMs`. A manifest is module-authored input, so the
 *  host's maximum wins over whatever it asks for. */
export const MAX_INVOCATION_MS = 600_000;

/** The module gets a deadline strictly inside the hard kill, so it can persist partial results
 *  and return cleanly instead of being SIGKILLed mid-write. */
export const DEADLINE_MARGIN_MS = 5_000;

/** `options` is REQUIRED, and `lane` is required within it. There is no default: a
 *  silently-defaulted lane is how a background job ends up in the foreground lane and the
 *  isolation this task buys is quietly given back. */
invoke(
  module: ExternalModuleDiscovery,
  handler: string,
  input: Record<string, unknown>,
  rpc: Rpc,
  options: { readonly lane: WorkerLane; readonly timeoutMs?: number }
): Promise<unknown>;

resolveHardTimeout(options: { readonly timeoutMs?: number }): number;
```

```ts
// module-sdk/src/worker.ts — ModuleWorkerContext gains the deadline, and only the deadline.
interface ModuleWorkerContext {
  // …existing ports: input, auth, fetch, kv, ai, db, attachments…
  /** Absolute epoch ms after which the host will hard-kill this invocation. This is the
   *  form every stage budget in Phase 4 is written against: compare it to a clock. */
  readonly deadlineAt: number;
  /** There is deliberately NO `ctx.signal`. No module port accepts a signal — `ctx.fetch`
   *  takes `{url, method?, headers?, bodyBase64?}` (`packages/module-sdk/src/index.ts:682`)
   *  and `ctx.ai.generateStructured` takes `{schema, prompt, maxOutputTokens?, tierHint?}`
   *  (`worker.ts:38`); an `AbortSignal` cannot be serialized across JSON-RPC; and a signal
   *  that can only cancel the module's own `await`s, while looking like it cancels the RPC
   *  it is passed beside, is a trap. A module that wants to stop its own loop compares
   *  `Date.now()` to `deadlineAt`. Cancelling work already in the host's hands is the HOST's
   *  job, through the per-invocation `AbortController` the host never exposes to the child. */
}
```

```ts
// worker-rpc-host.ts — the returned handler already takes (method, params, rememberSecret).
(method: string, params: unknown, rememberSecret: (v: string) => void, hostSignal?: AbortSignal);
```

```jsonc
// manifest: a queue may raise its own ceiling, bounded by the host.
{ "name": "job-search.crawl-run", "handler": "crawl.run", "timeoutMs": 600000 }
```

Wire format written to the child's stdin — `params` gains one field:

```jsonc
{ "jsonrpc": "2.0", "id": 1, "method": "module.invoke", "params": { "handler": "…", "input": {}, "deadlineAt": 1234567890 } }
```

**Constraints**

- **The stall budget measures silence, not duration** (B6, B7). It is cleared when the module asks the
  host for something and restarted when the host answers. The hard ceiling is the actual bound and is
  never suspended — without it, a module that pings the host every 29 s runs forever.
- **Suspension must be reference-counted, not a boolean.** A handler may have a `fetch` and an
  `ai.generateStructured` in flight at once; a boolean lets the first to finish restart the clock
  while the second is still blocked.
- **A lane is a separate child process.** Splitting only the serialization map while both lanes share
  one child is not a smaller version of this change, it is a security bug (B1):
  - Lane B's `state.current = invocation` (:95) overwrites lane A's while A still runs, so every RPC A
    issues afterwards executes under **B's** `rpc` closure — B's actor, B's data context, B's secret
    set — which also defeats the `containsSecret` redaction (:188, :212) because A's secrets are no
    longer the set being checked.
  - Whichever lane finishes first clears the slot (:107), so the other lane's next RPC hits
    `if (!invocation)` (:184) and **kills the process** as a protocol violation.
  - `capture` (:219) and `flushLogs` (:224) attribute stdout and stderr to whatever occupies the slot.
  - The invocation timeout (:88-92) `stop()`s the whole child, so a crawl lane timing out kills the
    user's in-flight chat tool call.
- **Every map and lifecycle hook keyed by `module.id` becomes keyed by
  `` `${moduleId}:${lane}` ``.** The call sites, so they are not re-derived — all in
  `worker-runtime.ts`:

  | Line (current) | Today                                                  | Must become                                        |
  | -------------- | ------------------------------------------------------ | -------------------------------------------------- |
  | :61-66         | `this.queues.get/set/delete(module.id)`                | `laneKey(module.id, lane)`                         |
  | :85            | `this.states.get(module.id) ?? this.start(module)`     | `this.states.get(key) ?? this.start(module, lane)` |
  | :90            | `this.states.delete(module.id)` (timeout)              | `this.states.delete(key)`                          |
  | :106           | `this.flushLogs(module.id, invocation)`                | log the lane alongside `moduleId`                  |
  | :108-113       | idle timer re-arm / `states.delete(module.id)`         | keyed by `key`                                     |
  | :143           | `this.states.set(module.id, state)`                    | `this.states.set(key, state)`                      |
  | :146-153       | `onStdout(module.id, …)` / `failProcess(module.id, …)` | pass `key`; keep `moduleId` separately for logging |
  | :240           | `if (this.states.get(moduleId) === state)`             | `if (this.states.get(key) === state)`              |

- **All three callers change in the same commit** or one silently lands in the wrong lane. The lane is
  passed explicitly — no inference from the handler name, no default.
- **The cost, stated so nobody is surprised:** up to three child processes per module while all lanes
  are warm, each released by the existing 60 s idle timer (:112). Keep per-lane serialization — one
  in-flight invocation per lane — so N concurrent jobs still cannot spawn N processes. The rejected
  alternative (tagging each RPC with an invocation id and multiplexing inside the child) needs a
  protocol version bump in `@jarv1s/module-sdk` plus concurrency inside `defineModuleWorker`, and
  still leaves one crashed lane taking down the other.
- **The deadline is absolute epoch milliseconds, not a duration.** Host and child are the same machine
  (the child is spawned at `worker-runtime.ts:124`), so epoch ms are directly comparable. A relative
  duration starts drifting the moment the child is slow to read stdin.
  `deadlineAt = Date.now() + Math.max(1_000, resolveHardTimeout(options) - DEADLINE_MARGIN_MS)`.
- **The SDK defaults `deadlineAt` to `Date.now() + 30_000` when the host omits it.** That version-skew
  default is the **only** reason the field is not mandatory in the protocol; say so in the code
  comment so it is not later "cleaned up" into a required field.
- **The host half is what makes cancellation real.** At the ceiling, `run()` aborts a per-invocation
  `AbortController` immediately before killing the child; the RPC callback takes that signal as a
  fourth host-side argument (never on the wire); `fetch.request` forwards it into the pinned fetch
  (`worker-rpc-host.ts:134`); and `ExternalModuleAiRequest.signal` forwards it into
  `generateStructured`, which already accepts `input.signal` and already returns
  `{ok: false, error: "aborted"}` (`packages/ai/src/structured/generate-structured.ts:130`, `:156`).
  This is what makes the `aborted` member of the worker-facing error union reachable at all (C4);
  today nothing in this tree can produce it for an external module. Neither construction site changes
  (`external-module-job-handler.ts:67`, `external-module-tools.ts:44`) — the signal comes from the
  runtime at `invoke`, not from the caller.
- **`validate.ts` already lets an unknown `timeoutMs` through** — it normalizes queues by spreading the
  whole queue object (M3) — so the work is rejection and clamping, not passthrough. Mirror the
  existing `retryLimit` clamp: reject a `timeoutMs` that is not a positive integer (`0`, negative,
  fractional, `NaN`, a string, `null`); clamp anything above `MAX_INVOCATION_MS` down to it. The
  validator returns `worker` reassembled from the normalized queue array, so the clamped value is what
  every caller receives (F1, B8).
- **Downstream consumers, named here so dependent tasks do not invent their own transport.** No
  module-facing port takes a signal; the deadline crosses the wire as a number and nothing else:
  - `Portal.crawl(input: { …, deadlineAt: number })` (Task 11), no `signal` parameter.
  - Every portal checks `Date.now() >= deadlineAt` **before each page fetch** and returns what it has.
  - Task 15's `runProfileStages` computes the crawl share from the time **remaining**, evaluated when
    that profile's crawl starts: `crawlDeadlineAt = now + (ctx.deadlineAt - now) * CRAWL_SHARE`. In a
    sweep the second profile's `now` is later, so it gets a share of what is actually left.
  - `runCrawl` (Task 14) narrows further per portal — an equal share of the crawl time still
    remaining, recomputed per portal, so an early finisher donates its slack.
  - Task 15's scoring stage checks `clock() < deadlineAt` before each `generateStructured` and halts
    with `"deadline"`. It passes no signal; the `aborted` branch is reachable because the **host**
    aborts the in-flight call at the ceiling.

**Tests**

`tests/unit/external-module-invocation-budget.test.ts`. The budget cases use fake timers; the lane
cases must assert on **whose context the RPCs ran under and how many children exist**, not on ordering
— a test that only asserts "the fast call returned first" passes against the broken shared-child
design too.

1. **Does not kill an invocation blocked on a slow host RPC.** Module makes one RPC, host takes 45 s,
   module returns. Under the old flat 30 s wall-clock timer this dies at 30 s having done nothing
   wrong. This is the regression the whole task exists for.
2. **Kills an invocation that goes quiet longer than the stall budget.** A module stuck in
   `while (true)` makes no RPCs, so nothing suspends the clock and it dies on schedule. Proves the
   budget still bites.
3. **Kills an invocation that exceeds the hard ceiling even while making progress.** A module RPCing
   every 20 s runs past 120 s and is killed. Without this, the stall budget alone is not a bound — it
   only measures silence.
4. **Honours a queue's declared ceiling but clamps it to the host maximum.**
   `resolveHardTimeout({timeoutMs: 600_000})` is 600 000; `{timeoutMs: 86_400_000}` is
   `MAX_INVOCATION_MS`. A manifest must not pin a worker process open for a day.
5. **Runs two lanes of one module in two separate child processes.** Actor A's queue-lane handler
   awaits a host-controlled latch while actor B's tool-lane handler completes. Assert (a) A's RPC was
   dispatched with `actorUserId === OWNER_A` — this is the cross-actor leak the shared `state.current`
   slot causes and the whole reason a lane is a process; (b) A resolves normally after the latch
   releases; (c) two distinct child pids.
6. **Does not queue a foreground tool call behind a running background job.** A never-resolving queue
   invocation does not delay a tool-lane call.
7. **Kills only the timing-out lane's child.** A queue invocation hitting a 5 s ceiling rejects while
   a latched tool invocation still resolves. Under one shared child, `stop(state)` kills both.
8. **Ships an absolute deadline in the invoke params, inside the hard ceiling.** Assert on the JSON
   written to the child's stdin — `method === "module.invoke"`, `params.deadlineAt` greater than now
   and at most `now + ceiling - DEADLINE_MARGIN_MS`. Asserted at the wire, not on a runtime getter,
   because the bug this prevents is the field never being sent.
9. **Still kills at the ceiling a handler that ignores its deadline.** The deadline is cooperative;
   the ceiling is the bound.
10. **Defaults `deadlineAt` when the host does not send one, and exposes no signal.** SDK-side: an
    older host omits the field, and the child must not compute `NaN` and abort everything
    immediately. Also assert `"signal" in ctx === false` — the sole cancellation surface is the number.
11. **Rejects a queue whose `timeoutMs` is not a positive integer** — `0`, `-1`, `1.5`, `NaN`,
    `"600000"`, `null`, each named in the failure message.
12. **Clamps a `timeoutMs` above the platform ceiling on the normalized output.** Assert on the
    returned manifest's `worker.queues[0].timeoutMs`, not the input.
13. **Passes the queue's normalized `timeoutMs` into `runtime.invoke`** — the job handler's fifth
    argument is `{lane: "queue", timeoutMs: 600_000}`. A validated, clamped ceiling the job handler
    never reads is the same as no ceiling.
14. **Invokes with the default ceiling when a queue declares no `timeoutMs`** — fifth argument is
    `{lane: "queue"}`.
15. **Invokes a briefing contribution on the briefing lane.** Drive the **real** briefing adapter
    (Task 2), not a hand-built options object — an assertion on a literal proves only that the literal
    was typed correctly. Assert the fifth argument is `{lane: "briefing"}` and is not the queue lane,
    where a running crawl would hold it (J4).
16. **At the hard ceiling an in-flight `fetch.request` aborts rather than resolving after the child is
    killed.** Assert against a real deferred HTTP handler, not a spy — the point is that host-held
    work actually stops.
17. **At the hard ceiling an in-flight AI RPC resolves `{ok: false, error: "aborted"}`.** Today
    nothing in this tree can produce that value for an external module.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-invocation-budget.test.ts   # exit 0
pnpm typecheck                                                          # exit 0
```

`pnpm typecheck` is not optional here — making `options` a required argument on `invoke()` is a
breaking signature change, and typecheck is the only thing that finds every caller, including
external modules (I7).

**User-facing summary:** Long-running module background jobs no longer fail part-way through for no
visible reason, a background job no longer blocks the assistant from answering questions about the
same module, and a job that runs out of time saves what it found instead of being cut off mid-write.

---
