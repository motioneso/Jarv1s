# Open Module System Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `coordinated-build` and `superpowers:test-driven-development`. This repo disables `subagent-driven-development` and `executing-plans`; drive each task inline and stop at the coordinator gates.

**Goal:** Execute enabled external-module assistant tools in isolated child processes while preserving Jarv1s confirmation, audit, RLS, credential, and lifecycle guarantees.

**Architecture:** Extend the JSON manifest with declarative worker/tool metadata, then adapt active external modules into ordinary `JarvisModuleManifest` tools whose `execute` closures call one per-module JSON-RPC child runtime. The child receives only handler input and SDK RPC helpers; the trusted API parent proxies auth/KV through a separate `jarvis_worker_runtime` `DataContextRunner`, setting actor and module GUCs inside every transaction. Existing `AssistantToolGateway` remains the sole risk/confirmation/audit chokepoint.

**Tech Stack:** TypeScript, Node `child_process`/`readline`, JSON-RPC 2.0 over newline-delimited stdio, Kysely/PostgreSQL RLS, Vitest.

## Global Constraints

- Security tier: Opus adversarial QA plus Ben merge sign-off; never auto-merge.
- Use migration `packages/settings/sql/0157_module_worker_runtime_access.sql`, contingent on #914 landing `0155/0156`; re-check `origin/main` immediately before creating it.
- Never alter applied migrations `0152`-`0154`; update `tests/integration/foundation.test.ts` with `0157`.
- Preserve `AccessContext` as exactly `actorUserId` and `requestId`; module identity is a separate transaction-local GUC.
- Child receives no DB/Kysely/DataContextDb/VaultContext/root fs/root env handle and no DB URL.
- Plaintext credentials exist only during one invocation, cross only the RPC response to the trusted child, and never enter env, logs, outputs, jobs, exports, or persistence.
- Existing #918 metadata-only response, RLS, revocation, and lifecycle coverage stays; do not duplicate it.
- No new dependency. Use Node built-ins and existing packages.
- Stage explicit paths only. Never touch `docs/coordination/` or run repo-wide `pnpm format`.

---

### Task 1: Declarative manifest and worker authoring contract

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Create: `packages/module-sdk/src/worker-protocol.ts`
- Create: `packages/module-sdk/src/worker.ts`
- Modify: `packages/module-sdk/package.json`
- Modify: `packages/module-registry/src/external/validate.ts`
- Modify: `tests/unit/external-validate.test.ts`
- Modify: `tests/unit/module-sdk-external-types.test.ts`
- Create: `tests/unit/module-sdk-worker.test.ts`

**Interfaces:**

- Produces `MODULE_WORKER_CONTRACT_VERSION = 1`, `ModuleWorkerDeclaration`, `ExternalModuleAssistantToolDeclaration`, `ModuleWorkerContext`, and `defineModuleWorker()`.
- Keeps `@jarv1s/module-sdk` browser-safe; Node imports exist only behind `@jarv1s/module-sdk/worker`.

- [ ] **Step 1: Add failing manifest tests**

Add assertions accepting this exact declarative shape and rejecting missing runtime, bad paths/version, unprefixed names/permissions, duplicate names/handlers, invalid risk, and function values:

```ts
const toolManifest = {
  ...base,
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
  assistantTools: [
    {
      name: "acme-widgets.lookup",
      description: "Look up a widget",
      permissionId: "acme-widgets.lookup",
      risk: "read",
      inputSchema: { type: "object" },
      handler: "lookup"
    }
  ]
};
expect(validateExternalModuleManifest(toolManifest, "acme-widgets", "0.1.0").ok).toBe(true);
```

Run: `pnpm vitest run tests/unit/external-validate.test.ts tests/unit/module-sdk-external-types.test.ts`
Expected: FAIL because runtime/tools are rejected or untyped.

- [ ] **Step 2: Add JSON-only declarations and validation**

Use these public shapes in `index.ts`:

```ts
export interface ModuleWorkerDeclaration {
  readonly workerEntrypoint: string;
  readonly workerContractVersion: 1;
}

export interface ExternalModuleAssistantToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: "read" | "write" | "destructive";
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly handler: string;
}
```

Add optional `runtime` and `assistantTools` to `JsonJarvisModuleManifest`; require `runtime` whenever tools exist. Remove only `assistantTools` from `FORBIDDEN_FIELDS`; continue rejecting every executable function/surface. Validate clean package-relative `dist/*.js` entrypoint, exact contract version `1`, module-id-prefixed tool/permission ids, non-empty handler ids, and uniqueness.

- [ ] **Step 3: Add failing SDK worker protocol test**

Exercise `defineModuleWorker` in a real spawned fixture: host sends `module.invoke`; handler reads `ctx.input`, calls `ctx.auth.getCredential()` and `ctx.kv.get()`, then returns JSON. Assert the child emits readiness version `1`, helper RPC requests, and the final result; assert unknown handlers return a typed JSON-RPC error.

Run: `pnpm vitest run tests/unit/module-sdk-worker.test.ts`
Expected: FAIL because `@jarv1s/module-sdk/worker` does not exist.

- [ ] **Step 4: Implement the Node-only authoring contract**

`worker-protocol.ts` owns JSON-compatible message types and method names. `worker.ts` exports:

```ts
export interface ModuleWorkerContext {
  readonly input: Record<string, unknown>;
  readonly auth: { getCredential(authId: string): Promise<string> };
  readonly kv: {
    get(
      scope: "instance" | "user",
      namespace: string,
      key: string
    ): Promise<Record<string, unknown> | null>;
    set(
      scope: "instance" | "user",
      namespace: string,
      key: string,
      value: Record<string, unknown>
    ): Promise<void>;
    delete(scope: "instance" | "user", namespace: string, key: string): Promise<boolean>;
    list(scope: "instance" | "user", namespace: string): Promise<readonly string[]>;
  };
}

export function defineModuleWorker(input: {
  readonly handlers: Readonly<Record<string, (ctx: ModuleWorkerContext) => Promise<unknown>>>;
}): void;
```

Parse newline-delimited JSON-RPC, emit `worker.ready` with version `1`, correlate helper requests, never inspect `process.env`, and serialize handler failures without stack traces. Export only `./worker` from `package.json`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/unit/external-validate.test.ts tests/unit/module-sdk-external-types.test.ts tests/unit/module-sdk-worker.test.ts && pnpm typecheck`
Expected: PASS.

Commit: `feat(module-sdk): add external worker authoring contract`

---

### Task 2: Isolated per-module worker process runtime

**Files:**

- Create: `packages/module-registry/src/external/worker-runtime.ts`
- Modify: `packages/module-registry/src/node.ts`
- Create: `tests/unit/external-worker-runtime.test.ts`

**Interfaces:**

- Produces `ExternalModuleWorkerRuntime.invoke()` and `close()`.
- Consumes a per-invocation parent RPC callback; owns no DB or credential cipher.

- [ ] **Step 1: Write failing real-process lifecycle tests**

Generate temporary prebuilt `.mjs` workers and assert:

```ts
await runtime.invoke(module, "lookup", { value: 1 }, rpc);
await Promise.all([
  runtime.invoke(module, "slow", {}, rpc),
  runtime.invoke(module, "fast", {}, rpc)
]);
```

Cover lazy one-process-per-module spawn, `cwd === module.dir`, absence of `JARVIS_*`, DB URLs, `HOME`, and unrelated env vars, allowlisting only `LANG`/`LC_ALL`/`TZ`, contract-version mismatch, serialized calls, timeout kill, crash error, next-call respawn, idle shutdown, and `close()`.

Run: `pnpm vitest run tests/unit/external-worker-runtime.test.ts`
Expected: FAIL because runtime is absent.

- [ ] **Step 2: Implement process lifecycle and JSON-RPC correlation**

Expose the minimal API:

```ts
export class ExternalModuleWorkerError extends Error {
  constructor(readonly code: "protocol" | "timeout" | "crash" | "handler_failed") {
    super(code);
  }
}

export class ExternalModuleWorkerRuntime {
  invoke(
    module: ExternalModuleDiscovery,
    handler: string,
    input: Record<string, unknown>,
    rpc: (
      method: string,
      params: unknown,
      rememberSecret: (value: string) => void
    ) => Promise<unknown>
  ): Promise<unknown>;
  close(): Promise<void>;
}
```

Spawn `process.execPath` with the validated absolute entrypoint, `cwd: module.dir`, `env` copied only from the three locale keys, and stdio pipes. Maintain one queued promise tail and one child per module. Require `worker.ready` version `1` before invocation; kill and remove the child on protocol failure, timeout, or exit so the next call respawns.

- [ ] **Step 3: Add bounded/redacted stdio tests, then implementation**

Assert arbitrary stdout/stderr is capped per invocation, partial lines cannot grow without bound, and each credential learned through `rememberSecret` is replaced with `[REDACTED]` before the logger receives output. Assert raw handler error messages/stacks are never logged or returned.

Use fixed limits (`1 MiB` protocol line, `16 KiB` captured bytes per stream) and exact-value replacement longest-first. Clear capture and known-secret sets in `finally` after every invocation.

Run: `pnpm vitest run tests/unit/external-worker-runtime.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run tests/unit/external-worker-runtime.test.ts tests/unit/module-sdk-worker.test.ts && pnpm typecheck`
Expected: PASS.

Commit: `feat(module-registry): add isolated external worker runtime`

---

### Task 3: Worker-role RLS and parent auth/KV RPC host

**Files:**

- Create: `packages/settings/sql/0157_module_worker_runtime_access.sql`
- Modify: `tests/integration/foundation.test.ts`
- Modify: `packages/settings/src/repository-module-credentials.ts`
- Modify: `packages/settings/src/index.ts`
- Create: `packages/module-registry/src/external/worker-rpc-host.ts`
- Modify: `packages/module-registry/src/node.ts`
- Create: `tests/integration/module-worker-rpc.test.ts`

**Interfaces:**

- Produces `createExternalModuleRpcHandler(discovery, toolRisk, actorUserId, workerDataContext, cipher)`.
- Every RPC opens a worker-role `withDataContext({ actorUserId, requestId })`, then transaction-locally sets `app.current_module_id` before repository access.

- [ ] **Step 1: Re-check migration ordering and write failing RLS tests**

Run: `git fetch origin main && git ls-tree -r --name-only origin/main 'packages/*/sql/*.sql' | sort | tail -10`
Expected: #914 owns `0155/0156`; `0157` remains free. If not, stop and ask coordinator for a new number.

Add integration assertions proving worker role: cannot read with no actor/module GUC; module A cannot read module B credentials/KV; disabled module cannot read; user credential cannot cross owners; instance credential can be read for a non-admin actor in the owning enabled module; app role remains admin-only for instance credentials; credential DELETE remains denied.

Run: `pnpm tsx scripts/test-integration.ts tests/integration/module-worker-rpc.test.ts`
Expected: FAIL because worker grants/GUC do not exist.

- [ ] **Step 2: Add migration `0157` and foundation list entry**

Migration requirements:

```sql
CREATE OR REPLACE FUNCTION app.current_module_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_module_id', true), '') $$;
REVOKE ALL ON FUNCTION app.current_module_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_module_id() TO jarvis_worker_runtime;
```

Add separate worker policies on both tables requiring `module_id = app.current_module_id()`, non-null actor, and an enabled `app.external_modules` row. Credential SELECT permits owning user rows or instance rows. KV policies permit owning user rows or instance rows; parent code separately enforces admin-only instance mutation. Grant worker `SELECT` only on credentials and `SELECT, INSERT, UPDATE, DELETE` on KV. Do not modify app-role policies or grant credential DELETE.

- [ ] **Step 3: Add secret read and RPC host tests**

Add `readModuleCredentialSecret(scopedDb, moduleId, credentialId, scope, ownerUserId)` selecting only `encrypted_secret` where `revoked_at IS NULL`. RPC host tests use real worker-role DB transactions and assert:

```ts
await sql`SELECT set_config('app.current_module_id', ${module.id}, true)`.execute(scopedDb.db);
```

- auth id must be declared by this module; scope comes only from declaration.
- missing/revoked rows throw `credential_missing` without a value.
- plaintext is decrypted only immediately before the RPC response and passed to `rememberSecret`.
- KV namespace/scope/key/value are validated; module id and owner id come only from parent context.
- read-risk tools cannot call KV set/delete.
- instance KV set/delete requires `app.current_actor_is_admin()` true; user KV remains owner-scoped.

- [ ] **Step 4: Implement minimal RPC host and verify**

Use one fresh `workerDataContext.withDataContext()` per helper request. Never cache plaintext or encrypted envelopes. Map errors to fixed codes: `credential_missing`, `undeclared_auth`, `undeclared_namespace`, `forbidden_kv_mutation`, `forbidden_instance_kv_write`, `invalid_rpc`.

Run: `pnpm tsx scripts/test-integration.ts tests/integration/module-worker-rpc.test.ts tests/integration/module-credentials.test.ts tests/integration/module-kv-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(settings): scope external worker data access`

---

### Task 4: Adapt active external tools into the existing gateway

**Files:**

- Create: `packages/module-registry/src/external/tool-manifests.ts`
- Modify: `packages/module-registry/src/node.ts`
- Create: `tests/unit/external-tool-manifests.test.ts`
- Modify: `tests/integration/mcp-gateway.test.ts`

**Interfaces:**

- Produces executable `JarvisModuleManifest[]` from validated discoveries.
- Reuses `AssistantToolGateway` unchanged; generated `execute` closures invoke the worker runtime.

- [ ] **Step 1: Write failing adapter tests**

Assert generated manifests preserve module/tool identity, schema, risk, permission id, and user-disable behavior; only declarations with runtime+tools generate executable tools. Assert `execute` binds module discovery and handler internally—worker input cannot supply or override module id, actor id, or handler id.

Run: `pnpm vitest run tests/unit/external-tool-manifests.test.ts`
Expected: FAIL because adapter is absent.

- [ ] **Step 2: Implement the thin adapter**

Map each declaration to the existing shape:

```ts
{
  name: declared.name,
  description: declared.description,
  permissionId: declared.permissionId,
  risk: declared.risk,
  inputSchema: declared.inputSchema,
  outputSchema: declared.outputSchema,
  execute: (_scopedDb, input, ctx) => invoke(discovery, declared, input, ctx)
}
```

Set `availability.supportsUserDisable` only for `lifecycle === "user-toggleable"`. Add no second gateway, policy engine, confirmation registry, or audit writer.

- [ ] **Step 3: Prove pending action and audit reuse**

Extend the existing gateway integration fixture with an adapted external read/write/destructive tool. Assert read executes immediately; write creates a pending `app.ai_assistant_action_requests` row before worker invocation; destructive confirms even when marked auto; confirmation executes once; action audit rows contain module/tool/risk/outcome metadata only. Assert disabled/unresolved external manifests list no tools.

Run: `pnpm tsx scripts/test-integration.ts tests/integration/mcp-gateway.test.ts`
Expected: PASS after adapter wiring; no gateway production diff required.

- [ ] **Step 4: Commit**

Commit: `feat(ai): route external tools through assistant gateway`

---

### Task 5: Production composition and end-to-end execution

**Files:**

- Modify: `apps/api/src/server.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/chat/src/routes.ts`
- Create: `tests/integration/external-module-tools.test.ts`

**Interfaces:**

- API owns worker-role DB pool, worker runtime, active external manifest adapter, and shutdown.
- Chat/gateway receives only the combined actor-filtered resolver; no worker internals cross into chat.

- [ ] **Step 1: Write failing end-to-end test**

Create a temporary enabled module with a prebuilt worker using `defineModuleWorker`. Through the real API/MCP gateway assert: feature flag off hides tools and spawns nothing; enabled read tool runs under actor/module RLS; user and instance credentials resolve; revoke causes next call to return safe failure; KV round-trip is actor/module scoped; write remains pending until confirmed; stdout/stderr secret text reaches logger only as `[REDACTED]`.

Run: `pnpm tsx scripts/test-integration.ts tests/integration/external-module-tools.test.ts`
Expected: FAIL because production resolver/runtime are not composed.

- [ ] **Step 2: Wire resources at the API composition root**

Only when external modules are enabled, create `workerDb` with `getJarvisDatabaseUrls().worker`, `DataContextRunner(workerDb)`, one credential cipher, and one `ExternalModuleWorkerRuntime`. Build executable external manifests from the boot discovery snapshot. Wrap the built-in active resolver so external manifests additionally require reconciled `app.external_modules.status = 'enabled'`, package-hash match, and existing instance/user deny rows.

Pass the combined resolver through `registerBuiltInApiRoutes` to chat. Keep `listModuleManifests`, route registration, and built-in workers unchanged. On Fastify close, stop all module children before destroying worker DB; use `Promise.allSettled` with existing owned resources.

- [ ] **Step 3: Verify fail-closed lifecycle**

Add assertions for absent status row, disabled status, drifted hash, per-user disable, worker crash/respawn, and server shutdown. Confirm no child env contains any DB or credential secret and no job payload is introduced.

Run: `pnpm tsx scripts/test-integration.ts tests/integration/external-module-tools.test.ts tests/integration/mcp-gateway.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

Commit: `feat(api): execute enabled external module tools`

---

### Task 6: Final security regression and full gate

**Files:**

- Modify only files required by failures found below; no cleanup outside Slice 3.

- [ ] **Step 1: Run focused security suite**

Run:

```bash
pnpm vitest run tests/unit/external-validate.test.ts tests/unit/module-sdk-worker.test.ts tests/unit/external-worker-runtime.test.ts tests/unit/external-tool-manifests.test.ts
pnpm tsx scripts/test-integration.ts tests/integration/module-worker-rpc.test.ts tests/integration/external-module-tools.test.ts tests/integration/mcp-gateway.test.ts tests/integration/module-credentials.test.ts tests/integration/module-kv-lifecycle.test.ts
```

Expected: PASS with no secret/path/stack in captured output.

- [ ] **Step 2: Re-run migration collision check**

Run: `git fetch origin main && git ls-tree -r --name-only origin/main 'packages/*/sql/*.sql' | sort | tail -10`
Expected: `0157` remains assigned to this branch after `0155/0156`. If ordering changed, stop and get coordinator renumber approval before editing the filename and foundation list.

- [ ] **Step 3: Run complete local gate**

Run: `pnpm verify:foundation`
Expected: exit 0.

Run: `pnpm audit:release-hardening`
Expected: exit 0.

- [ ] **Step 4: Sync graph and inspect diff**

Run: `codegraph sync . && git diff --check && git status --short`
Expected: graph refreshed, no whitespace errors, only Slice 3 files changed, tree clean after final explicit-path commit.

- [ ] **Step 5: Commit any gate-only corrections**

Commit only when corrections were needed: `fix(modules): harden external worker execution`

Then invoke `coordinated-wrap-up`; do not merge, close issue, or move board.
