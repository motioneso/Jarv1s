# FIN-00 Module Runtime Write Seams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two host-enforced write seams the finance module needs: a worker `auth.setCredential` RPC (user-scoped, declared slots only) and a manifest-declared `instanceWritePolicy` for instance-scoped KV namespaces.

**Architecture:** All changes are additive to the existing external-module worker RPC host (`createExternalModuleRpcHandler`) and the module SDK types. One additive migration (0171) grants `jarvis_worker_runtime` INSERT+UPDATE on `app.module_credentials` under user-scope-owner-only RLS. Audit rides the sanctioned `recordAuditEvent` API, so neither RPC call site (`apps/api/src/external-module-tools.ts`, `apps/worker/src/external-module-job-handler.ts`) changes.

**Tech Stack:** TypeScript, Kysely, Postgres RLS, vitest (integration tests hit a real per-agent Postgres via `tests/integration/test-database.ts`).

**Spec:** `docs/superpowers/specs/2026-07-18-module-runtime-write-seams.md` (task issue #1145, part of epic #1144).

## Global Constraints

- Never edit applied migrations; new SQL goes in `packages/settings/sql/0171_module_credentials_worker_write.sql` (0171 is the next global number after 0170).
- `tests/integration/foundation-schema-catalog.test.ts` asserts the FULL migration list with `toEqual` — every new migration adds a row there.
- Secrets never reach logs, KV, job payloads, exports, or AI inputs. Audit events are metadata-only (ids and scope, never the value).
- Credential value cap: non-empty string, ≤ 32 KiB UTF-8. Error codes (exact ids): `forbidden_instance_credential_write`, `forbidden_credential_write`, `credential_value_invalid`.
- `MODULE_WORKER_CONTRACT_VERSION` stays 1 (additive change).
- Full gate before every commit: `pnpm verify:foundation` (never pipe through `tail`; record real exit code).
- Generous why-comments citing issue #1145; commit messages include a user-facing summary line ("Not user-visible." is acceptable here).
- Stage explicit paths only — never `git add -A` (shared tree discipline applies even in the worktree).

---

### Task 1: Migration 0171 — worker write grants on module_credentials

**Files:**

- Create: `packages/settings/sql/0171_module_credentials_worker_write.sql`
- Modify: `tests/integration/foundation-schema-catalog.test.ts` (migration list, after the `0170` row at ~line 295)

**Interfaces:**

- Produces: DB-level permission for `jarvis_worker_runtime` to INSERT/UPDATE user-scope, owner-bound rows in `app.module_credentials`. Task 4's RPC branch depends on this.

- [ ] **Step 1: Add the expected-list row (failing test)**

In `tests/integration/foundation-schema-catalog.test.ts`, after the `0170` entry:

```ts
        { version: "0170", name: "0170_notification_reads_worker_policy_comment.sql" },
        // FIN-00 #1145 — worker-written user-scope credentials (auth.setCredential RPC):
        // INSERT+UPDATE grants for jarvis_worker_runtime, RLS owner+module-bound, user scope only.
        { version: "0171", name: "0171_module_credentials_worker_write.sql" }
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/foundation-schema-catalog.test.ts`
Expected: FAIL — applied list lacks 0171.

- [ ] **Step 3: Write the migration**

`packages/settings/sql/0171_module_credentials_worker_write.sql`:

```sql
-- FIN-00 (#1145) — worker-written user-scope credentials (auth.setCredential RPC).
-- jarvis_worker_runtime has been SELECT-only on app.module_credentials since 0157.
-- The new RPC persists runtime-minted secrets (OAuth-style token exchanges) via
-- upsertModuleCredential, which needs INSERT + UPDATE. RLS mirrors 0157's
-- module-binding predicate but is deliberately NARROWER than the SELECT policy:
-- writes are user-scope, owner-bound only — instance-scope credential writes stay
-- impossible for this role at the database itself (spec D1 defense in depth).

CREATE POLICY module_credentials_worker_insert ON app.module_credentials
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  );

CREATE POLICY module_credentials_worker_update ON app.module_credentials
  FOR UPDATE TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  );

GRANT INSERT, UPDATE ON app.module_credentials TO jarvis_worker_runtime;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/foundation-schema-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/sql/0171_module_credentials_worker_write.sql tests/integration/foundation-schema-catalog.test.ts
git commit -m "feat(settings): migration 0171 — worker INSERT/UPDATE on module_credentials, user-scope owner-bound (#1145)"
```

---

### Task 2: SDK types — `auth.setCredential` child transport + `instanceWritePolicy`

**Files:**

- Modify: `packages/module-sdk/src/index.ts:572-575` (`ModuleStorageDeclaration`)
- Modify: `packages/module-sdk/src/worker.ts:15` (interface) and `:127-130` (inline auth object)

**Interfaces:**

- Produces: `ModuleWorkerContext.auth.setCredential(authId: string, value: string): Promise<void>` (used by finance FIN-01 and Task 4's host branch); `ModuleStorageDeclaration.instanceWritePolicy?: "admin" | "module"` (consumed by Tasks 3 and 5).

- [ ] **Step 1: Extend `ModuleStorageDeclaration`** in `packages/module-sdk/src/index.ts`:

```ts
export interface ModuleStorageDeclaration {
  readonly namespace: string;
  readonly scopes: readonly ("instance" | "user")[];
  /**
   * FIN-00 #1145: who may write instance-scoped rows from module handlers.
   * Default "admin" (today's behavior). "module" opts declared namespaces into
   * handler writes regardless of the acting user's admin status — part of what
   * the admin approves at enable time (manifest hash pins it).
   */
  readonly instanceWritePolicy?: "admin" | "module";
}
```

- [ ] **Step 2: Extend the worker context** in `packages/module-sdk/src/worker.ts`:

Interface:

```ts
  readonly auth: {
    getCredential(authId: string): Promise<string>;
    setCredential(authId: string, value: string): Promise<void>;
  };
```

Inline object inside `defineModuleWorker`'s `module.invoke` handling:

```ts
          auth: {
            getCredential: (authId) =>
              callParent("auth.getCredential", { authId }) as Promise<string>,
            setCredential: (authId, value) =>
              callParent("auth.setCredential", { authId, value }) as Promise<void>
          },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -r typecheck` (or the repo's equivalent per `package.json`; `pnpm verify:foundation` includes it)
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/module-sdk/src/index.ts packages/module-sdk/src/worker.ts
git commit -m "feat(module-sdk): auth.setCredential context method + storage instanceWritePolicy (#1145)"
```

---

### Task 3: Manifest validation for `instanceWritePolicy`

**Files:**

- Modify: `packages/module-registry/src/external/validate.ts` (storage entry loop, ~lines 305–330)
- Test: `tests/unit/external-validate.test.ts`

**Interfaces:**

- Consumes: `ModuleStorageDeclaration.instanceWritePolicy` from Task 2.
- Produces: manifests carrying a valid `instanceWritePolicy` pass validation and the field survives into the parsed manifest (the existing `obj.storage as readonly ModuleStorageDeclaration[]` passthrough at ~line 585 already carries it — no change needed there).

- [ ] **Step 1: Write the failing tests** in `tests/unit/external-validate.test.ts` (follow the file's existing valid-manifest helper pattern; the storage-bearing fixtures use `namespace` prefixed by the module id):

```ts
it("accepts instanceWritePolicy 'module' on an instance-scoped namespace", () => {
  const result = validateManifest(
    withStorage([{ namespace: "acme.state", scopes: ["instance"], instanceWritePolicy: "module" }])
  );
  expect(result.ok).toBe(true);
});

it("rejects instanceWritePolicy on a user-only namespace", () => {
  const result = validateManifest(
    withStorage([{ namespace: "acme.state", scopes: ["user"], instanceWritePolicy: "module" }])
  );
  expect(result.ok).toBe(false);
});

it("rejects unknown instanceWritePolicy values", () => {
  const result = validateManifest(
    withStorage([{ namespace: "acme.state", scopes: ["instance"], instanceWritePolicy: "always" }])
  );
  expect(result.ok).toBe(false);
});
```

(Adapt `validateManifest`/`withStorage` to the file's actual fixture helpers — the file already builds storage-bearing manifests for the namespace-prefix tests; reuse that construction verbatim.)

- [ ] **Step 2: Run to verify the accept case fails** (unknown field may already be tolerated — the two reject cases are the load-bearing ones and MUST fail before the fix)

Run: `pnpm vitest run tests/unit/external-validate.test.ts`

- [ ] **Step 3: Implement** — inside the storage entry loop in `validate.ts`, after the scopes check:

```ts
// FIN-00 #1145: instance-write opt-in is only meaningful (and only
// approved by the admin) for namespaces that actually have instance scope.
const { instanceWritePolicy } = entry as Record<string, unknown>;
if (instanceWritePolicy !== undefined) {
  if (instanceWritePolicy !== "admin" && instanceWritePolicy !== "module") {
    errors.push('storage instanceWritePolicy must be "admin" or "module"');
  } else if (!Array.isArray(scopes) || !scopes.includes("instance")) {
    errors.push('storage instanceWritePolicy requires "instance" in scopes');
  }
}
```

- [ ] **Step 4: Run to verify all three pass**

Run: `pnpm vitest run tests/unit/external-validate.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/external/validate.ts tests/unit/external-validate.test.ts
git commit -m "feat(module-registry): validate storage instanceWritePolicy (#1145)"
```

---

### Task 4: Host RPC — `auth.setCredential` branch

**Files:**

- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` (error-code union ~line 20; new branch after the `auth.getCredential` branch ending ~line 168)
- Test: `tests/integration/module-worker-rpc.test.ts`

**Interfaces:**

- Consumes: migration 0171 (Task 1); `upsertModuleCredential` + `recordAuditEvent` from `@jarv1s/settings` (both already exported); `input.cipher.encryptJson({ value })` (same envelope `readModuleCredentialSecret` decrypts).
- Produces: RPC method `auth.setCredential { authId, value }` → `undefined`; audit action `"module.credential.worker-set"`.

- [ ] **Step 1: Extend the seed manifest** in `tests/integration/module-worker-rpc.test.ts` — `moduleA.manifest.auth` gains a user-scope declaration matching the already-seeded `acme-a.user` row:

```ts
    auth: [
      {
        id: "acme-a.shared",
        displayName: "Shared",
        kind: "api-key" as const,
        scope: "instance" as const
      },
      {
        id: "acme-a.user",
        displayName: "User token",
        kind: "api-key" as const,
        scope: "user" as const
      }
    ],
```

- [ ] **Step 2: Write the failing tests** (new `it` blocks in the `external module worker RLS` describe; mirror the construction at the "proxies declared credentials" test):

```ts
it("persists a declared user-scope credential via auth.setCredential", async () => {
  const base = {
    module: moduleA,
    actorUserId: ids.userA,
    requestId: "rpc-setcred",
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => false
  };
  const write = createExternalModuleRpcHandler({ ...base, toolRisk: "write" });

  // guards: undeclared slot, instance-scope slot, read-risk tool, bad values
  await expect(
    write("auth.setCredential", { authId: "acme-a.nope", value: "x" }, () => undefined)
  ).rejects.toMatchObject({ code: "undeclared_auth" });
  await expect(
    write("auth.setCredential", { authId: "acme-a.shared", value: "x" }, () => undefined)
  ).rejects.toMatchObject({ code: "forbidden_instance_credential_write" });
  const read = createExternalModuleRpcHandler({ ...base, toolRisk: "read" });
  await expect(
    read("auth.setCredential", { authId: "acme-a.user", value: "x" }, () => undefined)
  ).rejects.toMatchObject({ code: "forbidden_credential_write" });
  await expect(
    write("auth.setCredential", { authId: "acme-a.user", value: "" }, () => undefined)
  ).rejects.toMatchObject({ code: "credential_value_invalid" });
  await expect(
    write(
      "auth.setCredential",
      { authId: "acme-a.user", value: "x".repeat(32 * 1024 + 1) },
      () => undefined
    )
  ).rejects.toMatchObject({ code: "credential_value_invalid" });

  // happy path: persists, redacts, reads back in a second invocation
  const remembered: string[] = [];
  await expect(
    write("auth.setCredential", { authId: "acme-a.user", value: "minted-token-1" }, (value) =>
      remembered.push(value)
    )
  ).resolves.toBeUndefined();
  expect(remembered).toEqual(["minted-token-1"]);
  const second = createExternalModuleRpcHandler({ ...base, toolRisk: "read" });
  await expect(
    second("auth.getCredential", { authId: "acme-a.user" }, () => undefined)
  ).resolves.toBe("minted-token-1");

  // audit: metadata-only worker-set event, never the value
  const audit = await bootstrap.query(
    `SELECT metadata::text AS metadata FROM app.admin_audit_events
       WHERE action = 'module.credential.worker-set'`
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].metadata).not.toContain("minted-token-1");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/integration/module-worker-rpc.test.ts`
Expected: FAIL — `auth.setCredential` falls through to KV parsing → `invalid_rpc`/`undeclared_namespace`.

- [ ] **Step 4: Implement** in `worker-rpc-host.ts`:

Error-code union gains three members:

```ts
      | "forbidden_instance_credential_write"
      | "forbidden_credential_write"
      | "credential_value_invalid"
```

Imports: add `recordAuditEvent, upsertModuleCredential` to the existing `@jarv1s/settings` import.

New branch, immediately after the `auth.getCredential` branch (inside `withDataContext`, so the module id set_config and worker role are active):

```ts
if (method === "auth.setCredential") {
  // FIN-00 #1145: workers may persist runtime-minted secrets (e.g. an
  // OAuth-style token exchange) into DECLARED, USER-scope slots only.
  // Instance slots stay human-written via admin settings routes, and
  // migration 0171 enforces the same rule at the database.
  const authId = stringParam(params, "authId");
  const declaration = declarations.get(authId);
  if (!declaration) throw new ExternalModuleRpcError("undeclared_auth");
  if (declaration.scope !== "user") {
    throw new ExternalModuleRpcError("forbidden_instance_credential_write");
  }
  if (input.toolRisk === "read") {
    throw new ExternalModuleRpcError("forbidden_credential_write");
  }
  const value = params.value;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 32 * 1024
  ) {
    throw new ExternalModuleRpcError("credential_value_invalid");
  }
  await upsertModuleCredential(
    scopedDb,
    {
      moduleId: input.module.id,
      credentialId: authId,
      scope: "user",
      ownerUserId: input.actorUserId,
      displayName: declaration.displayName,
      encryptedSecret: input.cipher.encryptJson({ value }),
      actorUserId: input.actorUserId,
      requestId: input.requestId
    },
    // Metadata-only audit via the sanctioned cross-module API; override
    // the repository's default action so worker writes are distinguishable
    // from owner-PUT writes in the audit trail (spec D1).
    (event) => recordAuditEvent(scopedDb, { ...event, action: "module.credential.worker-set" })
  );
  // Same redaction posture as getCredential: the just-written value must
  // never appear in ai/fetch inputs or worker stdout for this invocation.
  rememberSecret(value);
  resolvedSecrets.add(value);
  return undefined;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run tests/integration/module-worker-rpc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/module-registry/src/external/worker-rpc-host.ts tests/integration/module-worker-rpc.test.ts
git commit -m "feat(module-registry): auth.setCredential worker RPC — declared user slots, audited, redacted (#1145)"
```

---

### Task 5: Host RPC — instance-KV write policy consult

**Files:**

- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` (the admin gate at ~line 188)
- Test: `tests/integration/module-worker-rpc.test.ts`

**Interfaces:**

- Consumes: `instanceWritePolicy` on the storage declaration map already built at handler construction (`storage.get(namespace)` returns the full declaration).

- [ ] **Step 1: Write the failing test:**

```ts
it("allows non-admin instance kv writes when the namespace declares instanceWritePolicy module", async () => {
  const optedIn = {
    ...moduleA,
    manifest: {
      ...moduleA.manifest,
      storage: [
        {
          namespace: "acme-a.state",
          scopes: ["instance", "user"] as const,
          instanceWritePolicy: "module" as const
        }
      ]
    }
  };
  const write = createExternalModuleRpcHandler({
    module: optedIn,
    toolRisk: "write",
    actorUserId: ids.userA,
    requestId: "rpc-kv-policy",
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => false
  });
  await expect(
    write(
      "kv.set",
      { scope: "instance", namespace: "acme-a.state", key: "pooled", value: { v: 9 } },
      () => undefined
    )
  ).resolves.toBeUndefined();
  // read-risk tools still cannot mutate, policy or not
  const read = createExternalModuleRpcHandler({
    module: optedIn,
    toolRisk: "read",
    actorUserId: ids.userA,
    requestId: "rpc-kv-policy-read",
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => false
  });
  await expect(
    read(
      "kv.set",
      { scope: "instance", namespace: "acme-a.state", key: "pooled", value: { v: 9 } },
      () => undefined
    )
  ).rejects.toMatchObject({ code: "forbidden_kv_mutation" });
});
```

(The existing "denies … non-admin instance mutations" test keeps covering the default-`"admin"` path — do not touch it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/module-worker-rpc.test.ts`
Expected: FAIL with `forbidden_instance_kv_write` on the first assertion.

- [ ] **Step 3: Implement** — replace the unconditional gate in `worker-rpc-host.ts`:

```ts
// FIN-00 #1145: default stays admin-gated; a namespace whose reviewed,
// hash-pinned manifest declares instanceWritePolicy "module" opts its
// instance rows into handler writes for any acting user.
if (
  scope === "instance" &&
  declaration.instanceWritePolicy !== "module" &&
  !(await input.isActorAdmin())
) {
  throw new ExternalModuleRpcError("forbidden_instance_kv_write");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/module-worker-rpc.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/external/worker-rpc-host.ts tests/integration/module-worker-rpc.test.ts
git commit -m "feat(module-registry): honor storage instanceWritePolicy for instance kv writes (#1145)"
```

---

### Task 6: Composition guard covers written credentials + docs + PR

**Files:**

- Test: `tests/integration/module-worker-rpc.test.ts` (one case in the `ai.generateStructured` describe)
- Modify: `docs/module-developer-guide.md` (new "Runtime credential writes" subsection near the existing auth/credentials docs)

- [ ] **Step 1: Write the failing test** (in the `ai.generateStructured` describe, reusing its existing `base`-style construction with an `ai` callback — mirror the "rejects prompts or schemas containing a credential resolved in this invocation" test at ~line 345, but resolve the secret via `auth.setCredential` instead of `getCredential`):

```ts
it("rejects ai prompts containing a credential written via auth.setCredential this invocation", async () => {
  const rpc = createExternalModuleRpcHandler({
    module: moduleA,
    toolRisk: "write",
    actorUserId: ids.userA,
    requestId: "rpc-ai-setcred",
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => false,
    ai: async () => ({ ok: true, object: {} })
  });
  await rpc(
    "auth.setCredential",
    { authId: "acme-a.user", value: "freshly-minted" },
    () => undefined
  );
  await expect(
    rpc(
      "ai.generateStructured",
      { schema: { type: "object" }, prompt: "token is freshly-minted" },
      () => undefined
    )
  ).rejects.toMatchObject({ code: "forbidden_secret_in_ai_input" });
});
```

- [ ] **Step 2: Run it** — if Task 4 was implemented correctly (value added to `resolvedSecrets`) this passes immediately; if it fails, the bug is in Task 4's redaction lines, fix there.

Run: `pnpm vitest run tests/integration/module-worker-rpc.test.ts`
Expected: PASS.

- [ ] **Step 3: Document** — add to `docs/module-developer-guide.md`, alongside the existing `ctx.auth` docs:

```markdown
### Runtime credential writes (`ctx.auth.setCredential`)

Workers may persist runtime-minted secrets (e.g. the access token from an
OAuth-style exchange) with `await ctx.auth.setCredential(authId, value)`:

- `authId` must be a declared `auth` entry with `scope: "user"`. Instance-scope
  credentials are always human-entered via admin settings.
- Only write-risk tool invocations may call it; the value must be a non-empty
  string of at most 32 KiB.
- One slot holds one string. Modules needing per-item tokens store a JSON map
  inside a single declared slot — and must serialize their own
  read-modify-write (run token-touching work on a single per-user queue;
  concurrent writers are last-writer-wins and will drop each other's entries).
- The written value is treated like a resolved secret for the rest of the
  invocation: it is redacted from worker output and rejected from `ctx.ai` /
  `ctx.fetch` inputs.

### Instance KV write policy (`instanceWritePolicy`)

Instance-scoped KV writes from handlers are admin-gated by default. A storage
declaration with `"instanceWritePolicy": "module"` opts that namespace into
handler writes for any acting user — use it for module-managed shared pools.
The admin approves this as part of the reviewed, hash-pinned manifest.
```

- [ ] **Step 4: Full gate**

Run: `pnpm verify:foundation`
Expected: exit 0 (record the real exit code).

- [ ] **Step 5: Commit and open the PR**

```bash
git add tests/integration/module-worker-rpc.test.ts docs/module-developer-guide.md
git commit -m "test+docs: setCredential composition-guard coverage; developer-guide write-seams section (#1145)"
git push -u origin worktree-finance-module
gh pr create --title "FIN-00: module runtime write seams — auth.setCredential + instanceWritePolicy (#1145)" --body "..."
```

PR body must include a user-facing summary (platform capability, not user-visible UI), "Part of #1144, closes #1145", the spec path, and the verify:foundation result.

---

## Self-Review Notes (completed at authoring time)

- **Spec coverage:** D1 → Tasks 1, 2, 4, 6 (audit action, redaction, 32 KiB cap, migration, RMW rule in docs). D2 → Tasks 2, 3, 5 (+ docs). D3 → no code (contract stays 1; asserted implicitly by not touching `worker-protocol.ts`). Testing section → Tasks 3–6; the spec's "unit" host-handler cases live in `tests/integration/module-worker-rpc.test.ts` because that is where ALL existing RPC-handler cases live (real RLS beats mocks here — deliberate deviation, noted).
- **Type consistency:** `instanceWritePolicy?: "admin" | "module"` used identically in Tasks 2/3/5; error codes in Task 4 match the union extension and the spec's ids exactly; `setCredential(authId: string, value: string): Promise<void>` identical in SDK and host.
- **Placeholder scan:** the `gh pr create --body "..."` ellipsis is the only intentional one (body content specified in prose directly below it).
