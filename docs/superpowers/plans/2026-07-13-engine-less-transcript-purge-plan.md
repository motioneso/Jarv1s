# Serialized #868 + #1020 security dependency plan

**Goal:** Land deterministic interactive-submit readiness from approved #1020 rev 2, then close
#868's graceful/crash transcript-purge gaps without deleting another session's files.

**Authority:** Ben approved #1020 rev 2 commit `39dafc29` at issue comment `4961635704`.
`UX Coordinator` session `019f5adf-594d-7623-8259-69e1657f4e6b` authorized planning after main CI
run `29275470092` completed 4/4 green at `b205f1c7`. Primary Coordinator session
`58a78927-385c-4b1d-8fa0-94db20255d6f` authorized build + QA only and retains merge authority.

**Grounding:** Branch `security/868-engine-purge` rebased cleanly on current
`origin/main@cdf66df0` (the requested green base plus unrelated #1023). Approved #1020 spec is not
yet on main; restore its exact approved blob from `39dafc29` as first post-approval task.

## Non-negotiable design

- No feature edit until UX Coordinator approves this plan.
- No elapsed-time readiness. Existing/new deadlines are failure bounds only; ECHO + post-cursor ACK
  are the only submit-success transition. No `JARVIS_CHAT_REPLAY_SETTLE_MS` or equivalent.
- #1020: stable `attemptId`, payload digest, verified-empty composer baseline, one re-paste before
  Enter, at most one Enter, exact post-cursor user-record ACK, engine-lifetime idempotency ledger,
  35 s runner deadline, out-of-queue cancellation, loud non-retryable `delivery_unknown`, and replay
  ACK + completion before launch succeeds.
- #868: never select or delete by mtime, launch window, newest file, or a home-wide approximate
  glob. Purge only a launch-chosen ID or an exact transcript identity persisted under that
  session's neutral directory with mode `0600` and atomic rename.
- Codex: run the calibrated `/status` command after observed empty-composer readiness, parse its
  exact UUID, and atomically persist that UUID before the private turn's Enter. Derive the one
  rollout path from the UUIDv7 timestamp, then require basename plus `session_meta.payload.id` and
  cwd equality. Cwd/timestamp alone never authorizes deletion.
- Interactive Gemini routing is an AGY engine: production launches `agy --sandbox --log-file` and
  writes `brain/<conversation UUID>/.system_generated/logs/transcript_full.jsonl`. Capture the UUID
  only from this session's exact log and reuse `purgeAgyBrainDir(capturedUuid)` with AGY print.
  Missing/ambiguous capture retains data; never enumerate or glob the shared `brain/` root.
- `transcriptGlobDir("google", ...)` and the Gemini CLI reader path are dead in production. Do not
  target them for purge. The interactive engine's wrong reader path/schema is a separate finding,
  explicitly out of #868 scope.
- AGY print resolves and continues only the exact conversation UUID captured from its own log. It
  must not use `find -newermt`, newest-file, or launch-window matching. Graceful and engine-less
  purge consume the same marker and shared primitive as interactive AGY.
- Neutral-dir identity markers must remain available when engine-less purge follows kill. Do not
  change manager ordering or marker lifetime without the coordinator's explicit lifecycle ruling.
- Preserve SQL bookkeeping, migrations, ordinary-history behavior, idle reaper, and startup sweep.
- Lock PR #1015/#984 manager/UI/history files until Task 6. At Task 6, touch only the approved
  manager await/invalidation seam if existing `await engine.launch()` ordering is insufficient.
- Never edit `docs/coordination/`, merge, close issues, move board state, touch shared DB, stage
  broadly, or expose secrets. Stage explicit task paths only.

## Task 1 — Anchor approved spec + empirical calibration (hard gate)

**Files:**

- Create unchanged approved blob:
  `docs/superpowers/specs/2026-07-13-cli-runner-input-ready-event.md`
- Create focused calibration tests/fixtures beside existing adapter/engine tests only if needed.

**Steps:**

1. Restore the exact file from commit `39dafc29`; verify byte equality with `git show`.
2. Against supported Claude, Codex 0.144.1, Gemini 0.49.0, and AGY 1.1.1, pin:
   verified-empty composer signature, full-text/placeholder ECHO delta, exact user-record shape,
   partial-line boundary, launch-epoch field, and supported clear operation.
3. Prove production interactive Gemini is AGY (`agy --sandbox`) and calibrate its exact own-log UUID
   to `brain/<UUID>/.../transcript_full.jsonl`; record the dead Gemini CLI reader as out of scope.
4. Prove Codex `/status` UUID can be persisted before the private Enter and maps deterministically
   to one rollout whose basename, payload ID, and cwd all agree.
5. Prove both AGY engines capture one exact conversation UUID from their own log before purge or
   continuation success. Concurrent council/other-session transcripts must remain distinguishable.
6. If any interactive engine lacks positive empty-composer + exact post-cursor ACK, or Codex/AGY
   lacks exact crash-safe identity, stop and report to UX Coordinator. Do not invent a fallback.

**Green:** focused calibration checks; approved spec byte-equality check. Commit spec/calibration
artifacts with explicit paths.

## Task 2 — Exact transcript evidence primitives

**Files:**

- `packages/ai/src/adapters/transcript-reader.ts`
- `packages/ai/src/adapters/transcript-reader.test.ts`
- `packages/chat/src/live/cli-chat-engine.ts`
- focused existing/new `cli-chat-engine` test file

**TDD:**

1. Red: old identical `"yes"`, substring matches, pre-cursor records, partial JSONL, and prior-launch
   Claude/Codex/Gemini files cannot ACK; exact complete post-cursor record can.
2. Add `AckCursor` and minimal exact user-record extractors beside current parsers. Keep reply/
   completion parsing unchanged.
3. Reject pre-launch files before caching; no newest-file fallback for Gemini/AGY. Persist exact
   transcript identity atomically when provider identity becomes authoritative.
4. Green: adapter + engine tests and package typechecks. Commit exact paths.

## Task 3 — Split multiplexer submit into evidence-capable primitives

**Files:**

- `packages/ai/src/adapters/multiplexer.ts`
- `packages/ai/src/adapters/tmux-multiplexer.ts`
- `packages/ai/src/adapters/herdr-multiplexer.ts`
- their focused tests

**TDD:**

1. Red: old scrollback cannot satisfy ECHO; clear must be positively observed; a re-paste clears
   first; Enter count is one.
2. Replace combined `submit` seam with minimum `clearComposer`, `capturePane`, `paste`, and
   `pressEnter` operations. Reuse current tmux/Herdr verbs; add no abstraction beyond this contract.
3. Delete tmux paste buffer + temporary prompt file after paste on success/failure.
4. Green: both multiplexer implementations pass identical behavior tests. Commit exact paths.

## Task 4 — Verified interactive submit state machine

**Files:**

- `packages/chat/src/live/cli-chat-engine.ts`
- `packages/chat/src/live/types.ts` only if required by approved contract
- focused engine tests

**TDD:**

1. Red each terminal branch: pre-paste unavailable; post-paste clear/kill; post-Enter
   `delivery_unknown` + kill; ACK success; cancel before Enter; late ACK cannot reverse failure.
2. Implement approved states: CLEARING → EMPTY_VERIFIED → PASTED → ECHOED → ENTERED → ACKED,
   one pre-Enter re-paste maximum, signal checks around every awaited operation, and no Enter retry.
3. Replay uses verified submit and requires ACK + provider completion; drain expiry fails launch and
   performs existing post-mux teardown. No-replay launch remains process-start only.
4. Keep codex-exec/Claude-print/AGY-print run-to-completion behavior outside interactive state
   machine.
5. Green: engine tests + `@jarv1s/chat` typecheck. Commit exact paths.

## Task 5 — RPC idempotency, cancellation, and failure bounds

**Files:**

- `packages/chat/src/live/rpc-contract.ts`
- `packages/chat/src/live/chat-engine-rpc-client.ts`
- `packages/cli-runner/src/connection.ts`
- `packages/cli-runner/src/engine-host.ts`
- focused RPC/host tests

**TDD:**

1. Red: duplicate same-ID/same-digest joins/caches one attempt; same-ID/different payload is
   `bad_request`; duplicate frames cause one paste/Enter; cancel bypasses queued submit; queued kill
   releases; client abandonment emits best-effort cancel; late ACK stays terminal.
2. Add `{attemptId,text}`, conditional `replayAttemptId`, `cancelSubmit`, and
   `delivery_unknown` wire contracts. Generate attempt IDs above transport and reuse them only for
   transport retry of the same logical operation.
3. Add engine-lifetime attempt ledger + `AbortController`s. `cancelSubmit` must not call `enqueue`.
4. Bound verified submit at 35 s and runner launch at >=70 s; keep 45 s client turn and 120 s launch
   bounds. Timers only fail/cancel; they never mark readiness or success.
5. Green: real RPC framing integration proves one Enter, cancellation, queue release, and no orphan
   terminal flip. Commit exact paths.

## Task 6 — Serialized manager consumer seam (#984 paths otherwise locked)

**Files:**

- Prefer test-only change in focused `chat-session-manager` tests.
- Modify `packages/chat/src/live/chat-session-manager.ts` only if needed for approved
  `delivery_unknown` invalidation/await semantics.

**TDD:**

1. Prove first post-resume submit cannot run until replay launch returned ACK + completion.
2. Prove `delivery_unknown` invalidates the live manager session and does not auto-resend.
3. Reuse existing awaited `engine.launch()` ordering if it satisfies both assertions. Do not port
   PR #1015's forced-replay latch, UI, history, or consumer work into this branch.
4. Green: focused manager tests. Commit only touched manager test/source paths.

## Task 7 — Exact graceful + crash purge for #868

**Files:**

- `packages/chat/src/live/private-transcript-cleanup.ts`
- new real-filesystem `private-transcript-cleanup.test.ts`
- `packages/chat/src/live/cli-chat-engine.ts`
- `packages/chat/src/live/agy-print-chat-engine.ts`
- focused engine tests
- launch command/wiring files proven necessary by Task 1 only

**TDD real on-disk fixtures:**

1. Red then green: exact shared AGY brain UUID directory deleted; sibling directories and root
   retained. Missing/ambiguous capture deletes nothing.
2. Red then green: exact Codex rollout marker deleted; same cwd sibling retained. Missing/corrupt
   marker deletes nothing and reports only redacted best-effort diagnostics.
3. Red then green: `codex-exec-transcript.jsonl` under exact neutral dir deleted.
4. Red then green: interactive AGY and AGY print graceful/crash purge reuse one exact UUID primitive.
   Concurrent council, prior, and other-user transcripts survive.
5. Crash matrix: before spawn, after identity marker, after process transcript creation, after exact
   path upgrade, and after ACK. Every point either has no private transcript or has enough durable
   identity to delete exactly.
6. Keep `purgePrivateTranscripts(io, neutralBase, sessionKey, homeBase?)` public signature unless
   Task 1 proves an additive exact-identity input is unavoidable. No DB schema or home-wide scan.
7. Green: focused real-fs tests, engine tests, chat + cli-runner typechecks. Commit explicit paths.

## Task 8 — Security verification and handoff

1. Grep bans: `JARVIS_CHAT_REPLAY_SETTLE_MS`, readiness sleeps, mtime/newest/home-wide deletion,
   raw prompt/secret logging.
2. Run focused suites, then `pnpm format:check && pnpm lint && pnpm typecheck`.
3. Fetch/rebase current `origin/main`; stop on non-trivial conflict.
4. Run `pnpm verify:foundation` and record exit code.
5. Hard dev-UAT gate: fresh isolated stack, no harness waits, three resume→first-send repetitions per
   interactive engine. Assert 200/ACK only after exact payload exists once in launch-valid transcript,
   replay completed first, and stalled ACK terminates/releases queue without duplicate.
6. Invoke `coordinated-wrap-up`: explicit staging, push, PR, report SHA/evidence to UX Coordinator.
   No merge, issue close, board update, or #984 unhold.

## Plan self-check

- #1020 decisions 1–7 and Build-task 0 are serialized before manager consumption.
- #868 covers two production AGY engines, Codex interactive, and codex-exec graceful/crash paths
  with real files; dead Gemini CLI transcript code is not a purge target.
- AGY and Codex deletion authority is exact durable identity—not time, cwd alone, or shared-root
  proximity. Failure to prove identity blocks build instead of weakening privacy.
- Existing code wins where sufficient: awaited launch ordering, queue, parsers, `TmuxIo`, and
  `purgePrivateTranscripts` remain canonical seams.
