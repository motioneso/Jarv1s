# Coordination Run — 2026-06-28-batch-followups

**Date:** 2026-06-28
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `f8a5b8f7-a287-4665-b480-0f46dc52bed2`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. ⚠️ **Pane numbers (`w…-N`) reflow on every restart/split/reap — do NOT trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time.** Agents escalate to the **label** (routing, re-claimable); the coordinator merges only when its own pane's **session id** (immutable, NOT the pane number) matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Issues                             | Label            | Tier      | Status   | Branch           | PR  |
| ---------------------------------- | ---------------- | --------- | -------- | ---------------- | --- |
| #554, #555, #560, #561, #562, #565 | Memory-Cleanup   | sensitive | building | memory-cleanup   | —   |
| #505, #509                         | Wellness-Fixes   | sensitive | building | wellness-fixes   | —   |
| #564, #567                         | Calendar-Monitor | sensitive | building | calendar-monitor | —   |
| #480, #512                         | UI-Polish        | routine   | qa       | ui-polish        | #581 |

**Deferred (needs spec before build):**

- issue #578 — UX: in-container Claude permission prompts invisible (multiple options, security implications)
- issue #579 — All dates/times in user local timezone (cross-cutting architecture, needs single-source-of-truth decision)

Risk tier (content triggers, set at Phase 0 — see `coordinate` Risk tiering):

- `routine` — no schema/auth/secret surface → auto-merge after green QA.
- `sensitive` — shared-table migration / cross-module contract / export-delete / job-payload shape → auto-merge + Ben digest.
- `security` — auth/sessions/tokens/RLS/secrets/rate-limit/network-exposed/policy migration → cross-model Opus QA + `gh pr comment` verdict + **Ben merge sign-off**.

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `qa-failed`/`rework` → `awaiting-ben-signoff` (security) → `merged`
(or `handed-off` when relayed to a fresh session).

## Issue details

### Memory-Cleanup (sensitive) — #554, #555, #560, #561, #562, #565

All memory module follow-ups from security/spec QA of issues #532 and #533.
Spec refs: `docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`, `docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md`

- **#554** — Wrap confirmFact/correctFact/patchFactStatus in DB transactions
- **#555** — patchFactStatus: reject 400 if target has superseded_by IS NOT NULL and new status='active'
- **#560** — entity delete/forget: return 403 if target is actor's self-entity
- **#561** — acceptCandidate: check for existing active fact conflicts; route via #532 correction path (PR #553 already merged)
- **#562** — factToItem: when sourceLabel absent and sourceRef looks like raw UUID/internal id, substitute sourceKind label instead
- **#565** — notes monitor-provider: add `listRecentVaultFiles(scopedDb, since, limit)` to MemoryRepository in @jarv1s/memory; update notes monitor-provider to use it (not raw Kysely queries on memory tables)

No migrations needed. All changes within existing module APIs.

### Wellness-Fixes (sensitive) — #505, #509

Spec refs: `docs/superpowers/specs/2026-06-25-wellness-ai-consent.md`, `docs/superpowers/specs/2026-06-25-wellness-selective-export.md`

- **#505** — When wellness consent permits access, expose check-in free-text note to Jarvis (AI tool response includes the note field alongside existing structured fields)
- **#509** — Export modal: (a) align styling to existing design system (checkbox treatment, modal patterns); (b) fix broken export action so it actually runs and shows progress/ready state

### Calendar-Monitor (sensitive) — #564, #567

Spec ref: `docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md`

- **#564** — scanner.ts: after `sorted = [...ranked].sort(byScore)`, loop uses wrong index (pairs sorted[i] priority band with allowedSignals[i] content). Fix index correspondence so priority band travels with its signal through the sort.
- **#567** — calendar monitor-provider: apply `sanitizeSnippet(event.title)` and `sanitizeSnippet(event.location)` before writing to proactive card fields (follow email provider pattern at `packages/email/src/monitor-provider.ts:78,80`)

### UI-Polish (routine) — #480, #512

No spec required (bug fixes / style alignment to existing patterns).

- **#480** — Today page: remove the persistent medication nudge card that appears when no medication has been logged. Medication logging affordance itself stays; just remove the persistent nudge.
- **#512** — Chat approve/reject buttons: fix spacing between buttons; rework the instructional text above so it doesn't look like system/debug text (consider collapse/disclosure pattern per issue comment). Follow existing design system patterns.

## Dependency / merge order

**Parallel group 1 — launch all 4 simultaneously:**

- Memory-Cleanup
- Wellness-Fixes
- Calendar-Monitor
- UI-Polish

No migration ordering issues (none require schema migrations).
No cross-agent file collisions: memory package is owned by Memory-Cleanup only; wellness module owned by Wellness-Fixes only; calendar/monitoring owned by Calendar-Monitor only; UI components owned by UI-Polish only.

**Merge order:** Any order — no inter-PR dependencies among these 4.

## CI waivers

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding escalations

- [ ] issue #578 — needs spec before spawning; deferred
- [ ] issue #579 — needs spec before spawning; deferred

## Reaped sessions

(none yet)
