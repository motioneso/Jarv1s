# ⏳ Awaiting Ben — decision parking lot

Coordinator holding pen for decisions that need Ben's call. **Rule:** anything that needs Ben goes
here the moment it arises (not buried in a digest), stays until he rules, and the Coordinator
**leads every status report with this list while it's non-empty.** Cleared items drop to the log
at the bottom.

Lock: Coordinator session `eb173f3a-c671-40c7-9bd2-78cbec597433` (job-search-overnight run;
predecessor `09cda409` reaped 2026-07-14).

## Open

- **Cross-coordinator UAT request declined 2026-07-14 (informational, not blocking).** UX
  Coordinator (`019f6186`) asked this coordinator to run desktop+narrow UAT and post evidence on
  its own PR #1058 (#987, exact-head `d0344d21c78918f945a48c9373e108e286934ffb`). Declined — that
  would mean this coordinator touching UX's PR/worktree, which is exactly what the
  dual-coordinator boundary in CLAUDE.md prohibits. Pointed UX Coordinator at its own
  `coordinated-qa` lane instead. Flagging in case there's a real capability gap on UX's side (e.g.
  no display/browser access) that needs a deliberate call from Ben rather than routing execution
  through a sibling coordinator — not urgent, no action needed unless it recurs.

- **#1050 external live-proof BLOCKED** — see full item below. **2026-07-14 chat update:** Ben's
  lean is **Option A** (wire real CLI auth into the UAT container), using **his own personal CLI
  credentials** (he is the builder — no separate service/test account). Ben explicitly asked to
  **keep this open and revisit in more detail when he has time** — no build authorized yet. Do NOT
  spawn a build lane on this until Ben re-opens the conversation. Draft mechanism discussed
  (unwritten, not yet spec'd): opt-in `UAT_CLI_LIVE=1` flag (never default), read-only bind-mount of
  Ben's CLI auth state (nothing baked into the image, nothing surviving `down -v`), `extra_hosts`
  network path to the host headroom proxy `:8787`, sandbox-bypass flag for the in-container CLI
  call (per `codex-sandbox-workaround`), redact auth material from `run.log`. Still needs: a written
  spec (CLAUDE.md "spec before build" gate — this is credential-handling infra) + a decision on
  whether it's harness-level standing capability (any future CLI-dependent UAT run can opt in) vs.
  scoped strictly to unblocking #1050.

## Cleared (log)

- **#1040 / PR #1051** dev/UAT seed logs owner/admin creds — **CLEARED 2026-07-14.** Ben signed off
  ("i sign off on 1040") + clarified the standing sign-off model: **Opus adversarial security QA →
  Fable cross-model review, both GREEN = the sign-off** (per #982/#984 precedent) — coordinator
  merges on council-green + digests Ben; no separate manual gate unless the council splits/flags.
  MERGED squash `313c194c`; #1040 closed; worktree/lane reaped; monitor stopped. Test-placement
  follow-up (move `admin.test.ts` DB-free fence describe to `tests/unit`) filed on #1034.
  **Epic #1000 NOT auto-closed** — 4 children still open (#1030 multi-user seed tier [task], #1034
  non-blocking QA follow-ups, #1042 install-noop bug [UX], #1047 harness spec-filter gap); left for
  Ben's roadmap call on whether to close core-complete or hold.

- **#984 / PR #1015** private-history — Raised 2026-07-13 (resume-vs-defer + merge sign-off).
  Ben ruled **resume** ("do those things yes please") and then **delegated the merge decision to
  Opus** (2026-07-13): Opus's adversarial security re-QA verdict IS the sign-off — auto-merge on
  Opus APPROVE, back to the lane on any blocker. No Ben gate for this PR.

---
## #1050 external live-proof BLOCKED — needs box-infra/credential decision (owner: Ben)
**Filed:** 2026-07-14 by primary Coordinator (routed from UX Coordinator session 019f5fc7).
**Status:** PR #1050 draft/unmerged. NO product edit or retry authorized.

**What passed** (head `8a976ecd`, image `:live-1050-8a976ecd`): Assistant authored/guided mode +
the corrected **Discard** assertion PASS (typed unsaved persona draft → exact `Discard` restored the
saved server snapshot). The app/UI leg is proven.

**What's blocked:** `POST /api/me/persona/preview` → HTTP **503 in 13.2 ms** (`req-x0`, fast-fail).
Root cause is NOT product code: the persona-preview port (`packages/settings/src/persona-routes.ts:99`)
routes to the per-user **CLI engine**, which inside the ephemeral prod-shaped UAT container has **no
authenticated external-CLI (Codex) path**. Harness has ZERO CLI-cred wiring (no `auth.json`/proxy/
sandbox plumbing in `tests/uat` or compose). A copied `auth.json` + provider row are insufficient
because Codex CLI needs: (1) the CLI binary present, (2) real account-auth state — not just auth.json,
(3) sandbox bypass (bwrap loopback `RTM_NEWADDR` fails in-container — see codex-sandbox-workaround),
(4) network path to the model (host headroom proxy :8787 is Ben's box infra, not reachable/wired
into the container).

**Why this is a Ben gate (not autonomous):** improvising host-CLI account credentials into an
ephemeral container is credential-handling (CLAUDE.md "Secrets never escape", security-tier) + box
infra (headroom proxy) + a harness-design call. Outside my build-lane autonomy.

**Decision needed — pick the plumbing model for external-CLI live-proof:**
  A. **Wire real CLI auth into the UAT container** — mount/inject Codex account auth + reach the
     host headroom proxy :8787 + sandbox-bypass the in-container CLI. Highest fidelity; credential-
     handling risk; needs Ben to authorize how creds cross the boundary.
  B. **Split the proof boundary** — container proves the app/UI leg (already PASS); the CLI-transport
     leg is proven separately host-side (where Codex CLI is already authed) as a documented exit
     criterion. Cheapest; accepts a seam.
  C. **Stub the provider boundary in UAT** — a fake persona-preview port returning a canned reply so
     the container proves wiring end-to-end without real external auth. Loses "real authenticated"
     fidelity the #1050 exit criterion asked for.
**Coordinator lean:** B (host-side CLI leg + container app leg) unless Ben wants full in-container
fidelity — A is real box-infra + credential work, not an overnight build task.

---

## #1110 app-map — real-LLM grounding e2e can't meet the #1000 hard-gate in current UAT (2026-07-16, `Coord-1109-1110-g3`)

**Same root gap as the #1050 entry above.** Building #1110 Task 8, `app-map-grounding.uat.spec.ts`
became the first UAT to assert a **real LLM-generated chat response** (grounded phrases). Verified
against source: UAT provider is fake-by-design (`{cli:true}`, #1025), seed binds only `module.news`
(no `purpose='assistant'` binding), and the UAT image ships **no CLI chat engine**. So Jarvis
answering an app-map question in a live chat turn is **not e2e-provable** in this harness without
milestone-scope infra.

**What I directed (build-lane autonomy) — deterministic ship, no scope blowout:**
- #1110 ships with a **deterministic** #1000 UAT: news prerequisite error-code + previewOverride
  deep-link href + non-admin no-leak (test4 already PASSES).
- Grounding persona/strings stay proven at **unit** level (`chat-runtime-persona.test.ts`, Task 7).
- The 3 real-LLM grounded-phrase assertions are **deferred to issue #1121** (deterministic
  scriptable chat engine for UAT — the general fix that also unblocks #1050's leg and future chat
  e2e).

**Your call (gates merge — I will NOT merge #1110 until you rule):** is deterministic-UAT +
unit-grounding acceptable as #1110's exit criterion, with real-chat e2e deferred to #1121? Or do you
want #1121's harness built **before** #1110 merges? **Coordinator lean:** accept the deferral —
#1121 is the right long-term fix and shouldn't block #1110/#1109; the feature code is fully covered
at unit+integration level and the deterministic UAT proves the prerequisite surfaces on a real
instance.

**✅ RESOLVED 2026-07-17 (Fable, delegated per Ben's "escalate to fable, no blockers on me")** —
[issue #1110 comment 5000410700](https://github.com/motioneso/Jarv1s/issues/1110#issuecomment-5000410700).
Deferral **approved**, single-use, does not extend to #1109. **Added condition:** merge also needs a
manual live-path walk on a dev instance (all 3 spec §8 scenarios) with transcripts/screenshots
posted to PR #1122 before merge — not yet done, queued after the #1122 CI blocker below clears.
Backlink posted to #1121 (`issuecomment-5000430204`) listing the 3 deferred grounded-phrase
assertions.

---

## #1122 CI — 'Verify foundation and app' stop-the-line, 2nd failure (2026-07-17, `Coord-1109-1110-g6`)

**Independent, additional blocker on PR #1122** (separate from the exit-criterion question above).
VF has now failed **twice** on this PR — tripping the coordinate skill's twice-failing
stop-the-line rule. 1st failure was a real module-sdk-barrel regression (root-caused, fixed,
verified 3/3). This 2nd failure is a **different failure mode**: the job hit the 25-minute CI
timeout mid-`test:integration`, vs. 19m29s for the whole job (incl. Build web + Playwright) on the
last known-green `main` run — a ~30%+ slowdown, not marginal. Full detail + run links:
**GitHub issue #1123**.

**UPDATE (2026-07-17, `Coord-1109-1110-g7`) — 3rd failure, same signature, needs your call now.**
-15's diagnosis (2nd failure) was environmental/CI-Postgres-contention, not the errors.ts diff
(type-only change, can't cause a runtime DB hang; same commit ran 156/156 clean locally). Gen-6
authorized one re-run to test that hypothesis (`gh run rerun 29560460812 --failed`, no code push).
**That re-run just failed a 3rd time — 25m27s, same hard timeout, same exact failing files
(`multi-user-isolation`, `account-self-deletion`, `auth-bootstrap-recovery`), same ~10.9s
per-test hang signature.** Full comparison in issue #1123.

This is the *same* environmental signature recurring, which strengthens (not weakens) the
"CI Postgres-container contention under runner load" theory — but per the stop-the-line waiver
protocol, a check failing 3 times on a clean re-run with no code change is past what the
coordinator loop can resolve by retrying. **No further re-run has been or will be attempted
without your input.**

**Your call:** this looks like a CI infrastructure health issue (shared Postgres service
container under-provisioned for concurrent DB/auth-heavy integration suites), not a defect in
PR #1122's code. Options: (a) try a fresh/different runner, (b) investigate CI Postgres
service resourcing, (c) something else you'd want done. `-15` is holding idle on the branch
with no pending code changes — not touching anything further until you weigh in. Merge stays
blocked on the exit-criterion ruling above regardless of how this resolves.

**✅ RESOLVED 2026-07-17 (Fable, delegated per Ben's "escalate to fable, no blockers on me")** —
[issue #1123 comment 5000410449](https://github.com/motioneso/Jarv1s/issues/1123#issuecomment-5000410449),
independently corroborated by a second Fable pass (agent `afe4e45afd7a0cf85`). **No waiver**
(main is green — the failure isn't reproducible as a pre-existing condition), **no more blind
reruns**, **no CI-Postgres re-provisioning yet** (unconfirmed theory, and counter-evidence: it's a
per-job container, and `fix/1112` ran the identical job green the same morning). **Authorized ONE
action**, already relayed to `-15`: local CI-conditioned repro under ~2vCPU + fresh CI-default
pgvector Postgres, run on branch head `874759ec` AND `origin/main`, `pg_stat_activity`-instrumented,
naming the exact resource the constant ~10.9s per-test hang maps to. Branch-only repro → real
defect, `-15` fixes+pushes once. Repros on `main` too → separate CI-infra task, no #1122 code
touch. Awaiting `-15`'s verdict (posts to #1123, pings coordinator label).

**UPDATE 2026-07-17 (`Coord-1109-1110-g8`) — repro done, verdict = CI-infra fragility, confirmed
zero #1122 code cause.** [issue #1123 comment 5000739946](https://github.com/motioneso/Jarv1s/issues/1123#issuecomment-5000739946):
matched-CI repro (2vCPU taskset, fresh pgvector Postgres, CI defaults) ran the failing trio CLEAN
(27/27, ~69s) on **both** branch head `874759ec` and `origin/main` — no hang, no lock contention.
Named cause: pg-boss's own hardcoded `connectionTimeoutMillis` default (10000ms,
`node_modules/pg-boss/dist/db.js`), never overridden by `packages/jobs/src/pg-boss.ts`; the 3
failing test files instantiate a server with no `boss` override
(`apps/api/src/server.ts:195`), so each spins a real pg-boss PG client subject to that 10s
ceiling — plausible to trip under real GH-runner contention, not reproducible on an uncontended
local box. `git diff origin/main` on pg-boss.ts/server.ts/all 3 trio files = **empty** — 100%
pre-existing, zero relation to #1122's diff. Separate CI-infra issue **#1124** filed. `-15` did
NOT touch #1122 code, did not merge/board — held per instruction.

**Next-step decision routed to a fresh Fable one-shot** (re-run now vs. require #1124 fixed first
vs. a scoped test-only timeout/boss-override fix ahead of #1122) — awaiting that ruling before
any further CI action on #1122. Will record the ruling here once it lands.

**RULING (2026-07-17, Fable, [issue #1123 comment 5000769797](https://github.com/motioneso/Jarv1s/issues/1123#issuecomment-5000769797)):
path (c) — narrow test-scoped mitigation, not a blind re-run, not gated on the full #1124
redesign.** Reasoning: 3/3 identical failures is a constant not noise, plus a same-morning clean
VF on another branch — a bare re-run of the unchanged head is a lucky-runner bet; the durable
#1124 policy question shouldn't gate #1122, only the narrow mechanism needs removing.

**Conditions (enforced by coordinator):**
1. Tiny PR under #1124 ("Part of #1124"): `boss` override or test-path-only
   `connectionTimeoutMillis` raise in the 3 trio test files only. Zero production-runtime
   changes. Full local gate + normal (routine-tier) QA. No new spec required — evidence-backed
   bugfix under an existing issue. If scope creeps past test-config, halt and report.
2. After merge to main: merge main into #1122's branch (`build/1110-app-map`) — do NOT rerun the
   stale head — then fresh VF.
3. **Hard stop:** same ~10.9s trio signature recurs on #1122 after the fix is in its head → full
   halt, escalate to Ben, no further attempts.
4. #1122 merge still separately gated on the deferred #1110 live-path walk evidence. #1124 stays
   open for any durable policy fix. Never merge with red required checks.

**Action taken:** tasked `Build-1110-AppMap-15` (owns #1122's branch, has full root-cause
context) with the fix in a fresh worktree off main (`fix/1124-pgboss-test-timeout`), separate
from the #1122 branch. Fix landed as PR #1125 (merged), then merged into #1122's branch
(`build/1110-app-map` @ `552308d7`) per condition 2 above.

**🛑 4th VF FAILURE — HARD STOP HIT, ESCALATING TO YOU DIRECTLY (2026-07-17, `Coord-1109-1110-g8`).**
Fresh VF on the post-fix head (`552308d7`) failed again: run `29569935763`, job `87851069365`,
25m26s. This trips Fable's own condition 3 verbatim — per that ruling, this now goes to **you**,
not another Fable pass, and **no further re-runs**.

Pulled the failure log directly (`gh run view 29569935763 --job 87851069365 --log`). Two things
worth flagging:
- **It's not just the original 3 files anymore.** Failures now span at least 6 integration
  suites: `multi-user-isolation` (14/15 failed), `auth-settings` (13/23), `account-self-deletion`
  (8/8), `news-personalization-repository` (10/15), `auth-bootstrap-recovery` (5/5), and one
  failure in `release-hardening` (1/19) — well beyond the trio #1125 patched.
- **But the per-test timing is the same ~10-11s ceiling as before** (e.g. `multi-user-isolation`
  failures logged at 11205ms/11074ms) — so this isn't a new failure mode, it's the *same*
  10s-class timeout hitting far more surface area than originally scoped. Read together with
  #1124's root cause (pg-boss's hardcoded 10000ms `connectionTimeoutMillis`, uncorrected because
  no `boss` override is passed into `createApiServer`): it looks like more integration test files
  than just the original 3 construct a real pg-boss client with no override, and this run's
  GH-runner load pushed enough of them over the ceiling to cascade. #1125's fix was scoped to
  the 3 files that failed in the first 3 runs — evidently too narrow.

No `ECONNREFUSED`/pool-exhaustion/`EADDRINUSE` signature found (checked). One `HttpError:
Unauthorized` line in the log is an intentional negative-path assertion in
`data-export.test.ts` ("requires authentication"), not a real failure — ignore it, it's noise.

**Not treating this as solved or re-attempting anything.** `-15` is holding on
`build/1110-app-map`, no further pushes, no further re-runs, per Fable's condition 3 and your
standing "no blockers on me but the named hard-stop still means Ben" framing. `Build-1109-RuntimeContext-8`
is a separate, unaffected lane.

**Your call, options as I see them (not deciding for you):**
(a) Widen #1124's fix to every integration test file that omits a `boss` override (audit via
`grep -rL "createPgBossClient" tests/integration/*.test.ts` cross-referenced against ones that
call `createApiServer` directly) rather than the original 3 — durable fix, more surface to touch.
(b) Raise pg-boss's real default `connectionTimeoutMillis` for CI specifically (env-gated), which
fixes it for every current and future test file at once but changes runtime behavior more broadly
than "test-scoped."
(c) Treat this as confirmation the shared CI Postgres/runner is under-provisioned for this test
suite's current size regardless of the pg-boss angle, and address runner sizing instead of test
code.
(d) Something else.

#1122 stays fully blocked (VF red, plus the still-open #1110 live-path exit-criterion question
above) until you weigh in — no further coordinator action on this lane.

**UPDATE 2026-07-17 (`Coord-1109-1110-g12`) — proceeding under Ben's explicit "complete and merge
#1122" instruction, extending Fable's already-approved fix pattern rather than re-litigating the
fork.** Ben directed the coordinator to drive #1118/#1122/#1126 to merge without further per-fork
sign-off. Rather than picking cold among options (a)/(b)/(c)/(d) above, applying the *same*
reasoning Fable already used for this exact lane (issue #1123 comment 5000769797: narrow,
test-scoped, root-cause-consistent fix over a blind rerun or an unconfirmed infra-sizing bet) to
the now-confirmed wider scope. Chosen path = **(a) widened**, i.e. the direct extension of the
already-merged #1125 fix: audit every integration test file that instantiates `createApiServer`
without a `boss`/pg-boss override (not just the original 3), apply the same test-scoped
`connectionTimeoutMillis` fix to all of them. Not (b) — a runtime-default bump is broader-blast
than a test-scoped fix and Fable's own ruling preferred the narrower option when both were on the
table. Not (c) — runner/Postgres sizing remains an unconfirmed theory with standing counter-evidence
(`fix/1112` ran the identical job green the same morning); no infra spend without a confirmed
signature after the widened fix is actually in place.

**Guardrail (unchanged from Fable's condition 3):** if the same ~10-11s signature recurs *after*
this widened fix lands in #1122's head, that is a genuine new signal (root-cause theory falsified)
and gets escalated to Ben directly — not another self-directed pass, not another Fable pass.
Tasked to `Build-1110-AppMap-15`, new PR "Part of #1124", zero production-runtime changes, full
local gate + routine-tier QA before merge to main, then main merged into `build/1110-app-map`
(never rerun the stale head) per condition 2, fresh VF.

## #1126 CI — 'Verify foundation' timing out 3x consecutively, needs your call (2026-07-17, `Coord-1109-1110-g12`)

**Separate lane from #1122 above — this is PR #1126, #1109's final task (7/7).** The `Verify
foundation and app` workflow's `Verify foundation` step has hit the job's 25-minute timeout cap
(`ci.yml:18`) **3 consecutive times** on `build/1109-runtime-context`:

| Run | SHA | Created (UTC) | Conclusion | Duration |
| --- | --- | --- | --- | --- |
| [29577885359](https://github.com/motioneso/Jarv1s/actions/runs/29577885359) | `a317cad0` | 2026-07-17 11:45:04Z | failure | 25m29s |
| [29579771831](https://github.com/motioneso/Jarv1s/actions/runs/29579771831) | `80ebb905` | 2026-07-17 12:18:31Z | cancelled (timeout) | 25m28s |
| [29582266459](https://github.com/motioneso/Jarv1s/actions/runs/29582266459) | `96239450` | 2026-07-17 12:59:36Z | cancelled (timeout) | 25m26s |

Each landed at ~24:39–24:45 elapsed — a hard ceiling miss every run, not one-off variance. This is
past the CLAUDE.md CI waiver protocol's "fails twice = stop-the-line" bar. Filed
[issue #1127](https://github.com/motioneso/Jarv1s/issues/1127) with full evidence.

**PR #1126 is otherwise fully green** — both compose smoke checks pass (`Compose deployment
smoke`, `Prod compose deployment smoke`), sensitive-tier QA already passed its 2nd cycle. This
timeout is the only remaining blocker.

**Root cause not yet fully proven.** Working hypothesis: branch runs ~25min+ vs `main`'s
~18-20min baseline, likely from #1109's added test volume across its 7 build tasks. The first
failure (`a317cad0`) was previously read as pre-existing/proportional-to-added-tests, not caused
by this PR's app-map fix specifically. Nobody has yet read the actual step log for a stuck/
looping test to rule out a real hang vs. accumulated legitimate runtime crossing the cap.

**Your call, options as I see them (not deciding for you):**
(a) Bump `ci.yml` `timeout-minutes` 25→35 as a documented stopgap — unblocks immediately, doesn't
resolve whether there's a real perf regression or hang underneath.
(b) Investigate further for a real hang/loop (read the actual step log, isolate which test(s)
account for the ~5-7min overage vs `main`) before touching the timeout — slower, but distinguishes
"needs more budget" from "something is actually stuck."

**✅ RESOLVED 2026-07-17 (Fable, delegated per Ben's standing overnight "route judgment calls to
Fable" policy — coordinator initially mis-escalated this straight to Ben, corrected)** —
[issue #1127 comment 5005410092](https://github.com/motioneso/Jarv1s/issues/1127#issuecomment-5005410092).

**Path (a) chosen, evidence-backed** — Fable pulled the actual VF step log itself (the gap
nobody had closed): no hang. Integration files complete green steadily until 9s before
cancellation. Measured delta: main's same-morning VF step = 14m02s (run `29569865167`); branch =
24m45s unfinished (run `29582266459` job `87890580965`, killed 13:24:51Z, last file green
13:24:42Z) — a ~+75% growth, consistent with #1109's added test volume across 7 tasks. Time sink
identified: multi-minute silent gaps between integration files (per-file setup/migration cost) —
named as a durable-fix lead for a follow-up, not a defect in #1126.

**Conditions (enforced by coordinator, relayed to `Build-1109-RuntimeContext-8`):**
1. One single-line commit on `build/1109-runtime-context`: `ci.yml` `timeout-minutes` 25→35, with
   a why-comment citing #1127. Nothing else in the diff.
2. One fresh VF run on the new head. Pass bar = mechanically green with a completed-suite
   summary; actual VF duration recorded as a PR #1126 comment.
3. No auto-merge (VF may not be a required check) — poll green, merge manually under normal
   gates.
4. #1127 stays open, re-scoped as a perf follow-up (attribute the ~11min growth, restore
   headroom) — does not block #1126.

**Hard stop:** if the single post-bump VF run does not complete green (timeout at 35 or any test
failure) → full halt, no reruns, no further `ci.yml` edits, escalate directly to Ben (not
another Fable pass). Secondary flag: green but VF step duration >~32min (near the new ceiling) →
merge proceeds, but coordinator notes the near-ceiling duration here for your awareness.

**Held per this ruling:** `Build-1109-RuntimeContext-8` (`w1:pT6`) — tasked with the one commit +
one VF run above, nothing further without hitting the hard stop.

**🛑 HARD STOP HIT (2026-07-17, `Coord-1109-1110-g12`) — escalating directly to you per condition
above, no further reruns, no further `ci.yml` edits.** Post-bump commit `e8defd69` (`ci.yml`
`timeout-minutes` 25→35, citing #1127) landed as instructed. Fresh VF run
[29597220968](https://github.com/motioneso/Jarv1s/actions/runs/29597220968), job `87940451041`:
started 16:42:38Z, completed 17:18:03Z = **35m25s, conclusion `cancelled`**. This is not the
"secondary flag" case (green-but-near-ceiling) — the job consumed the *entire* raised 35-minute
budget and still did not finish. Both compose-smoke checks stayed green; only `Verify foundation
and app` hit the wall again.

This falsifies the "known ~+75% growth, no hang, just needs headroom" read Fable's evidence was
based on (main same-morning baseline was 14m02s; a proportional +75% growth would land ~24-25min,
not exceed a 35min cap). Something is consuming meaningfully more than the previously-measured
delta, or genuinely hanging past where the first read stopped looking. Per the ruling's own hard
stop: **no further reruns, no further timeout edits, not routing to another Fable pass** — this is
your call now on the actual mechanism (real hang vs. much larger perf regression than measured).
`Build-1109-RuntimeContext-8` is holding on `build/1109-runtime-context` @ `e8defd69`, no further
pushes. #1122 (separate lane, see above) is unaffected and proceeding independently.
