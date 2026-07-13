# Spec: Deterministic cli-runner input-ready event for the first resume turn (#1020)

- **Issue:** bug #1020 (child of the #868 seam comment; blocks #984 / PR #1015)
- **Tier:** security (chat engine lifecycle / private-history correctness)
- **Status:** draft for Ben approval (rev 2 after Sol + Fable review)
- **Grounded on:** worktree `coord/settings-host-cleanup` @
  `83f76741ea803e4ce72804ceb12bb3c0301c2328` (current feature-worktree HEAD; intentionally
  reviewed with the stale-baseline override because this coordination branch is ahead of and
  diverged from `origin/main`)

## Problem

The first real chat send after a thread resume can be silently dropped. Resume
(`resumeThread`, `packages/chat/src/live/chat-session-manager.ts:673-695`) kills the live engine;
the next turn relaunches it (`ensureSession` → `launchSession` → `engine.launch`,
`chat-session-manager.ts:276-294,296-394`). On the RPC path the cli-runner submits the replay batch
and the manager then submits the user's first typed message, but nothing proves the resumed CLI TUI
accepted either input before success is returned.

Today's path is timer- and exit-code-based:

- `packages/chat/src/live/cli-chat-engine.ts:236-254` sleeps `launchMs` (3 000 ms default at
  `:141`) before replay.
- `packages/ai/src/adapters/tmux-multiplexer.ts:65-72` pastes, sleeps `submitMs` (600 ms as
  configured at `cli-chat-engine.ts:142`), then sends Enter.
- `packages/chat/src/live/rpc-contract.ts:266-272` returns `{ok:true}` even though that currently
  proves only that the multiplexer verbs exited 0.
- `replayAndDrain` (`cli-chat-engine.ts:638-662`) treats its 25 s drain expiry as success, so launch
  can release the first real turn while replay is still active.

A slow-booting TUI can discard the paste while entering raw mode. Worse, a matcher that scans the
whole pane or transcript can find an older identical prompt (the replay block deliberately contains
prior user turns at `chat-session-manager.ts:948-962`) and falsely certify the dropped attempt.

A manager-side blind settle (`JARVIS_CHAT_REPLAY_SETTLE_MS`) was tried during #984 UAT and rejected.
It is absent at this HEAD (repo-wide grep) and remains **banned**. Deadlines may bound failure; elapsed
time may never prove readiness, delivery, or completion.

## Decision 1 — Attempt-correlated verified submit

Every interactive submit is one logical **attempt** with a stable random `attemptId` (UUID) and a
payload digest. The ID is generated above the RPC transport and reused if that logical submit is
replayed after a socket/client retry. A launch carrying replay similarly carries a stable
`replayAttemptId`. A new deliberate user send gets a new ID.

The runner accepts two positive observations, both scoped to this attempt:

1. **ECHO (this paste reached the composer):** before every paste or re-paste, clear the composer
   and positively verify the provider's calibrated empty-composer state. Capture that empty pane as
   the attempt baseline. After paste, inspect only the composer change from that baseline — never
   search old pane scrollback. Text-rendering engines must show the normalized full payload; engines
   that render a paste placeholder must show a new calibrated placeholder transition after this
   baseline. Historical pane content cannot satisfy ECHO.
2. **ACK (the engine created this user turn):** capture an `AckCursor` before paste:
   `{launchEpoch, transcriptPath|null, completeJsonlOffset}`. After Enter, accept only a provider user
   record whose record start is at or after that cursor and whose extracted text exactly equals the
   sanitized payload. A record before the cursor, a substring/short marker match, or a record from a
   transcript that fails the launch-epoch guard is ignored.

The transport nonce and evidence cursor have separate jobs: `attemptId` makes duplicate RPC delivery
idempotent; the pane baseline and transcript offset prove the observed ECHO/ACK were produced by this
paste attempt without injecting a nonce into the user's model-visible prompt.

**Per-engine correlation:**

| Interactive engine | ECHO correlation | ACK cursor and launch-epoch validation |
| --- | --- | --- |
| Claude (`anthropic`) | New full-text/placeholder composer delta after verified-empty baseline | Keep the `--session-id`-pinned path (`cli-chat-engine.ts:153-193`), additionally reject a file/first record older than `launchEpoch`; match an exact `type:"user"` record beginning at/after the captured offset. |
| Codex (`openai-compatible`) | New full-text/placeholder composer delta after verified-empty baseline | Keep cwd matching plus the existing session timestamp guard (`cli-chat-engine.ts:397-425`); do not cache a candidate until it passes both. Match an exact rollout `user_message` record at/after the captured offset. |
| Gemini/AGY interactive (`google`) | New full-text/placeholder composer delta after verified-empty baseline | The directory is stable by neutral-dir basename (`packages/ai/src/adapters/tmux-bridge.ts:113-116`), so reject every candidate whose file/first-record timestamp predates `launchEpoch`; do not cache the prior session while the new file is absent. Match an exact `type:"user"` record at/after the captured offset. |

If the valid launch transcript does not exist when the cursor is captured, the cursor is
`{path:null, offset:0}`. Post-Enter resolution may select only a launch-epoch-valid new file; it may
not fall back to the newest pre-launch file. Partial final JSONL lines are excluded from the cursor
and matcher until complete.

The provider user-record extractors live beside the current parsers in
`packages/ai/src/adapters/transcript-reader.ts:84-128`; the current reply parser ignores user records,
so ACK is a separate exact-record helper, not a reinterpretation of `complete`.

**Meaning of ACKED:** for an interactive engine, `ACKED` means the provider wrote a new user-turn
record for this exact payload after this attempt's cursor — therefore the engine accepted and acted
on this turn. It does **not** mean the model finished or tools completed. Normal turns return submit
success at ACKED and the manager continues its existing reply poll. Replay launch has the stronger
completion rule in Decision 4.

Rejected alternatives:

- Scanning the whole pane/transcript for a payload marker: repeated history can false-match.
- Embedding the nonce in the prompt: it pollutes model-visible input and is unnecessary once the
  pane baseline and transcript cursor are attempt-scoped.
- Treating generic TUI chrome or elapsed time as readiness: version-fragile and not evidence that our
  payload was accepted.

## Decision 2 — Exactly-once submit state machine

`CliChatEngineImpl.submit` (`packages/chat/src/live/cli-chat-engine.ts:263-270`) becomes
`verifiedSubmit({attemptId,text,signal})` for interactive engines. The multiplexer seam
(`packages/ai/src/adapters/multiplexer.ts:28-41`) gains the minimum primitives needed by that method:
`clearComposer`, `capturePane`, `paste`, and `pressEnter`. Tmux splits its current combined sequence
(`tmux-multiplexer.ts:65-72`); Herdr splits `send-text` and Enter
(`packages/ai/src/adapters/herdr-multiplexer.ts:91-94`).

Per interactive attempt:

```
QUEUED
  -> CLEARING -> EMPTY_VERIFIED -> PASTED -> ECHOED -> ENTERED -> ACKED
                         ^           |
                         |           +-- no correlated ECHO -> CLEARING -> one re-paste max
                         |
                         +-- clear/empty cannot be proved -> FAIL_CLEANUP

Any state -- cancel/deadline --> CANCELING --> terminal failure
```

Rules:

- **Clear before every paste.** Initial paste and the single allowed re-paste both require a positive
  empty-composer observation first. No "absence of echo" is treated as proof that the composer is
  empty.
- **Enter once.** The state transition to `ENTERED` is recorded before `pressEnter`; no code path may
  call `pressEnter` again for the same `attemptId`.
- **Idempotent duplicate RPCs.** The runner keeps attempt records for the engine lifetime. A duplicate
  `{sessionKey,attemptId}` with the same payload digest joins the in-flight promise or returns the
  cached terminal result. The same ID with different text is `bad_request`. Duplicate delivery never
  pastes or presses Enter again.
- **No post-Enter retry.** Missing ACK after Enter is not safe evidence that the engine did nothing.
  The attempt becomes `delivery_unknown`; the same ID can never execute again and automatic retry is
  forbidden.
- **No stale composer inheritance.** Every new logical attempt starts with verified clear. A failed
  attempt never leaves unclassified text for the next attempt.

Failure-state contract:

| Failure point | Composer / engine state before response | Result |
| --- | --- | --- |
| Before paste | No composer mutation; engine remains registered | `unavailable` (retryable with a **new** logical attempt) |
| After paste, before Enter | Clear and positively verify empty; if that cannot be proved, kill the engine and remove it from the host map | `unavailable`; same `attemptId` remains terminal and cannot re-paste |
| After Enter, before ACK | Kill the engine, remove it from the host map, and invalidate the manager session so the next deliberate turn must relaunch | `delivery_unknown` (non-retryable; UI must not auto-resend) |
| ACKED | Engine remains live; next submit still begins with verified clear | `{ok:true}` cached for this `attemptId` |
| Launch replay failure in any phase | Existing POST-mux-create teardown kills the mux before removing the neutral dir (`cli-chat-engine.ts:255-259,676-692`) | launch `unavailable`; no session is registered |

This is the precise guarantee available at the CLI boundary: **at most one Enter per attempt ID,
duplicate-RPC idempotency, and success only after a current-attempt transcript ACK.** Provider-side
external effects cannot be rolled back after Enter; that is why `delivery_unknown` is loud and
non-retryable rather than falsely claiming exactly-once external side effects.

## Decision 3 — Runner deadline and out-of-queue cancellation

The existing client deadline only abandons its local pending call
(`packages/chat/src/live/chat-engine-rpc-client.ts:390-420`); it does not stop the runner operation.
The runner therefore owns a total verified-submit deadline:

- `VERIFIED_SUBMIT_DEADLINE_MS = 35_000` default for clear + at most two ECHO attempts + ACK.
- Each ECHO attempt gets at most 10 000 ms; expiry is only a retry/failure boundary, never readiness.
- The existing client turn deadline stays 45 000 ms (`chat-engine-rpc-client.ts:85-94`), leaving
  cleanup/cancel headroom after the runner deadline.
- Poll cadence remains observation-only (250 ms is already used by replay drain at
  `cli-chat-engine.ts:146-147`); no poll interval creates a success transition.

`rpc-contract.ts` receives additive wire changes despite the prior rev's "no new verb" claim:

- `RpcSubmitParams` becomes `{attemptId,text}`.
- `RpcLaunchParams` gains `replayAttemptId`, required exactly when `replayBatch` is present, so a
  duplicated launch request cannot submit the replay twice.
- Add `cancelSubmit` with `{attemptId}` and an idempotent `{ok:true}` result.
- Add `delivery_unknown` to `RpcErrorCode`, mapped to a non-retryable HTTP error; `unavailable`
  remains retryable only when Enter was never sent.

`CliChatEngineHost` currently serializes submit/read/kill behind one per-key promise chain
(`packages/cli-runner/src/engine-host.ts:112-124,277-331`). `cancelSubmit` **must bypass that queue**:

1. Register every queued/active attempt and its `AbortController` by `{sessionKey,attemptId}`.
2. A cancel frame marks even a not-yet-started attempt canceled and aborts an active one immediately.
3. The submit loop checks the signal before/after every awaited mux or transcript operation and
   immediately before Enter.
4. Cancellation performs the Decision-2 cleanup, settles the submit promise, and therefore releases
   the per-key queue. A later kill/submit/read is never permanently trapped behind the poll.
5. The client sends best-effort `cancelSubmit` with the same ID if it abandons a submit because of
   connection/client timeout. The runner deadline remains authoritative if that cancel frame is lost.

Connection dispatch is already concurrent (`void dispatchFrame` at
`packages/cli-runner/src/connection.ts:130-160`), so the cancel verb can reach the host while the
original submit request is awaiting ECHO/ACK. It must not call `enqueue` internally.

## Decision 4 — Launch semantics and the input-ready event

The wire event depends on whether launch carries replay:

- **Replay present:** launch success means the replay attempt reached `ACKED` **and** the provider
  emitted end-of-turn. `replayAndDrain` may no longer return success when its drain budget expires
  (`cli-chat-engine.ts:646-662`); expiry is a loud launch failure followed by POST-mux-create
  teardown. Only then may `launchSession` continue past `await engine.launch(...)`
  (`chat-session-manager.ts:346-375`) and submit the first real user turn
  (`chat-session-manager.ts:446-469`). The manager/RPC client generates one `replayAttemptId` for
  that logical launch and reuses it on transport retry. This closes both duplicate replay and the
  busy-replay race.
- **No replay:** launch success means only "process launched"; it is **not** an input-ready event.
  The first real `verifiedSubmit` supplies the ECHO+ACK readiness proof. The old rev's claim that an
  empty launch `RpcOk` itself proved readiness is withdrawn.

Because verified submit can consume 35 s and replay completion can consume the existing 25 s drain
budget, the runner launch deadline (`packages/cli-runner/src/engine-host.ts:93,226-264`) must be raised
from 40 s to at least 70 s. The client launch deadline remains 120 s
(`chat-engine-rpc-client.ts:96-102`). These are failure bounds, not settle sleeps.

The manager ordering is otherwise unchanged: `launching` serializes launches
(`chat-session-manager.ts:230-231,284-293`), `turnsInFlight` serializes turns (`:233-244,402-424`),
and the first typed message cannot reach submit until the replaying launch has completed.

## Decision 5 — Engine coverage

| Engine | Readiness / submit semantics | Completion semantics |
| --- | --- | --- |
| Claude interactive (`anthropic`) | attempt-correlated ECHO + exact post-cursor ACK | Claude `end_turn` remains reply/replay completion (`transcript-reader.ts:19-21,146-158`) |
| Codex interactive (`openai-compatible`) | attempt-correlated ECHO + exact post-cursor `user_message` ACK | `task_complete` remains completion (`transcript-reader.ts:45-47,213-218`) |
| Gemini/AGY interactive (`google`) | attempt-correlated ECHO + exact post-cursor `type:"user"` ACK on an epoch-valid file | non-empty `type:"gemini"` remains completion (`transcript-reader.ts:49-61,240-257`) |
| Codex exec (`non_interactive`) | exempt: no persistent composer/pty; process spawn is the submit | run-to-completion exit code (`packages/chat/src/live/codex-exec-session.ts:41-77`) |
| Claude print / AGY print | exempt: one process per turn (`packages/chat/src/live/runtime.ts:94-105`) | run-to-completion exit code |

Interactive `CliChatEngineImpl` paths use verified submit for replay, normal turns, and manager-owned
in-process replay. Non-interactive engines retain their existing run-to-completion contract.

## Decision 6 — Relationship to #984 and #868

### #984 guarantee

PR #1015 needs the first post-resume turn to be delivered after bounded replay. With this protocol:

- replay launch success means replay was ACKED by this launch's engine and completed;
- first-turn submit success means this exact typed payload produced a new post-cursor user record;
- therefore **ACKED means the engine acted on this attempt**, not merely that tmux/herdr accepted
  bytes or that an older identical prompt exists in history.

### `pendingForcedReplay` divergence

PR #1015 head `57c484acf40149c859bcf6d7c233763bd5b5aab4` consumes the latch before awaiting launch
(`packages/chat/src/live/chat-session-manager.ts:278` on that PR) and sets it after resume (`:692`).
Fable's counter-analysis is correct: a failed forced launch followed by an unforced launch is **not a
privacy leak**. Private turns are never persisted or eligible for replay, while this latch only
changes the bounded replay count for a stored ordinary history thread. The failure can lose resume
context when normal `JARVIS_CHAT_REPLAY_K=0`, which is a continuation/UX defect, not an escape of
un-purged private content.

Resolution: **non-blocking #984 hardening, not a #1020 security blocker.** PR #1015 should restore the
latch on launch failure or consume it only after successful launch so its own continuation acceptance
remains durable, but verified-submit correctness and the #984 privacy guarantee do not depend on that
change.

### #868 scope split — unchanged

This child remains **input-readiness and delivery only**. #868 owns engine-less transcript purge
(Gemini/AGY, non-interactive engines, and per-session Codex matching) at the purge verb
(`packages/cli-runner/src/engine-host.ts:334-350`). **Both #1020 and #868 must land before PR #1015
unholds.** This rev does not move, duplicate, or weaken that boundary.

## Decision 7 — Tests and review bar

- **Unit, evidence correlation:** repeated `"yes"` in pane scrollback and pre-cursor transcript
  cannot satisfy ECHO/ACK; exact current payload after the cursor can. Partial lines and substring
  markers cannot ACK.
- **Unit, epoch safety:** Claude pinned-path, Codex cwd+epoch, and Gemini/AGY stable-dir candidates
  reject prior-launch files and do not cache them while the new file is absent.
- **Unit, composer state:** clear is positively verified before initial paste and re-paste; re-paste
  occurs at most once; failed clear kills the session; no branch leaves unknown composer content.
- **Unit, idempotency:** concurrent and late duplicate RPCs with one `attemptId` produce one paste
  sequence and one Enter; same ID/different payload is `bad_request`; cached ACK returns `{ok:true}`.
- **Unit, cancellation/deadline:** pre-Enter timeout clears or kills and returns `unavailable`;
  post-Enter timeout kills and returns `delivery_unknown`; `cancelSubmit` bypasses the queue; a queued
  kill runs after cancellation; a late ACK cannot turn the terminal failure into success.
- **Unit, launch:** replay ACK without completion is insufficient; replay drain expiry fails launch
  and tears down; no-replay launch is explicitly not marked input-ready.
- **Unit, manager:** first post-resume submit remains ordered after successful replay launch; a
  post-Enter `delivery_unknown` invalidates the manager session so a future deliberate turn relaunches.
- **Integration:** duplicate submit frames and client-timeout cancel over the real RPC framing prove
  one Enter, queue release, and no late orphan response changing terminal state.
- **Dev-UAT (HARD merge gate):** fresh isolated stack, no harness waits; Playwright reaches chat by
  clicking navigation, resumes a stored conversation, types the first message into the real composer,
  and repeats three times per interactive engine. Each run asserts the replay completes before the
  typed turn, the exact typed payload appears in the launch-epoch transcript exactly once, and the
  UI receives success only after that record exists. Add a forced stalled-ACK case proving the request
  terminates, the runner queue releases, and no automatic duplicate turn appears.

Security tier: approved spec → serialized security build lane → Opus or Fable sign-off plus dev-UAT
evidence → security QA → primary coordinator merge with Ben sign-off. CI green alone is insufficient.

## Build-task 0 (empirical calibration, before coding matchers)

Capture each interactive engine at current supported versions and pin:

- the safe composer-clear key sequence and positive empty-composer signature;
- small and large paste rendering (full text versus placeholder) and the attempt-baseline delta;
- the exact user-record shape/text normalization and first-record/session timestamp used by the epoch
  guard;
- whether interactive AGY writes the documented Gemini `type:"user"` record.

If any engine cannot provide a positive empty-composer state plus an exact post-cursor user record,
that engine does not get a heuristic fallback: verified interactive submit is unsupported until a
real signal exists.

## Non-goals

- No manager-side settle delay and no `JARVIS_CHAT_REPLAY_SETTLE_MS`.
- No engine-chrome "looks ready" success without current-attempt ECHO and ACK.
- No claim of exactly-once provider side effects after an unacknowledged Enter.
- No change to #868 purge ownership, the idle reaper, reconciliation, or the single-active-user gate.
- No durable cross-restart attempt ledger; a runner restart kills/reconciles the live engine, so an
  in-memory ledger scoped to that engine lifetime covers duplicate delivery on the live connection.

## Rework log (rev 2)

- **Attempt correlation:** stable `attemptId` + verified-empty pane baseline + exact user record at or
  after an `AckCursor`; old pane/transcript history can no longer certify a dropped paste.
- **Runner deadline:** 35 s server-owned deadline plus out-of-queue `cancelSubmit`; expiry cleans up,
  releases the per-key queue, and never becomes success.
- **Composer / RPC retry:** verified clear before every paste, one Enter per nonce, engine-lifetime
  idempotency ledger, and explicit pre-/post-Enter terminal states.
- **Stale transcripts:** launch-epoch validation now applies to Claude, Codex, and Gemini/AGY before a
  path is cached or an ACK is accepted.
- **Replay completion:** launch with replay requires current-attempt ACK **and** end-of-turn; drain
  expiry is failure, not readiness.
- **#6 divergence:** no privacy leak; early `pendingForcedReplay` consumption is non-blocking #984
  continuation hardening.
- **Ground line:** rewritten against HEAD `83f76741ea803e4ce72804ceb12bb3c0301c2328`.
