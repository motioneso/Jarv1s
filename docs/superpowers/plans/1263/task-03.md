**Dependency:** Task 2 must already be committed.

## Task 3 — Enforce exclusions before YOLO without changing YOLO

**Files**

- Modify `packages/ai/src/gateway/gateway.ts`
- Modify `tests/integration/mcp-gateway.test.ts`

**Changes**

1. In `AssistantToolGateway.executableTools`, omit centrally excluded tools so they are never listed
   to the model.
2. In `AssistantToolGateway.callTool`, keep exclusion/unavailability ahead of the existing YOLO
   branch. Do not move `resolvePolicy`, destructive handling, or `requiresConfirmation` ahead of
   YOLO.
3. Reuse `isSelfOperationExcluded`; do not duplicate exclusion logic in the gateway.

**Tests — exact names**

- `"does not list or execute an excluded tool with YOLO on"`
- `"YOLO still runs confirm_always destructive and per-call-confirm tools"`
- `"YOLO off still confirms confirm_always destructive and per-call-confirm tools"`

The YOLO-on regression test must cover all three ordinary confirmation mechanisms, not only
destructive risk.

**Verify**

`pnpm vitest run tests/integration/mcp-gateway.test.ts`

**Commit**

`fix(ai): enforce exclusions before yolo`
