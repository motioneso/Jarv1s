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
