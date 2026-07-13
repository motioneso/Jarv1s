# Spec: Deterministic cli-runner input-ready event for the first resume turn (#1020)

- **Issue:** bug #1020 (child of the #868 seam comment; blocks #984 / PR #1015)
- **Tier:** security (chat engine lifecycle / private-history correctness)
- **Status:** draft for Ben approval
- **Grounded on:** worktree `coord/settings-host-cleanup` @ `0b5e58ef` (main-tracking coordination
  worktree; all cited files verified at these lines)

## Problem

The first real chat send after a thread resume can be silently dropped. Resume
(`resumeThread`, `packages/chat/src/live/chat-session-manager.ts:673-695`) kills the live engine;
the next turn relaunches it (`ensureSession` → `launchSession` → `engine.launch`,
`chat-session-manager.ts:352`). On the RPC path the cli-runner submits the replay batch and the
manager then submits the user's first typed message — but nothing anywhere proves the resumed CLI
TUI is **input-ready** before bytes are pasted into its pty. Today's only guards are elapsed-time
guesses:

- `packages/chat/src/live/cli-chat-engine.ts:243` — `await this.io.sleep(this.launchMs)` (3 000 ms
  default, `:141`), the blind boot wait before the first paste.
- `packages/ai/src/adapters/tmux-multiplexer.ts:71` — `await this.io.sleep(this.submitMs)` (600 ms
  as configured at `cli-chat-engine.ts:142`; 2 000 ms default at `tmux-multiplexer.ts:27`), the
  blind paste-settle before Enter.

A slow-booting TUI (Codex especially — crossterm-style TUIs flush queued pty input on entering raw
mode) eats the paste; the drop is silent because `RpcSubmitResult {ok:true}`
(`packages/chat/src/live/rpc-contract.ts:270-272`) only means "the tmux verbs exited 0", and a
dropped replay merely times out the drain budget (`replayAndDrain`, `cli-chat-engine.ts:638-663`)
and returns an offset as if nothing happened.

A manager-side blind settle (`JARVIS_CHAT_REPLAY_SETTLE_MS`) was tried during #984 UAT and
**rejected** (failed fresh isolated live-path UAT; Opus ruling recorded on issue #868,
comment 2026-07-13). It is not in the tree (verified by repo-wide grep) and is **banned** by this
spec. Timers are not a fix.

## Decision 1 — The readiness signal: pane-echo + transcript-ack ("verified submit")

The readiness proof is **observation of the engine's own state**, at two levels, both already
observable through existing seams:

1. **ECHO (input accepted by the TUI):** after `paste-buffer`, poll
   `tmux capture-pane -p -J -t =<name>` until the pane visibly contains evidence of the pasted
   payload (normalized head of the sanitized text, or the engine's paste-placeholder rendering).
   Only then send Enter. Precedent: the login service already does pane observation with exactly
   this verb (`packages/cli-runner/src/login-service.ts:386,403`); the exact-name `=` guard
   matches `killMuxSessionByName` (`cli-chat-engine.ts:717`).
2. **ACK (turn accepted by the engine):** after Enter, poll the provider's raw transcript jsonl
   (the engine already reads it — `readNew`, `cli-chat-engine.ts:289`) until a **user-record**
   containing the payload marker appears. All three interactive providers write user records:
   Claude `type:"user"` and Gemini `type:"user"`
   (`packages/ai/src/adapters/transcript-reader.ts:10,52`), Codex rollout `user_message` events.
   A small per-provider `transcriptHasUserRecord(jsonl, marker)` matcher is added next to the
   existing parsers in `transcript-reader.ts`.

**Where produced:** inside `CliChatEngineImpl` in the cli-runner process — a `verifiedSubmit()`
that replaces the raw `mux.submit()` call at `cli-chat-engine.ts:270` and the replay submit at
`cli-chat-engine.ts:644`. The `Multiplexer` seam (`packages/ai/src/adapters/multiplexer.ts`) gains
three primitives: `paste(handle, text)`, `pressEnter(handle)`, `capturePane(handle)` (tmux and
herdr backends both; herdr via `herdr pane read`). `submit()` remains for non-chat callers.

**Where consumed (the manager seam):** no new wire message is needed. The **launch `RpcOk`**
(dispatch `packages/cli-runner/src/connection.ts:189-191` → `engine-host.ts:128` → result at
`engine-host.ts:233`) becomes the input-ready event on the wire: it is now emitted only after the
engine has (a) echo-verified and (b) transcript-ACK'd the replay submit (when a `replayBatch` is
present) and drained it. The manager already consumes it at exactly the right place:
`launchSession` awaits `engine.launch(...)` at `chat-session-manager.ts:352`, and the first real
send (`session.engine.submit(engineText)`, `chat-session-manager.ts:469`) is strictly ordered
after it via `runTurn` → `ensureSession` (`chat-session-manager.ts:446, 276-294`). The first real
send itself ALSO goes through `verifiedSubmit`, so even a launch with no replay batch (empty
resumed thread) is gated by the same signal. The frozen RPC contract
(`rpc-contract.ts:1-16`) needs **no shape change** — only a documented semantics strengthening of
`launch` and `submit` (`{ok:true}` now means ACKED for interactive engines). This is
additive-compatible.

Rejected alternative: probing engine TUI chrome (composer prompt regexes) for a pre-paste
"ready" marker — fragile across CLI versions and needs a per-engine regex zoo. Echo/ack matches
**our own payload**, not engine chrome, so the only per-engine surface is the paste-placeholder
pattern and the user-record shape.

## Decision 2 — Exactly-once first-turn delivery: state machine

Per interactive submit (runner-side):

```
PASTED --echo observed--> ECHO_OK --Enter (exactly once)--> SUBMITTED --user-record--> ACKED
   |                                                             |
   +-- re-paste (max 1) ONLY IF pane shows NO payload            +-- no ack by deadline
       evidence AND transcript has NO user record                    => loud failure
       (double-negative witness)                                     (never silent success)
```

- **No drop:** Enter is never sent before ECHO_OK; a paste eaten by a booting TUI produces no
  echo, so the (single) re-paste fires and the submit still lands. A missing ACK fails the RPC
  loudly (`unavailable` → retryable 503 via the existing mapping, `rpc-contract.ts:162`), instead
  of today's silent drop.
- **No double-send:** Enter fires at most once per verified paste; **after Enter there is no
  retry path of any kind**. The re-paste edge requires the double-negative witness; when evidence
  is ambiguous (echo unseen but a user record exists), the runner does NOT guess — it fails the
  call. Replay-side, launch failure takes the existing POST-mux-create teardown
  (`cli-chat-engine.ts:255-260`, `engine-host.ts:234-259`), so a retried launch starts from a
  clean session, not a half-fed TUI.
- **Manager-side ordering (unchanged, now sufficient):** `launching` map
  (`chat-session-manager.ts:231, 284-293`) serializes launches per user; `turnsInFlight`
  (`chat-session-manager.ts:237, 416-424`) serializes turns; the first post-resume turn cannot be
  submitted until the launch `RpcOk` (= readiness event) resolves. PR #1015's
  `pendingForcedReplay` one-shot consume (its Slice 2) remains the exactly-once guard for _which_
  launch replays; this spec is the exactly-once guard for _delivery_. No manager timer, no new
  manager state.

## Decision 3 — No timers in the path

- **REMOVED:** `io.sleep(launchMs)` boot wait (`cli-chat-engine.ts:243`, default `:141`) — the
  ECHO phase inherently waits for the real TUI-accepted-input signal.
- **REMOVED:** `io.sleep(submitMs)` paste-settle (`tmux-multiplexer.ts:71`; configured at
  `cli-chat-engine.ts:142`) — replaced by echo-verified Enter.
- **BANNED:** `JARVIS_CHAT_REPLAY_SETTLE_MS` or any manager/runner elapsed-time settle.
- **KEPT (poll cadence, not proofs):** `drainPollMs` 250 ms (`cli-chat-engine.ts:147`), manager
  `pollMs` 25 ms (`chat-session-manager.ts:265`) — the interval at which a real signal is
  re-checked.
- **KEPT (failure bounds, not proofs):** launch timeout 40 s (`engine-host.ts:93`), RPC per-call
  turn deadline 45 s (`chat-engine-rpc-client.ts:94`), drain budget 25 s
  (`cli-chat-engine.ts:146`). Invariant: **a timeout may only produce a loud failure, never an
  "assume ready" or "assume delivered" transition.** A drain-budget expiry AFTER ACK remains
  tolerated (slow model ≠ dropped input, `cli-chat-engine.ts:661-662`).

## Decision 4 — Engine coverage

| Engine                                             | Readiness                                                                          | Ack                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Claude interactive (`anthropic`)                   | verifiedSubmit ECHO                                                                | `type:"user"` record, session-id-pinned path (`cli-chat-engine.ts:192-193`)          |
| Codex interactive (`openai-compatible`)            | verifiedSubmit ECHO                                                                | rollout `user_message` record, cwd+epoch-matched path (`cli-chat-engine.ts:408-429`) |
| Gemini interactive (`google`, agy TUI)             | verifiedSubmit ECHO                                                                | `type:"user"` record (`transcript-reader.ts:52`)                                     |
| codex-exec (`non_interactive`)                     | ready-by-construction after `initialize()` (`codex-exec-session.ts:41-43`; no pty) | spawn exit code IS the ack (`codex-exec-session.ts:45-77`, throws on rc≠0)           |
| agy-print (`AgyPrintChatEngine`, `runtime.ts:101`) | ready-by-construction (spawn per turn)                                             | run-to-completion exit code                                                          |

Uniform abstraction: interactive engines route every submit through `verifiedSubmit`;
non-interactive engines keep run-to-completion semantics and are exempt (their submit cannot race
a boot — there is nothing to be "ready"). This is the same interactive/non-interactive split
`isCodexExecMode` already draws (`cli-chat-engine.ts:438-440`).

## Decision 5 — Relationship to #868

This child is **input-readiness only**. #868 original (engine-less transcript purge missing
Gemini + non-interactive engines, per-session Codex matching) is a separate filesystem-privacy
gap with its own required spec/build. **Both** must land before PR #1015 (#984) unholds — the
#984 acceptance depends on both (issue #1020 body; #868 durable comment 2026-07-13). Do not fold
them: they share the engine-abstraction boundary but touch disjoint verbs (launch/submit here;
purge there, `engine-host.ts:341-351`).

## Decision 6 — Tests

- **Unit, runner seam** (fake `TmuxIo` scripting capture-pane frames — same pattern as existing
  engine tests): (a) Enter never sent before echo appears; (b) late echo → still exactly one
  Enter; (c) eaten paste (no echo + no user record) → exactly one re-paste, then Enter;
  (d) ambiguous state (no echo but user record present) → NO re-paste, loud failure; (e) no ACK
  by deadline → `unavailable`, never `{ok:true}`; (f) non-interactive engines bypass
  verifiedSubmit; (g) launch with replayBatch resolves only after replay ACK+drain.
- **Unit, manager seam:** first post-resume `engine.submit` is not issued until `engine.launch`
  resolves (regression-pin the ordering at `chat-session-manager.ts:352→469`); extends PR #1015's
  `tests/unit/chat-session-manager-resume.test.ts` exactly-once forced-replay cases.
- **Integration:** RPC round-trip against a scripted host asserting launch RpcOk carries
  post-ACK semantics and a dropped-paste script surfaces a 503, not success.
- **Dev-UAT (HARD merge gate** — #868 comment exit criteria + Ben's e2e rule): fresh isolated
  stack, **no harness waits**; Playwright drives the REAL UI — reach chat by clicking nav (no
  `page.goto` shortcut), resume a private chat from History, **type** the first message into the
  real composer (never inject/replay via API), **3 repetitions**, each asserting (a) 200/ACK and
  (b) the exact prompt present in the engine transcript **exactly once** (no drop, no duplicate).

## Decision 7 — Tier and review bar

Security tier. Approved spec → serialized security build lane (UX Coordinator spawns) → **Opus or
Fable sign-off AND the Decision-6 dev-UAT evidence before merge** → security QA → **Primary
coordinator merges with Ben sign-off**. CI-green alone is insufficient (verification-discipline
rule).

## Build-task 0 (empirical calibration, before coding the matchers)

Capture, in the dev stack, how each interactive CLI renders a large paste (verbatim head vs a
paste-placeholder like Codex's `[Pasted Content]`-style marker) and pin the three
payload-evidence matchers from those captures. This is calibration of constants, not a design
fork — the verified-submit design does not change with the outcome.

## Non-goals

- No new RPC verbs or wire-shape changes (frozen contract, `rpc-contract.ts:2-7`).
- No change to #868's purge scope, the idle reaper, reconciliation, or the single-active-user
  gate.
- No engine-chrome "ready prompt" detection.
