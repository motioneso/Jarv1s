# Relay: #985 true YOLO / approval / menu hardening

Spec: `docs/superpowers/specs/2026-07-12-true-yolo-approval-popover-hardening.md`
Handoff: `docs/coordination/handoff-985-yolo-approvals.md`
Branch/worktree: `ux/985-yolo-approvals` (this worktree). Coordinator label `UX Coordinator`,
session `019f5a2e-03fd-71c3-95ab-1934cb1de973`.

**Status: grounding complete, zero code written, zero commits.** Plan not yet written. Do NOT
skip the coordinator plan-approval gate — message before any feature edit.

## What's done

Read in full: handoff doc, spec, `packages/ai/src/gateway/gateway.ts` (576 lines),
`packages/chat/src/mcp-transport.ts`, `packages/ai/src/repository.ts` audit/pending-action shapes,
`packages/chat/src/gateway-notifier.ts`, `packages/chat/src/live/types.ts`, `apps/web/src/chat/
use-chat-stream.ts`, `apps/web/src/chat/action-request-card.tsx`, `tests/unit/
mcp-gateway-units.test.ts` (native-permission describe block, lines 173-259). Read-only grep of
`chat-drawer.tsx`, `chat-model-pill.tsx`, `briefing-feedback-menu.tsx`, `tasks-page.tsx`
(`ListFilterMenu`), `task-details-sections.tsx` (`TaskStatusControl`), `settings-admin-panes.tsx`.
codebase-memory MCP tools are NOT wired into this session's toolset — grounded via Grep/Read
instead (confirmed, don't retry it).

## Locked design decisions — implement these, don't re-derive

**1. Native YOLO parity (`packages/ai/src/gateway/gateway.ts`, owned).**
`requestNativeToolPermission` (currently lines 165-220) has NO yoloMode check today — that's the
bug. Mirror the pattern already at line 132 (`callTool`'s yolo branch), fail-closed:
`(await this.deps.yoloMode?.(ctx)) === true` — only literal `true` auto-grants.

On YOLO true: **skip `createPendingAssistantAction` and `confirmations.awaitResolution` entirely**
(no pending DB row, no card shown — spec Decision 2: no per-action confirmation UI on auto-grant).
Instead:
- emit `notifier.emit(chatSessionId, { kind: "action_result", actionRequestId: requestId,
  toolName, outcome: "allowed" })` — new outcome value, see task 2.
- record an audit row with `approvalMode: "yolo"`, `outcome: "success"`.
- return `{ decision: "allow", reason: "Allowed by YOLO." }` immediately.

On no-YOLO (false/missing/throw): existing behavior unchanged (create pending action, emit
`action_request`, await, existing "executed"/"denied" outcomes on resolution) — do NOT touch that
path's outcome strings.

**Audit-record refactor needed:** `recordAudit` (private method, ~line 521) takes `found:
ExecutableTool`, which native tool requests don't have (no manifest/dto — it's a synthetic
`NATIVE_TOOL_MODULE_ID`/`NATIVE_TOOL_MODULE_NAME` pair). Split it:
```ts
private async recordAuditRaw(
  access: AccessContext,
  fields: { toolModuleId: string; toolName: string; actionFamilyId: string | null; actionKind: "write" | "destructive" },
  opts: { approvalMode: InsertAuditLogInput["approvalMode"]; outcome: InsertAuditLogInput["outcome"]; errorClass?: string | null; chatSessionId?: string }
): Promise<void> {
  // same try/catch/console.error body currently in recordAudit, using fields.* instead of found.dto/found.tool
}

private async recordAudit(access: AccessContext, found: ExecutableTool, opts): Promise<void> {
  return this.recordAuditRaw(access, {
    toolModuleId: found.dto.moduleId,
    toolName: found.dto.name,
    actionFamilyId: found.tool.actionFamilyId ?? null,
    actionKind: found.tool.risk as "write" | "destructive"
  }, opts);
}
```
Native YOLO branch calls `recordAuditRaw` directly with `{ toolModuleId: NATIVE_TOOL_MODULE_ID,
toolName, actionFamilyId: null, actionKind: nativeToolRisk(toolName) }`.

Confirm-path unchanged: `resolveActionRequest` (lines 276-300, #979 deterministic wait) — do not
touch.

**2. Widen the outcome enum — add `"allowed"` (truthful auto-grant, not "executed" since Jarvis
never observes native execution). Touch every one of these, all in this lane except the escalation
noted below:**
- `packages/ai/src/gateway/types.ts` — `SessionNotifier`/`action_result` outcome union: add
  `"allowed"` alongside `"executed" | "denied" | "error"`.
- `packages/chat/src/live/types.ts:21` — `TranscriptRecord.outcome?: "executed" | "denied" |
  "error"` → add `"allowed"`.
- `packages/chat/src/gateway-notifier.ts:34` — `toTranscriptRecord()`:
  `const verb = record.outcome === "executed" ? "Executed" : "Denied";` → add a branch:
  `record.outcome === "allowed" ? "Allowed by YOLO" : record.outcome === "executed" ? "Executed" :
  "Denied"`.
- `apps/web/src/chat/use-chat-stream.ts` — `parseRecord()` whitelist currently only accepts
  `"executed" | "denied" | "error"` from SSE data; add `"allowed"` or it silently drops to
  `undefined`.

**ESCALATE, do not edit silently:** `apps/web/src/chat/chat-drawer.tsx` is #984-locked. Its
`activityVerb()` (~line 689-691) does the same `outcome === "executed" ? "Executed" : "Denied"`
check. If left unpatched, a genuine YOLO auto-grant renders as **"Denied"** in the drawer — an
active falsehood, worse than doing nothing. This is the one hunk that needs an explicit lock
release from `UX Coordinator` per the handoff doc's own instruction ("identify the exact hunk and
wait for an explicit lock release"). Flag this in the plan message; do not touch the file until
released.

**3. Compact/truthful approval card (`apps/web/src/chat/action-request-card.tsx`, owned, 85
lines).** Confirmed baseline: no "Always approve" control exists today — keep it that way (spec
Decision 7). Content-hierarchy hardening (Decision 6) not yet spec'd into concrete diffs by me —
read spec Decision 6 fresh in the next session before writing the task (I did not finalize exact
before/after markup).

**4. Shared true-menu hook (owned; new file, e.g. `apps/web/src/shared/use-dismissable-menu.ts` —
name it whatever fits repo convention, no existing precedent). Confirmed via grep: zero existing
shared dismiss primitive anywhere in `apps/web/src` (`useDismissableMenu`, `useOutsideClick`,
`useClickOutside`, `useMenu` all zero hits; `apps/web/src/rail/` doesn't exist).** Needs: outside
pointerdown dismiss, Escape dismiss, single-shot-selection dismiss, focus-return-to-trigger.
Apply to:
- `apps/web/src/chat/chat-model-pill.tsx` (lines 88-110) — currently `<details>`-based, convert.
- `apps/web/src/today/briefing-feedback-menu.tsx` — currently `<details>`-based, convert.
- `apps/web/src/settings/settings-admin-panes.tsx` (~lines 100-200) — currently scrim-div pattern,
  no Escape handling, convert.
- `apps/web/src/tasks/tasks-page.tsx` `ListFilterMenu` (~lines 500-610) — already has ref+mousedown
  dismiss, missing Escape + focus-return; multi-select so it does NOT auto-close on selection
  (spec allows this).
- `apps/web/src/tasks/task-details-sections.tsx` `TaskStatusControl` (~lines 200-270) — same
  ref+mousedown pattern, already single-shot-closes on selection, missing Escape + focus-return.

Do NOT touch `<details>`-based disclosure panels that aren't menus (e.g. chat-drawer's "Behind the
scenes" activity peek) — spec explicitly says disclosures keep normal behavior.

## Test conventions to follow

`tests/unit/mcp-gateway-units.test.ts` `describe("native Claude tool permission bridge", ...)`
(lines 173-259): gateway constructed with mocked `resolveActiveModules`,
`repository.createPendingAssistantAction`, `runner.withDataContext` (just invokes `work({})`),
real `tokens: new SessionTokenRegistry()`, real `confirmations: new ConfirmationRegistry()`,
`notifier: {emit: (_chatSessionId, record) => emitted.push(record)}`, `confirmTimeoutMs`. Mirror
this shape for new tests, adding `yoloMode` to deps. Cover: literal true (auto-grant, no pending
row created, outcome "allowed"), false, missing resolver, resolver throw (all three fail closed to
existing confirm flow) per handoff's non-negotiable checks list. Also extend
`tests/integration/chat-mcp-transport.test.ts` for destructive/external/master-off/account-revoked
paths per handoff.

## Next steps (in order)

1. Read spec Decision 6 (approval card) fresh — I did not finalize its diff.
2. Write the plan via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-12-true-yolo-approval-hardening.md`, covering the 4 tasks above + the chat-drawer.tsx escalation as an explicit named item.
3. `herdr pane list`, confirm exactly one `UX Coordinator` pane, message it via `herdr-pane-message` with the plan path + the escalation ask. **STOP and wait for approval — no feature code before that.**
4. On approval: build task-by-task via `superpowers:test-driven-development`, commit per task (`Co-Authored-By: Claude`), stage explicit paths only.
5. Pre-push trio + rebase, then `coordinated-wrap-up` (push, PR, report — never merge).
