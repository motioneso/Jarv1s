# #1264 settings self-operation — relay (plan submitted, awaiting coordinator approval)

**Branch/worktree:** `1264-settings-self-operation` (this worktree). **Coordinator agent name:**
`coord-1262` (resolve fresh via `herdr agent list` / `herdr pane list` — label `Coordinator`).
**Risk tier:** security (Opus QA required before merge).

## State: plan written, committed, coordinator notified. NOT approved yet. NO task code written.

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` (committed,
`05744bcc`). 12 tasks, TDD, covers all 6 round-one settings tools + `chat.setResponseStyle` (on
chat's own manifest) + 3 migrations (prefs revision, instance_settings revision, audit CHECK
widen) + CAS + undo stack + no-op suppression + inventory-count update + full-gate verify.

Sent to `coord-1262` via `herdr agent prompt`: "plan ready for 1264-settings-self-operation: <path>.
... Approve, or flag a fork?" **No reply seen yet before this relay** — check for one first.

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

1. Check for coordinator's reply/approval (`herdr pane read` on `coord-1262`'s pane, resolved
   fresh — do not reuse any pane number from this doc).
2. If approved: build via `superpowers:test-driven-development`, Task 1 onward, per-task green
   commits. If the coordinator flagged a fork/correction, fix the plan first, re-notify, wait again.
3. Self-monitor context; relay again at the 70% meter warning or on seeing a compaction summary —
   whichever comes first. Reading is not progress; build and commit.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relay doc
(now superseded by this one) had the grounding-phase findings — plan file already encodes the
load-bearing ones (exact preference keys, validation gaps, migration directories).
