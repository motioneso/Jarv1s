# RESUME — coordinator session restart (Bash-snapshot wedge) — 2026-07-16

## 🛑 CURRENT STATE (updated 2026-07-17 by `Coord-1109-1110-g8`, relaying at 70% meter — #1122 FULLY HALTED, ESCALATED)

**YOU ARE gen-9 (or later).** g8 finished the hard-stop investigation and escalation before
relaying — nothing left to investigate on this thread, your job is to hold the line, not re-open it.

**#1122 is fully halted, escalated to Ben directly (not Fable).** 4th VF failure (run
`29569935763`, job `87851069365`, 25m26s) on the post-#1125-fix head (`build/1110-app-map` @
`552308d7`) trips Fable's own hard-stop condition 3 (issue #1123 comment `5000769797`) verbatim.
Pulled the actual log (`gh run view 29569935763 --job 87851069365 --log` — works fine, the
earlier `--log-failed` attempt was the dead end, don't repeat it). Findings, already written up
in full in `docs/coordination/AWAITING-BEN.md` (new section under `#1122`, appended
2026-07-17 by g8) with 4 options for Ben to choose from — **read that doc, don't re-derive**:
- Failure now spans 6+ integration suites (not just the original 3), but same ~10-11s per-test
  timeout ceiling as before — same root cause (pg-boss default `connectionTimeoutMillis`), wider
  blast radius than #1125 scoped for.
- `Build-1110-AppMap-15` (`w1:pST`) has been told to hold — no pushes, no re-runs, may pick up
  other unblocked work but leave `build/1110-app-map` untouched.

**Your job:** do nothing further on #1122 until Ben rules in `AWAITING-BEN.md`. Do not re-run VF,
do not route to Fable, do not touch the branch. If Ben's answer shows up there, resume from his
chosen option (a/b/c/d, see the doc) and re-task `-15` accordingly.

**Also still open, lower priority:** `Build-1109-RuntimeContext-8` (`w1:pT6`) was waiting on its
own `verify:foundation` closeout for Task 7 (final task) before opening its PR — check status,
unaffected by the #1122 situation, handle per normal Phase 2/3 flow. Liveness monitor `bdunrnvoc`
(persistent) died with g8's relay — re-arm it (snapshot `herdr pane list` every ~60s, emit only
changed lines).

Below is g8's own takeover note (already executed) + full history, kept for reference (skim,
don't deep-read).

## ⏩ CURRENT STATE (updated 2026-07-17 by `Coord-1109-1110-g8`, takeover confirmed)

**g8 is driving.** Pane `w1:pT8`, session `417b42df-b34d-4bbe-a56f-ebf1e566a1df`, label
`Coord-1109-1110-g8` (only pane with that label — uniqueness confirmed via `herdr pane list`).
Reaped g7 (`w1:pT5`, session `a6112658…`) after it self-reported standing down; closed cleanly.

**Takeover checklist — all done, nothing new to act on yet:**
- Fleet re-adopted: `Build-1109-RuntimeContext-8` (`w1:pT6`, session `2c4c1e48…`) `working` on
  Task 7 (final, adapted deterministic plan). `Build-1110-AppMap-15` (`w1:pST`, session
  `f8124cd9…`) `working` — running the authorized local CI repro for PR #1122/issue #1123.
  **Waiting on its ping — not polling.**
- Liveness monitor re-armed as `bdunrnvoc` (persistent, diffs `herdr pane list` for both build
  panes' `agent_status`, emits only on change). g7's monitor died with its session as expected.
- `AWAITING-BEN.md` — checked: g7 had **already** committed the #1110 and #1122 RESOLVED-by-Fable
  entries in `bc54687b` before relaying (its own "still open" note was stale/inaccurate). Verified
  `git status` clean on that file — no further edit needed.
**Progress since takeover (this session, still `g8`):**
- -15's CI repro landed: verdict = CI-infra fragility (pg-boss hardcoded `connectionTimeoutMillis`
  10000ms default), zero #1122 code cause, proven clean-repro on both branch head and
  `origin/main` locally. Issue **#1124** filed. Full detail + comment link in
  `AWAITING-BEN.md` (#1122 section).
- Routed next-step decision to a fresh Fable one-shot → **ruling: path (c)**, tiny test-scoped fix
  first (issue #1123 comment `5000769797`). Full ruling + conditions recorded in
  `AWAITING-BEN.md`.
- -15 built the fix in an isolated worktree (`fix/1124-pgboss-test-timeout`, off `main`, separate
  from its own `build/1110-app-map` #1122 branch) → **PR #1125**, scoped to exactly the 3
  trio test files, zero prod-runtime touch. CI green (VF/Compose smoke/prod-compose smoke/
  build-publish all pass). Routine-tier QA green (0 blocking findings, verdict posted PR #1125
  comment `5001404324`). **Merged** `2026-07-17T09:24:39Z`, branch deleted, issue #1124 correctly
  left open (durable fix still tracked there).
- Tasked -15 (step 5 of the ruling): merge `main` into `build/1110-app-map` (its #1122 branch,
  do NOT rerun stale head) and trigger a fresh VF. **Waiting on its ping — not polling.** Hard
  stop condition still applies: same ~10.9s trio signature recurring after the fix lands in
  #1122's head → full halt, escalate to Ben, no further attempts.
- `Build-1109-RuntimeContext-8` still waiting on its own `verify:foundation` closeout run before
  opening its PR (Task 7, final task) — unaffected by the above, watching in parallel.
- No new Fable escalations pending right now. Still routing any judgment call to a Fable one-shot
  subagent overnight, not waiting on Ben.

Below is g7's now-superseded takeover note (kept for history — skim, don't deep-read).

## ⏩ PRIOR STATE (updated 2026-07-17 by `Coord-1109-1110-g7`, relay from g7 at 71% meter)

**YOU ARE gen-8 (or later). Ben went to bed and delegated open questions to Fable overnight — no
blockers on him; do NOT wait for him, route further judgment calls to a Fable one-shot subagent
(`Agent(model: "fable", ...)`, pointer-style prompt) the same way g7 did. See both real rulings
already posted:**
- **PR #1122 CI (issue #1123, comment `5000410449`):** No waiver (main is green), no more
  `gh run rerun` of any kind, no CI-Postgres re-provisioning yet (unconfirmed theory + real
  counter-evidence: per-job Postgres container, `fix/1112` ran the identical job green same
  morning). **Authorized ONE action, already relayed to `-15`** (`Build-1110-AppMap-15`, pane
  resolve fresh by label — was `w1:pST`): local CI-conditioned repro — `test:integration` under
  ~2vCPU + fresh CI-default pgvector Postgres on branch head `874759ec` AND `origin/main`,
  instrumented with `pg_stat_activity`, naming the exact limit the constant ~10.9s timeout maps
  to. Branch-only repro → real defect, -15 fixes+pushes once. Repros on main too → separate
  CI-infra task, no #1122 code touch. **-15 was told to ping the coordinator label when done —
  watch for that push, don't poll.** No monitor currently armed on this (nothing to poll — it's
  agent-work, not a CI check); re-arm the `gh pr checks 1122` terminal-state monitor only once
  -15 reports a fix pushed.
- **#1110 exit criterion (issue #1110, comment `5000410700`):** Deferral **approved** — deterministic
  UAT + unit grounding is the automated gate, #1121 does NOT need to land first. **But NOT a full
  waiver:** merge additionally requires a **manual live-path walk** on a dev instance running PR
  head, all 3 spec §8 scenarios (grounded fix / adversarial pair / transient-error honesty),
  transcripts+screenshots as `gh pr comment` on #1122, before merge. Deferral is single-use, does
  NOT extend to #1109. Backlink posted to #1121 (`issuecomment-5000430204`) listing the 3 deferred
  assertions. **Not started yet** — told -15 to focus on the CI repro first, live-path walk is a
  follow-up once CI clears.

**Still open / not yet done by g7 (pick up here):**
1. `AWAITING-BEN.md` still shows the *questions* as open, not marked resolved-by-Fable-ruling —
   update both entries (#1110 section ~line 90, #1122 section ~line 116) to record the rulings
   landed, so Ben wakes up to a decision trail, not stale questions. Keep it short — link the
   GitHub comments, don't re-paste them.
2. Commit that + this doc.
3. Resume passive supervision: liveness monitor `b81t5s4em` (persistent, watches
   `Build-1109-RuntimeContext-8` + `Build-1110-AppMap-15` by label/status) should still be running
   — verify with `herdr pane list`, it dies with the relaying session same as any monitor.
   `Build-1109-RuntimeContext-8` was `working` on Task 7 (final task, adapted deterministic plan,
   deferring LLM assertions to #1121) at last check, healthy, no PR yet.
4. Watch for -15's ping (CI repro verdict) and Build-1109's next relay/PR-done push — normal
   coordinate-skill Phase 2/3 flow from there.

Below is g7's own takeover note (already executed) + full history, kept for reference (skim, don't
deep-read):

## ⏩ PRIOR STATE (updated 2026-07-17 by `Coord-1109-1110-g7`, session a6112658, pane `w1:pT5`)

**gen-7 is driving.** Reaped g6 (session `08b39789…`, pane `w1:pT3`, was idle at prompt post-relay,
51% meter — closed cleanly). Confirmed distinct successor session id before reaping.

**Re-armed both monitors (both had died with g6, session-only):**
- `bra9ox5lm` — PR #1122 `gh pr checks` diff, non-persistent (30min timeout), emits on any check
  change and again on terminal (all-non-pending) state. Initial read on re-arm:
  **VF still `pending`** on run `29560460812` (the re-run from g6's authorization) — Compose smoke
  + prod-compose smoke both `pass`. No new information yet vs. g6's handoff; re-run is still in
  flight, not yet resolved.
- `bnaa8c3du` — persistent fleet liveness diff on `Build-1109-RuntimeContext-7` (`w1:pT4`) +
  `Build-1110-AppMap-15` (`w1:pST`); both present at re-arm, `-7` was `working`.

**PR #1122 CI: 3rd VF failure, same signature — escalated to Ben, lane fully halted, NO further
re-runs.** Monitor `bra9ox5lm` fired terminal state: VF failed again, 25m27s, same hard timeout.
Read the job log myself (`gh run view 29560460812 --job 87826877201` + `--log`) — confirmed
**identical failure signature** to the 2nd failure: same 3 files (`multi-user-isolation.test.ts`
14/15 failed, `account-self-deletion.test.ts` 8/8 failed, `auth-bootstrap-recovery.test.ts` 5/5
failed), same ~10.9s per-test hang pattern (consistent with stuck/contended DB connection, not
app logic). Compose + prod-compose smoke both still pass. This strengthens the "CI
Postgres-container contention" diagnosis but a 3rd failure on a clean re-run (no code change) is
past what a coordinator-level retry can resolve.

**Actions taken:** posted full signature comparison to issue #1123
(`issuecomment-5000219819`). Added an escalation entry to `AWAITING-BEN.md` (below the existing
#1122 stop-the-line entry) laying out options (fresh runner / CI Postgres resourcing / other) and
explicitly asking for Ben's call — **no further `gh run rerun` will happen without his input.**
-15 remains idle holding on the branch, not touched.

**Next action for whoever reads this:** this is now genuinely blocked on Ben, not on more
investigation. Do NOT re-run CI again unprompted. Check `AWAITING-BEN.md` for his response; when
he weighs in, act on it (retry on fresh runner / escalate CI infra / etc. per his direction).
#1109/#1110 build lanes continue unaffected in parallel — only the #1122 CI gate is blocked.

**#1109 update (same gen-7 session):** `Build-1109-RuntimeContext-7` finished Task 6 (tier-one
privacy boundary tests, `09af162c`) and investigated Task 7 (final task) — UAT harness has no
chat-capable AI model seeded at any level (tracked gap, issue #1121, same limitation already
handled via `test.fixme` in sibling specs `app-map-grounding.uat.spec.ts` and
`1089-1090-chat-drawer-private.uat.spec.ts`). Wrote an adapted Task 7 plan staying within
deterministic assertions, deferring LLM-dependent portions to #1121. Relayed to
`Build-1109-RuntimeContext-8` (pane `w1:pT6`, session `2c4c1e48…`). Verified tab placement
(`w1:t2D`, correct shared agents tab) and Sonnet + `working` before reaping `-7` (pane `w1:pT4`
closed). Handoff doc: `docs/superpowers/handoffs/2026-07-17-1109-runtime-context-relay-7.md`.
`-8` now on Task 7 (final task, adapted plan). Healthy relay cadence continues (-1→-8, all clean).
Passive supervision only unless it escalates.

Below is g6's own takeover note (already executed, now superseded by the above) + full history,
kept for reference (skim, don't deep-read):

## ⏩ PRIOR STATE (updated 2026-07-17 by `Coord-1109-1110-g6`, session 08b39789 — relay → gen-7, 70% meter)

**YOU ARE gen-7. Do these FIRST:**
1. `herdr pane list` — find your own pane/session (relay spawns you in the SAME tab as g6's pane,
   `w1:t2E`, NOT the agents tab).
2. **Reap g6** (label `Coord-1109-1110-g6`, session `08b39789-f9ad-4bee-ac33-f1b438142dbc`, pane
   `w1:pT3`) — resolve fresh by label+session, confirm you're the distinct successor first.
3. **Re-arm both monitors — both are session-only and died with g6:**
   - PR #1122 CI re-run terminal-state watch (was `buvkh6pws`, non-persistent, still running at
     handoff — `gh pr checks 1122`, check if it already landed before re-arming a new one).
   - Fleet liveness on `Build-1109-RuntimeContext-7` (pane `w1:pT4`, session `1ece3f0a…`) +
     `Build-1110-AppMap-15` (pane `w1:pST`, session `f8124cd9…`) — was `bjxpou3zi`.

**IMMEDIATE WORK — PR #1122 CI re-run in flight, verdict pending:**
- **Stop-the-line context (full detail: GitHub issue #1123, `AWAITING-BEN.md` new section):** VF
  failed 2nd time on run `29560460812` (head `874759ec`) — but a **different failure mode** than
  the pre-fix regression: 25-min job timeout mid-`test:integration`, 5 DB/auth-heavy files failing
  hard (not just slow) vs. clean 156/156 on the identical commit locally. -15 diagnosed this as
  **CI Postgres-container contention under runner load, not a code regression** (type-only diff,
  normal unit timing, auth-heavy-files-only failure pattern) — verdict verified directly against
  -15's own pane, not just relayed text. **Coordinator authorized `gh run rerun 29560460812
  --failed`** (no code push) to test the flake hypothesis — this is a re-run, not a waiver (no
  Ben approval needed for re-triggering the existing gate on the same commit).
- **Check `gh pr checks 1122` fresh — do not assume still pending.** On terminal:
  - **VF green:** flake confirmed. Update issue #1123 (comment: resolved, environmental, no code
    change) and close it. Spawn QA (`coordinated-qa`, tier **sensitive** — module-sdk barrel
    touch = cross-module contract change). Merge is **still separately blocked** on Ben's pending
    #1110 exit-criterion ruling in `AWAITING-BEN.md` (unresolved as of this relay) — QA green does
    not unblock merge.
  - **VF fails a 3rd time:** no longer plausibly noise — do NOT just re-run again. This needs
    real escalation (possibly CI infra health, needs Ben's attention) — read the job log yourself
    first (same method as g6: `gh run view <id> --job <id>`, compare timing/failure pattern
    against the 2nd failure to see if it's the *same* environmental signature recurring, which
    would actually strengthen the flake diagnosis, vs a *new* pattern, which would not). Update
    issue #1123 either way.
- **-15 is idle, holding on the branch as instructed** (pane `w1:pST`) — don't re-message it
  unless CI comes back red a 3rd time or you need it to push a real fix.

**#1109 in parallel:** now on `Build-1109-RuntimeContext-7` (pane `w1:pT4`, session `1ece3f0a…`),
Task 6 (WIP, was mid-task at last relay). Task 5 (delete per-turn page_context push path) done +
committed `4922cb06`, handoff doc `docs/superpowers/handoffs/2026-07-16-1109-runtime-context-relay-6.md`
(`ddd4fa0d`). Healthy relay cadence throughout (-1→-7, all clean, no escalations) — normal churn
for a long build. Passive supervision only unless it escalates.

Below is g6's own takeover note (already executed) + full history, kept for reference (skim, don't
deep-read):

## ⏩ PRIOR STATE (updated 2026-07-17 by `Coord-1109-1110-g6`, session 08b39789)

**gen-6 is driving.** Pane `w1:pT3`, tab `w1:t2E` (same tab as g5, not agents tab). Reaped g5
(session `435f7c1a`, pane `w1:pSX` closed, confirmed distinct successor first) and confirmed
`Build-1109-RuntimeContext-6` still driving (pane `w1:pT2`, session `c865baf7…`, `working`).
`Build-1109-RuntimeContext-5` was already gone from the pane list at handoff — no action needed.

**PR #1122 CI: VF's 2nd failure CONFIRMED STOP-THE-LINE, filed as GitHub issue #1123.**
Read the job log myself (`gh run view 29560460812 --job 87821595425`) per g5's late-breaking
instruction — this is a **different failure mode** than the pre-fix regression: the job hit the
**25-minute CI timeout** mid-`test:integration` (last test seen: `route-guard.test.ts`, canceled
7s later). Compose-smoke + prod-compose-smoke both PASS on this run. Compared against the last
known-green `main` run (`29554454835`, whole VF job incl. Build web + Playwright = **19m29s**) —
this run burned the **full 25m budget on just the `Verify foundation` step alone**. Real ~30%+
slowdown, not marginal/noise.

**Actions taken:**
- Filed **GitHub issue #1123** documenting both VF failures, run links, and the timing comparison.
- Added an entry to `docs/coordination/AWAITING-BEN.md` (new section, below the existing #1110
  exit-criterion entry) — informational only, no decision needed from Ben yet, just flagging per
  the stop-the-line protocol.
- **Relayed to -15** (`herdr pane run w1:pST`, confirmed delivered — it was already independently
  checking CI when the message landed): investigate whether this is a genuine regression from the
  errors.ts leaf-split (Task: does moving `JarvisError`/`ModuleErrorManifest` plausibly add real
  import-graph/typecheck overhead) or CI runner contention/flake — check if `test:integration`
  timing is meaningfully slower locally too. **Explicitly told it NOT to push anything without
  checking in with the coordinator first** (lane is halted per stop-the-line, no more blind
  fixes). -15 was at 61% context when messaged, flipped to `working` immediately after.

**Re-armed monitor:** persistent Monitor (`bjxpou3zi`, superseded `b28z85fu6` after -6→-7 relay
below) diffing `herdr pane list` for `Build-1109-RuntimeContext-7` + `Build-1110-AppMap-15` status
changes / pane death — only emits on change, so silence = both still running.

**#1109 relay (same gen-6 session):** `Build-1109-RuntimeContext-6` finished Task 5 (deleted
per-turn page_context push path, committed `4922cb06`, all green), relayed at 70% meter warning to
`Build-1109-RuntimeContext-7` (pane `w1:pT4`, session `1ece3f0a…`). Verified tab placement
(`w1:t2D`, correct shared agents tab) and Sonnet + `working` before reaping `-6` (pane `w1:pT2`
closed). Handoff doc: `docs/superpowers/handoffs/2026-07-16-1109-runtime-context-relay-6.md`
(`ddd4fa0d`). -7 now on Task 6. Healthy relay cadence continues (-1→-7 all clean).

**UPDATE (same gen-6 session) — -15's verdict in, re-run authorized, in flight:**
- **-15's diagnosis: environmental, not the errors.ts diff.** `test:unit` normal timing (423/423,
  129.89s — no resolution-overhead signature). `test:integration` slowdown wasn't uniform —
  dominated by 5 DB/auth-heavy files failing hard in CI (`auth-settings` 13/23 failed 159.6s,
  `multi-user-isolation` 14/15 failed 158s, `account-self-deletion` 8/8 failed 89.6s,
  `news-personalization-repository` 10/15 failed 110.6s, `auth-bootstrap-recovery` 5/5 failed
  56.8s — all normally ~11-23s). **Same commit ran 156/156 clean locally** (790s, incl. all 5 of
  those files), only unrelated pre-existing `chat-skills.test.ts` flake. `errors.ts` is type-only
  — mechanistically can't cause runtime auth/DB failures. Pattern = Postgres service container
  choking under CI runner load, not a code defect. Verified against -15's own pane directly
  (matched exactly) before acting — not just trusting relayed text.
- **Decision:** authorized `gh run rerun 29560460812 --failed` (no code push) to test the flake
  hypothesis. Confirmed in flight (`gh pr checks 1122` shows VF `pending` again on a fresh job
  attempt, same run ID). Posted verdict + decision to issue #1123
  (`issuecomment-5000011936`). Told -15 to keep holding idle.
- **Monitor `buvkh6pws`** (non-persistent, 30min timeout) armed on `gh pr checks 1122` for
  all-non-pending terminal state.

**Next action for whoever reads this next:** wait for monitor `buvkh6pws` (or re-check
`gh pr checks 1122` if it timed out silently). On result:
- **VF green:** flake theory confirmed. Close out issue #1123 as resolved (environmental, no code
  change needed). Spawn QA (`coordinated-qa`, tier **sensitive**) per the original plan. Merge
  still separately blocked on the #1110 exit-criterion ruling in AWAITING-BEN.md (unresolved as of
  this update) — clearing CI does not unblock merge.
- **VF fails a 3rd time (even with different specific test failures):** no longer plausibly noise
  — do NOT just re-run again. Escalate harder: this may need a genuinely fresh runner / manual Ben
  attention on CI infra health, not another coordinator-level retry. Update issue #1123.

Below is g5's own final relay note (partially superseded by the above — the "IMMEDIATE WORK" CI
state it describes is now stale, already investigated and superseded) + full history, kept for
reference (skim, don't deep-read):

## ⏩ PRIOR STATE (updated 2026-07-17 by `Coord-1109-1110-g5`, session 435f7c1a — relay → gen-6, genuine 70%)

**🚨 LATE-BREAKING (added after the section below was written, before g5's final reap): monitor
`b52frv1qd` fired post-relay-spawn — PR #1122 run `29560460812` (head `874759ec`, the run AFTER
both fixes) reached terminal state: `Compose deployment smoke` PASS, `Prod compose deployment
smoke` PASS, but `Verify foundation and app` = **FAIL** (25m26s). This is VF's SECOND failure on
this PR (first was the pre-fix module-sdk-barrel regression, root-caused and fixed by -15,
verified 3/3 locally). Per the coordinate skill's CI waiver protocol: a check failing TWICE on
the same PR = **stop-the-line** — halt the lane, do NOT assume it's the same root cause or a
flake, pull this run's VF job log yourself (`gh api repos/motioneso/Jarv1s/actions/runs/29560460812/jobs`
→ job id → `gh api repos/motioneso/Jarv1s/actions/jobs/<id>/logs`) before deciding next step. This
was relayed live to gen-6 via `herdr pane run` immediately on receipt — treat that as your actual
first action if you haven't already started on it. -15 is idle/holding on `build/1110-app-map`,
ready for another fix once root-caused. If genuinely stop-the-line, file a GitHub issue and
escalate to Ben rather than looping -15 through more blind fixes.**

**YOU ARE gen-6. Do these FIRST:**
1. `herdr pane list` — find your own pane/session (relay spawns you in the SAME tab as g5's pane,
   `w1:t2E`, NOT the agents tab).
2. **Reap `Build-1109-RuntimeContext-5`** (pane `w1:pT1`, session `e06f43fd-1f9f-4dee-a923-
   a923-e76e90310af7`) — its successor `Build-1109-RuntimeContext-6` (pane `w1:pT2`, session
   `c865baf7-a3a4-4fc4-baa8-27a804aae18d`) was **already confirmed driving fresh** by g5 right
   before this relay fired — re-resolve by label+session once more before closing (cheap, don't
   skip), but this one is low-risk, already-verified.
3. **Reap g5** (label `Coord-1109-1110-g5`, session `435f7c1a-1c09-493b-b091-af1cf10919f0`,
   pane `w1:pSX`) — resolve fresh by label+session, confirm distinct successor first.
4. Re-arm Monitor on PR #1122 CI (`gh pr checks 1122`) for terminal state — the prior one
   (`b52frv1qd`) is session-only and died with g5; it does NOT auto-continue. Also re-arm a
   `Build-1110-AppMap*` pane-status/lane-death watch (g5's `ban5o5gh8` also died with the
   session).

**IMMEDIATE WORK — PR #1122, both prior CI blockers fixed, 3rd run in flight, VF still pending:**
- Head SHA `874759ec` (commits `a29cd8aa` fix + `874759ec` handoff docs from -15). Run
  `29560460812`. **At last check:** `Compose deployment smoke` PASS, `Prod compose deployment
  smoke` PASS, **`Verify foundation and app` still PENDING** — check `gh pr checks 1122` fresh,
  don't assume it's still pending by the time you read this.
- **-15 is idle, holding on the branch as instructed** (pane `w1:pST`, session `f8124cd9…`) —
  don't re-message it unless CI comes back red again.
- **On CI green (all required checks):** spawn QA — `Agent(subagent_type: "coordinated-qa",
  isolation: "worktree", prompt: "PR: 1122 | Branch: build/1110-app-map | Spec: <see prior specs
  in docs/superpowers/specs/ for #1110 app-map> | Tier: sensitive")` (Sonsonet inherits — this is
  `sensitive` tier, not `security`, so no Opus override needed; tier rationale: module-sdk barrel
  touch = cross-module contract change, confirmed in this session's investigation above).
- **On CI red again:** this would be the first red run on `Verify foundation and app`
  specifically since the VF fix landed (compose-smoke already passed once on the current head, so
  compose-smoke red-again would count differently) — read the job log yourself before
  re-escalating to -15; don't assume it's a flake or the same root cause.
- **Merge stays blocked regardless of QA verdict** on Ben's `AWAITING-BEN.md` #1110
  exit-criterion ruling (§"#1110 app-map — real-LLM grounding e2e...") — not yet resolved as of
  this relay. QA + green CI do not unblock merge on their own.

**#1109 in parallel:** now on **`Build-1109-RuntimeContext-6`** (pane `w1:pT2`, session
`c865baf7…`), Task 5 (WIP, was mid-task at last relay — "chat.getCurrentView tool" was Task 4,
now done+committed `e5d57c6e`). Healthy relay cadence throughout (-1→-6, all clean, no
escalations) — this is normal churn for a long build, not a problem. Passive supervision only
unless it escalates.

**UX Coordinator (separate fleet, pane `w1:pSS`, tab `w1:t1Q`):** exchanged status pings this
session. #1118 (their PR) completed its single Ben-authorized CI rerun GREEN, no overlap with any
#1110-touched files (`packages/module-sdk/src/index.ts`, `packages/shared/src/index.ts`,
`news-api.ts`) — confirmed by them. No action needed from this fleet; they're advancing through
their own remaining gate independently.

Below is g5's own takeover note (already executed) + full gen-4/gen-3 history, kept for reference
(skim, don't deep-read):

**gen-5 is driving.** Took over from g4 (5622ee69, reaped clean, pane `w1:pSV` closed after

**gen-5 is driving.** Took over from g4 (5622ee69, reaped clean, pane `w1:pSV` closed after
fresh label+session confirm). My pane `w1:pSX`, tab `w1:t2E` (same tab as predecessor, not the
agents tab) — labeled `Coord-1109-1110-g5`.

**Monitors re-armed (session-only, both fresh):**
- `bxa08yb28` — PR #1122 CI terminal-state watch. Fired immediately (CI was already terminal,
  both checks still red, no change) — task ended, not re-armed since nothing pending; re-arm a
  fresh one after the next push instead.
- `blps7dqlc` — watches `Build-1110-AppMap*` pane status/relay/death. Live.

**VF failure on PR #1122 — INVESTIGATED, CONFIRMED REAL REGRESSION (not the previously-assumed
pre-existing gap):**
- Job `87815542433` log: `module-web-browser-safety.test.ts` fails with `module "news": expected
  [ …(4) ] to deeply equal []` — first listed offender `packages/module-sdk/src/route-errors.ts
  imports backend-only package "fastify"`.
- **This is NOT the previously-documented pre-existing false positive** (that one was about
  `packages/shared/src/index.ts:5`, a different symptom). Proof: pulled the `Verify foundation
  and app` job log from the latest **green** run on `main` (run `29554454835`, job
  `87803601966`, 2026-07-17T04:19) — `module-web-browser-safety.test.ts` passes clean, 3/3, no
  mention of "news" or "fastify" or "route-errors". The branch-only failure is real.
- **Root cause not fully pinned — handed to the build lane, not resolved by me.** No `modules/news/`
  files changed in this PR's diff at all. The two `apps/web/src/` files that import
  `@jarv1s/module-sdk` are `apps/web/src/chat/use-chat-stream.ts` and
  `apps/web/src/settings/settings-admin-panes.tsx` — one of these is almost certainly how module
  "news"'s web-contribution graph now reaches the barrel's `route-errors.js` re-export (barrel
  line 6, pre-existing, unchanged by this PR). The PR's own `packages/module-sdk/src/index.ts`
  diff (the "#1110 regression fix" commit, moving `AI_MODEL_CAPABILITIES` to a leaf) added only
  type-only interfaces (`JarvisError`, `ModuleErrorManifest`, etc.) — didn't look like the direct
  cause on inspection, but I did not chase further; **-15 (or successor) should verify with an
  isolated import-graph trace**, not assume.
- Compose-smoke: -15 still on it. Went through an auto-compact cycle (was at 1% until
  auto-compact, then compacted, now back to `working` per `blps7dqlc`). No new findings surfaced
  yet — **check its pane before re-messaging**, don't duplicate work.
- **Next action for whoever reads this next:** once -15 (or its relay successor) is at a natural
  break point (idle, or done with compose-smoke), relay it the VF finding above verbatim — don't
  make it re-derive the main-vs-branch proof.

**UPDATE (same gen-5 session):**
- **Compose-smoke: FIXED, pushed** by -15. Root cause: `apps/api`'s `start` script (used by the
  dev docker-compose `api` service) never generated `dist/app-map.json` — only the `dev` script
  did. `registerBuiltInApiRoutes` eagerly `loadAppMap()`s at boot → ENOENT on fresh checkout →
  container crash-loop → healthcheck never passes. **Unrelated to the module-sdk barrel fix.**
  Fix: `apps/api/package.json` `start` now mirrors `dev` (`pnpm --dir ../.. build:app-map && tsx
  src/server.ts`, 1-line diff). -15 verified empirically (repro'd the ENOENT crash by deleting
  `dist/app-map.json`, applied fix, repro'd again — `GET /health` now 200). Pushed 2 commits (fix
  `8e30e1da` + handoff doc `8e35e67f`) — **PR #1122 head is now `8e35e67f`.** New CI run
  `29559158348` in flight.
- **Monitor `b9czcxmvb`** (persistent) re-armed watching this new run for terminal state.
- **Relayed the VF finding (above) to -15 verbatim** — told it to start on the VF regression now
  while the new compose-smoke CI run is in flight, no re-derivation needed. As of hand-off it was
  actively working (67% context).

**UPDATE (same gen-5 session) — VF regression FIXED too, both blockers now resolved:**
- **Root cause (confirmed via `git diff origin/main`, not assumed):** PR added 2 new bare
  type-only imports (`packages/shared/src/index.ts:5` + `news-api.ts:2`) from
  `@jarv1s/module-sdk`. The browser-safety walker resolves bare specifiers via the whole barrel
  and can't distinguish type-only from runtime imports — pulled module-sdk's pre-existing
  fastify/node:crypto re-exports (`route-errors.ts`/`logger.ts`/`rate-limit-key.ts`) into news's
  browser graph.
- **Fix:** moved `JarvisError`/`JarvisErrorClass` to a new node-clean
  `packages/module-sdk/src/errors.ts` leaf + `./errors` export subpath (mirrors the existing
  `ai-capabilities.ts` pattern from `34457186`); both shared consumers now import via the
  subpath. Walker can't resolve subpaths, so the leaf stays invisible to it — same blind spot the
  `ai-capabilities` fix already relies on.
- **Verified by -15:** `module-web-browser-safety.test.ts` 3/3 pass, typecheck EXIT=0,
  `test:unit` 423/423 files clean, `test:integration` 155/156 files (1 unrelated pre-existing
  timestamp-precision flake in `chat-skills.test.ts`, untouched by this fix). Deferred/unrelated:
  #1087 uat-seed shared-DB `guard.test.ts` (known issue, tracked separately).
- **Pushed:** commits `a29cd8aa` (fix) + `874759ec` (handoff docs) → `build/1110-app-map`. **PR
  #1122 head is now `874759ec`.**
- **New CI run `29560460812` in flight** (all 3 checks pending at last check). **Monitor
  `b52frv1qd`** (persistent) armed for terminal state.
- Told -15 to stay idle on the branch until CI reports back and QA runs — **don't touch anything
  else.**
- **Next action:** on CI terminal — if green, spawn QA (`coordinated-qa`, tier **sensitive**,
  per prior tentative call — module-sdk barrel touch = cross-module contract change). Merge still
  gated on Ben's `AWAITING-BEN.md` #1110 exit-criterion ruling regardless of QA verdict. If red
  again, this is the **2nd failure on this lane's CI** (compose-smoke and VF both failed once
  already, both now fixed once each — so a 3rd red run of the SAME check would trip the
  twice-failing stop-the-line rule; a red run on a *different* check would not).

Below is g4's own relay note (its "YOU ARE gen-5" instructions, now executed) + full history,
kept for reference (skim, don't deep-read):

**YOU ARE gen-5. Do these FIRST:**
1. `herdr pane list` — find your own pane/session, confirm it (relay spawns you in the SAME tab
   as g4's pane, NOT the agents tab).
2. Re-arm a Monitor on PR #1122 CI (`gh pr checks 1122`) — the prior one (`bt30t6376`) hit its
   terminal-state break condition and ended; it does NOT auto-continue after a new push. Also
   confirm the PR/lane-death monitor (`bvvuha20x`) is either still running (session-only, may have
   died with g4) or re-arm it too: watches `gh pr list --head build/1110-app-map` (already open,
   so this leg is moot now) + lane death (no `Build-1110-AppMap*` pane).
3. **Reap g4** (label `Coord-1109-1110-g4`, session `5622ee69-917d-425c-a6d3-acdb93d1e8c7`,
   currently pane `w1:pSV`) — resolve fresh by label+session, confirm distinct successor first.

**IMMEDIATE WORK — PR #1122 CI is RED, uninvestigated on the VF side:**
- **`Compose deployment smoke`: FAIL.** `infra-api-1` never became healthy (job run
  `29558438821`/job `87815542417`), no app logs captured (job has no diagnostic-dump step).
  Confirmed NOT pre-existing (green on `main` at base SHA `65b8a7f8`; `Prod compose deployment
  smoke` passed on this same branch) — real regression, not CI-waivable. **Already reopened
  `Build-1110-AppMap-15`'s lane** (pane `w1:pST`, session `f8124cd9`, same worktree/branch
  `build/1110-app-map`) with repro instructions; it had started investigating (thinking) as of
  last check — **check its pane for progress/findings before re-messaging it.**
- **`Verify foundation and app`: FAIL** (job `87815542433`) — **NOT YET INVESTIGATED.** Could be
  the same known-pre-existing false positive `-15` already flagged locally (VF_EXIT=1,
  `module-web-browser-safety.test.ts` type-only-reexport blind spot,
  `packages/shared/src/index.ts:5`) reproducing in CI too (in which case it's a documented,
  expected gap — not new), OR something newly broken. **Check the job log first**
  (`gh api repos/motioneso/Jarv1s/actions/jobs/87815542433/logs`) before doing anything else —
  don't assume either way.
- `Build and publish images`: skipping (dependent on the failed jobs, expected).
- **QA is blocked** until both red checks are resolved (fixed-and-green, or the VF one confirmed
  as the already-documented pre-existing gap with nothing new). Tentative tier for whenever QA
  spawns: **sensitive** (module-sdk barrel touch = cross-module contract change).
- **Merge stays blocked regardless** on Ben's AWAITING-BEN #1110 exit-criterion ruling
  (`docs/coordination/AWAITING-BEN.md` §"#1110 app-map — real-LLM grounding e2e...") — CI going
  green does NOT unblock merge on its own.

**#1109 in parallel (unaffected by the above, keep supervising independently):** spawned, worktree
`.claude/worktrees/build-1109-runtime-context`, branch `build/1109-runtime-context` off
`origin/build/1110-app-map` (upstream tracking unset). Build agent **`Build-1109-RuntimeContext`**,
pane `w1:pSW`, tab `w1:t2D`, confirmed Sonnet 5, was working as of last check — no report yet,
nothing to action unless it escalates.

Below is g4's own prior takeover note + the full gen-3 history, kept for reference (skim, don't
deep-read):

**gen-4 is driving.** Took over from gen-3 (cb9ca6a3, reaped clean — it had already stopped
taking coordinator actions before I closed its pane w1:pS5). Persistent PR/lane-death Monitor
**re-armed** (task `bvvuha20x`, polls every 30s: `gh pr list --head build/1110-app-map` +
`herdr agent list` for a `Build-1110-AppMap*` pane).

**Fleet snapshot at takeover:** exactly one `Build-1110-AppMap*` pane — **`-15`**, session
`f8124cd9-d875-4190-b6c8-9fcad2bc412b`, pane `w1:pST`. Mid-`coordinated-wrap-up`: code is DONE,
committed, rebased clean onto `origin/main` (HEAD `30284c28`, 29 commits ahead, not yet pushed).
Per its checkpoint-16 doc (`docs/superpowers/handoffs/2026-07-16-1110-app-map-relay-16.md` in the
`build-1110-app-map` worktree), remaining steps are mechanical: `pnpm verify:foundation` →
`pnpm audit:release-hardening` → push → `gh pr create` → report to coordinator. Pane was showing
"1% until auto-compact" at takeover — expect it to self-relay to checkpoint 17 before finishing;
that's normal churn per the established pattern, not a problem. No #1110 PR open yet as of takeover.

**UPDATE (same gen-4 session, post-takeover):**
- **#1110 PR OPEN: [#1122](https://github.com/motioneso/Jarv1s/pull/1122)**, `build/1110-app-map` →
  `main`, MERGEABLE. `-15`'s report: VF_EXIT=1 (sole cause: known pre-existing
  `module-web-browser-safety.test.ts` false positive, type-only-reexport blind spot at
  `packages/shared/src/index.ts:5` — confirmed unrelated to this PR via git-stash isolation on bare
  `origin/main` HEAD), AUDIT_EXIT=0 clean. 422/423 `test:unit`, `test:uat-seed` 11/12 (2
  pre-existing #1087 fails), `test:integration` 156/156. Two follow-up issues still needed: (1) the
  VF false-positive, (2) `guard.test.ts` #1087 non-ephemeral shared-dev-DB state. GitHub CI
  (Compose smoke ×2, Verify foundation and app) was PENDING at PR-open — Monitor `bt30t6376`
  watching for terminal state. `-15` acked, told to stay idle (not reaped — reap happens post-merge).
  **QA not yet spawned** — waiting on CI terminal per coordinate skill ("QA trusts CI, don't re-run").
  Tentative tier: **sensitive** (module-sdk barrel touch = cross-module contract change) — confirm
  when spawning QA. **Merge stays blocked on Ben's AWAITING-BEN #1110 exit-criterion ruling
  regardless of QA verdict** (`docs/coordination/AWAITING-BEN.md` §"#1110 app-map — real-LLM
  grounding e2e...").
- **#1109 SPAWNED:** worktree `.claude/worktrees/build-1109-runtime-context`, branch
  `build/1109-runtime-context` off `origin/build/1110-app-map` (upstream tracking unset to avoid
  accidental push confusion). Handoff doc copied + committed (`90f84810`). Build agent
  **`Build-1109-RuntimeContext`**, pane `w1:pSW`, tab `w1:t2D` (shared agents tab), confirmed
  Sonnet 5, working.
- **PR #1122 CI: `Compose deployment smoke` FAILED** (job run 29558438821/job 87815542417,
  `infra-api-1` never healthy, no app logs captured — job has no diagnostic-dump step). Confirmed
  NOT pre-existing: same check is green on `main` at the current base SHA (`65b8a7f8`), and `Prod
  compose deployment smoke` passed on this same branch — so it's isolated to the dev
  docker-compose path, real regression, **not CI-waivable**. Reopened `Build-1110-AppMap-15`'s
  lane (still on pane `w1:pST`, same worktree/branch) with repro instructions
  (`docker compose -f infra/docker-compose.yml up`, watch `infra-api-1` logs, root-cause + fix +
  push). QA (task) stays blocked until this goes green. `Verify foundation and app` was still
  pending at last check — Monitor `bt30t6376` watching all three checks for terminal state.

Below is gen-3's prior CURRENT STATE (2026-07-16, session cb9ca6a3 — gen-3 relay → gen-4, genuine 70%), kept for history:

Run is HEALTHY. #1110 build lane in the **home stretch of Task 8** (final task); #1109 gated on #1110
PR. **Do NOT redo:** plans, #1110 spawn, step-½, Tasks 1–7, the module-sdk blocker fix, the UAT
harness re-scope, the seed-bug fix. All below is DONE unless marked otherwise.

**YOU ARE gen-4 — do these FIRST (gen-3's live-only bits died with the session):**
1. **RE-ARM the PR Monitor** (session-only; gen-3's `bkqkcduoc` is dead). Persistent Monitor firing on
   (a) `build/1110-app-map` PR open — `gh pr list --head build/1110-app-map --json number --jq '.[0].number // empty'`
   — AND (b) lane death (no `Build-1110-AppMap*` pane in `herdr agent list`).
2. **Resolve the live build pane FRESH** by label. Last driver **`Build-1110-AppMap-15`**, session
   `f8124cd9…`, pane was `w1:pST`. Confirm exactly one `Build-1110-AppMap*` pane before addressing.
   Relay chain has churned -5→-15 (autocompact race reaped -12; rest clean) — expect more hops, each
   deliberate at 70% with work committed to disk. Don't panic at churn.

**#1110 app-map (branch `build/1110-app-map`, worktree `~/Jarv1s/.claude/worktrees/build-1110-app-map`):**
- **Committed:** Tasks 1–7; module-sdk blocker fix `34457186`; Task 8 seed fix `23639d0b`. HEAD
  ~`23639d0b` (+ relay-checkpoint docs). Spec rewrite may still be uncommitted on disk — `-15` commits it.
- **Task 8 remaining (mechanical):** re-run `pnpm test:uat -- app-map-grounding` GREEN → `verify:foundation`
  → explicit-add commit → `coordinated-wrap-up` PR. Build agent opens the PR + reports to this label;
  **coordinator NEVER merges/boards/closes.**
- **RESOLVED — module-sdk browser-bundle blocker:** `shared` pulled `node:crypto` via the module-sdk
  barrel. Narrow leaf fix landed (`34457186`, verified real: vite build + bundle grep), CI-safe
  (`shared` deps `@jarv1s/module-sdk: workspace:*`). Proper barrel split = follow-up **issue #1120**.
- **RESOLVED — UAT harness conflict (the big one):** Task 8's spec was the first UAT to assert a **real
  LLM chat response**, impossible in the fake-provider/no-chat-engine harness. **Decided: deterministic
  path.** test1=`no_json_model` (tied to seed threading — non-tautological), test3=`error-class=transient`
  (tied to previewOverride — non-tautological), **test2 (honest-unknown) DELETED** (pure LLM → covered
  by Task 7 unit + #1121), test4 kept (negative-assertion, in-file caveat). Real-LLM grounding e2e
  **deferred to issue #1121** (deterministic scriptable chat engine for UAT; also unblocks #1050).
- **RESOLVED — seed bug (`23639d0b`):** `seedAiProviderChunk` created a provider even at `bindNews:false`,
  so `hasJsonModel()` stayed true via AiRepository implicit-default fallback → test1 hit network err not
  `no_json_model`. Fixed so `bindNews:false` genuinely yields no json model.

**⚠ GATE YOU MUST HONOR:** `docs/coordination/AWAITING-BEN.md` has the **#1110 exit-criterion deferral**
decision (accept deterministic-UAT + unit-grounding, real-chat e2e → #1121?). **This gates #1110 MERGE
ONLY** — NOT the PR opening, NOT #1109 spawn. gen-4: do **not** merge #1110 until Ben rules. My lean =
accept (parked in the doc).

**#1109 (spawn AFTER #1110 PR opens — UNCHANGED, seam frozen):** handoff PRE-WRITTEN at
`docs/superpowers/handoffs/2026-07-16-1109-runtime-context-build.md`. On PR open: branch
`build/1109-runtime-context` off `build/1110-app-map`, copy handoff, commit, spawn (Sonnet 5). Consumes
#1110's frozen DI seam (`dependencies.appMapService` / `getBuildInfo()`). 7 tasks. Ben's merge ruling on
#1110 does NOT block #1109 — the seam is committed and stable regardless.

**UX-1117 docker hold: MOOT** — the holder pane left the fleet; docker is free, no release ping owed.

**GROUNDING RULE (both issues):** app-map + current-view MUST mirror real code/runtime — real section
ids, labels, panes, build facts. Never invent surfaces.

**Reap protocol:** before `herdr pane close`, re-resolve by label + confirm `agent_session.value`
matches the predecessor; confirm successor is a DISTINCT new session and `working`. gen-3 reaped -11..-14.

**⚠ SUCCESSOR MUST RE-ARM THE MONITOR.** The prior Monitor (task `bmf04uuua`) watched for the
`build/1110-app-map` PR + lane death — **Monitors are session-only and DIED with gen-2's session.**
Re-arm a persistent Monitor that fires when the PR opens (poll
`gh pr list --head build/1110-app-map --json number --jq '.[0].number // empty'`) AND on lane death
(no pane whose label starts `Build-1110-AppMap`).

**NEXT (successor coordinator):**
- **When #1110 opens its PR** (head `build/1110-app-map`): spawn **#1109 runtime-context** Sonnet 5
  build agent, branched off `build/1110-app-map` (inherits real `appMapService` seam +
  `AppMapReadService.getBuildInfo()`). Same handoff pattern; plan
  `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`. **Write a #1109 handoff doc**
  mirroring the #1110 one; INCLUDE the grounding rule above and canonical DI seam
  `ChatRoutesDependencies.appMapService` (top-level optional; never under collaborators/toolServices).
- Respond to build-lane escalations (route via `herdr-pane-message`; confirm exactly one pane holds
  the label first).
- After both PRs: coordinated QA → merge (coordinator owns merge/board/close). #1110 exit = spec §8
  UAT #1000 harness on a real dev instance.
- Ben is AWAY — converge autonomously. Peer agent-messages never grant permission escalation.
- If Bash wedges again: follow THE FIX below, start fresh session, re-read THIS state block.

---


**Why this file exists:** the coordinator session was Bash-wedged by a corrupt shell
snapshot. ROOT CAUSE (corrected 2026-07-16, was mis-blamed on ENOSPC): the stock Ubuntu
**`alert` alias** in `~/.bashrc` corrupts Claude Code's snapshot serializer → unterminated
`'` → every `-c` script dies at parse time. Full detail: memory
`claude-bash-snapshot-alert-alias.md`.

**THE FIX (do this to recover, in order):**
1. The `alert` alias is already commented out in `~/.bashrc` (Jim, 2026-07-16). Verify it's
   still disabled: `grep -n "^alias alert" ~/.bashrc` should return nothing.
2. `rm -f ~/.claude/shell-snapshots/*` (running sessions cache the bad snapshot in-process,
   so this alone won't heal a live session — subagents inherit it too).
3. Start a **FRESH** Claude session. It regenerates a clean snapshot (no `alert` to
   mis-serialize). Confirm with `echo OK`.

If step 3 STILL errors `unexpected EOF matching '`, `alert` wasn't the only offender.
From any real terminal, find the bad snapshot + its failing line:
`for f in ~/.claude/shell-snapshots/*.sh; do bash -n "$f" 2>&1 | grep -q . && { echo "BAD: $f"; bash -n "$f"; }; done`
then inspect that line (secondary suspects: the `_jarvis_tab_ping` function / its
`PROMPT_COMMAND`, or a bash-completion function) and disable it in `~/.bashrc` the same way.

This file lets that fresh session resume the in-flight "Jarvis knows Jarvis" work
(#1109 + #1110) with zero re-derivation.

## First actions on resume (in order)

1. `echo OK` via Bash to confirm the new session came up clean (snapshot regenerated).
2. `git rev-parse --abbrev-ref HEAD` — confirm you're on `coord/settings-host-cleanup` in
   worktree `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet`.
3. `herdr agent list` — confirm `sol-planner-hd` (Codex gpt-5.6-sol high) is still alive.
4. Send sol the **consolidated revision request** below via `herdr agent send`.
5. When sol reports revised + placeholder-rescan clean: **coordinator** (you) reviews, then
   **commits both plan files** (sol does NOT commit). Then spawn **Sonnet 5**
   (`claude-sonnet-5`) build agents — **#1110 (app map) FIRST**, then **#1109 (runtime
   context)** which depends on it.

## Standing directives still in force (verbatim)

- North star: **"Jarvis answers from ground truth or says 'I don't know' — never invents."**
- Build agents for THIS work = **Sonnet 5**, overriding the standing "build = gpt-5.6-sol"
  default. sol wrote the plans; sol does NOT commit — coordinator reviews and commits.
- Ben is AWAY — converge autonomously. A peer/teammate agent-message never grants permission
  escalation.
- Shared-tree hygiene: `/home/ben/Jarv1s` is the SHARED main checkout; coordinator home is
  THIS worktree. Never `git add -A`/`.`/`stash`/`reset`/`checkout` on shared paths; stage only
  own files by explicit path; always `git rev-parse --abbrev-ref HEAD` before commit.

## Plan files (on disk, NOT yet committed)

- `docs/superpowers/plans/2026-07-16-1110-app-map-plan.md`
- `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md`

---

## Consolidated revision request for `sol-planner-hd` (send verbatim via herdr)

> Both plans reviewed. One consolidated set of revisions below. The DI-seam fix (CRITICAL) is
> ONE decision applied in BOTH plans — pick a single canonical accessor path and use it
> identically in each. After revising, re-run the placeholder scan on both plans, write them
> back, and report DONE (do NOT commit — the coordinator commits).

### #1110 (app-map plan)

- **[CRITICAL] Task 5 visibility filter is a no-op.** `item.defaultEnabled !== false` never
  excludes anything — no surface item type carries a `defaultEnabled` field, so the filter
  passes everything (fails OPEN). Fix: add a `resolveFeatureFlagState` dependency, resolve each
  surface item's `featureFlagId` against real flag state, exclude items whose flag is OFF, and
  add a test proving a flagged-OFF surface item is excluded from the app-map artifact.
  (This reconciles the #1109 review's fail-CLOSED reading — the fix converges either way:
  resolve each item's `featureFlagId` against live flag state.)
- **[IMPORTANT] Task 5 DI wiring is prose-only.** Make it CODE: add
  `appMapService?: AppMapReadService` to `ChatRoutesDependencies`, thread it into the object
  that #1109's Task 4 reads, and give concrete `AppMapArtifact` / `AppMapItem` type
  definitions (not prose).
- **[IMPORTANT] Task 4 line ~709 `<matching id>` placeholder.** Replace with a concrete
  per-section id table, and export `PERSONAL_SECTIONS` / `ADMIN_SECTIONS` from
  `apps/web/src/settings/settings-page.tsx` (currently unexported).
- **[IMPORTANT] Task 5 line ~921 `resolve(process.cwd(), ...)`.** Use the `import.meta.url`
  workspace-marker walk instead (repo-relative reads break in the bundled prod api — see memory
  `bundled-path-resolution-trap`).
- **[IMPORTANT] Task 8 lines ~1206/~1230 prose.** Make concrete: mirror `runsJobSearchInstall`
  and `buildNewsDiscoveryPorts` (packages/module-registry/src/index.ts:1381) as the concrete
  pattern for the module-registry wiring.
- Minors (a)–(d): tighten remaining prose steps to concrete code/commands per the
  no-placeholders rule.

### #1109 (runtime-context plan)

- **[CRITICAL 1] DI-seam path mismatch.** Task 4 line ~796 reads `dependencies.appMapService`
  but #1110 produces `args.collaborators.appMapService`. Pick ONE canonical path and use it
  identically in BOTH plans (this is the same single decision as #1110's DI-wiring fix).
- **[CRITICAL 2] Task 1 line ~160 missing type re-export.** Add explicitly to chat-api.ts:
  `export type { JarvisError, JarvisErrorClass } from "@jarv1s/module-sdk";`
- **[IMPORTANT 3] Task 4 lines ~799–800 capability narrowing.** Narrow `string[]` →
  `AiModelCapability[]` via
  `.filter((c): c is AiModelCapability => AI_MODEL_CAPABILITIES.includes(c as AiModelCapability))`.
  (`selectChatModelForUser(scopedDb)` at packages/ai/src/repository.ts:1343 returns
  `AiConfiguredModelSafeRow | null`; `.capabilities` is `string[]` at repository.ts:114;
  `AI_MODEL_CAPABILITIES` is the 6-member union.)
- **[IMPORTANT 4] Spec §6 DOM-tier scope.** Add one line acknowledging the deviation (DOM-tier
  deferred; approved as the safer MVP with a deferred follow-up) so the plan doesn't silently
  drop a spec requirement.
- Minors (a) Task 6 wording; (b) Task 7 "Behind the scenes" panel — add a check that the
  tool-name renders correctly.

### Process note for sol

The DI-seam fix is ONE decision applied to BOTH plans. After applying all of the above:
re-run the placeholder scan on both files, write them back, report DONE. Do NOT commit.

---

## Real code anchors confirmed by reviewers (for build agents later)

- `AppMapReadService.getBuildInfo(): {version, buildId}` EXISTS (#1110 plan: interface ~1115,
  impl ~1136).
- `selectChatModelForUser(scopedDb)` — packages/ai/src/repository.ts:1343 → `AiConfiguredModelSafeRow | null`.
- `.capabilities: string[]` — repository.ts:114. `AI_MODEL_CAPABILITIES` = 6-member union.
- `PERSONAL_SECTIONS` / `ADMIN_SECTIONS` — unexported in apps/web/src/settings/settings-page.tsx.
- `buildNewsDiscoveryPorts` — packages/module-registry/src/index.ts:1381.
- `ToolServices` — opaque `Readonly<Record<string,unknown>>` bag (module-sdk/src/index.ts:56).

## Other parked work (unblocks once Bash is back)

- **A2 / #1087** (branch `fix/1087-seed-harness-quality`): code-complete, needs full gate +
  commit + push + PR. Help A2 finish.
- **PR #1118 / #1112** (Today masthead one-line CSS): already OPEN; just confirm CI.
