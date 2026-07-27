**Dependency:** None.

**Status:** DONE — `b2840f7b`.

## Task 1 — Add the public SDK declaration

**Files**

- Modify `packages/module-sdk/src/index.ts`
- Modify `tests/unit/mcp-gateway-units.test.ts`

**Changes**

1. Export
   `ModuleAssistantToolSelfOperationGrant = "granted_at_install" | "confirm_always"`.
2. Add optional
   `readonly selfOperationGrant?: ModuleAssistantToolSelfOperationGrant`
   to `ModuleAssistantToolManifest`. It remains optional at the TypeScript level because read tools
   do not declare it; the runtime/build assertion enforces it for writes.
3. Do not change `JarvisActionPermissionTier` or
   `ModuleAssistantActionFamilyManifest.defaultTier`.
4. In the existing `"module-sdk tool contract"` describe block, add
   `"accepts the selfOperationGrant vocabulary without widening action tiers"` and compile fixtures
   for both values.

**Verify**

`pnpm vitest run tests/unit/mcp-gateway-units.test.ts`

**Commit**

`feat(module-sdk): declare self-operation grants`
