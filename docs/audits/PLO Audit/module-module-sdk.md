# Thermo-Nuclear Audit: packages/module-sdk

**Date:** 2026-06-10
**Reviewer:** Automated PLO audit (claude-sonnet-4-6)
**Scope:** `packages/module-sdk/src/index.ts` + all consumers (`packages/*/src/manifest.ts`, `packages/ai/src/gateway/`, `packages/chat/src/gateway-notifier.ts`, `tests/integration/fixtures/`)

---

## Summary

The module-sdk is a single 142-line file of pure TypeScript type declarations — no runtime logic, no dependencies. The types are clean but several contracts have structural gaps that permit security violations, silent data leakage, and broken invariants that TypeScript cannot catch. The worst findings are in the **consumers** of the SDK rather than the SDK itself, but they arise directly from under-specified SDK contracts.

---

## Findings

---

### [HIGH] ToolSummarize return value carries raw user-supplied content into transcript and frontend

- **File:** `packages/module-sdk/src/index.ts:36`, `packages/ai/src/gateway/gateway.ts:165–166`, `packages/chat/src/gateway-notifier.ts:25,28`
- **Category:** Security / Payloads
- **Finding:** `ToolSummarize` is typed as `(input: ToolInput, ctx: ToolContext) => string`. The returned string has no structural constraint — a module author can (and the test fixture does) embed the full raw input value in the string. The gateway passes this string verbatim through `GatewaySessionRecord.summary`, which is then:
  1. Injected into the live transcript via `injectRecord` / `ChatSessionManager`
  2. Emitted as `text: "Approve or deny: ${record.summary}"` over the SSE stream to the frontend
  3. Stored in the `TranscriptRecord.summary` field returned to every subscriber tab
- **Evidence:**
  ```typescript
  // example-tool-module.ts:45
  summarize: (input) => `Write the value "${String(input.value)}"`
  // gateway-notifier.ts:25
  text: `Approve or deny: ${record.summary}`,
  summary: record.summary   // SSE to frontend
  ```
  The fixture explicitly embeds `input.value`. If that value were a password, secret key, or private document content, it would be streamed to the browser.
- **Impact:** A module's `summarize` function is the only data path that bypasses the `summarizeAssistantToolInput` metadata-only gate. Content from the raw `ToolInput` bag — which can include anything the AI model passes — reaches the SSE stream and the browser UI. Violates the "secrets never escape to frontend" hard invariant.
- **Recommendation:** Change `ToolSummarize` to return a typed safe-summary object (e.g., `{ label: string; fieldCount: number; fieldNames: readonly string[] }`) rather than a free string. The gateway then renders the display string from that structured object, never from raw input values. Alternatively, enforce at the gateway that the string returned by `summarize` is used only as a display label and never echoed if it contains any value from `ToolInput` — but this is not statically enforceable; the type change is the right fix.

---

### [HIGH] Tool permissionId is declared but never enforced at execution time

- **File:** `packages/module-sdk/src/index.ts:116`, `packages/ai/src/gateway/gateway.ts:54–66`, `packages/ai/src/routes.ts:399–437`
- **Category:** Security / Architecture
- **Finding:** `ModuleAssistantToolManifest.permissionId` is a required field, but the gateway executes tools without ever checking whether the `actorUserId` holds that permission. The gateway's `callTool` path: (1) verifies the session token, (2) finds the tool, (3) validates input, (4) checks risk policy — but skips any permission check. The REST invocation path in `ai/src/routes.ts` is identical. `permissionId` is only forwarded to `createPendingAssistantAction` for audit-trail purposes and serialized to the DTO for the UI to display.
- **Evidence:**
  ```typescript
  // gateway.ts - callTool: no permission check between token verify and execute
  const { actorUserId, chatSessionId } = this.deps.tokens.verify(token);
  const found = this.executableTools(actorUserId).find(...);
  // goes straight to validateToolInput then resolvePolicy then execute
  ```
- **Impact:** Any authenticated user with a valid session token can invoke any tool regardless of whether they hold the declared permission. For example, a user who lacks `tasks.update` can still invoke `tasks.updateStatus`. The permission declaration is advisory metadata only — it carries no enforcement weight. This is a privilege-escalation path.
- **Recommendation:** Add a permission-check hook to `AssistantToolGatewayDependencies` (e.g., `hasPermission(actorUserId: string, permissionId: string): Promise<boolean>`) and call it in `callTool` before `validateToolInput`. Return `{ ok: false, error: "forbidden" }` (not a leak of the reason detail) on failure. The SDK contract should make it explicit that `permissionId` is the enforcement key, not just a label.

---

### [HIGH] `listTools()` ignores actorUserId — returns all tools regardless of session identity

- **File:** `packages/ai/src/gateway/gateway.ts:46–48`, `packages/chat/src/mcp-transport.ts:74`
- **Category:** Security
- **Finding:** `listTools()` calls `executableTools("")` with an empty string as `actorUserId`. The `ActiveModulesResolver` receives an empty string and currently returns all built-in modules (it does not filter by user). When per-user module enable/disable ships, `listTools()` will silently bypass that filter — every user will see every tool regardless of what modules they have enabled or what permissions they hold.
- **Evidence:**
  ```typescript
  listTools(): AiAssistantToolDto[] {
    return this.executableTools("").map((entry) => entry.dto);
  }
  ```
  MCP `/tools/list` calls `deps.gateway.listTools()` with no token-to-user mapping.
- **Impact:** Even if the permission enforcement gap (finding above) is fixed, the tool listing leaks the existence of all tools to any authenticated user regardless of their module access. When per-user module toggle ships, the intent gap becomes exploitable.
- **Recommendation:** Accept the session token in `listTools(token: string)` consistent with `callTool`, verify it, and pass the real `actorUserId` to `executableTools`. The MCP transport already has the token at the point it calls `listTools` — it just does not pass it.

---

### [MEDIUM] ToolSummarize receives the full ToolContext (including actorUserId) with no stated purpose

- **File:** `packages/module-sdk/src/index.ts:36`
- **Category:** Security / Architecture
- **Finding:** `ToolSummarize = (input: ToolInput, ctx: ToolContext) => string` exposes `ctx.actorUserId` and `ctx.chatSessionId` to the summary function. There is no documented reason a human-readable confirmation label needs the user's identity. Passing `ctx` encourages module authors to embed identity or cross-user data into the summary string, which then flows to the frontend.
- **Evidence:**
  ```typescript
  export type ToolSummarize = (input: ToolInput, ctx: ToolContext) => string;
  ```
- **Impact:** Low today (no production `summarize` uses `ctx`), but the type widens the surface for future module authors to accidentally or deliberately include context-sensitive data in what is supposed to be a safe label.
- **Recommendation:** Remove `ctx` from `ToolSummarize`. A summary label should be deterministic from the input schema alone. If identity-aware labels are needed in the future they deserve an explicit named parameter.

---

### [MEDIUM] Duplicate `summarizeAssistantToolInput` — identical function in two files

- **File:** `packages/ai/src/assistant-tools.ts:33–39`, `packages/ai/src/routes.ts:572–578`
- **Category:** Code Quality
- **Finding:** The function `summarizeAssistantToolInput` is defined twice with identical logic (`Object.keys(input).sort()` returning `{ inputKeys, inputKeyCount }`). One is in `assistant-tools.ts` (exported, used by the gateway), the other is a private function at the bottom of `routes.ts` (used only locally at line 383).
- **Evidence:**
  ```typescript
  // assistant-tools.ts:33
  export function summarizeAssistantToolInput(input: Record<string,unknown>) {
    const inputKeys = Object.keys(input).sort();
    return { inputKeys, inputKeyCount: inputKeys.length };
  }
  // routes.ts:572
  function summarizeAssistantToolInput(input: Record<string,unknown>) {
    const inputKeys = Object.keys(input).sort();
    return { inputKeys, inputKeyCount: inputKeys.length };
  }
  ```
- **Impact:** Silent drift risk. If the sanitization logic is ever tightened in `assistant-tools.ts` (the canonical location), `routes.ts` continues running the old version, potentially leaking keys that were intentionally removed.
- **Recommendation:** Delete the private copy in `routes.ts` and import the canonical `summarizeAssistantToolInput` from `./assistant-tools.js`.

---

### [MEDIUM] `ModuleCompatibility.jarv1s` version string is declared but never validated

- **File:** `packages/module-sdk/src/index.ts:38–40`, all manifest files
- **Category:** Architecture / Code Quality
- **Finding:** Every manifest declares `compatibility: { jarv1s: string }` (e.g., `">=0.0.0"`), but no code in `module-registry`, the gateway, or anywhere else reads or validates this field at runtime. It is dead metadata.
- **Evidence:**
  ```typescript
  export interface ModuleCompatibility {
    readonly jarv1s: string;
  }
  ```
  `grep -rn "compatibility" packages/ --include="*.ts"` finds it only in `module-sdk/src/index.ts` and manifest definitions — zero consumers.
- **Impact:** When the SDK version bumps in a breaking way, modules with `compatibility: { jarv1s: ">=0.0.0" }` will silently continue to load without any incompatibility signal. The field creates a false sense of safety that is not backed by enforcement.
- **Recommendation:** Either (a) add a version-check step in module registration that rejects or warns on incompatible manifests, or (b) remove the field from the SDK until enforcement exists. A declared contract with no enforcement is worse than no contract — it misleads future module authors.

---

### [MEDIUM] `ModuleJobManifest.metadataOnly` is an optional, advisory-only flag with no runtime enforcement

- **File:** `packages/module-sdk/src/index.ts:68`
- **Category:** Payloads / Architecture
- **Finding:** `metadataOnly?: boolean` signals that a job queue's payloads should contain only metadata. However, this flag is never read by the pg-boss worker registration code or any payload validation layer — it exists only in the manifest and in two test assertions that verify the flag is set to `true`. Nothing prevents a module from omitting the flag or from sending content-rich payloads into a queue declared as metadata-only.
- **Evidence:**
  ```typescript
  readonly metadataOnly?: boolean;
  ```
  `grep -rn "metadataOnly" packages/` finds it only in `module-sdk/src/index.ts`, `tasks/src/manifest.ts`, and `briefings/src/manifest.ts`. Zero enforcement at worker registration or enqueueing.
- **Impact:** The hard invariant "metadata-only job payloads" (CLAUDE.md) is unenforced. A future module can set `metadataOnly: false` (or omit it) and place private content or secrets in a pg-boss payload — and nothing will catch it at development or runtime. The flag gives a false compliance signal.
- **Recommendation:** Enforce the constraint at the worker registration boundary. At minimum, if `metadataOnly: true`, wrap the queue's handler to validate that incoming payloads contain only the declared `payloadSchema` property names (no extra keys). Ideally, add a lint/test assertion that any queue without `metadataOnly: true` fails CI until explicitly reviewed.

---

### [MEDIUM] `ModuleAvailabilityManifest`, `featureFlagId`, `permissionId` on routes/navigation/settings — all advisory metadata with zero runtime enforcement

- **File:** `packages/module-sdk/src/index.ts:42–48, 56–111`
- **Category:** Architecture / Code Quality
- **Finding:** The SDK defines rich manifest sections — `availability`, `featureFlags`, `permissions`, `navigation`, `settings`, `routes` — with `featureFlagId` and `permissionId` fields on `ModuleRouteManifest`, `ModuleNavigationEntryManifest`, and `ModuleSettingsSurfaceManifest`. None of these fields are consumed by any runtime code in the codebase. `grep -rn "featureFlagId" packages/ --include="*.ts"` and `grep -rn "manifest\.routes\b"` both return zero hits outside manifests.
- **Impact:** The manifest expresses access-control intent (which routes require which permissions, which nav entries require which feature flags) that is never enforced. A route declared as requiring `tasks.view` is not gated on that permission by the manifest system — the route handler itself must implement its own check. The manifest sections are documentation, not policy. This is only problematic when module authors believe the manifest provides real enforcement, and write handlers that don't enforce permissions themselves because the manifest "already handles it."
- **Recommendation:** Document explicitly in the SDK that `featureFlagId` and `permissionId` on route/navigation manifests are currently informational metadata and enforcement is the route handler's responsibility. Long term, the module registry should enforce these at route registration using Fastify hooks so the manifest becomes the actual policy surface.

---

### [MEDIUM] `tasks.updateStatus` assistant tool declared without `execute` handler — silently invisible to the gateway

- **File:** `packages/tasks/src/manifest.ts:338–353`
- **Category:** Architecture / Code Quality
- **Finding:** The `tasks.updateStatus` tool is declared with `permissionId`, `risk: "write"`, and full `inputSchema`/`outputSchema` — but has no `execute` field. The gateway filters out tools without an execute handler (`typeof tool.execute !== "function"`). This means the tool is completely invisible at runtime: it cannot be listed or called via MCP. However, it is listed by `listAssistantToolsFromManifests` in the AI routes (which does not filter on execute), creating an inconsistency.
- **Evidence:**
  ```typescript
  // tasks/src/manifest.ts:338
  {
    name: "tasks.updateStatus",
    ...
    outputSchema: getTaskResponseSchema
    // no execute field
  }
  ```
- **Impact:** The tool appears in `GET /api/ai/assistant-tools` (via `listAssistantToolsFromManifests`) but cannot be invoked via MCP or the gateway. The AI can see the tool in its manifest but calling it returns "Tool not available". This creates a confusing broken experience and represents an incomplete feature that was merged without an implementation.
- **Recommendation:** Either (a) add a `taskUpdateStatusExecute` handler and wire it, or (b) remove the declaration until it is ready. Declaration-only tools should be treated as a spec stub, not shipped to production manifests. If the gateway is the authoritative path, `listAssistantToolsFromManifests` should also filter on `execute` for consistency.

---

### [LOW] `JsonSchema` is typed as `{ readonly [key: string]: unknown }` — no constraint on valid JSON Schema structure

- **File:** `packages/module-sdk/src/index.ts:6–8`
- **Category:** TypeScript / Code Quality
- **Finding:** `JsonSchema` accepts literally any object, including `{ type: "potato" }`, `{ required: 42 }`, or an empty object `{}`. The `validateToolInput` validator trusts the schema blindly (e.g., it casts `schema.required` to `string[]` without validating).
- **Evidence:**
  ```typescript
  export interface JsonSchema {
    readonly [key: string]: unknown;
  }
  ```
  In `input-validation.ts:31`: `const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];` — if `schema.required` is `[1, 2]` the cast is unsafe.
- **Impact:** Low — the existing built-in modules write correct schemas. Risk increases when external or future module authors provide malformed schemas that silently pass validation or cause unexpected runtime behavior.
- **Recommendation:** Introduce a minimal opaque `JsonSchemaObject` branded type or at least type the well-known top-level fields (`type`, `required`, `properties`) more specifically. This is a quality improvement, not a blocker.

---

### [LOW] `ToolInput = Record<string, unknown>` and `ToolResult.data = Record<string, unknown>` provide no contract on what enters or exits a tool

- **File:** `packages/module-sdk/src/index.ts:10, 18–20`
- **Category:** TypeScript / Architecture
- **Finding:** Both the input bag and result data bag are fully untyped at the SDK boundary. Tool handlers must downcast input (e.g., `const { taskId } = input as { taskId: string }`) and can return anything in `data`. There is no structural validation between the `inputSchema` JSON Schema declaration and the actual TypeScript type of `input` as seen by the handler.
- **Evidence:**
  ```typescript
  // tasks/src/tools.ts
  const { taskId } = input as { taskId: string };
  // no check that taskId is actually a string at runtime
  ```
- **Impact:** The `inputSchema` + `validateToolInput` gate validates required fields and scalar types at the gateway level before the handler runs. However, the handler then re-casts without validation, trusting the gateway's partial check. If a field is declared as `type: "string"` but not in `required`, the handler can receive `undefined` and the cast silently widens. This is currently safe only because `validateToolInput` skips absent optional fields.
- **Recommendation:** This is an inherent limitation of the `unknown scopedDb` + `ToolInput = Record<string, unknown>` design choice that avoids a module-sdk→db dependency. Document the expected pattern (`assertDataContextDb` + safe cast after gateway validation) clearly in JSDoc on `ToolExecute`. Consider a future generic `ToolExecute<TInput extends ToolInput>` when the SDK matures.

---

### [LOW] `ModuleScope` type used in permissions/feature-flags/settings but scope is never enforced

- **File:** `packages/module-sdk/src/index.ts:2`
- **Category:** Architecture
- **Finding:** `ModuleScope = "user" | "admin" | "system"` is a declared discriminator but no code checks it at runtime. A permission declared as `scope: "admin"` is not restricted to admin-only callers by the manifest system.
- **Impact:** Same advisory-metadata problem as `featureFlagId`/`permissionId` findings. Low severity because actual access control lives in route handlers, not manifests.
- **Recommendation:** Document that scope is informational until the enforcement layer exists. Consistent with the featureFlagId finding.

---

### [LOW] `ModuleDatabaseManifest.migrations` (list of file paths) and `ownedTables` are unenforced — no cross-module table access check

- **File:** `packages/module-sdk/src/index.ts:50–54`
- **Category:** Architecture
- **Finding:** `ownedTables` declares which SQL tables belong to a module. Tests assert the correct values but no runtime or CI check validates that a module's repository queries only its own tables (or shared API tables). Module isolation invariant (CLAUDE.md §9) is therefore relied on by convention, not enforcement.
- **Evidence:**
  Integration tests (e.g., `tasks.test.ts:175`) assert `ownedTables` values but do not cross-check repository queries against the declared set.
- **Impact:** A module could query another module's table directly and it would compile, pass lint, and pass tests. The `ownedTables` manifest declaration creates a documentation artifact with no enforcement weight.
- **Recommendation:** Add a CI check (or use CodeGraph) that no module's repository files import table names outside its declared `ownedTables` plus the explicitly shared tables (e.g., `app.users`). This converts the declaration from documentation to a policy gate.

---

### [INFO] `scopedDb: unknown` in `ToolExecute` requires every tool to cast — structural debt is intentional but should be documented

- **File:** `packages/module-sdk/src/index.ts:29–30`
- **Category:** Architecture / TypeScript
- **Finding:** The JSDoc on `ToolExecute` explains the design rationale: `unknown` avoids a module-sdk → db package dependency. All production tool handlers call `assertDataContextDb(scopedDb)` immediately (narrowing to `DataContextDb`). The test fixture uses `db as DataContextDb` (a type cast). The cast in the fixture is safe because the gateway always passes a real `DataContextDb`, but TypeScript cannot verify this without the assertion.
- **Impact:** None in current state — the pattern is consistent and intentional. Risk is that future module authors skip `assertDataContextDb` and use a bare cast or assume the type is already narrowed.
- **Recommendation:** Add a JSDoc example to `ToolExecute` showing the required `assertDataContextDb(scopedDb)` call as the first line of any handler. Consider a lint rule that flags tool handlers that cast `scopedDb` without an assertion call.

---

### [INFO] `package.json` exports raw TypeScript source, not compiled output

- **File:** `packages/module-sdk/package.json:6–8`
- **Category:** Architecture
- **Finding:** `"exports": { ".": "./src/index.ts" }` — the package exports the TypeScript source directly, consistent with the monorepo workspace pattern (all packages do this). This is intentional: the TypeScript project references ensure the root `tsconfig.json` paths resolve correctly. There is no compiled artifact. Any external consumer of `@jarv1s/module-sdk` (outside this monorepo) would need to compile it first.
- **Impact:** None within the monorepo. Noted for completeness.

---

## Summary Table

| Severity | Count | Topics |
|----------|-------|--------|
| HIGH     | 3     | ToolSummarize content leakage to frontend; permissionId not enforced; listTools ignores actor |
| MEDIUM   | 6     | ToolSummarize ctx param; duplicate summarize function; compatibility field dead; metadataOnly unenforced; rich manifest metadata advisory-only; tasks.updateStatus ghost tool |
| LOW      | 4     | JsonSchema untyped; ToolInput/ToolResult untyped; ModuleScope unenforced; ownedTables unenforced |
| INFO     | 2     | scopedDb:unknown pattern; TS source exports |

The three HIGH findings all affect the `AssistantToolGateway` consumption layer rather than the SDK file itself, but each stems from an under-specified SDK contract. Fixing them requires both SDK-level type changes and gateway enforcement changes.
