# Coordination Run — issue-queueing-pass-2026-07-07

**Date:** 2026-07-07
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id
`d2380257-0a2b-44a4-bafa-49a3be6559ca`** (pane `w1:pA3`, tab `w1:t15` at time of writing — resolve
fresh by label+session, never trust the pane number). Relayed from predecessor session
`9fb2dc84-f605-4580-8ba3-510bbdef6f59` (pane `w1:p9Z`) at its 70/71% context checkpoint;
predecessor confirmed handoff, went idle, and was reaped (pane closed) at run continuation.
Exactly one `Coordinator` pane confirmed via `herdr pane list` post-reap.
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
| (bug fix, no spec doc — atomicity fix in existing auth flow) | #853 | security | building (Task 2 done, Task 3 "full local gate" next) | Build-853 | w1:p9W | 853-auth-signup-atomicity | — |
| (bug fix, no spec doc — enforce per-run isolated DB, existing JARVIS_PGDATABASE mechanism) | #854 | routine | building (relayed twice, plan design fully grounded, not yet written to file) | **Build-854c** | w1:pA1 | 854-integration-test-db-isolation | — |

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

### #854 — relayed twice, plan design grounded but not yet written to file

Build-854 relayed → Build-854b (reaped by predecessor coordinator tenure). Build-854b relayed again
this tenure at ~70% ctx → successor **Build-854c** is live at pane `w1:pA1`, session
`ee780331-4b5b-42cc-8d25-5be366d63b1a`, confirmed driving/working, same worktree/branch
(`854-integration-test-db-isolation`). Predecessor `w1:p9Y` (session
`4a271eb9-8a17-4317-b5bc-6e3d484b9515`) confirmed reaped 2026-07-07. Note: Build-854c initially
landed in the coordinator's own tab (`w1:t15`) — moved to the shared agents tab `w1:t1C` on
discovery.

Root cause confirmed (per Build-854b's relay note): `packages/*/urls.ts` jarv1s default +
`test-database.ts` `seedProbeData` share the default DB name across concurrent agent runs. Design
grounded, not yet written to a plan file:
- **(A)** `scripts/test-integration.ts` wrapper — pure `createDatabaseIsolationPlan()` fn,
  auto-generates an isolated DB name when `JARVIS_PGDATABASE` is unset, ensures/drops it via the
  postgres maintenance DB; no separate `db:migrate` step needed (reset fns self-bootstrap schema).
- **(B)** `DEFAULT_JARVIS_DATABASE_NAME` const in `urls.ts` + `assertIsolatedTestDatabase()` guard
  in `test-database.ts` refusing the shared default.
- **(C)** reroute ~20 `package.json` `test:*` scripts through the wrapper.

**Still no plan/code written** — successor coordinator: expect a plan-ready escalation from
Build-854c next (it should write the plan to
`docs/superpowers/plans/2026-07-07-854-integration-test-db-isolation.md` before requesting
approval).

### #817 — `/brief` interview COMPLETE (not a build item)

All six `brief` questions answered by Ben and Feature Brief synthesized + confirmed
2026-07-07 (session `d2380257-...`). Slug: **`error-explainability`**.

- **Problem:** silent breakage (e.g. "not all leagues could be loaded") gives no path to the
  underlying cause.
- **User:** everyone — anyone asking "what does X mean" should learn why.
- **Success:** Jarvis can identify the source of any error message and read/surface the relevant
  logs.
- **Non-goal:** no auto-fix — explain only.
- **MVP:** user asks a natural-language question about a symptom (e.g. "what leagues aren't
  current right now?"); Jarvis reads logs to answer. **Load-bearing precondition:** errors must
  actually be written to a log Jarvis can read — comprehensive logging coverage, not just an
  implementation detail.
- **Verification:** when an error occurs, ask Jarvis about it; confirm it explains the actual
  cause, not just the raw message.

Ben confirmed the brief as-is, no corrections. **Successor: hand off is "ready to run `/start`
whenever you are, slug `error-explainability`"** — per the `brief` skill's own protocol, do not
write a `docs/superpowers/specs/` file yourself; that's `/start`'s job downstream. This is NOT
part of the build queue until Ben invokes `/start` (still needs an approved spec per Hard
Invariants — brief ≠ spec).

### Liveness monitor

A persistent `Monitor` (task id `bcy2lgvqj`, started by session `d2380257-...`) is running,
diffing `herdr pane list` for panes `w1:p9V` (Build-663) / `w1:p9W` (Build-853) / `w1:pA2`
(Build-854d) every 30s, emitting only on `agent_status` change. **This monitor dies with this
session on relay — the successor must start its own**, or it has zero passive liveness signal on
the fleet.

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

- [x] **#817 spec scoping** — `/brief` interview complete, brief confirmed by Ben 2026-07-07.
  Slug `error-explainability`. Awaiting Ben to invoke `/start` (produces the actual spec doc;
  still gated by Hard Invariants — no build until spec approved).
- [ ] **#780** — reminder only, not actionable by the coordinator: Ben needs to supply licensed
  Neue Haas Grotesk `.otf` files before this can build.

## Reaped sessions

- `9ba963a2-ae22-47b2-a8f2-2871b37a2f46` (pane `w1:p9Q`) — relayed at 70% context checkpoint,
  confirmed handoff, reaped by successor `e56b7c36-6f1b-4438-85ef-bb5cad9eed74` (pane `w1:p9S`).
- `e56b7c36-6f1b-4438-85ef-bb5cad9eed74` (pane `w1:p9S`) — relayed at 70% context checkpoint,
  confirmed handoff, reaped by successor `9fb2dc84-f605-4580-8ba3-510bbdef6f59` (pane `w1:p9Z`),
  2026-07-07.
- `9fb2dc84-f605-4580-8ba3-510bbdef6f59` (pane `w1:p9Z`) — relayed at 71% context checkpoint,
  confirmed handoff, reaped by successor `d2380257-0a2b-44a4-bafa-49a3be6559ca` (pane `w1:pA3`),
  2026-07-07.

## Successor tenure notes (session `d2380257-0a2b-44a4-bafa-49a3be6559ca`)

- Reaped predecessor `9fb2dc84-f605-4580-8ba3-510bbdef6f59` (pane `w1:p9Z`) per its confirmed
  handoff; claimed lock, renamed own pane `Coordinator-next` → `Coordinator` (now `w1:pA3`).
  Verified exactly one `Coordinator` pane via `herdr pane list`.
- Applied the quadrant layout to `w1:t1C` (see note under "Ben, standing instruction" below) —
  done, with the caveat about Herdr's binary split-tree noted there.
- Started a fresh liveness `Monitor` (task `bcy2lgvqj`) for `w1:p9V`/`w1:p9W`/`w1:pA2`.
- Completed the `#817` `/brief` interview (Q3–Q6; Q1/Q2 were already answered) — see the `#817`
  section above. Brief confirmed by Ben, slug `error-explainability`.
- **Build-854d observed flickering `idle`/`working`/`done` in `agent_status` several times this
  tenure while genuinely still mid-Task-6 (manual smoke test) — pane content unchanged across all
  three "done" readings (Task 6 ◼ in progress, Wrap-up ◻ not started, no PR). Treat `done` from
  the liveness Monitor as unreliable for Build-854d specifically until it actually opens a PR —
  confirm with a bounded pane read every time, don't act on the status string alone.** Build-854d
  own context was climbing (52–62%+) as of last read — may relay again soon; watch for it.

## Successor tenure notes (session `9fb2dc84-f605-4580-8ba3-510bbdef6f59`)

- **Tab hygiene fix:** found Build-854b (pane, session `4a271eb9-8a17-4317-b5bc-6e3d484b9515`)
  parked in tab `w1:t17` — Ben's own personal-agent tab (`w1:p8Y`, working `#855` sports dedupe
  directly), not the shared agents tab. Moved it to `w1:t1C` alongside Build-663/Build-853 per
  Ben's explicit instruction (2026-07-07): keep all build/QA agents in the agents tab only, open
  `agents2`/`agents3` overflow tabs past 4 panes, never spawn/park agents elsewhere.
- Restarted a fresh liveness `Monitor` for `w1:p9V`/`w1:p9W`/`w1:p9Y` (predecessor's monitor died
  with its session at relay, per protocol).
- Resuming the paused `#817` `/brief` interview — re-asking Q1 since no answer was ever recorded.
- **Stray duplicate agent closed:** pane `w1:p90` ("Build-853-next", session
  `b23cca4f-02ec-4c95-8d28-9940f3c09bc3`) appeared in `w1:t17` (Ben's personal tab) pointed at the
  **same worktree** as Build-853 (`853-auth-signup-atomicity`) — a two-agents-one-worktree hazard.
  Origin unknown (not spawned by this coordinator tenure). Confirmed with Ben via AskUserQuestion →
  closed 2026-07-07. Build-853 (`w1:p9W`, session `2e85563b-b1e6-4828-9e21-48fa4cfccff8`) is the
  sole agent on that worktree/branch going forward.

## Relay checkpoint (session `9fb2dc84-f605-4580-8ba3-510bbdef6f59`, own context 71%)

Coordinator context hit the 70% trigger — no-deferral relay in progress. Spawning successor now
in same tab (`w1:t15`). Full fleet + open-item state at handoff:

**Fleet:**
- **#663** — HOLD, `w1:p9V`, label Build-663. Awaiting Ben's explicit close-vs-rescope call
  (duplicate of PR #719/#695). Not resolved this tenure — do not act without Ben.
- **#853** — security tier, `w1:p9W`, label Build-853. TDD in progress, last observed at Task 2
  done / Task 3 ("full local gate") next. No PR yet — no QA needed until it reports done. When it
  does: spawn Opus adversarial QA, mandatory `gh pr comment` verdict, Ben's explicit sign-off
  before merge. Never auto-merge.
- **#854** — routine tier, branch `854-integration-test-db-isolation`. Plan (6 TDD tasks, reuse
  `JARVIS_PGDATABASE`, no spec/migration needed) was approved this tenure against Build-854c
  (`w1:pA1`). **Build-854c then relayed at its own 70% checkpoint before writing any code** —
  zero code written, successor picks up Task 1 in the SAME worktree/branch. Successor
  label/pane not yet confirmed as of this note. **Next coordinator action:** find the new
  successor via `herdr pane list` (look for a new pane in the agents tab `w1:t1C` on this
  worktree), confirm it's actually driving (bounded pane read, confirm Sonnet), reap Build-854c,
  update this table, restart the liveness Monitor.

**#817 `/brief` interview (with Ben, not a build agent):**
- Q1 (problem) answered: sports "not all leagues could be loaded" prompted it; broader idea is
  any user-visible error should be explainable by Jarvis on request.
- Q2 (user) answered, after probe on "everyone": any user who asks "what does X mean" should get
  told why that message appeared — confirmed as "everyone" is the real answer here, not a
  cop-out.
- **Q3 (success) was asked but NOT yet answered** — Ben's last several messages were about the
  #854 relay chain, not the interview. **Successor: re-ask Q3 verbatim** ("What does success look
  like?") — do not assume an answer, do not skip to Q4.

**Tab discipline (Ben, standing):** agents tab only (`w1:t1C` this run), overflow past 4 panes to
agents2/agents3. Twice this tenure a relayed/spawned agent landed in the wrong tab (Build-854b in
Ben's personal tab, Build-854c briefly in the coordinator's own tab) — check tab placement on
EVERY relay, not just initial spawn.

**Incident this tenure:** stray duplicate-worktree pane `w1:p90` ("Build-853-next") found running
against Build-853's same worktree — unknown origin, hard-stop two-agents-one-worktree hazard.
Escalated to Ben via AskUserQuestion (not decided unilaterally); Ben chose "shut it down"; closed.

**merges_since_relay:** 0 (nothing merged this tenure).

**Coordinator lock:** unchanged — still `9fb2dc84-f605-4580-8ba3-510bbdef6f59` / label
`Coordinator` / pane `w1:p9Z` (resolve fresh, don't trust the pane number) until the successor
claims Phase 0a and updates this line itself.

## Prior late-breaking events (resolved this tenure, session `d2380257-...`)

- **#854 relay chain:** Build-854c → Build-854d resolved and confirmed driving at `w1:pA2`,
  reaped `w1:pA1`. Done, see fleet table.
- **Quadrant layout:** done, see "Ben, standing instruction" note under Successor tenure notes
  above — reuse `w1:pA4` (`reserved-slot`) for the next agent spawn.

## Relay checkpoint (session `d2380257-0a2b-44a4-bafa-49a3be6559ca`, own context ~70%)

Coordinator context hit the 70% trigger — no-deferral relay in progress. Spawning successor now
in same tab (`w1:t15`). Full fleet + open-item state at handoff:

**Fleet:**
- **#663** — still HOLD, `w1:p9V`, label Build-663, idle. Still awaiting Ben's explicit
  close-vs-rescope call (duplicate of PR #719/#695). **Untouched this tenure — do not act
  without Ben.**
- **#853** — security tier, `w1:p9W`, label Build-853, idle (last observed). No PR yet this
  tenure — status not actively re-checked this tenure beyond the liveness monitor's
  `agent_status` field. Successor: bounded pane read to get current task position before
  assuming anything. When it reports done: Opus adversarial QA → mandatory `gh pr comment`
  verdict → Ben's explicit sign-off before merge. Never auto-merge.
- **#854** — routine tier, Build-854d, `w1:pA2`, branch `854-integration-test-db-isolation`.
  **On Task 6 (manual smoke test) as of last bounded read this tenure** (Tasks 1–5 done,
  wrap-up not started, no PR yet). `agent_status` flickered `idle`/`working`/`done` repeatedly
  without real progress in the pane content — **treat `done` as unreliable for this agent until
  a PR actually appears; always confirm with a bounded pane read.** Own context was ~52–62%+ at
  last read — may relay again soon; if a new pane appears in `w1:t1C` on the same
  worktree/branch, that's its successor — confirm driving, reap Build-854d, update this table.

**#817** — CLOSED OUT this tenure (see `#817` section above and Outstanding escalations). Not a
build queue item; no further coordinator action until Ben runs `/start` on slug
`error-explainability`.

**merges_since_relay:** 0 (nothing merged this tenure either).

**Coordinator lock:** now `d2380257-0a2b-44a4-bafa-49a3be6559ca` / label `Coordinator` / pane
`w1:pA3` (resolve fresh, don't trust the pane number) until the successor claims Phase 0a and
updates this line itself.
