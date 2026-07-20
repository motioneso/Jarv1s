# #1226 Job Search Recovery Relay 2

## Scope
Same as relay 1 (`docs/superpowers/handoffs/2026-07-20-job-search-recovery-relay.md`, still valid
for scope/collision boundary/coordinator label — re-resolve `Coordinator` fresh via `herdr pane
list`). Fix is committed `a1caaeb5`, unit tests green. This relay is Task 6 (live proof + gates).

## What changed since relay 1
- Worker re-verified alive (was documented DOWN in relay 1). Web/API alive too. Re-verify PIDs
  fresh anyway — shared box, PIDs churn.
- Stale `w1:pZ0` pane re-confirmed genuinely stuck at relay-1 handoff time (composer never
  emptied). Cleaned via the app's own UI: browser "New chat" -> `POST /api/chat/clear` -> **204**,
  zero manual pane keys. This part of the mechanism works.
- **Discovered undocumented prereq**: Job Search must be instance-enabled at Settings ->
  "Admin / Setup" mode -> "Instance modules" -> "Enable Job Search" checkbox before it shows in any
  user's nav. Checkbox is a visually-hidden native input; Playwright needs
  `checkbox.evaluate("el => el.click()")` (normal `.check()`/`.click(force=True)` both fail
  actionability/viewport checks).
- Webwright run_1 (`/tmp/jarvis-1226-webwright/final_runs/run_1/`) exercised the full mechanical
  path (clear -> 204 -> submit long multiline prompt -> Send button toggles back within 90s) but
  **self-verify caught a false positive**: `final_execution_6_turn_state.png` shows the chat
  drawer in a "Connect a provider to start chatting — No AI provider is connected yet" empty
  state, and the Job Search page shows "SOMETHING WENT WRONG — Jarvis couldn't verify your saved
  Job Search setup." The button-toggle proxy is NOT valid evidence of a completed real turn.
- **Contradiction found, not yet resolved**: Settings -> Personal mode -> "Assistant & AI" shows
  "Powering your chat: Anthropic · claude-sonnet-4-6 — Managed by admin" (a provider IS configured
  instance-wide), yet the Job Search chat drawer shows "no provider connected." Two live
  hypotheses (neither confirmed): (a) module-onboarding chat uses a different provider-connection
  check than general chat, and this is the real source of two observed `503
  CliChatUnavailableError` responses from `/api/chat/module-onboarding`
  (`packages/chat/src/live-routes.ts:600`, `packages/chat/src/routes.ts:993` — real cause only
  logged server-side, never sent to client); (b) a race — screenshot taken before the CLI engine
  finished relaunching after the clear+kill.
- Full details saved to agentmemory (project `jarv1s`, search `"1226 provider connection"` or
  `"1226 job search recovery"`).

## Start here (next agent)
1. Skip install (`node_modules` exists). Re-verify process state fresh (`ps`, `ss -ltnp`).
2. Resolve the provider-connection contradiction first — this blocks trusting any further live
   proof: grep `apps/web/src/chat/chat-drawer.tsx` (or wherever the "Connect a provider" empty
   state renders) for what query/condition drives it, and check whether it's scoped per-module or
   global. Re-run the Webwright script with an explicit poll/wait after `/api/chat/clear` before
   opening the composer, to rule out hypothesis (b) (race).
3. If it's a real bug (hypothesis a): decide whether it's in scope for this PR (disclose in PR
   either way) or a separate issue — escalate to Coordinator, don't decide unilaterally.
4. Once a genuine assistant turn is observed in the transcript (not just button-state), re-run
   Webwright final script in a new `final_runs/run_<n+1>/`, re-verify CP4r-CP7r against real
   evidence (see `/tmp/jarvis-1226-webwright/plan.md` for the full CP list incl. the run_1 scope
   note — full CP1-CP8 PDF-upload journey still not started, logged as deferred).
5. Then: scoped checks -> full gate in fresh `jarvis_1226_gate` DB -> pre-push trio + rebase
   `origin/main` -> `coordinated-wrap-up` (PR, disclose shared-chat + package-hash dependencies +
   the module-enablement prereq + provider-connection finding, never merge, wait for Ben).

## Coordinator-approved files (unchanged scope boundary)
`packages/chat/src/live/cli-chat-engine.ts`, `tests/unit/cli-chat-engine-verified-submit.test.ts`.
Do not touch the multiplexer adapter without a red test + fresh approval.
