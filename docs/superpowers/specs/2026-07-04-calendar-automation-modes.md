# Calendar Automation Modes (#736)

**Status:** approved
**Issue:** #736
**Author:** Codex, grill-me with Ben - 2026-07-04

## 1. Problem

Calendar settings currently persist follow-through values such as `createTasks` and `blockTime`,
but the UI labels imply automatic write behavior that is not actually wired end-to-end. Ben wants
the same trust model used elsewhere: suggestions by default, and automatic action only when the
user explicitly chooses it for that module/action.

## 2. Decisions

- Use a shared automation mode shape: `off | suggest | auto`.
- Keep ownership local: each module owns what those modes mean and which action families they map
  to. Do not build a central behavior engine.
- Calendar owns Calendar follow-through settings, including Calendar-driven prep task creation.
- Calendar prep task creation may create a Task, but the user-facing setting belongs in Calendar.
- Calendar writeback is a Calendar-owned write action family. Reuse the existing focus-time
  writeback service as the canonical Calendar write path; focus time is one caller, not the owner.
- Choosing `auto` means auto for that exact module/action family. The UI must not ask again after
  the user has selected auto.
- Internally, `auto` can map to the existing action policy tier, but there must be no separate
  user-facing sync problem.
- Suggested and automatic actions both create feedback targets so Jarv1s learns which suggestions
  were useful.
- Marking a Jarv1s-created block/task as not useful records feedback and removes/cancels that
  Jarv1s-created item. Never remove user-created or external calendar/task items through this path.

## 3. Scope

- Replace boolean Calendar follow-through controls with 3-state controls:
  - prep task creation: `off | suggest | auto`
  - time blocks/calendar writeback: `off | suggest | auto`
  - commitment detection if it creates tracked commitments: `off | suggest | auto`
- Wire `suggest` to proposed actions/cards plus usefulness feedback.
- Wire `auto` to execute the scoped action with no extra approval prompt.
- Use existing action-policy storage internally where appropriate.
- Add provenance for Jarv1s-created calendar blocks and tasks so "not useful" can safely remove
  only those items.
- Record useful/not-useful feedback for accepted, rejected, auto-created, and removed suggestions.

## 4. Non-Goals

- Global automation settings.
- Email or Tasks automation changes except where Calendar calls a Calendar-owned action that
  creates a task.
- Deleting user-authored tasks or external calendar events.

## 5. Acceptance

- Calendar settings expose no misleading "automatic" toggles.
- `off` emits no suggestion or action for that behavior.
- `suggest` produces a governed suggestion and records feedback from user action.
- `auto` executes the exact scoped action with no second approval prompt.
- Auto-created blocks/tasks are visibly attributable to Jarv1s.
- Marking auto-created blocks/tasks as not useful removes/cancels them and records feedback.
- Tests cover at least one mode transition, one auto execution, and one not-useful removal path.

## 6. Files In Play

- `~/Jarv1s/packages/calendar/src/settings/index.tsx`
- `~/Jarv1s/packages/calendar/src/routes.ts`
- `~/Jarv1s/packages/calendar/src/tools.ts`
- `~/Jarv1s/packages/calendar/src/focus-time.ts`
- `~/Jarv1s/packages/chat/src/calendar-write-impl.ts`
- `~/Jarv1s/packages/briefings/src/signals.ts`
- `~/Jarv1s/packages/briefings/src/feedback-*`
- `~/Jarv1s/packages/usefulness-feedback`
- `~/Jarv1s/packages/ai/src/action-policy-*`
