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
| docs/superpowers/specs/2026-07-02-evening-briefing-redesign.md | #663 | sensitive | queued | — | — | — | — |
| (bug fix, no spec doc — atomicity fix in existing auth flow) | #853 | security | queued | — | — | — | — |
| (bug fix, no spec doc — enforce per-run isolated DB, existing JARVIS_PGDATABASE mechanism) | #854 | routine | queued | — | — | — | — |

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
