# Job Search Overnight Run — 2026-07-09

**Coordinator lock:** label `Coordinator`, session `ff21f505-87fe-4818-97ea-53f16a7a741e`,
pane `w1:pCT`, tab `w1:t15`. (Same lock as `2026-07-09-next-wave.md` — that manifest's wave is
fully merged; this is a fresh manifest for the new overnight initiative per Ben's handoff.)

**Lock re-claimed 2026-07-09 (this checkpoint, self-relay from `395b82b5-...`):** predecessor
pane `w1:pCS` closed after successor pane `w1:pCT` confirmed sole `Coordinator`-labelled pane via
`herdr pane list`. Fleet unchanged: `w1:pCK` (Codex, idle), `w1:pCR` (Fable 5, idle).

**Lock re-claimed 2026-07-09 (this checkpoint):** predecessor session `c99d19d5-...` (pane
`w1:pCM`) had already self-closed by the time this successor adopted — verified via `herdr pane
list`, no other `Coordinator`-labelled pane exists, no explicit close action was needed. Live
fleet re-confirmed: `w1:pCK` (Codex: Job Search Spec, idle, tab `w1:t1F`) and `w1:pCR` (Fable 5:
Job Search Spec Review, working, tab `w1:t1F`, worktree `review-913-job-search-spec`) both still
present and unchanged.

## Ben's directive (verbatim intent)
Build everything needed for the Intelligent Job Search module tonight. Fable 5 ("Fable 5: Job
Search Spec Review") drafts/approves plans first. Adopt overnight fleet under single Coordinator
lock. **Do not spawn any build lane until its spec AND implementation plan are approved.**
Suggested order #917→#914→#918→#919→#915→#916 — **explicitly told to revalidate, not trust.**
Ready lanes → Codex `gpt-5.6-sol` high reasoning, isolated worktrees, then independent
security-tier QA + Ben sign-off where required.

**Mid-turn addendum (2026-07-09, this checkpoint):** Ben: "any approvals can be escalated to a
fresh gpt-5.5-sol extra-high and a fable 5 high. Not everything needs that, just the ones that
would surface to me." → For judgment calls that would otherwise need to page Ben (design forks,
readiness verdicts, tier calls), spin up a Codex `gpt-5.6-sol`-class agent at extra-high reasoning
+ a Fable 5 (Claude) agent at high effort as a two-model adjudication panel **instead of** paging
Ben — but only for calls that would actually have surfaced to him; routine mechanical stuff still
resolves inline, no escalation needed.

## Revalidation results (read-only recon, this checkpoint)

| Issue | Labels | Spec status (ground truth) | Plan status |
|---|---|---|---|
| #913 (epic) | epic | Drafted+"approve" commit in `/tmp/jarv1s-913-spec` (branch `spec/913-intelligent-job-search`) but **NOT merged to main** — no spec PR found via `gh pr list`. Spec file: `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md` (local to that worktree only). | Not found. Root-level `PLAN.md`/`PLAN-REVIEW-LOG.md` in that worktree are **stale leftovers from an unrelated prior Wellness-module task** — ignore, not the job-search plan. |
| #914 | task, RFA | **MERGED** — PR #920, `docs/superpowers/specs/2026-07-09-module-data-plane.md`, merged to main 2026-07-10T04:49:35Z. Spec is real and landed. | Not yet located — needs check for an implementation plan doc/PR. |
| #915 | task, needs-spec (GitHub label stale) | In progress in `review-913-job-search-spec` worktree: "revision 2 — incorporate adversarial review round" on top of "external worker capabilities — queues/schedules, structured-AI RPC, pinned fetch". **Not merged**, no spec PR yet. | Not found. |
| #916 | task, needs-spec | No spec activity found anywhere. | Not found. |
| #917 | task, RFA | **No spec PR, no spec commits found anywhere** — despite being first in Ben's relayed dependency order. | Not found. |
| #918 | task, RFA | No spec activity found. | Not found. |
| #919 | task, RFA | No spec activity found. | Not found. |

**Verdict: only #914 currently has a genuinely approved (merged-to-main) spec. None have an
approved implementation plan yet.** The relayed order #917→#914→... does not match actual
readiness — #917 (meant to be first) has no spec at all yet; #914 (meant to be second) is the
only one actually spec-complete. **Do not spawn any build lane yet.** This contradicts "approved
mapping" framing in the handoff — flag to Ben/Fable 5, don't silently reorder.

**Correction (2026-07-09, successor checkpoint, grounded via `gh`/`git`):** #917's spec gate IS
satisfied — it does not need a standalone spec PR. #917's issue body cites the already-approved
`docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md` (§Build slices —
Slice 1), merged to main via PR #911 (`90cc89d7`, "Approved — RFA after Opus + Fable adversarial
review + Ben approval", GitHub #818). Verified: file present on `origin/main`, #917 is
OPEN + labeled `task, RFA`, body explicitly scopes Slice 1 (external manifest loader,
fail-closed activation, `app.external_modules` migration) and states #917 is "the foundation for
epic #860 (delivers #913 platform prerequisite 1)". **Remaining gate for #917 is an approved
implementation plan only — no new spec needed.** No #917 plan found yet in main, the Fable
worktree, or any PR. Flagged by Codex (`w1:pCK`), independently re-verified by coordinator before
acting on it (grounding discipline). This directly feeds the Phase-0 collision map (dispatched
this checkpoint, pending) — #917 may need to lead the serialization order since it underlies
#860's prerequisite 1, which #913's epic depends on. Not yet reordering Fable's queue (it's
mid-#915) pending the collision map's full-picture verdict.

Epic #913 body confirms hard dependency: job-search module is blocked by / must target the
pluggable-module runtime in **epic #860** (see `[[pluggable-modules-epic]]` memory — migrations
coupling, install=privileged-ops, two-bundle runtime load, supply-chain signing, phases 0→3).
#914/#917/#918/#919 read as pieces of that #860 module-system runtime (module data plane,
privileged install, module system slices) — i.e. this "job search" overnight wave and epic #860
are the same collision surface. Collision map still needs a proper one-shot Opus pass before any
dispatch (Phase 0 step 3) — not yet done.

## Live fleet (job-search-relevant panes, from `herdr pane list` this checkpoint)
- `w1:pCK` "Codex: Job Search Spec" — codex agent, session `019f49ed-b7eb-7693-9460-0151efe99769`, idle, cwd `/home/ben/Jarv1s`.
- `w1:pCR` "Fable 5: Job Search Spec Review" — claude agent, session `d2661a6c-e15e-4e42-8b27-71c99bb70423`, working, cwd `.claude/worktrees/review-913-job-search-spec`.
- Not part of this task (do not touch): `w1:pCP` "Fable: sports-fed spec+plan", `w1:pCQ` "Fable: PR review 908/909/910" (worktree already deleted).

**Do-not-reap:** `/tmp/jarv1s-913-spec` (branch `spec/913-intelligent-job-search`) — Codex's draft
spec worktree, awaiting Ben approval. Exempt from any repo-hygiene sweep.

## Phase-0 collision map (Opus one-shot, completed 2026-07-09, this checkpoint)

Grounded on `origin/main`, latest global migration `0151` (next free `0152`).

| # | Spec status | Build status |
|---|---|---|
| #913 (epic) | Draft only, `ac9b5554` on branch, NOT on main, no PR | **NOT buildable** |
| #914 | **MERGED** PR #920 (`204aca0f`) | ready *after #917* |
| #915 | Draft rev2 `6019f94f`, NOT merged, no PR | NOT ready |
| #916 | No spec | NOT ready, dep #919 |
| **#917** | **Approved on main** — `2026-07-08-open-module-system-user-authored-modules.md` §Slice 1 | **READY TODAY (root)** — plan still needed |
| #918 | Approved on main (§Slice 2) | ready *after #917* |
| #919 | Approved on main (§Slice 3) | ready *after #918* |
| #860 (epic) | No standalone spec; delivered via #818 (approved) + #914 (merged) | epic OPEN, not itself blocking |

**Collision pairs:** #914/#917/#918/#915 each land ONE new global-sequence migration + edit the
same `foundation.test.ts` full-list `toEqual` — **cannot parallelize at all**, migration numbering
+ shared assertion forces strict serial landing regardless of logical independence. #919 adds no
migration (reuses `ai_assistant_action_requests`). #917/#918 share `packages/settings/sql/` +
module-registry manifest schema. #919/#916/#915 all wire through `AssistantToolGateway`.

**Forced serialization order (dependency-driven, NOT the relayed order):**
`#917 (root) → #914 → #918 → #919 → then #916, #915` (#915 also deps #917 loader + #919 RPC +
#914 `ctx.db`).

**#860 check:** has no standalone spec/plan but does NOT block the wave — legitimately delivered
through #818 (approved) + #914 (merged spec, which explicitly resolves migration-coupling blocker
via a namespaced external-module ledger, core/built-ins stay on the global sequence).

**Verdict: only #917 is buildable today** (root, RFA, approved spec, no unmet dependency) — but
still has **no implementation plan**, so per manifest rule (spec merged AND plan approved,
per-issue) **no build lane spawns yet**. #913's own epic spec remains unapproved/unmerged — the
epic itself is not buildable regardless of its children's readiness. #915/#916 lack merged specs.
Do not parallelize any migration-adder under any circumstance.

## Relay checkpoint (coordinator session `395b82b5-...`, context 70% warning fired)

**Ben's directive (this checkpoint, verbatim intent):** move plan-authoring to Opus xhigh,
running ALONGSIDE Fable 5 (not replacing it) — confirmed via AskUserQuestion: "Spawn a fresh Opus
xhigh agent alongside Fable 5."

**Done this checkpoint:**
- Isolated worktree created: `.claude/worktrees/917-implementation-plan`, branch
  `plan/917-open-module-system-slice1` off `origin/main` @ `204aca0f`.
- Handoff doc committed: `docs/coordination/handoffs/917-implementation-plan.md` (plan-authoring
  task for #917, tier `security`, invokes `superpowers:writing-plans`, reports back to
  Coordinator before any build spawns).
- Fable 5 (`w1:pCR`) hit a mid-stream API stall answering my status questions (#915/#913 state) —
  nudged once (memory: `agent-stall-nudge-recovery` — nudge before respawn), it went back to
  `working` then just flipped to **`idle`** (this checkpoint's Monitor event) — **its reply has
  NOT been read yet**, do that first.
- Codex (`w1:pCK`) fully briefed on collision map, idle, aligned (agreed to hold dispatch).
- Monitor task `bax84pxa9` (persistent, this session, watches `w1:pCR`+`w1:pCK` only) — dies with
  this session, successor should start its own.

**NOT done yet (successor's immediate queue, in order):**
1. **Spawn the Opus xhigh agent** — NOT yet spawned (relay fired right as the handoff doc landed).
   ```
   herdr agent start "Opus: #917 Plan" --tab w1:t1F --cwd /home/ben/Jarv1s/.claude/worktrees/917-implementation-plan --no-focus \
     -- claude --model opus --effort xhigh --permission-mode bypassPermissions \
     "STEP 1 pnpm install if needed. STEP 2 read docs/coordination/handoffs/917-implementation-plan.md IN FULL and follow it. Begin now."
   ```
   Put it in the same tab as Codex/Fable 5 (`w1:t1F`) per tab discipline. Verify pane says
   "Opus" after spawn (confirm reasoning-effort xhigh is active per the pane's status line, as
   seen on the Codex pane's `gpt-5.6-sol high` line — Claude panes may not show effort in the
   status line; if unclear, ask the agent to state its model+effort back to you).
2. **Read Fable 5's reply** (`herdr pane read w1:pCR --source recent --lines 20`) — it should
   finally answer: #915 spec-approval state, #913 PR-readiness, and whether it can pivot to help
   on #917 (now moot since Opus xhigh is taking #917 planning — tell Fable 5 to stay on #915,
   do NOT have both agents plan #917 redundantly).
3. Restart a persistent Monitor scoped to `w1:pCR`, `w1:pCK`, and the new Opus pane.
4. **Still do not spawn any build lane** — #917 plan is only just starting to be authored, not
   approved. #913 epic spec still unmerged. #915/#916 still no merged spec.

## Next actions for successor coordinator
1. Message `w1:pCR` (Fable 5) directly with this table — ask for its current verdict on #915's
   spec-approval state and whether #913's epic spec is ready to open as a PR against main.
2. Send a short status ping to `w1:pCK` (Codex) — keep it informed per Ben's instruction, ask
   status on #917 (first in the relayed order, currently spec-less).
3. Do the Phase-0 collision map (one-shot Opus subagent) cross-referencing #860's pluggable-module
   blockers against #914/#917/#918/#919.
4. For any readiness/tiering/design-fork judgment call that would otherwise page Ben: use the
   two-model panel (Codex gpt-5.6-sol extra-high + Fable 5/Claude high) per his mid-turn addendum
   above, reserving direct escalation to Ben for calls that genuinely need his sign-off (security
   tier merges, non-mechanical scope decisions).
5. **Still do not spawn any build lane** until spec-merged-to-main AND an approved plan exist for
   that specific issue. #914 is closest (spec merged) but has no plan yet — check with Fable 5
   whether one is in progress.
6. Once ready lanes exist: spawn via Codex `gpt-5.6-sol` high reasoning, isolated worktrees, then
   independent security-tier QA (likely tier for all of these — privileged install, module data
   plane, external-worker RPC/fetch all hit the security-tier triggers) + Ben sign-off.

## Relay note
This manifest was written at a 72%-context checkpoint immediately after completing the
revalidation above. No build lane has been spawned; no panes have been messaged yet. Coordinator
is about to self-relay (spawn successor in tab `w1:t15`, same pane) per the coordinate skill's
context-meter trigger.

## Checkpoint update (successor session `ff21f505-...`, immediate queue executed)
- Lock re-claimed: pane `w1:pCT` relabeled `Coordinator`, predecessor `w1:pCS` closed after
  confirming sole-Coordinator uniqueness via `herdr pane list`.
- **Opus xhigh spawned for #917 plan-authoring:** pane `w1:pCV`, tab `w1:t1F`, worktree
  `.claude/worktrees/917-implementation-plan`, confirmed running "Opus 4.8" (xhigh passed via
  argv, not visible in status line but confirmed via launch command). Working through
  `docs/coordination/handoffs/917-implementation-plan.md`.
- **Fable 5 (`w1:pCR`) reliability note (Ben, this checkpoint): Fable has been hitting repeated
  mid-stream API errors** — its reply to the #915/#913 status questions stalled twice before this
  checkpoint. Treat its output as possibly unreliable/delayed; nudge rather than hammer
  (`agent-stall-nudge-recovery` memory), don't respawn unless it actually dies. Redirected it to
  stay on #915 only (Opus xhigh now solely owns #917 planning — no redundant #917 work), asked it
  to answer #915 spec-approval state + #913 epic-PR readiness whenever stable, no rush.
- Monitor restarted: task `b90uanpka` (persistent, changes-only), scoped to `w1:pCR` + `w1:pCK` +
  `w1:pCV`. Predecessor's monitor `bax84pxa9` died with that session as expected.
- **Still holding — no build lane spawns** until #917's plan is authored by Opus xhigh AND
  approved (by coordinator per spec-lock-adherence, or escalated per Ben's two-model-panel
  addendum / to Ben directly for a genuine fork). #913 epic spec still unmerged; #915/#916 still
  lack merged specs.
