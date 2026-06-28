# Coordinator Relay R2 — rfa-overnight-20260627

**Run:** rfa-overnight-20260627
**Relay time:** 2026-06-28 (coordinator context compacted)
**Predecessor session:** 5e1a6b62-a480-4b5c-9706-e476cfe77044 (Coordinator, w1:p59)
**Authority session:** 5e1a6b62-a480-4b5c-9706-e476cfe77044 — **you are the successor; claim the Coordinator label and record your own session id as the new authority.**
**Run manifest:** docs/coordination/rfa-overnight-20260627.md

---

## Your first actions (ordered)

1. **Rename yourself:** `herdr pane rename "$HERDR_PANE_ID" "Coordinator"`
2. **Verify uniqueness:** `herdr pane list` — exactly one `Coordinator` label. If a stale pane also holds it, message it to stand down; do NOT run parallel coordinators.
3. **Record your session id** as the new authority in the manifest top section.
4. **Read the manifest** (`docs/coordination/rfa-overnight-20260627.md`) IN FULL.
5. **Check all four agents** (see Fleet section below).
6. **Continue supervising** per the `coordinate` skill.

---

## Fleet at relay time (2026-06-28)

All four Wave-2 build agents are active. Re-read the manifest for full detail.

### #538 — rfa-538-person-contact-model
- **Pane:** w1:p5P | **Session:** 9e59a87b-e38d-4132-8f17-530319bfca11
- **Label:** `RFA-538 Claude`
- **Tier:** `security` ← dual Opus+GLM QA required; Ben merge sign-off required
- **Worktree:** ~/Jarv1s/.claude/worktrees/rfa-538-person-contact-model
- **State:** R1 hit context limit + file-write error while writing plan. Relay nudge submitted (Enter sent). Agent now at ~56% context — likely compacted and continuing OR has relayed to R2.
- **Migration slot: 0127** (reserved; confirm before any push)
- **Spec:** docs/superpowers/specs/2026-06-27-unified-person-contact-model.md
- **Plan:** NOT yet approved. When #538 escalates its plan, approve (if within spec) or spawn Opus for security review of the plan. This is security tier — plan still needs coordinator sign-off before coding begins.
- **Action:** `herdr pane read w1:p5P --source recent --lines 12` to verify status. If it relayed, get the new pane from `herdr pane list` for label `RFA-538-R2 Claude` or similar.

### #539 — rfa-539-source-backed-provenance
- **Pane:** w1:p5W | **Session:** 741d008c-8140-4c24-8ac3-936e50be76f2
- **Label:** `RFA-539-R2 Claude`
- **Tier:** `sensitive`
- **Worktree:** ~/Jarv1s/.claude/worktrees/rfa-539-source-backed-provenance
- **State:** Plan APPROVED 2026-06-28 (8 TDD tasks, no migration). Building Task 1 at 52% ctx. Active.
- **Plan:** docs/superpowers/plans/2026-06-28-source-backed-provenance.md (committed in rfa-539 worktree)
- **Key collision:** shares `packages/shared/src/chat-api.ts` with #541. Fields: `answerProvenance`, `answerProvenanceCitedIds` (for #539); freshness fields (for #541). DISJOINT — no overlap.
- **Action:** Monitor; await done report or relay. When done, spawn dual QA (Codex + GLM) before merge.

### #540 — rfa-540-safe-automation-audit-log
- **Pane:** w1:p5Z | **Session:** e6b6a6ad-910c-40b0-9dab-76394aa3886e
- **Label:** `RFA-540-R3 Claude`
- **Tier:** `sensitive`
- **Worktree:** ~/Jarv1s/.claude/worktrees/rfa-540-safe-automation-audit-log
- **State:** Plan APPROVED 2026-06-28 (12 TDD tasks, migration slot 0128). R3 building. Active.
- **Plan:** docs/superpowers/plans/2026-06-28-rfa-540-safe-automation-audit-log.md (in rfa-540 worktree)
- **Migration:** Use placeholder `XXXX` during dev; rename to `0128_jarvis_action_audit_log.sql` ONLY at merge time — confirm slot first.
- **Key note:** `purgeActionAuditLog` uses raw `Kysely<JarvisDatabase>` (not DataContextDb) — acceptable for SECURITY DEFINER maintenance. QA must verify `connectionStrings.app` role = `jarvis_app_runtime`.
- **Action:** Monitor; await done report or relay. Dual QA (Codex + GLM) before merge.

### #541 — rfa-541-data-freshness-visibility
- **Pane:** w1:p5X | **Session:** abf19e12-b402-4501-88e1-e3a705e352b0
- **Label:** `R3-541`
- **Tier:** `routine`
- **Worktree:** ~/Jarv1s/.claude/worktrees/rfa-541-data-freshness-visibility
- **State:** R3 active. **R2 relayed BEFORE writing a plan** — R3 may need to write the plan itself.
- **Spec:** docs/superpowers/specs/2026-06-28-data-freshness-visibility.md
- **Action:** `herdr pane read w1:p5X --source recent --lines 12` to check if R3 is building (plan already in place) or waiting to write plan. If plan needed, R3 will escalate for approval.
- **Collision:** shares `packages/shared/src/chat-api.ts` with #539 (disjoint freshness fields). Second to merge will need rebase.

---

## Context policy for this run

- **merges_since_relay:** reset to 0 on relay R2 start.
- **Ben stay-resident override:** ACTIVE — do not relay on merge counter; only relay on compaction tripwire (context compacted summary seen in your own context).
- **QA policy (Ben directive 2026-06-27):** ALL approval gates require DUAL-MODEL — Codex + GLM both GREEN before merge.

## Dual QA workflow (Ben directive)

For each PR ready to merge:
1. Spawn Codex QA agent via `herdr agent start` in w1 agents tab
2. Spawn GLM QA agent via `herdr agent start` in w1 agents tab
3. Both must report GREEN independently
4. After both GREEN → merge (auto for routine/sensitive; Ben sign-off for security)

## Security invariants (carried forward — must survive compaction)

- No admin private-data bypass. RLS applies to all actors including admins. No BYPASSRLS on runtime roles.
- Private by default. Cross-user access requires explicit grants.
- DataContextDb only. Repositories accept only branded DataContextDb handle.
- AccessContext: `{ actorUserId, requestId }` only. No extra fields.
- Secrets never escape to frontend, logs, payloads, prompts.
- Metadata-only pg-boss payloads.
- Provider-agnostic AI. No hardcoded models.
- Spec before build.
- Module isolation. No cross-module internal imports.
- Never edit applied migrations.

## Post-run tasks (after all 4 issues merged)

1. File GitHub issue "Jarvis capabilities doc / what's new"
2. Wrap up the run and relay to Ben

## Predecessor pane

w1:p59 (session 5e1a6b62) — reap after you confirm successor is driving.
