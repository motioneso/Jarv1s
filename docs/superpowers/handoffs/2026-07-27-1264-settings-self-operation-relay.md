# #1264 settings self-operation — relay (PLAN APPROVED, build now)

**Branch/worktree:** `1264-settings-self-operation` (this worktree). **Coordinator agent name:**
`coord-1262` (resolve fresh via `herdr agent list` / `herdr pane list` — label `Coordinator`).
**Risk tier:** security (Opus QA required before merge).

## State: plan APPROVED by coordinator, with ONE required addition (Task 13, see below). BUILD NOW.

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` (committed,
`05744bcc`). Originally 12 tasks (renumber the new one 13, appended last — do NOT renumber existing
tasks). TDD, covers all 6 round-one settings tools + `chat.setResponseStyle` (on chat's own
manifest) + 3 migrations (prefs revision, instance_settings revision, audit CHECK widen) + CAS +
undo stack + no-op suppression + inventory-count update + full-gate verify.

## Coordinator's approval message (verbatim ruling — do not re-litigate)

Confirmed correct, no changes needed: family declaration (plan line ~432) `defaultTier:
"confirm_once"` with install grant setting `trusted_auto` separately — the grant promotes, the
default never widens. Undo stack key `${actorUserId}:${chatId}` — matches spec's "bound to actor
AND chat," do not simplify. 20-entry cap — spec says "bounded" with no number; 20 stands, no further
check needed.

**REQUIRED — new Task 13 (last task, before the final gate): per-actor, per-tool rate limiting.**
Spec quote: "Rate limiting: per-actor and per-tool limits, no-op suppression ... Bounded blast
radius is not bounded frequency — an injected loop can otherwise oscillate a setting indefinitely."
Task 9 (no-op suppression) is the OTHER half of that bullet only — `light→dark→light→dark` is never
a no-op, so suppression never fires and an injected loop oscillates freely. Three build constraints:
1. **Gateway-level, not settings-local.** A settings-local limiter can't bound `chat.setResponseStyle`
   (different module) — write it once as a small generic in-memory per-`(actorUserId, toolName)`
   bucket applied to write tools in `packages/ai/src/gateway/gateway.ts` (or policy.ts — find the
   existing dispatch wrapper from Task 1). Module-agnostic, no settings-specific knowledge. This is
   the seam #1265/#1267 adopt later.
2. **Rate-limited call reports outcome `denied`.** Do NOT add a `rate_limited` outcome — audit
   outcome set is closed, Task 0c already widens the CHECK constraint once; a new value = pointless
   4th migration.
3. **Last task, before the gate.** If it stalls, everything ahead still ships — escalate to
   coordinator and state the gap plainly in the PR body; never silently omit on a security-tier PR.
Optional, not a blocker, do only if cheap: plain counters for hard-exclusion hits + repeated CAS
failures (same spec bullet). Coordinator will NOT hold the PR for this.

**On the plan's 5 flagged assumptions:** all fine to build against as originally planned (4 of 5
self-correct — wrong enum/context shape fails typecheck immediately, cheapest possible failure).
Assumption 5 (undo scoped to settings only) needs one explicit thing: `chat.setResponseStyle` gets
NO undo entry (chat's own undo is out of plan), so "change that back" works for the six settings
tools and silently no-ops for response style. **State this plainly in the PR body** — spec's own
worked example (line ~180) is undoing a theme change, a reviewer will look for response-style undo
and not find it; call it out before they ask.

**Verification:** gate list MUST include `format:check` (a prior lane in this epic went red on
prettier alone, which silently skipped test:unit/test:integration entirely). Never pipe a gate
command through tail/head — always check the real exit code. Commit per task.

## Do NOT re-read the plan file in full

It's ~500 lines. Read it BY TASK as you execute each one, never front-to-back. Same for the spec
(`docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`) — section only.

## Plan's own flagged assumptions (not yet independently re-verified — confirm during the task that needs them, not before)

1. Audit-dispatch call site: assumed `packages/ai/src/gateway/gateway.ts`'s tool-dispatch wrapper
   auto-records an audit row per call; app functions just return outcome/throw. Confirm in Task 1
   Step 1.
2. `chat.setResponseStyle`'s real `ChatResponseStyle` enum values + chat's own write path: NOT
   grounded, confirm in Task 7 Step 1 (`packages/chat/src/manifest.ts:171`,
   `packages/shared/src/chat-settings-api.ts:3`, `packages/chat/src/live/runtime.ts:529`). If
   the real type has any free-text field, STOP — do not build, escalate (would violate the
   closed-enum-only ruling).
3. `ModuleAssistantToolContext` exact shape (how `scopedDb`/`preferencesRepository`/`actorUserId`/
   `chatId` reach `execute`): not re-confirmed. Read `packages/module-sdk/src/index.ts` +
   `app-map-tool.ts` (existing tool in this same package) as Task 2 Step 3's first sub-step.
4. `assistantActionFamilies` shape/pattern: copy from an existing module (e.g. `tasks`'s manifest)
   — not yet re-read this pass.
5. Undo stack scoped to settings only; chat's own undo (if any) is chat module's responsibility,
   out of this plan — flag in PR body, don't silently build shared infra.

## Immediate next step

1. **Already approved — do not re-message coordinator for approval.** Add Task 13 (rate limiting,
   see above) to the plan file, then build via `superpowers:test-driven-development`, Task 0a
   onward, per-task green commits.
2. Self-monitor context; relay again at the 70% meter warning or on seeing a compaction summary —
   whichever comes first. Reading is not progress; build and commit.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relay doc
(now superseded by this one) had the grounding-phase findings — plan file already encodes the
load-bearing ones (exact preference keys, validation gaps, migration directories).
