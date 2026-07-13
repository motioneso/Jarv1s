# Relay: #985 true YOLO build — mid Task 2

Plan: `docs/superpowers/plans/2026-07-12-true-yolo-approval-hardening.md` (approved by
UX Coordinator, session `019f5a2e-03fd-71c3-95ab-1934cb1de973`, label `UX Coordinator`).

**Status: plan approved, chat-drawer.tsx `activityVerb()` hunk lock RELEASED (2026-07-13,
#984 committed `a0989815`, confirmed no conflict). Zero commits yet on this lane. Currently
mid-Task-2, grounding done, no edits written yet.**

## Order (per plan): Task 2 → Task 1 → Task 3 → Task 4

## Task 2 — outcome enum widening (IN PROGRESS, not yet edited)

Grounded current file contents (all read fresh this session, safe to Edit without re-Read):

- `packages/ai/src/gateway/types.ts:38` — `action_result.outcome: "executed" | "denied" | "error"`
  → add `| "allowed"`.
- `packages/chat/src/live/types.ts:21` — `TranscriptRecord.outcome?: "executed" | "denied" |
  "error"` → add `| "allowed"`.
- `packages/chat/src/gateway-notifier.ts:34` — `const verb = record.outcome === "executed" ?
  "Executed" : "Denied";` → 3-way branch adding `"allowed"` → `"Allowed by YOLO"` (exact
  replacement code in the plan doc, Task 2 Step 5).
- `apps/web/src/chat/use-chat-stream.ts:36` (type) and `:140-143` (`parseRecord` whitelist) →
  add `"allowed"` to both (exact code in plan doc, Task 2 Steps 9).
- **Now also in scope (lock released):** `apps/web/src/chat/chat-drawer.tsx:688-693`
  `activityVerb()` — same 3-way branch as gateway-notifier.ts:
  ```ts
  function activityVerb(record: TranscriptRecord): string {
    if (record.kind === "action_result") {
      return record.outcome === "allowed"
        ? "Allowed by YOLO"
        : record.outcome === "executed"
          ? "Executed"
          : "Denied";
    }
    return `${record.kind} ·`;
  }
  ```
  Coordinator directive: ship this atomically with Task 1/2, not deferred. Stage this file
  explicitly (it's otherwise #984-locked — only this one hunk is released). Do not touch
  anything else in chat-drawer.tsx.

Existing test file `tests/unit/gateway-notifier.test.ts` already exists (confirmed via grep,
not yet read) — extend it rather than creating a new file (plan doc's Step 1 suggested a new
file only if none existed; one does, use it).

`tests/unit/action-request-card-preview.test.tsx` already read in full this session (71
lines) — its `parseRecord preview parsing` describe block is where the `use-chat-stream.ts`
`"allowed"` whitelist test goes (plan Task 2 Step 7).

## Task 1 — gateway native YOLO parity (NOT STARTED)

Full spec + exact code skeleton is in the plan doc Task 1 (all 11 steps have complete code,
no placeholders, except integration Step 9 which has scaffolding comments — read
`tests/integration/chat-mcp-transport.test.ts`'s existing `registerNativePermissionRoute`
tests first to copy the real harness shape before writing those two tests for real).

Key facts already grounded (from before this handoff, still valid — file unlikely to have
changed since only #985 owns it):
- `packages/ai/src/gateway/gateway.ts`, 576 lines. `callTool`'s yolo branch is at line 132.
  `requestNativeToolPermission` currently lines 165-220, no yoloMode check.
- `recordAudit` private method ~line 521-559, needs the `recordAuditRaw`/`recordAudit` split
  (exact code in plan Task 1 Step 5).
- Constants already exist: `NATIVE_TOOL_MODULE_ID`, `NATIVE_TOOL_MODULE_NAME`, helpers
  `safeNativeToolName`, `nativeToolRisk`, `nativeToolSummary` (lines 562-576).
- `AssistantToolGatewayDependencies` already declares `yoloMode?` and `resolveLocalTimezone?`
  as optional deps (lines 34, 54) — plumbing exists, only the method body needs to consult it.
- **Re-read `gateway.ts` fresh before editing** — it was read in full in an earlier
  (pre-compaction) part of this session; contents haven't been touched by this lane since,
  but do a fresh Read per tool-use rules before the first Edit.

## Task 3 / Task 4 — NOT STARTED

Full detail in plan doc. Task 3 targets `apps/web/src/chat/action-request-card.tsx` (85
lines, already read in full pre-compaction). Task 4 creates
`apps/web/src/shared/use-dismissable-menu.ts` + converts 5 call sites (chat-model-pill.tsx,
briefing-feedback-menu.tsx, settings-admin-panes.tsx `PersonRow`, tasks-page.tsx
`ListFilterMenu`, task-details-sections.tsx `TaskStatusControl`) — all 5 files' current
structure is captured in the plan doc's Task 4 steps with exact before/after code.

## Constraints (unchanged, still binding)

- Fail-closed only-literal-`true` YOLO auto-grant.
- Outcome `"allowed"` never `"executed"` for native auto-grants.
- No new "Always approve" control.
- Zero `kit-chat.css` changes anywhere in this build.
- Stage explicit paths only, never `git add -A`.
- Commit per task, `Co-Authored-By: Claude`.
- `apps/web/src/api/client.ts` and chat session manager/persistence/live routes remain
  locked (not released — only the one `chat-drawer.tsx` `activityVerb()` hunk was).
- Coordinator note: "stop if a rebase conflict reaches beyond that hunk" in chat-drawer.tsx.

## Next action

Implement Task 2's 5 file edits + tests (use plan doc's exact code), run
`pnpm vitest run tests/unit/gateway-notifier.test.ts tests/unit/action-request-card-preview.test.tsx`,
then commit Task 2 (staged paths: the 5 files above + their test files). Then proceed to
Task 1.
