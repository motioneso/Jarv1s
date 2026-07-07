# Coordination Run — issue-queueing-pass-2026-07-07

**Date:** 2026-07-07
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id
`e56b7c36-6f1b-4438-85ef-bb5cad9eed74`** (pane `w1:p9S`, tab `w1:t15` at time of writing — resolve
fresh by label+session, never trust the pane number). Relayed from predecessor session
`9ba963a2-ae22-47b2-a8f2-2871b37a2f46` (pane `w1:p9Q`) at its 70% context checkpoint; predecessor
confirmed handoff, went `done`, and was reaped (pane closed) at run continuation. Exactly one
`Coordinator` pane confirmed via `herdr pane list` post-reap.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; `security`-tier needs
Ben's explicit merge sign-off.
**Relay threshold:** per coordinate skill. No deferral. Compaction summary = relay, merge nothing.
**merges_since_relay:** 0 (no builds spawned yet this tenure)

> Externalized memory for this run. GitHub is the source of truth for issue/spec status; this file
> holds only in-flight operational state.

## How this run started

Ben asked to review non-deferred GitHub issues, queue up what's ready, and unblock anything stuck
on a spec/design question. Full issue triage done against `gh issue list --state open` (see
commit history / this session's transcript for the full categorization) — main CI confirmed green
(`gh run list --branch main --limit 3`, all `success`) before any spawn.

**Decisions Ben made this session (via AskUserQuestion):**
- **#663** (Evening Review Design) — approve the existing draft spec as-is, no revisions. Spec
  `docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md` status updated to "approved
  (2026-07-07)" and committed. **Build agent MUST re-verify grounding against current `origin/main`
  first** — the draft was grounded on `b1a1f672`, well behind current main (sports/datasets work
  landed since).
- **#855** (sports team dedupe across competitions) — **OUT OF SCOPE for this coordinator.** Ben is
  working this directly with his own agent on the sports branch (`fix/sports-ticker-annotations` in
  the shared primary tree `/home/ben/Jarv1s` — do NOT touch, has active uncommitted work in
  `packages/sports/*`). Do not queue, do not spawn, do not touch sports files.
- **#854** (integration tests pollute shared dev DB) — direction confirmed: **enforce per-run
  isolated DB**, reusing the existing `JARVIS_PGDATABASE` agent-isolation mechanism rather than a
  harness-refusal or cleanup-only approach. No dedicated spec doc needed (bug fix using an existing
  mechanism, not a new feature/module) — ready to queue directly.
- **#817** (Jarvis should explain user-visible errors) — Ben confirmed this IS worth scoping now.
  **No spec exists yet.** Needs a design-question interview (one-question-at-a-time per
  `feedback-grill-me-for-design` memory) before it can be queued — NOT ready to build. Successor:
  either run this interview with Ben directly, or spin up `/brief` or `superpowers:brainstorming`
  to produce a draft spec for his approval. This is cross-cutting (diagnostic surface across every
  feature, not just sports) — likely `docs/superpowers/specs/2026-07-0X-error-explainability.md`
  when drafted.

**#853** (sign-up hook orphans a better-auth user on failure) was already spec-clear going in — a
bug fix restoring atomicity in `bootstrapFirstJarvisUser` (`packages/auth/src/index.ts`), no
design question, no spec doc needed.

**Not touched this pass (needs-spec backlog, unscoped, no draft exists for any of these — flagged
to Ben, no decision requested yet):** #818, #819, #820, #821, #822, #823, #824, #825, #826, #741,
#742, #743, #744, #745, #759, #760. #780 (Park Press font wiring) has a plan but is blocked on Ben
supplying licensed `.otf` files — not a coordinator action item, just a standing reminder to him.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md | #663 | sensitive | **HOLD — likely duplicate** | Build-663 | w1:p9V | 663-evening-briefing-redesign | — |
| (bug fix, no spec doc — atomicity fix in existing auth flow) | #853 | security | building (plan approved, Task 1 TDD in progress) | Build-853 | w1:p9W | 853-auth-signup-atomicity | — |
| (bug fix, no spec doc — enforce per-run isolated DB, existing JARVIS_PGDATABASE mechanism) | #854 | routine | building (relayed once, root cause confirmed, no plan/code yet) | **Build-854b** | w1:p9Y | 854-integration-test-db-isolation | — |

All three spawned into agents tab `w1:t1C` (created this run), confirmed running Sonnet, worktrees
cut off `origin/main` @ `babe07aa`. Handoff docs committed in each worktree at
`docs/coordination/handoff-<slug>.md`. **merges_since_relay: 0** (nothing merged yet).

### ⚠️ #663 — HOLD, likely duplicate (found this tenure, unresolved)

Build-663 found that `docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md` is **already
fully implemented and merged** as commit `bcbbdf60` / PR #719 (closes #695), merged 2026-07-03 —
**three days before** the #663 spec was approved 2026-07-06. Verified independently by this
coordinator (not just agent self-report): `git merge-base --is-ancestor bcbbdf60 HEAD` on the
`663-evening-briefing-redesign` worktree returns true; `#695` is `closed` via
`gh api repos/motioneso/Jarv1s/issues/695`; file/test structure on current `main` matches the
spec's section 2 exactly, `tests/integration/briefings-evening.test.ts` is 9/9 green as-is.
**#663 itself is still open.** Build-663 is told to **hold, do nothing further** (no close, no
merge, no delete) pending Ben's call. I surfaced this to Ben via AskUserQuestion; his first
response was a clarifying question ("how do I view the evening briefing now?") — answered (Today
page auto-switches to evening mode by local time; `apps/web/src/today/evening-mode.tsx`; a manual
"run now" API exists via `runBriefingDefinitionRouteSchema` in `packages/briefings/src/routes.ts`;
his existing dev preview from `/home/ben/Jarv1s` already has this feature since it's an ancestor of
`main`). **Ben has NOT yet made the close-vs-rescope call.** Successor: when Ben responds, act on
one of:
- **Close #663 as duplicate** → `gh issue close 663` referencing #719/#695, message Build-663 to
  stand down permanently, `git worktree remove .claude/worktrees/663-evening-briefing-redesign`,
  delete the `663-evening-briefing-redesign` branch (local + none pushed), drop the queue row.
- **#663 wants a real delta beyond #719** → have Build-663 re-scope its plan against exactly that
  delta (do not resurrect the full original spec — #719 already covers it).

### #853 — plan approved this tenure

Read the plan directly (`docs/superpowers/plans/2026-07-07-853-auth-signup-atomicity.md` in the
`853-auth-signup-atomicity` worktree) — no design fork, no migration, correctly respects the 0055
`users_guard_admin_flag` trigger (broadens the failure-path compensating delete to run on ANY
after-hook failure, not just `registrationRejected`; FK cascade on `app.auth_accounts`/
`app.better_auth_sessions` means deleting `app.users` alone fully cleans up). Approved via
`herdr-pane-message`; Build-853 resumed and is on Task 1 (failing-test repro) as of this write.
**Still needs, when it reports done:** Opus adversarial QA (security tier) → mandatory
`gh pr comment` verdict → Ben's explicit merge sign-off. Do not auto-merge on green CI alone.

### #854 — relayed once, no plan yet

Build-854 relayed and was confirmed + reaped this tenure. Successor **Build-854b** is live at pane
`w1:p9Y`, session `4a271eb9-8a17-4317-b5bc-6e3d484b9515`, confirmed running Sonnet, same worktree/
branch (`854-integration-test-db-isolation`). Continuation doc committed at
`docs/superpowers/handoffs/2026-07-07-854-integration-test-db-isolation-relay.md` (commit
`4e371fa0`) in that worktree. Predecessor pane `w1:p9X` (session `c513c561-1b4b-4eda-9b48-4c58c9bbc1b7`)
was verified and closed. **Still no plan/code written** — successor coordinator: expect a plan-ready
escalation from Build-854b next.

### #817 — design interview in progress (not a build item)

Started the `brief` skill with Ben for #817 (Jarvis should explain user-visible errors —
cross-cutting diagnostic surface, no spec exists). **Only Q1 ("what is the core problem this
solves?") was asked; Ben has not yet answered it** — the #663-duplicate escalation and his
clarifying question interrupted the interview before Q1's answer landed. Successor: re-invoke
`brief` (or just re-ask Q1 in-conversation) to resume — do not assume any answers were given, none
were. This is NOT part of the build queue; it produces a draft spec for Ben's future approval, not
an immediate spawn.

### Liveness monitor

A persistent `Monitor` (task id `bklyndmg7`) is running, diffing `herdr pane list` for panes
`w1:p9V`/`w1:p9W`/`w1:p9X` every 30s, emitting only on `agent_status` change. **This monitor dies
with this session on relay — the successor must start its own**, or it has zero passive liveness
signal on the fleet.

**Tier rationale:**
- **#663 → sensitive:** touches scheduled-job-adjacent notification content and reads across
  multiple modules (calendar/tasks/email/sports/news channels) for the gather step. Not
  auth/RLS/secrets → not security. Cross-cutting read integration → not pure routine.
- **#853 → security:** modifies auth-account/credential creation atomicity and interacts directly
  with the 0055 `users_guard_admin_flag` RLS trigger. Needs Opus adversarial QA + Ben sign-off
  before merge — do not auto-merge even if CI is green.
- **#854 → routine:** test-harness-only change, no shared-table migration, no production auth/RLS
  surface, isolated to integration-test setup. Standard QA + auto-merge on green.

**None of these three have been spawned yet** — this manifest is written at the readiness/queueing
stage, not mid-build. Successor should treat Phase 0 as substantially done (specs confirmed, tiers
set, dependency map trivial — all three are independent, no shared migration/table, can run in
parallel) and move straight to **Phase 1 spawn** for #663/#853/#854, pending nothing further from
Ben (he already approved the spec and the DB-isolation direction; #853 needs no additional
approval, it's a straightforward bug fix).

## Dependency / merge order

- **Parallel group 1:** #663, #853, #854 — no shared table, no shared module, no migration-number
  collision. Safe to spawn all three concurrently in separate worktrees.
- **Merge order:** no ordering constraint between them; merge each independently as it goes green.

## CI waivers

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | --------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

## Outstanding escalations

- [ ] **#817 spec scoping** — not a build blocker, but the next real piece of work: run a
  one-question-at-a-time design interview with Ben (or delegate to `/brief` /
  `superpowers:brainstorming`) to produce a draft spec, then bring it back for approval before
  queueing. Owner: coordinator (this run), not yet started.
- [ ] **#780** — reminder only, not actionable by the coordinator: Ben needs to supply licensed
  Neue Haas Grotesk `.otf` files before this can build.

## Reaped sessions

- `9ba963a2-ae22-47b2-a8f2-2871b37a2f46` (pane `w1:p9Q`) — relayed at 70% context checkpoint,
  confirmed handoff, reaped by successor `e56b7c36-6f1b-4438-85ef-bb5cad9eed74` (pane `w1:p9S`).
