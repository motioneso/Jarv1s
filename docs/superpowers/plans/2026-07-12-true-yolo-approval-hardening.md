# True YOLO / Approval Card / Menu Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude-native tool permission requests honor the same fail-closed YOLO resolver MCP/module tools already use, widen the outcome enum with a truthful `"allowed"` value, harden the approval card's content hierarchy and focus handling, and replace ad hoc dismiss logic at 5 non-drawer menu call sites with one shared dismissable-menu hook.

**Architecture:** Four independent, sequentially-safe tasks. Task 1 (gateway) and Task 2 (enum widening) are tightly coupled — Task 1 emits the new `"allowed"` outcome that Task 2's types/consumers must accept, so Task 2 must land before or atomically with Task 1's emission point. Task 3 (approval card) and Task 4 (menu hook) are independent of 1/2 and of each other. Order: Task 2 → Task 1 → Task 3 → Task 4.

**Tech Stack:** TypeScript, Fastify, Vitest (`tests/unit/*.test.ts(x)`, node environment — no jsdom, use `renderToString`), `tsx scripts/test-integration.ts` for integration tests, React 18 (no RTL).

## Global Constraints

- Fail-closed: only literal `true` from `yoloMode` auto-grants. Missing resolver, thrown error, or any non-`true` value falls through to existing confirm flow unchanged.
- Native auto-grants must emit outcome `"allowed"`, never `"executed"` (Jarvis cannot observe native execution).
- YOLO must never grant a provider/tool capability and must never add bypass CLI flags.
- No new "Always approve" control anywhere (spec Decision 7 — already absent from `action-request-card.tsx`, keep it that way).
- Disclosure panels (e.g. chat-drawer's "Behind the scenes" `<details>`) are NOT menus — do not convert them.
- Locked paths, do not edit without explicit release: `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/styles/kit-chat.css`, chat session manager/persistence/live routes.
- Stage explicit paths only. Never `git add -A`. Never run repo-wide formatting.
- Commit per task, `Co-Authored-By: Claude`.

---

### Task 1: Native YOLO parity in the gateway

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts:165-220` (`requestNativeToolPermission`)
- Modify: `packages/ai/src/gateway/gateway.ts:521-559` (`recordAudit` → split into `recordAuditRaw` + `recordAudit`)
- Test: `tests/unit/mcp-gateway-units.test.ts` (extend `describe("native Claude tool permission bridge", ...)`, lines 173-259)

**Interfaces:**

- Consumes: `this.deps.yoloMode?: (ctx: ToolContext) => Promise<boolean>` (already declared, `gateway.ts:34`). `ToolContext` from `@jarv1s/module-sdk`: `{ actorUserId, requestId, chatSessionId, localTimezone? }`.
- Produces: `notifier.emit(chatSessionId, { kind: "action_result", actionRequestId, toolName, outcome: "allowed" })` — Task 2 must accept this literal in its type unions. `requestNativeToolPermission` still returns `{ decision: "allow" | "deny", reason: string }`.

- [ ] **Step 1: Write failing test — literal true auto-grants, no pending row, outcome "allowed"**

Add to `tests/unit/mcp-gateway-units.test.ts` inside `describe("native Claude tool permission bridge", ...)`:

```ts
it("auto-grants when yoloMode resolves literal true, with no pending action row", async () => {
  const emitted: unknown[] = [];
  let createPendingCalled = false;
  const gateway = new AssistantToolGateway({
    resolveActiveModules: async () => [],
    repository: {
      createPendingAssistantAction: async () => {
        createPendingCalled = true;
        return { id: "pending_1" };
      },
      insertActionAuditLog: async () => {}
    } as never,
    runner: { withDataContext: async (_access, work) => work({}) } as never,
    tokens: new SessionTokenRegistry(),
    confirmations: new ConfirmationRegistry(),
    notifier: { emit: (_chatSessionId, record) => emitted.push(record) },
    confirmTimeoutMs: 50,
    yoloMode: async () => true
  } as never);

  const token = gateway.issueSessionToken({ actorUserId: "u1", chatSessionId: "c1" } as never);
  const result = await gateway.requestNativeToolPermission(token, {
    toolName: "Read",
    input: { file_path: "/tmp/x" }
  } as never);

  expect(result).toEqual({ decision: "allow", reason: "Allowed by YOLO." });
  expect(createPendingCalled).toBe(false);
  expect(emitted).toEqual([
    expect.objectContaining({ kind: "action_result", toolName: "Read", outcome: "allowed" })
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "auto-grants when yoloMode"`
Expected: FAIL — `yoloMode` unused, `requestNativeToolPermission` always creates a pending action.

- [ ] **Step 3: Write failing tests — false, missing resolver, resolver throw all fall closed**

```ts
it.each([
  ["false", async () => false],
  ["missing resolver", undefined],
  [
    "resolver throws",
    async () => {
      throw new Error("boom");
    }
  ]
])("falls back to normal confirmation when yoloMode is %s", async (_label, yoloMode) => {
  const emitted: unknown[] = [];
  let createPendingCalled = false;
  const gateway = new AssistantToolGateway({
    resolveActiveModules: async () => [],
    repository: {
      createPendingAssistantAction: async () => {
        createPendingCalled = true;
        return { id: "pending_1" };
      },
      insertActionAuditLog: async () => {}
    } as never,
    runner: { withDataContext: async (_access, work) => work({}) } as never,
    tokens: new SessionTokenRegistry(),
    confirmations: new ConfirmationRegistry(),
    notifier: { emit: (_chatSessionId, record) => emitted.push(record) },
    confirmTimeoutMs: 50,
    yoloMode
  } as never);

  const token = gateway.issueSessionToken({ actorUserId: "u1", chatSessionId: "c1" } as never);
  const pending = gateway.requestNativeToolPermission(token, {
    toolName: "Read",
    input: { file_path: "/tmp/x" }
  } as never);

  await vi.waitFor(() => expect(createPendingCalled).toBe(true));
  const requestRecord = emitted.find(
    (r): r is { actionRequestId: string } =>
      typeof r === "object" && r !== null && (r as { kind?: string }).kind === "action_request"
  );
  expect(requestRecord).toBeDefined();
  gateway.confirmations.resolve(requestRecord!.actionRequestId, "confirmed");
  const result = await pending;
  expect(result.decision).toBe("allow");
  expect(emitted).toContainEqual(
    expect.objectContaining({ kind: "action_result", outcome: "executed" })
  );
});
```

- [ ] **Step 4: Run tests to verify they fail or pass vacuously**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "falls back to normal confirmation"`
Expected: PASS already (no yoloMode check exists yet, so behavior is already "always confirm") — this test locks in the fail-closed baseline before the new branch is added, and must stay green after Step 5.

- [ ] **Step 5: Split `recordAudit` into `recordAuditRaw` + `recordAudit`**

In `packages/ai/src/gateway/gateway.ts`, find the existing `private async recordAudit(access: AccessContext, found: ExecutableTool, opts: {...}): Promise<void> { try { ... } catch (error) { console.error(...) } }` (~line 521). Replace it with:

```ts
private async recordAuditRaw(
  access: AccessContext,
  fields: {
    toolModuleId: string;
    toolName: string;
    actionFamilyId: string | null;
    actionKind: "write" | "destructive";
  },
  opts: {
    approvalMode: InsertAuditLogInput["approvalMode"];
    outcome: InsertAuditLogInput["outcome"];
    errorClass?: string | null;
    chatSessionId?: string;
  }
): Promise<void> {
  try {
    await this.deps.runner.withDataContext(access, async (db) => {
      await this.deps.repository.insertActionAuditLog(db, {
        actorUserId: access.actorUserId,
        toolModuleId: fields.toolModuleId,
        toolName: fields.toolName,
        actionFamilyId: fields.actionFamilyId,
        actionKind: fields.actionKind,
        approvalMode: opts.approvalMode,
        outcome: opts.outcome,
        errorClass: opts.errorClass ?? null,
        chatSessionId: opts.chatSessionId ?? null
      });
    });
  } catch (error) {
    console.error("Failed to record action audit log", error);
  }
}

private async recordAudit(
  access: AccessContext,
  found: ExecutableTool,
  opts: {
    approvalMode: InsertAuditLogInput["approvalMode"];
    outcome: InsertAuditLogInput["outcome"];
    errorClass?: string | null;
    chatSessionId?: string;
  }
): Promise<void> {
  return this.recordAuditRaw(
    access,
    {
      toolModuleId: found.dto.moduleId,
      toolName: found.dto.name,
      actionFamilyId: found.tool.actionFamilyId ?? null,
      actionKind: found.tool.risk as "write" | "destructive"
    },
    opts
  );
}
```

Keep the exact field names/shape the original `insertActionAuditLog` call used — copy them from the current body rather than retyping from memory; if the current call site differs from the sketch above (e.g. extra fields), preserve those fields verbatim inside `recordAuditRaw`.

- [ ] **Step 6: Run existing gateway tests to confirm the refactor is behavior-preserving**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts`
Expected: PASS (all existing tests, including the two new ones from Steps 1 and 3, are green — Step 3's test passes because behavior hasn't changed yet).

- [ ] **Step 7: Implement the YOLO branch in `requestNativeToolPermission`**

In `packages/ai/src/gateway/gateway.ts`, at the top of `requestNativeToolPermission` (after token verification and after `requestId`/`access` are built, before `createPendingAssistantAction` is called), insert:

```ts
const ctx: ToolContext = {
  actorUserId: access.actorUserId,
  requestId: access.requestId,
  chatSessionId: session.chatSessionId,
  localTimezone: (await this.deps.resolveLocalTimezone?.(access.actorUserId)) ?? undefined
};

if ((await this.deps.yoloMode?.(ctx)) === true) {
  const toolName = safeNativeToolName(request.toolName);
  this.deps.notifier.emit(session.chatSessionId, {
    kind: "action_result",
    actionRequestId: requestId,
    toolName,
    outcome: "allowed"
  });
  void this.recordAuditRaw(
    access,
    {
      toolModuleId: NATIVE_TOOL_MODULE_ID,
      toolName,
      actionFamilyId: null,
      actionKind: nativeToolRisk(toolName)
    },
    { approvalMode: "yolo", outcome: "success", chatSessionId: session.chatSessionId }
  );
  return { decision: "allow", reason: "Allowed by YOLO." };
}
```

Adjust variable names (`session`, `access`, `requestId`, `request`) to match whatever the existing method body actually calls them — read the current method body first and slot this branch in using its real local names; do not introduce new names that shadow existing ones. Import `ToolContext` from `@jarv1s/module-sdk` at the top of the file if not already imported.

- [ ] **Step 8: Run the new tests to verify they now pass**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "auto-grants when yoloMode"`
Expected: PASS.

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "falls back to normal confirmation"`
Expected: PASS (still — false/missing/throw all skip the new branch).

- [ ] **Step 9: Add destructive-path and master-off/account-revoke integration coverage**

Add to `tests/integration/chat-mcp-transport.test.ts` (new `describe("native permission YOLO", ...)` block, following the file's existing setup pattern for `registerNativePermissionRoute`):

```ts
describe("native permission YOLO", () => {
  it("auto-grants a destructive native tool when yoloMode is true", async () => {
    // Build the transport with a yoloMode dep that resolves true, POST to the
    // native permission route with toolName "Bash", assert response body
    // { decision: "allow" } and no pending row was created (query the
    // pending-actions table or assert via a spy on createPendingAssistantAction,
    // matching this file's existing assertion style for other routes).
  });

  it("does not auto-grant when the actor's account is revoked", async () => {
    // Build yoloMode to reflect the master-off/account-revoked condition this
    // repo already uses elsewhere for yolo resolution (mirror however
    // yoloMode is wired in the real app — check packages/settings or the
    // route that constructs AssistantToolGateway's deps for the actual
    // revoke-check composition), assert decision falls through to the
    // existing confirm-then-timeout-deny path.
  });
});
```

Before writing the real bodies, grep `tests/integration/chat-mcp-transport.test.ts` for how `registerNativePermissionRoute` is exercised in existing tests (request shape, auth header, app construction) and copy that scaffolding exactly — do not invent a different test harness shape for these two tests.

- [ ] **Step 10: Run full integration file**

Run: `tsx scripts/test-integration.ts tests/integration/chat-mcp-transport.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts tests/unit/mcp-gateway-units.test.ts tests/integration/chat-mcp-transport.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): native tool permission requests honor effective YOLO

requestNativeToolPermission now consults the same yoloMode resolver
callTool already uses, fail-closed to normal confirmation on
false/missing/throw. Auto-grants skip the pending-action row and
confirmation UI entirely and emit outcome "allowed" (never
"executed", since native execution isn't observable). Audit logging
split into recordAuditRaw so the native path (no ExecutableTool) can
still write an audit row.

User-facing: none directly — this closes a gap where "Approve
everything automatically" didn't apply to Claude's own tool calls
(file edits, bash, etc.), only to connector/module tools.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Widen the outcome enum to include `"allowed"`

**Files:**

- Modify: `packages/ai/src/gateway/types.ts` (`action_result` outcome union)
- Modify: `packages/chat/src/live/types.ts:21` (`TranscriptRecord.outcome`)
- Modify: `packages/chat/src/gateway-notifier.ts:34` (`toTranscriptRecord()` verb mapping)
- Modify: `apps/web/src/chat/use-chat-stream.ts:36` (local `TranscriptRecord.outcome` type) and `:140-143` (`parseRecord()` whitelist)
- Test: `tests/unit/gateway-notifier.test.ts` if it exists (grep first), else add a focused test file `tests/unit/gateway-notifier-outcome.test.ts`
- Test: extend `tests/unit/action-request-card-preview.test.tsx`'s `parseRecord` describe block

**Interfaces:**

- Produces: `outcome: "executed" | "denied" | "error" | "allowed"` consumed by Task 1's emission and by chat-drawer's `activityVerb()` (escalation, not edited by this lane).

- [ ] **Step 1: Write failing test for `toTranscriptRecord` verb mapping**

Grep first: `grep -n "toTranscriptRecord" packages/chat/src/gateway-notifier.ts tests/unit/*.test.ts`. If no existing test file covers this function, create `tests/unit/gateway-notifier-outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toTranscriptRecord } from "../../packages/chat/src/gateway-notifier.js";

describe("toTranscriptRecord outcome verb", () => {
  it("renders an allowed outcome as 'Allowed by YOLO'", () => {
    const record = toTranscriptRecord({
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "Read",
      outcome: "allowed"
    } as never);
    expect(record).toMatchObject({ text: expect.stringContaining("Allowed by YOLO") });
  });

  it("still renders executed and denied outcomes unchanged", () => {
    const executed = toTranscriptRecord({
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "Read",
      outcome: "executed"
    } as never);
    expect(executed).toMatchObject({ text: expect.stringContaining("Executed") });

    const denied = toTranscriptRecord({
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "Read",
      outcome: "denied"
    } as never);
    expect(denied).toMatchObject({ text: expect.stringContaining("Denied") });
  });
});
```

Read the actual return shape of `toTranscriptRecord` first (it may return `{verb, ...}` rather than `{text}` — match Step 1's assertions to the real field name, not the guess above).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/gateway-notifier-outcome.test.ts`
Expected: FAIL — TypeScript error or `outcome: "allowed"` not assignable, or verb falls through to "Denied".

- [ ] **Step 3: Widen `packages/ai/src/gateway/types.ts`**

Change the `action_result` variant's outcome field from:

```ts
readonly outcome: "executed" | "denied" | "error";
```

to:

```ts
readonly outcome: "executed" | "denied" | "error" | "allowed";
```

- [ ] **Step 4: Widen `packages/chat/src/live/types.ts:21`**

Change:

```ts
outcome?: "executed" | "denied" | "error";
```

to:

```ts
outcome?: "executed" | "denied" | "error" | "allowed";
```

- [ ] **Step 5: Update `packages/chat/src/gateway-notifier.ts:34`**

Change:

```ts
const verb = record.outcome === "executed" ? "Executed" : "Denied";
```

to:

```ts
const verb =
  record.outcome === "allowed"
    ? "Allowed by YOLO"
    : record.outcome === "executed"
      ? "Executed"
      : "Denied";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/gateway-notifier-outcome.test.ts`
Expected: PASS.

- [ ] **Step 7: Write failing test for `use-chat-stream.ts` `parseRecord` whitelist**

Add to `tests/unit/action-request-card-preview.test.tsx`'s `describe("parseRecord preview parsing", ...)` block:

```ts
it("accepts an allowed outcome on an action_result record", () => {
  const record = parseRecord(
    JSON.stringify({
      kind: "action_result",
      actionRequestId: "ar_1",
      toolName: "Read",
      outcome: "allowed"
    })
  );
  expect(record?.outcome).toBe("allowed");
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx -t "accepts an allowed outcome"`
Expected: FAIL — `record?.outcome` is `undefined` (whitelist drops unknown values).

- [ ] **Step 9: Widen `apps/web/src/chat/use-chat-stream.ts`**

At line 36, change:

```ts
readonly outcome?: "executed" | "denied" | "error";
```

to:

```ts
readonly outcome?: "executed" | "denied" | "error" | "allowed";
```

At lines 140-143, change:

```ts
outcome:
  parsed.outcome === "executed" || parsed.outcome === "denied" || parsed.outcome === "error"
    ? parsed.outcome
    : undefined,
```

to:

```ts
outcome:
  parsed.outcome === "executed" ||
  parsed.outcome === "denied" ||
  parsed.outcome === "error" ||
  parsed.outcome === "allowed"
    ? parsed.outcome
    : undefined,
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 11: Commit**

```bash
git add packages/ai/src/gateway/types.ts packages/chat/src/live/types.ts packages/chat/src/gateway-notifier.ts apps/web/src/chat/use-chat-stream.ts tests/unit/gateway-notifier-outcome.test.ts tests/unit/action-request-card-preview.test.tsx
git commit -m "$(cat <<'EOF'
feat(chat): widen action_result outcome enum with truthful "allowed"

A YOLO auto-grant on a native tool isn't the same claim as "executed"
(Jarvis never observes native execution results) or "denied". Thread
a new "allowed" outcome through the gateway types, live transcript
types, the notifier's verb mapping, and the web SSE parser's
whitelist, so the transcript can say "Allowed by YOLO" instead of
silently dropping the field or (worse) defaulting to "Denied".

User-facing: activity entries for auto-approved actions will read
"Allowed by YOLO" instead of being mislabeled once the drawer's own
verb mapping picks this up (tracked separately, drawer is locked to
another lane).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Approval card content hierarchy + focus return (Decision 6)

**Files:**

- Modify: `apps/web/src/chat/action-request-card.tsx` (85 lines)
- Test: `tests/unit/action-request-card-preview.test.tsx`

**Interfaces:**

- Consumes: existing props `{ actionRequestId, toolName, summary, preview? }`; existing `.action-request-preview__label` CSS class (from locked `kit-chat.css`, read-only reuse, no new/modified CSS).
- Produces: no change to the component's public prop shape.

- [ ] **Step 1: Write failing test — action name is visibly rendered**

Add to `tests/unit/action-request-card-preview.test.tsx`'s `describe("ActionRequestCard email preview", ...)` block:

```ts
it("renders the tool name as a distinct label, not just buried in summary", () => {
  const html = renderToString(createElement(ActionRequestCard, baseProps));
  expect(html).toContain("action-request-preview__label");
  expect(html).toContain("email.draftReply");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx -t "renders the tool name"`
Expected: FAIL — `toolName` prop is accepted but never rendered in the current component body.

- [ ] **Step 3: Render the tool name label**

Read `apps/web/src/chat/action-request-card.tsx` first to find the exact JSX structure around the summary (`props.summary`) line. Immediately above the summary paragraph, add a label line reusing the existing class:

```tsx
<div className="action-request-preview__label">{humanizeToolName(props.toolName)}</div>
```

Add a small helper above the component (no new CSS, no new dependency):

```ts
function humanizeToolName(toolName: string): string {
  const last = toolName.includes(".") ? toolName.split(".").pop()! : toolName;
  return last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
```

If the file already imports nothing else from React beyond what's needed, keep this helper function-only (no new imports required).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx -t "renders the tool name"`
Expected: PASS.

- [ ] **Step 5: Confirm no "Always approve" control and Approve-primary/Reject-secondary ordering (regression guard)**

Add:

```ts
it("never renders an Always-approve control, and orders Approve before Reject", () => {
  const html = renderToString(createElement(ActionRequestCard, baseProps));
  expect(html).not.toMatch(/always approve/i);
  expect(html.indexOf("Approve")).toBeLessThan(html.indexOf("Reject"));
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx -t "never renders an Always-approve"`
Expected: PASS (already true in the current implementation — this step is a regression guard, not a behavior change).

- [ ] **Step 7: Add focus-return on status transition to done/error**

Read the component's current `status` state machine and root element (`<div className="action-request-card" role="region" aria-label="Action request">`). Add:

```tsx
import { useEffect, useRef, useState } from "react";
```

(merge with the existing React import line rather than duplicating it — check what's already imported first). Inside the component body:

```ts
const rootRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (status === "done" || status === "error") {
    rootRef.current?.focus();
  }
}, [status]);
```

On the root `<div>`, add `ref={rootRef}` and `tabIndex={-1}`:

```tsx
<div className="action-request-card" role="region" aria-label="Action request" ref={rootRef} tabIndex={-1}>
```

This relies on the default browser focus ring (confirmed via grep: no global `outline: none` reset exists in the current stylesheets) — no CSS change needed, so `kit-chat.css` stays untouched.

- [ ] **Step 8: Note focus-restore is not unit-testable here**

`renderToString` is SSR-only (no DOM, no focus APIs) — this repo's `vitest.config.ts` runs `test.environment` as node with no jsdom. Do not attempt a focus assertion in this test file. Add a one-line comment above the `humanizeToolName` test block noting focus-restore is verified via manual dev QA per the project's `e2e-dev-uat-for-ui-features` convention, not a unit test:

```ts
// Focus-return-on-resolve (status → done/error) is verified via manual dev QA;
// renderToString has no DOM/focus APIs to assert against here.
```

- [ ] **Step 9: Run the full test file**

Run: `pnpm vitest run tests/unit/action-request-card-preview.test.tsx`
Expected: PASS (all tests, old and new).

- [ ] **Step 10: Manual dev QA for focus-restore**

Start the dev server (`pnpm dev` or repo's equivalent script, bound to `0.0.0.0` per this project's dev-environment convention), open a chat session, trigger an action request, click Approve, and confirm keyboard focus visibly lands on the card region (not lost to `<body>`) once it resolves to "done". Record the result in the plan-completion report to `UX Coordinator`; this step cannot be automated in this test setup.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/chat/action-request-card.tsx tests/unit/action-request-card-preview.test.tsx
git commit -m "$(cat <<'EOF'
feat(chat): approval card names the action and restores focus on resolve

Decision 6 hardening: the card now shows a distinct action-name label
above the summary (reusing the existing preview label style, no new
CSS) instead of relying on arbitrary summary prose to convey what's
being approved. Focus moves to the card's own region when it resolves
to done/error, instead of being dropped to <body> when the button row
unmounts. No "Always approve" control added (Decision 7 unchanged).

User-facing: approval prompts now show what action is being requested
as its own line, and keyboard focus stays predictable after you
approve or reject.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Shared dismissable-menu hook + 5 call-site conversions

**Files:**

- Create: `apps/web/src/shared/use-dismissable-menu.ts`
- Modify: `apps/web/src/chat/chat-model-pill.tsx:88-110`
- Modify: `apps/web/src/today/briefing-feedback-menu.tsx`
- Modify: `apps/web/src/settings/settings-admin-panes.tsx` (`PersonRow`, ~lines 100-203)
- Modify: `apps/web/src/tasks/tasks-page.tsx` (`ListFilterMenu`, ~lines 514-610)
- Modify: `apps/web/src/tasks/task-details-sections.tsx` (`TaskStatusControl`, lines 201-270)
- Test: `tests/unit/use-dismissable-menu.test.ts` (new)

**Interfaces:**

- Produces: `useDismissableMenu<T extends HTMLElement>(opts: { open: boolean; onClose: () => void; closeOnSelect?: boolean }): { ref: RefObject<T> }` — a ref to attach to the menu's outer container. Pointerdown-outside and Escape both call `onClose`. Focus-return-to-trigger is the caller's responsibility (the hook doesn't own the trigger element) — document this in the hook's own comment and implement it at each call site by calling `.focus()` on the trigger button ref when `open` transitions from `true` to `false`.

- [ ] **Step 1: Write failing unit tests for the hook**

Since this repo's vitest config has no jsdom, the hook can't be tested via a real DOM event dispatch inside `tests/unit/*.test.ts`. Grep first — `grep -rn "environment.*jsdom\|@testing-library" apps/web/package.json vitest.config.ts apps/web/vitest.config.ts 2>/dev/null` — to confirm whether `apps/web` has its own separate Vitest config with jsdom (it may, since it's a Vite app). If `apps/web` has its own jsdom-enabled config, write real DOM tests there:

```ts
// apps/web/src/shared/use-dismissable-menu.test.ts (only if apps/web has its own jsdom vitest config — verify first)
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react"; // only if RTL is present — verify via package.json first
```

If no jsdom config exists for `apps/web`, skip DOM-level automated testing for this hook (do not add a new jsdom dependency — that's outside this task's scope) and instead write a plain-logic unit test against the hook's exported pure helper (see Step 2) plus manual dev QA, noting this explicitly in the plan-completion report.

- [ ] **Step 2: Implement the hook with a pure, testable predicate**

Create `apps/web/src/shared/use-dismissable-menu.ts`:

```ts
import { useEffect, useRef, type RefObject } from "react";

export function isOutsideTarget(container: Element | null, target: EventTarget | null): boolean {
  if (!container) return false;
  return !(target instanceof Node) || !container.contains(target);
}

export function useDismissableMenu<T extends HTMLElement>(opts: {
  readonly open: boolean;
  readonly onClose: () => void;
}): { readonly ref: RefObject<T> } {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!opts.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (isOutsideTarget(ref.current, event.target)) opts.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") opts.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [opts.open, opts.onClose]);

  return { ref };
}
```

- [ ] **Step 3: Write and run a pure-logic test for `isOutsideTarget`**

Create `tests/unit/use-dismissable-menu.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isOutsideTarget } from "../../apps/web/src/shared/use-dismissable-menu.js";

describe("isOutsideTarget", () => {
  it("returns true when the container ref is null", () => {
    expect(isOutsideTarget(null, {} as EventTarget)).toBe(true);
  });

  it("returns true when the target is not a Node", () => {
    const container = { contains: () => true } as unknown as Element;
    expect(isOutsideTarget(container, {} as EventTarget)).toBe(true);
  });
});
```

Run: `pnpm vitest run tests/unit/use-dismissable-menu.test.ts`
Expected: PASS (this is a pure-function test written after the implementation since there's no DOM harness to drive a true red/green cycle here — acceptable given the no-jsdom constraint; the two React call-site conversions below are the real regression surface and are covered by manual dev QA per Step 9).

- [ ] **Step 4: Convert `chat-model-pill.tsx` from `<details>` to the hook**

Read the current file (already grounded: lines 87-111, `<details className="chatd-model">` wrapping a `<summary>` trigger and a `.chatd-model__menu` div). Replace with:

```tsx
import { useState } from "react";
import { useDismissableMenu } from "../shared/use-dismissable-menu.js";
```

(merge with existing imports rather than duplicating `useState` if already imported). Replace the `<details>...</details>` block:

```tsx
const [open, setOpen] = useState(false);
const triggerRef = useRef<HTMLButtonElement>(null);
const { ref: menuRef } = useDismissableMenu<HTMLDivElement>({
  open,
  onClose: () => {
    setOpen(false);
    triggerRef.current?.focus();
  }
});

// ...

<div className="chatd-model" ref={menuRef}>
  <button
    type="button"
    ref={triggerRef}
    className="chatd-model__trigger"
    onClick={() => setOpen((o) => !o)}
    aria-expanded={open}
  >
    <GitCommitHorizontal size={13} aria-hidden="true" />
    <span>{active?.providerModelId ?? "Instance default"}</span>
    <ChevronDown size={13} aria-hidden="true" />
  </button>
  {open ? (
    <div className="chatd-model__menu">
      {choices.map((choice) => (
        <button
          key={choice.modelId ?? "default"}
          type="button"
          disabled={props.disabled || mutation.isPending}
          onClick={() => {
            selectChoice(choice);
            setOpen(false);
          }}
        >
          <span>
            <b>{choice.label}</b>
            <small>{choice.providerLabel}</small>
          </span>
          {choice.selected ? <Check size={13} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  ) : null}
</div>;
```

Add `import { useRef } from "react";` if not already present. The `<summary>`/`<details>` markup and its default browser styling are gone — check `chat-model-pill.css` (this file's own colocated stylesheet, not the locked `kit-chat.css`) for any `details`/`summary` selectors that need to become plain-class selectors; if present, update them to target `.chatd-model__trigger` and a conditional-render `.chatd-model__menu` instead of `details[open] > .chatd-model__menu` (this stylesheet is owned by this lane, not locked).

- [ ] **Step 5: Convert `briefing-feedback-menu.tsx` from `<details>` to the hook**

Same pattern as Step 4, applied to `BriefingFeedbackMenu`'s `<details className="today-feedback__details">` block (grounded: lines 60-96). Replace with `useState` + `useDismissableMenu` + a trigger `<button>` with `ref={triggerRef}` and `aria-expanded={open}`, and a conditionally-rendered `.today-feedback__list` div carrying `ref={menuRef}`. Each item's `onClick` should call `setOpen(false)` after its mutation dispatch (single-shot dismiss). Check this file's colocated CSS (if any, e.g. a `today-feedback.css` or a shared `today.css`) for `details`/`summary` selectors needing the same conditional-class update as Step 4.

- [ ] **Step 6: Convert `settings-admin-panes.tsx` `PersonRow` menu to the hook**

Grounded structure (lines 93-210): `const [menu, setMenu] = useState(false)`, a toggle `<button>`, then a scrim `<div className="ppl__menuscrim" onClick={() => setMenu(false)} />` plus `<div className="ppl__menupop" role="menu">` with several `<button role="menuitem">` items via an `act(...)` helper. Replace the scrim-div dismiss pattern with the hook:

```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
const { ref: menuRef } = useDismissableMenu<HTMLDivElement>({
  open: menu,
  onClose: () => {
    setMenu(false);
    triggerRef.current?.focus();
  }
});
```

Attach `ref={triggerRef}` to the existing toggle button, remove the `.ppl__menuscrim` div entirely (the hook's pointerdown-outside listener replaces it), and attach `ref={menuRef}` to the `.ppl__menupop` div. Each `act(...)`-driven `onClick` should additionally call `setMenu(false)` after firing (mirror however `act` is currently structured — read the exact helper before editing so item actions still fire correctly).

- [ ] **Step 7: Add Escape + focus-return to `tasks-page.tsx` `ListFilterMenu`**

Grounded (lines 514-610): already has `ref={ref}` + `useEffect` with a `mousedown` listener calling `setOpen(false)`. This is a multi-select menu (spec: does NOT auto-close on selection). Replace the existing manual `useEffect`/`ref` pair with the shared hook (keeping the no-close-on-select behavior, since `useDismissableMenu` only closes on outside-pointerdown/Escape, never on item click):

```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
const { ref } = useDismissableMenu<HTMLDivElement>({
  open,
  onClose: () => {
    setOpen(false);
    triggerRef.current?.focus();
  }
});
```

Remove the old manual `useEffect` (lines 526-533) and the old `const ref = useRef<HTMLDivElement>(null);` (line 524), replacing both with the two lines above. Attach `ref={triggerRef}` to the toggle `<button className="tk-listbtn" ...>` (line ~548).

- [ ] **Step 8: Add Escape + focus-return to `task-details-sections.tsx` `TaskStatusControl`**

Grounded (lines 201-270): same manual `ref` + `mousedown`-only `useEffect` pattern, already single-shot-closes on item selection via `setOpen(false)` inside each item's `onClick` (line 258) — keep that per-item close, it's correct for a single-select menu. Replace the manual `useEffect`/`ref` (lines 205-214) with:

```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
const { ref } = useDismissableMenu<HTMLDivElement>({
  open,
  onClose: () => {
    setOpen(false);
    triggerRef.current?.focus();
  }
});
```

Attach `ref={triggerRef}` to the `.tk-statusctl__more` toggle button (line ~239-246).

- [ ] **Step 9: Manual dev QA across all 5 call sites**

Start the dev server bound to `0.0.0.0`. For each of the 5 converted menus, verify: opens on trigger click, closes on outside click, closes on Escape with focus returning to the trigger button, and (for single-select menus) closes on item selection while (for the multi-select `ListFilterMenu`) selecting an item keeps it open. Record pass/fail per site in the plan-completion report — this is the primary regression surface given the no-jsdom test constraint.

- [ ] **Step 10: Run full unit suite + typecheck to catch cross-file regressions**

Run: `pnpm vitest run tests/unit/`
Expected: PASS.

Run: `pnpm typecheck` (or the repo's equivalent script from `package.json`)
Expected: PASS — no unused `useEffect`/`useRef` imports left behind at any converted call site, no `details`/`summary` CSS selectors silently orphaned.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/shared/use-dismissable-menu.ts tests/unit/use-dismissable-menu.test.ts apps/web/src/chat/chat-model-pill.tsx apps/web/src/today/briefing-feedback-menu.tsx apps/web/src/settings/settings-admin-panes.tsx apps/web/src/tasks/tasks-page.tsx apps/web/src/tasks/task-details-sections.tsx
git commit -m "$(cat <<'EOF'
feat(web): shared dismissable-menu hook, convert 5 non-drawer menus

One useDismissableMenu hook replaces three different ad hoc patterns
(details/summary, scrim-div, ref+mousedown-only) across the model
picker, briefing feedback menu, people-list row menu, task list
filter, and task status control. All five now close on outside
pointerdown, close on Escape, and return focus to their trigger
button. The task list filter (multi-select) still stays open on
item selection; the others still close on single-shot selection,
matching prior behavior. Disclosure panels (e.g. chat-drawer's
"Behind the scenes" peek) are untouched — not menus.

User-facing: dropdown menus throughout the app (model picker,
feedback menu, people list, task filters, task status) now close
with Escape and return keyboard focus predictably; previously only
some of them supported Escape at all.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Escalation (not a task — flag to UX Coordinator, do not implement)

`apps/web/src/chat/chat-drawer.tsx:~688-693` (`activityVerb()`):

```ts
function activityVerb(record: TranscriptRecord): string {
  if (record.kind === "action_result") {
    return record.outcome === "executed" ? "Executed" : "Denied";
  }
  return `${record.kind} ·`;
}
```

Once Task 2 lands, a genuine YOLO auto-grant (`outcome: "allowed"`) will render as **"Denied"** here — an active falsehood, worse than doing nothing, until this file's lock is released and the same 3-way branch from Task 2 Step 5 (`packages/chat/src/gateway-notifier.ts`) is applied here too:

```ts
return record.outcome === "allowed"
  ? "Allowed by YOLO"
  : record.outcome === "executed"
    ? "Executed"
    : "Denied";
```

This is a single 3-line hunk. Requesting an explicit lock release for this one hunk only — not the rest of `chat-drawer.tsx` — in the coordinator message accompanying this plan.
