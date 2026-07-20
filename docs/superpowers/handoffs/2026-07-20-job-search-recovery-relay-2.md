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

## Relay 3 update (2026-07-20): provider-connection contradiction RESOLVED

Root cause found, confirmed via `/tmp/jarvis-1226-api.log` — **neither** of relay-2's two
hypotheses. The API server (`src/server.ts`, pid at the time 3538043) inherited
`HERDR_PANE_ID=w1:pZV` at process launch from a herdr pane that has since closed/reflowed.
No `JARVIS_HERDR_ROOT_TAB` is set, so `packages/ai/src/adapters/herdr-multiplexer.ts`
`resolveRoot()` falls to the static stale-pane-id path instead of the self-healing
tab-by-label path. Every live-chat launch (general chat drawer AND
`/api/chat/module-onboarding`) runs `herdr pane split --parent w1:pZV` → `pane_not_found` →
`CliChatUnavailableError` → 503 "Live chat is currently unavailable on this host". This is
why Webwright run_1 saw the "Connect a provider" empty state and the Job Search
"SOMETHING WENT WRONG" error — the CLI engine cannot launch on this host at all right now.
Unrelated to Settings → Assistant & AI (that's the separate capability-router config).

This is a real, reproducible bug, but the fix (set `JARVIS_HERDR_ROOT_TAB` at server start,
or restart the server from a currently-live pane) touches the multiplexer adapter / a shared
dev process — outside the Coordinator-approved scope above. **Escalated to Coordinator**
(`herdr pane` label `Coordinator`) rather than decided unilaterally; awaiting reply. Full
detail in agentmemory project `jarv1s`, search `"1226 provider connection"`.

Next agent: check for a Coordinator reply first (message sent to label `Build 1226 Recovery
R4` / this worktree's pane) before restarting any shared process or re-running Webwright.

## Relay 4 update (2026-07-20): provider-connection fix CONFIRMED, NEW deeper hang found

Coordinator authorized restarting the #1226 API process (only that process, port 3000) with
`JARVIS_MULTIPLEXER=herdr JARVIS_HERDR_ROOT_TAB=jarv1s`. Done (pid 3757574). `herdr tab list`
now shows a real self-healed tab `jarv1s` (`w1:t3F`, 2 panes) — confirms relay-3's root cause
(stale `HERDR_PANE_ID`) is fixed; module-onboarding no longer 503s with "unavailable".

**But**: re-running Task 6 live-proof surfaced a new, real, reproducible bug. Job Search module
had regressed to needing a full "Download and install" (Settings -> Admin/Setup -> Instance
modules -> module library row, precisely scoped by `<code>{row.id}</code>` ancestor, NOT the
enable-toggle relay-2 documented) — installed successfully, restarted again to load it. Then
`POST /api/chat/module-onboarding` hung 300+s, zero response, API process alive throughout
(`/tmp/jarvis-1226-api.log` reqId `req-1o`/`req-1p`, no "request completed" line ever).
`herdr pane read w1:p06` (the freshly-split CLI pane) shows the classic #1226 symptom
happening *inside* the now-fixed multiplexer path: prompt echoed into the composer, Enter
never landed, engine sits idle. `waitForUserAckWithEnterNudge` in
`packages/chat/src/live/cli-chat-engine.ts` (~line 702) is supposed to fail-fast on exactly
this (nudgeAfterMs=7000 x 2 nudges, ~14-21s bound -> `VerifiedSubmitError("delivery_unknown")`)
but never fired despite 5+ minutes — the hang is upstream of that bounded loop (candidates:
`mux.pressEnter`/`observePane` with no deadline of their own, or `purgeThenKillQuietly`'s
`kill()` during error cleanup hanging). No route-level timeout wraps
`/api/chat/module-onboarding` in `live-routes.ts` either, so nothing external bounds it.

Full detail + reasoning in agentmemory project `jarv1s`, search `"1226 relay-4"`. Escalated to
Coordinator (label `Coordinator`, pane `w1:pYN` at time of writing — re-resolve fresh) rather
than continuing unilaterally; awaiting direction (dig deeper in `cli-chat-engine.ts`, file a
separate follow-up issue, or hand to a fresh session).

### Start here (next agent)
1. Check for a Coordinator reply first.
2. Do NOT trust Task 6 as green — Webwright run_2
   (`/tmp/jarvis-1226-webwright/final_runs/run_2/`) is INCOMPLETE, hung at step 3 (never
   reached CP4r-CP7r). run_2's script already fixed run_1's gap (it now also captures
   `/api/chat/turn` responses, not just `/api/chat/module-onboarding`) — reuse it once the
   hang is understood.
3. If digging into the hang: instrument/log inside `waitForUserAckWithEnterNudge` and its
   callees (`mux.pressEnter`, `observePane`, `purgeThenKillQuietly`) to find which specific
   await never resolves — don't guess further, add a bounded reproduction first.
4. Then: scoped checks -> full gate in fresh `jarvis_1226_gate` DB -> pre-push trio + rebase
   `origin/main` -> `coordinated-wrap-up` (PR must disclose: shared-chat + package-hash
   dependencies, the module-install prereq, the provider-connection fix, AND this new
   module-onboarding hang finding — never merge, wait for Ben).

## Coordinator decision (2026-07-20): relay to R5, do not attempt another live turn first

Coordinator reviewed the relay-4 finding and ordered an immediate relay to a fresh session
("Build 1226 Recovery R5", same worktree `/home/ben/Jarv1s/.claude/worktrees/job-search-recovery`,
same branch `fix/1226-job-search-recovery`) rather than a follow-up issue or another live-turn
attempt. **Do not close pane `w1:p06` or restart the API process until the bounded-evidence
capture below is done** — it is the live, still-open repro of the hang.

### Frozen evidence (do not disturb until captured properly)
- API process: pid `3757574`, launched via `nohup ... pnpm --filter @jarv1s/api dev` from this
  worktree, log at `/tmp/jarvis-1226-api.log`.
- Confirmed env (`tr '\0' '\n' < /proc/3757574/environ`): `JARVIS_MULTIPLEXER=herdr`,
  `JARVIS_HERDR_ROOT_TAB=jarv1s` (self-healing path — this is why it's no longer 503ing with
  `pane_not_found`), plus an incidental inherited `HERDR_PANE_ID=w1:p04` (R4's own pane — harmless
  since `JARVIS_HERDR_ROOT_TAB` takes precedence in `resolveRoot()`'s override order).
- `herdr tab list` shows tab `jarv1s` (`tab_id: w1:t3F`) with 2 panes: `w1:p05` (plain shell,
  no agent, cwd = this worktree — likely the parent pane `ensureTabPane()` opened before
  splitting) and `w1:p06` (agent: claude, `agent_session.value:
  0bd0a0a0-3b44-4e22-97b6-9668a3055e7b`, cwd `~/.jarvis/chat/00000000-0000-4000-8000-000000000001`,
  `agent_status: idle`). **Pane IDs reflow — re-resolve both from a fresh `herdr pane list`
  filtered to `tab_id == "w1:t3F"` before touching either; do not assume `w1:p05`/`w1:p06` are
  still current numbers.**
- `herdr pane read w1:p06 --source recent` shows the onboarding system prompt + module-onboarding
  JSON state block fully echoed into the composer (`❯ calm, lightly dry, sentence case...`),
  never submitted — text sits there with no active spinner.
- API log (`/tmp/jarvis-1226-api.log`), last two lines in the entire file, both for pid
  `3757574`, reqId `req-1o` and `req-1p`, both `POST /api/chat/module-onboarding`, "incoming
  request" at `time: 1784588583372` / `1784588583373` (epoch ms). Grepped the full file for
  both reqIds: **zero "request completed" line exists for either, for this pid** (reqIds are
  reused per-process by Fastify's default counter, so earlier matches in the log belong to
  prior process incarnations — filter by `pid: 3757574` specifically). At last check
  (`date +%s` = `1784589039`) the requests had been open **~456 seconds** with the API process
  still alive and responsive to other routes.

### R5 task (from Coordinator, verbatim intent)
Build one deterministic, red-capable reproduction loop that proves this exact ~300s+ symptom
on demand (don't rely on the live pane staying frozen forever), then trace the call path
route -> session/RPC layer -> engine-host -> `verifiedSubmit` boundary in
`packages/chat/src/live/cli-chat-engine.ts` to identify the **precise `await` that never
resolves**, upstream of the bounded nudge loop (`waitForUserAckWithEnterNudge`, ~line 702;
nudgeAfterMs=7000 x 2 nudges, should bound to ~14-21s and never did). Candidates to check first:
`this.mux.pressEnter(handle)` (~line 397), `observePane` calls (~line 377, 389), and
`purgeThenKillQuietly()` -> `kill()` (~line 865, ~473) during error-path cleanup — none of these
visibly declare their own deadline in the code read so far.

- **Instrumentation rule**: add only uniquely-tagged temporary diagnostics (e.g. a distinct
  log-line prefix like `[R5-DIAG-<random>]`) around suspect awaits, capture the reproduction,
  then **remove every temporary diagnostic** before handing off or committing.
- **Manual Enter remains forbidden** — do not press Enter into any live chat pane yourself;
  the whole point is proving the *automated* path either completes or fails fast without
  human intervention.
- **Scope**: authorized edit surface is still `packages/chat/src/live/cli-chat-engine.ts` +
  its focused test `tests/unit/cli-chat-engine-verified-submit.test.ts`. If the proven root
  cause lives outside that seam (e.g. in `packages/ai/src/adapters/herdr-multiplexer.ts`, or
  the route handler in `packages/chat/src/live-routes.ts`), **stop and report the exact
  file/function to Coordinator and request scope before editing it.**
- Task 6 may only be considered unblocked once the **original automated** module-onboarding
  request returns (success or a fail-fast error) with zero manual keys involved.

### Handoff protocol
Predecessor session (R4, this one): `agent_session.value = 80fab49d-7cea-4966-bf86-3863dc88fc5d`,
pane `w1:p04` (tab `w1:t3B`, label "Build 1226 Recovery R4"). Successor (R5): spawned via the
`herdr-handoff` skill pattern but **in this same worktree/branch** (Coordinator override — this
is a context-exhaustion relay of one continuous branch of work, not a parallel-agent split, so
no fresh worktree). R4 will send both immutable session ids to Coordinator once R5 is confirmed
driving.

## Relay 5 update (2026-07-20): precise root cause found and reproduced deterministically

Frozen evidence re-verified untouched: pane `w1:p06` (tab `w1:t3F`) still holds the composer
state unchanged; API pid `3757574` still alive; `req-1o`/`req-1p` (pid `3757574`, POST
`/api/chat/module-onboarding`) still have zero "request completed" line in
`/tmp/jarvis-1226-api.log` after 700+s elapsed (re-grepped, did not touch pane or process).

**Root cause (confirmed, not guessed) — architectural gap in
`packages/chat/src/live/cli-chat-engine.ts`**: no individual `await this.mux.X(handle)` call
(`pressEnter`, `capturePane`, `paste`, `clearComposer`, `clearComposerHard`, `kill`) has its own
timeout. All bounded-looking logic in the file (`observePane`'s `echoMs` deadline,
`waitForUserAckWithEnterNudge`'s `nudgeAfterMs` x `MAX_ENTER_NUDGES`, `replayAndDrain`'s
`drainMs`) only bounds the check **between** polling iterations — it never wraps the single RPC
call itself. If one such call to the herdr multiplexer genuinely never settles, `verifiedSubmit`
hangs forever, because the code never even reaches the bounded logic (`live-routes.ts` also has
no route-level timeout, so nothing external bounds it either). This means the #1226 fix from
commit `a1caaeb5` (fail-fast when the composer never empties across nudges) is real and correct
for the failure mode it targets, but does NOT cover this deeper class.

**Deterministic reproduction — 3 unit tests, all confirm in <200ms** (fake mux methods that
return a `Promise` which never resolves, raced against a bounded timer):
1. `pressEnter` never resolves → `verifiedSubmit` hangs. **Committed** as
   `tests/unit/cli-chat-engine-verified-submit.test.ts`: "hangs forever when an individual mux
   call never settles — pressEnter (#1226 relay-4)".
2. `capturePane` never resolves (inside `observePane`'s echo-check) → hangs identically.
   Verified via scratch probe, not committed (redundant with #1 for documentation purposes).
3. `kill` never resolves (inside `purgeThenKillQuietly`, entered=true error path) → hangs
   identically. Verified via scratch probe, not committed.

Live frozen-pane evidence (composer holds the FULL pasted payload, un-submitted, no active
spinner, for 700+s) best matches candidate 1: the **first** `await this.mux.pressEnter(handle)`
call at `cli-chat-engine.ts:397` hanging — execution never reaches
`waitForUserAckWithEnterNudge` (line 702) at all, which is exactly why its 7s/14s/21s bound
"never fired despite 5+ minutes" (relay-4's puzzle). Candidates 2/3 share the identical
architectural gap and would hang the same way if hit in production; this is a systemic issue,
not unique to one call site.

**Scope note**: the fix (wrap each `await this.mux.X(handle)` call site with a bounded
race/timeout helper, surfacing a `VerifiedSubmitError` instead of hanging) is entirely within
the approved-scope file — **no change to `packages/ai/src/adapters/herdr-multiplexer.ts` is
architecturally required**. Not yet implemented; escalated to Coordinator per relay protocol
(this finding changes the shape of Task 6's remaining work) rather than deciding unilaterally
whether R5 proceeds to implement it now or relays to R6. Full detail in agentmemory project
`jarv1s`, search `"1226 relay-5"`.

Pane `w1:p06` still NOT touched, API process still NOT restarted, per Coordinator's freeze
instruction.
