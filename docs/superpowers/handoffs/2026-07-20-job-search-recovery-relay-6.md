# #1226 Job Search Recovery Relay 6 — implementation plan, ready to build

Predecessor: R6, pane `w1:p08` (tab `w1:t3B`), label "Build 1226 Recovery R6". Relaying at
context-meter 70% checkpoint — planning done, **zero code written yet**, nothing lost.

## Read first
`docs/superpowers/handoffs/2026-07-20-job-search-recovery-relay-2.md` — read only the **Relay 5
update** section (bottom of file). That is the approved root cause + scope. Do not full-read the
whole doc (17KB, caused a prior relay's context to bloat on boot).

## Mandate (Coordinator-approved, relayed via Ben)
Implement a bounded per-call timeout around each individual `await this.mux.X(handle)` RPC in
`packages/chat/src/live/cli-chat-engine.ts`. Scope is **that file + its test only**
(`tests/unit/cli-chat-engine-verified-submit.test.ts`) — do not touch
`packages/ai/src/adapters/herdr-multiplexer.ts` or `live-routes.ts` (relay-5 confirmed the fix
doesn't need them). Report PASS to Coordinator (label `Coordinator`, re-resolve pane fresh via
`herdr pane list` — was `w1:pYN` at relay-6 time, cwd `.claude/worktrees/coord-1179-pdf`) when
green, then `coordinated-wrap-up`.

## Root cause (confirmed, agentmemory `jarv1s` search "1226 relay-5")
None of `pressEnter`, `capturePane`, `paste`, `clearComposer`, `clearComposerHard`, `kill` have an
individual timeout. `observePane`'s `echoMs` and `waitForUserAckWithEnterNudge`'s `nudgeAfterMs`
only bound the wait **between** polling iterations, never the single RPC call inside them. A
stalled herdr call hangs `verifiedSubmit` forever, upstream of every bound in the file.

## Exact implementation plan (verified against current file — read it, don't re-derive)

1. **Add opt** to `packages/chat/src/live/cli-chat-engine-opts.ts` `CliChatEngineOpts`:
   `readonly muxCallMs?: number;` with a doc comment citing #1226 relay-5.
2. **In `CliChatEngineImpl`** (`cli-chat-engine.ts`): add `private readonly muxCallMs: number;`
   field, set in constructor: `this.muxCallMs = opts.muxCallMs ?? 10_000;` (10s: safely under the
   7s `nudgeAfterMs` default's neighbor scale but bounds the RPC itself; a plain `Error` on
   timeout, NOT `VerifiedSubmitError` — the existing `entered`/`pasted` classification logic in
   `verifiedSubmit`'s catch block already turns any thrown error into the correct
   `unavailable`/`delivery_unknown` code, so the helper must stay error-type-agnostic to avoid
   short-circuiting that logic).
3. **Add private helper**:
   ```ts
   private async raceMux<T>(call: Promise<T>): Promise<T> {
     let timer: ReturnType<typeof setTimeout>;
     const timedOut = new Promise<never>((_, reject) => {
       timer = setTimeout(
         () => reject(new Error(`mux call did not settle within ${this.muxCallMs}ms`)),
         this.muxCallMs
       );
       timer.unref?.();
     });
     try {
       return await Promise.race([call, timedOut]);
     } finally {
       clearTimeout(timer!);
     }
   }
   ```
4. **Wrap every one of these 19 call sites** (verified line numbers as of commit `8e40f531`;
   re-grep `this\.mux\.` before editing in case they drifted) — change `this.mux.X(...)` to
   `this.raceMux(this.mux.X(...))` for exactly these methods, leave `open`/`submit`/`isAlive`/
   `interrupt` untouched (not in relay-5's root-cause list):
   - `clearComposer`: L360, L627, L781
   - `clearComposerHard`: L375, L786
   - `capturePane`: L349, L712, L771, L782, L787
   - `paste`: L387, L636
   - `pressEnter`: L397, L646, L718
   - `kill`: L476
5. **Flip the documentation test** in `tests/unit/cli-chat-engine-verified-submit.test.ts`, the one
   titled `"hangs forever when an individual mux call never settles — pressEnter (#1226
   relay-4)"` (~L391-433): it currently asserts `outcome.kind === "timeout"` (documents the bug).
   Change to assert `outcome.kind === "rejected"` and
   `outcome.err` matches `VerifiedSubmitError` with `code: "delivery_unknown"` (pressEnter fires
   after `entered = true` is set at L396, so the catch-block classification applies). Pass
   `muxCallMs` short in the test opts (e.g. `muxCallMs: 0` or a few ms) so the race resolves fast
   — do NOT rely on the outer `RACE_DEADLINE_MS` harness timeout to prove it; that harness should
   now stay unhit (real rejection wins the inner race). Update the trailing comment (currently
   says "pending a Coordinator-approved fix") to reflect it's now fixed.
6. **Run** `pnpm exec vitest run tests/unit/cli-chat-engine-verified-submit.test.ts` — expect 15/15
   green (0 skipped/failed), the flipped test now genuinely passes via rejection, not the harness
   timeout arm.
7. Consider (optional, only if trivial): a small **new** unit test that a call which resolves
   comfortably inside `muxCallMs` is unaffected (regression guard for `raceMux` itself) — not
   required by Coordinator's task wording, use judgement on token budget.

## After green
- `pnpm format:check && pnpm lint && pnpm typecheck` (pre-push trio) + `git fetch origin main &&
  git rebase origin/main`.
- Full gate in a fresh `jarvis_1226_gate` DB per CLAUDE.md.
- `coordinated-wrap-up`: PR must disclose — shared-chat + package-hash dependencies, the
  module-install prereq (relay-4), the provider-connection fix (relay-3), AND this timeout fix.
  Never merge; wait for Ben.

## Frozen live evidence
No longer needs preserving — relay-5's deterministic unit-test repro superseded the live pane as
evidence. Pane `w1:p06` / API pid `3757574` can be left alone or reaped; not this task's concern
unless Coordinator says otherwise.

## Handoff protocol
Successor: same worktree/branch (`fix/1226-job-search-recovery`,
`/home/ben/Jarv1s/.claude/worktrees/job-search-recovery`), spawned via `herdr-handoff`, resumes via
`coordinated-build` step 2 (Build) directly — the plan above **is** the plan; no need to re-run
`writing-plans` or re-message Coordinator for plan approval (already approved, this doc is the
detail). Skip `pnpm install` (`node_modules` present). R6 will confirm successor driving, then
message Coordinator "relayed to <label>, safe to reap me."
