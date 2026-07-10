# Open Module System Slice 2 Implementation Plan (#918)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** External modules gain a web surface (served assets + ESM contribution mounted in the shell), encrypted per-module credentials (`app.module_credentials`), and module KV storage (`app.module_kv`) wired into export/delete lifecycle — with path-traversal/symlink defense and a plaintext-never-escapes guarantee.

**Architecture:** Everything extends the #917 Slice 1 seams: manifests validated in `packages/module-registry/src/external/validate.ts`, activation via `reconcileExternalModules`, admin routes in `packages/settings`. New platform-owned tables live in `packages/settings/sql/` with FORCE RLS. The asset route is platform-owned in `apps/api/src/server.ts` (external modules cannot declare routes). Credentials reuse the existing `JsonSecretCipher`/`resolveKeyring` AES-256-GCM machinery from `@jarv1s/db`.

**Tech Stack:** TypeScript, Fastify, Kysely, Postgres RLS, fast-json-stringify schemas in `packages/shared/src/platform-api.ts`, React 18 + React Query in `apps/web`, vitest (`tests/unit`) + integration harness (`tests/integration` via `tsx scripts/test-integration.ts`).

**Spec:** `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md` §Build slices — Slice 2. Issue #918. Risk tier: `security`.

## Global Constraints

- **Secrets never escape** (CLAUDE.md hard invariant): credential plaintext and ciphertext envelopes never reach frontend responses, logs, audit metadata, pg-boss payloads, user exports, or AI prompts.
- **DataContextDb only**: every new repository function calls `assertDataContextDb(scopedDb)` first and accepts only the branded handle.
- **AccessContext** stays `{ actorUserId, requestId }` — no new fields.
- **Never edit applied migrations.** New SQL files only, in `packages/settings/sql/`. Migration numbers are `NNNN` placeholders in this plan — **the coordinator assigns real numbers at build time** (global landing order). Both new migrations must be added to `tests/integration/foundation.test.ts`'s full-list `toEqual` assertion or it fails latently.
- **Module isolation**: external modules never declare `routes`/`database`/`dataLifecycle`; the platform owns the new tables and routes directly.
- **fast-json-stringify trap**: response schemas use `additionalProperties: false` — every emitted field MUST be declared in the schema in `packages/shared/src/platform-api.ts` or it is silently dropped (recurring trap: #859, #885).
- Authorize FIRST inside `withDataContext`, before any 404/409 branch (discipline from `packages/settings/src/routes-modules.ts`): a non-admin/non-owner must never be able to distinguish unknown vs forbidden vs feature-off.
- File-size gate: all source files ≤ 1000 lines. Full local gate at build time: `pnpm verify:foundation` + full `pnpm test:integration` (this plan-authoring lane does not run them).
- Frontend: extend `jds-*` primitives and existing authored patterns; raw colors only in `apps/web/src/styles/tokens.css`.

---

## Security Design (first-class sections)

### A. Path-traversal & symlink defense for the asset route

`GET /api/modules/:moduleId/web/*` serves files from an **untrusted module package directory**. Threat model: a hostile package (or hostile request) uses `..` segments, absolute paths, encoded traversal, or symlinks placed inside the package to read arbitrary host files (env files, keys, other modules' packages).

Defense in `packages/module-registry/src/external/web-assets.ts` (Task 17), layered:

1. **Lexical rejection before any filesystem call**: empty path, NUL bytes, absolute paths, backslashes, and any `.`/`..`/empty path segment → reject.
2. **Extension allowlist** (`.js .mjs .css .json .map .svg .png .woff2`) with explicit content types → anything else rejected (`jarvis.module.json`, `.env`, etc. are never servable even though they live in the package).
3. **Realpath containment** — the same algorithm `external/hash.ts` uses for packaging: `realpathSync` the module root once, `realpathSync` the joined candidate, then require `real === rootReal || real.startsWith(rootReal + sep)`. This is what defeats symlinks: a link inside the package pointing outside resolves to a real path that fails the prefix check.
4. **No error-message leakage** (discipline from `external/node.ts`): rejections carry a reason token only, never the requested path resolved to disk and never raw fs error text (which embeds absolute host paths). Logs record `reason` + `moduleId`; the HTTP response is a bare 404.
5. **Fail-closed activation gate in the handler** (Task 19): feature flag off, unknown module, no `web` declaration, or module not ACTIVE for the requesting actor are all indistinguishable 404s — same posture as the Slice 1 route-enablement guard. Assets are authenticated (401 without a session) and served `cache-control: no-store` so a cached asset cannot outlive a disable.

Serving is module-root-relative (not `dist/web`-restricted). Acceptable: package files are the shipped artifact, `packageHash` covers every file, and no secrets belong inside packages; the extension allowlist plus containment bound the exposure.

### B. Credential encryption flow & plaintext-never-escapes guarantee

**At rest:** `app.module_credentials.encrypted_secret` holds an `EncryptedSecret` envelope (`{version: 1, algorithm: "aes-256-gcm", keyId?, iv, tag, ciphertext}`) produced by `ModuleCredentialCipher` — a `JsonSecretCipher` subclass (Task 10) with its own key family `JARVIS_MODULE_CREDENTIAL_SECRET_KEY[(_ID|S)]`, resolved via the existing `resolveKeyring` (hardened env requires a ≥32-byte secret; dev default only outside hardened mode). Same machinery as connector credentials (`packages/connectors/src/crypto.ts`) — reused, not reinvented.

**Write path (the only path plaintext exists):** `PUT .../credentials/:credentialId` receives `{ value }`, encrypts inside the handler (`cipher.encryptJson({ value })`), and passes only the envelope to the repository. Plaintext lifetime = one handler frame. It is never assigned to a logged object, never included in the audit metadata, and the request body is never logged (Fastify default; no custom body logging is added).

**Read paths return metadata only, at the SQL level:** list queries never select `encrypted_secret`; they project `encrypted_secret IS NOT NULL AND revoked_at IS NULL AS has_secret` (Task 11). The DTO (`ModuleCredentialStatusDto`, Task 13) has no field that could carry the secret, and its fast-json-stringify schema (`additionalProperties: false`) would strip one even if a bug emitted it — schema-as-backstop.

**Decrypt:** **zero production decrypt call sites exist in Slice 2.** The only consumer of stored credentials is Slice 3's worker RPC (`ctx.auth.getCredential`), which is explicitly out of scope. Decryption is exercised solely by the Task 10 unit test (round-trip). The plaintext-never-escapes guarantee is therefore structural, not behavioral: there is no code path that can produce plaintext from storage.

**Per-sink audit:**

- _Frontend responses:_ metadata-only DTO + strict schema (Tasks 11/13/14).
- _Logs:_ no body logging; audit metadata restricted to `{moduleId, credentialId, scope}` — never `displayName`, value, or envelope (Task 11).
- _pg-boss payloads:_ Slice 2 enqueues no jobs; the metadata-only-payload invariant is untouched.
- _Exports:_ `moduleCredentialsQuery` mirrors `connectorAccountsQuery`'s `encrypted_secret IS NOT NULL AS "hasSecret"` — envelope never selected (Task 21).
- _AI prompts:_ no AI seam touches these tables in Slice 2.

**Revoke destroys the secret:** revoke is an `UPDATE` that scrubs (`encrypted_secret = NULL, revoked_at = now()`), stronger than a flag. `jarvis_app_runtime` has **no DELETE grant** on the table (`module_credentials` joins `protectedTables`, Task 9); rows persist as tombstones until user deletion cascades them.

### C. KV export/delete completeness

`app.module_kv` rows are `scope = 'user'` (owner-bound, `owner_user_id` FK `ON DELETE CASCADE`) or `scope = 'instance'` (`owner_user_id IS NULL`).

- **Export** (Task 21): `moduleKvQuery` exports every `scope = 'user'` row's plain `value` for the exporting user (KV values are the user's data, not secrets); `moduleCredentialsQuery` exports credential _metadata_ with `hasSecret`, never the envelope. Both are new fields on the flat `UserDataExportTables` interface wired into `readExportTables` — the interface's flatness means a missed table is a visible type gap.
- **Delete** (Task 20): row deletion is automatic via `ON DELETE CASCADE` from `app.users` (the single `DELETE FROM app.users` in `scripts/delete-user-data.ts`). What must be added by hand are the **dry-run count entries** in `userScopedCountQueries` — `["app.module_credentials", "owner_user_id = $1::uuid"]` and `["app.module_kv", "scope = 'user' AND owner_user_id = $1::uuid"]` — or the operator-facing count report silently under-counts. Instance rows have `owner_user_id IS NULL`, so the predicates can never match them.
- **Verification** (Task 26): integration test seeds both tables for a user, asserts export contains both sections, dry-run counts include both tables, and a real delete leaves zero user rows while instance rows survive.

---

## Resolved Decisions (do not re-litigate)

1. **SDK type redefinition** — `packages/module-sdk/src/index.ts`'s reserved `ModuleAuthDeclaration`/`ModuleStorageDeclaration` are **redefined to the spec shape**: `{id, displayName, kind: "api-key", scope: "instance" | "user"}` and `{namespace, scopes: ("instance" | "user")[]}` (rename `label`→`displayName`, drop `oauth2`, drop `kind: "kv"`). Zero back-compat cost: Slice 1's validator forbids `auth`/`storage` today, so nothing consumes the old shape.
2. **`protectedTables`** — `module_credentials` **added** to `scripts/audit-release-hardening.ts`'s `protectedTables` (no app_runtime DELETE; revoke = UPDATE, mirroring `connector_accounts`). `module_kv` **not added** — it needs real per-key DELETE (like `module_enablement`); its FORCE-RLS migration auto-satisfies the script's dynamic coverage check.
3. **Admin "purge module" action** (spec's uninstall semantics: delete module status + instance credentials + instance KV + all user rows) — **deferred out of Slice 2**. It is a large blast-radius addition to an already-large slice. File a follow-up issue at build time (placeholder: _"#TBD-follow-up: admin purge-module action"_) and reference it from PR notes.
4. **Out of scope — Slice 3 RPC:** module-facing helpers `ctx.auth.getCredential` / `ctx.kv.*` do **not** exist and must not be assumed or stubbed. Consequences baked into this plan: no worker grants in either migration, no decrypt call sites, KV instance-scope writes are admin-only (fail-closed; Slice 3 may relax via its own policy migration).

---

## File Structure

```
packages/module-sdk/src/index.ts                          # M: redefine auth/storage types, add ModuleWebDeclaration + manifest fields
packages/module-registry/src/external/validate.ts         # M: unforbid auth/storage, positively validate auth/storage/web
packages/module-registry/src/external/types.ts             # M: ReconciledExternalModule.web
packages/module-registry/src/external/reconcile.ts         # M: carry manifest.web through
packages/module-registry/src/external/web-assets.ts        # C: path/symlink containment + content-type map
packages/module-registry/src/node.ts                       # M: export web-assets
packages/db/src/types.ts                                   # M: ModuleCredentialsTable, ModuleKvTable
packages/settings/sql/NNNN_module_credentials.sql          # C: table + FORCE RLS + grants (no DELETE)
packages/settings/sql/NNNN_module_kv.sql                   # C: table + FORCE RLS + grants (with DELETE)
packages/settings/src/module-credential-crypto.ts          # C: ModuleCredentialCipher + keyring factory
packages/settings/src/repository-module-credentials.ts     # C: metadata list / upsert / revoke
packages/settings/src/repository-module-kv.ts              # C: get/set/delete/list KV
packages/settings/src/routes-module-credentials.ts         # C: admin + /me credential routes
packages/settings/src/routes.ts                            # M: wire registerModuleCredentialRoutes
packages/shared/src/platform-api.ts                        # M: credential DTOs/schemas + web field on ModuleDto/ExternalModuleDto
packages/module-registry/src/route-guard.ts                # M: allowlist new platform routes
apps/api/src/server.ts                                     # M: asset route + serializeExternalModule web passthrough
scripts/audit-release-hardening.ts                         # M: protectedTables += module_credentials
scripts/delete-user-data.ts                                # M: two count-query entries
packages/settings/src/data-export.ts                       # M: moduleCredentials/moduleKv export queries
apps/web/src/external-modules/loader.ts                    # C: host runtime global + contribution loader
apps/web/src/app.tsx                                       # M: dock external module routes (useMemo)
apps/web/src/api/client.ts                                 # M: credential API functions
apps/web/src/settings/module-credentials-section.tsx       # C: credentials settings UI section
apps/web/src/settings/settings-admin-panes.tsx             # M: dock admin credentials section
tests/unit/module-web-assets.test.ts                       # C: containment unit tests (Task 17)
tests/unit/module-credential-crypto.test.ts                # C: cipher round-trip unit test (Task 10)
tests/integration/module-credentials.test.ts               # C: route + RLS + no-plaintext tests
tests/integration/module-kv-lifecycle.test.ts              # C: export/delete completeness
tests/integration/module-web-assets.test.ts                # C: traversal/symlink/activation tests
tests/integration/foundation.test.ts                       # M: two migration rows
```

---

### Task 1: SDK manifest types — auth, storage, web

**Files:**

- Modify: `packages/module-sdk/src/index.ts` (the reserved `ModuleAuthDeclaration` / `ModuleStorageDeclaration` definitions)

**Interfaces:**

- Produces: `ModuleAuthDeclaration { id, displayName, kind: "api-key", scope: "instance" | "user" }`, `ModuleStorageDeclaration { namespace, scopes: ("instance" | "user")[] }`, `ModuleWebDeclaration { entrypoint: string, contractVersion: number }`; manifest fields `auth?`, `storage?`, `web?`. Consumed by Tasks 2, 3, 4, 14.

- [ ] **Step 1: Replace the reserved declarations and add the web declaration**

In `packages/module-sdk/src/index.ts`, replace the existing `ModuleAuthDeclaration` and `ModuleStorageDeclaration` interfaces with (keep surrounding doc-comment style):

```ts
/**
 * Credential slot a module declares (#918 Slice 2). Values are stored
 * platform-side in app.module_credentials (AES-256-GCM at rest) and are
 * NOT readable by module code until Slice 3's ctx.auth.getCredential RPC.
 * `id` must be prefixed with the module id ("<moduleId>." + slug).
 */
export interface ModuleAuthDeclaration {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "api-key";
  readonly scope: "instance" | "user";
}

/**
 * KV namespace a module declares (#918 Slice 2). Rows live platform-side in
 * app.module_kv; module code cannot read/write them until Slice 3's ctx.kv RPC.
 * `namespace` must be the module id or "<moduleId>.<slug>".
 */
export interface ModuleStorageDeclaration {
  readonly namespace: string;
  readonly scopes: readonly ("instance" | "user")[];
}

/**
 * Web contribution entry (#918 Slice 2). `entrypoint` is a package-relative
 * ESM file served via GET /api/modules/:moduleId/web/*; `contractVersion`
 * must equal the host's JARVIS_WEB_CONTRACT_VERSION or nothing mounts.
 */
export interface ModuleWebDeclaration {
  readonly entrypoint: string;
  readonly contractVersion: number;
}
```

- [ ] **Step 2: Add the manifest fields**

On the JSON manifest interface in the same file (the type `validate.ts` re-shapes into — currently it omits `auth`/`storage`/`web` or marks them reserved), ensure these optional fields exist:

```ts
readonly auth?: readonly ModuleAuthDeclaration[];
readonly storage?: readonly ModuleStorageDeclaration[];
readonly web?: ModuleWebDeclaration;
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @jarv1s/module-sdk typecheck` (or `pnpm typecheck`)
Expected: PASS (nothing consumes the old shapes — Slice 1 forbids these fields).

```bash
git add packages/module-sdk/src/index.ts
git commit -m "feat(#918): redefine module auth/storage declarations and add web declaration to SDK"
```

### Task 2: Manifest validator — accept auth/storage/web

**Files:**

- Modify: `packages/module-registry/src/external/validate.ts`
- Test: extend the existing validator coverage where Slice 1's tests live (integration `external-modules-*.test.ts` exercises rejection via discovery; add unit assertions only if a validator unit test file already exists — do not create a new suite for this task; Task 27's integration test covers the accept path end-to-end)

**Interfaces:**

- Consumes: Task 1's `ModuleAuthDeclaration` / `ModuleStorageDeclaration` / `ModuleWebDeclaration`.
- Produces: validated manifests may now carry `auth`, `storage`, `web`; all other Slice 3+ fields (`routes`, `tools`, `jobs`, `database`, `dataLifecycle`, …) stay forbidden.

- [ ] **Step 1: Remove `"auth"` and `"storage"` from `FORBIDDEN_FIELDS`**

Delete exactly those two entries from the `FORBIDDEN_FIELDS` array (currently 18 entries). Leave every other entry intact.

- [ ] **Step 2: Add positive validation, following the file's existing error style**

After the existing field validations and before the final re-shaped literal is built, add (adapting to the file's actual error-reporting helper — it returns/throws a validation failure with a message; mirror the nearest existing check verbatim in structure):

```ts
// #918 Slice 2: auth/storage/web are now first-class. Everything else
// (routes, tools, jobs, database, dataLifecycle, ...) stays forbidden.
if (raw.auth !== undefined) {
  if (!Array.isArray(raw.auth)) return fail("auth must be an array");
  for (const entry of raw.auth) {
    if (typeof entry !== "object" || entry === null) return fail("auth entries must be objects");
    const { id, displayName, kind, scope } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id.startsWith(`${moduleId}.`) ||
      id.length <= moduleId.length + 1
    ) {
      return fail(`auth id must be prefixed with "${moduleId}."`);
    }
    if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 200) {
      return fail("auth displayName must be a non-empty string (max 200)");
    }
    if (kind !== "api-key") return fail('auth kind must be "api-key"');
    if (scope !== "instance" && scope !== "user")
      return fail('auth scope must be "instance" or "user"');
  }
  const ids = (raw.auth as { id: string }[]).map((a) => a.id);
  if (new Set(ids).size !== ids.length) return fail("auth ids must be unique");
}
if (raw.storage !== undefined) {
  if (!Array.isArray(raw.storage)) return fail("storage must be an array");
  for (const entry of raw.storage) {
    if (typeof entry !== "object" || entry === null) return fail("storage entries must be objects");
    const { namespace, scopes } = entry as Record<string, unknown>;
    if (
      typeof namespace !== "string" ||
      (namespace !== moduleId && !namespace.startsWith(`${moduleId}.`))
    ) {
      return fail(`storage namespace must be "${moduleId}" or "${moduleId}.<slug>"`);
    }
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some((s) => s !== "instance" && s !== "user")
    ) {
      return fail('storage scopes must be a non-empty array of "instance" | "user"');
    }
  }
}
if (raw.web !== undefined) {
  if (typeof raw.web !== "object" || raw.web === null) return fail("web must be an object");
  const { entrypoint, contractVersion } = raw.web as Record<string, unknown>;
  if (
    typeof entrypoint !== "string" ||
    entrypoint.length === 0 ||
    entrypoint.startsWith("/") ||
    entrypoint.includes("\\") ||
    entrypoint.split("/").some((seg) => seg === ".." || seg === "." || seg.length === 0)
  ) {
    return fail("web.entrypoint must be a clean package-relative path");
  }
  if (
    typeof contractVersion !== "number" ||
    !Number.isInteger(contractVersion) ||
    contractVersion < 1
  ) {
    return fail("web.contractVersion must be a positive integer");
  }
}
```

`fail(...)` above stands for the file's actual rejection mechanism — use it verbatim from the neighboring checks (this validator collects/returns structured rejection reasons; match exactly). This is a naming instruction, not a placeholder: the implementer copies the adjacent pattern.

- [ ] **Step 3: Include the three fields in the final re-shaped literal**

The validator builds a fresh literal (never spreads `raw`). Add to that literal:

```ts
auth: raw.auth as readonly ModuleAuthDeclaration[] | undefined,
storage: raw.storage as readonly ModuleStorageDeclaration[] | undefined,
web: raw.web as ModuleWebDeclaration | undefined,
```

(with whatever narrowing style the file already uses — if it rebuilds nested literals field-by-field, rebuild these the same way).

- [ ] **Step 4: Typecheck + existing tests, commit**

Run: `pnpm typecheck && pnpm test:integration tests/integration/external-modules-routes.test.ts`
Expected: PASS (existing manifests without these fields are unaffected).

```bash
git add packages/module-registry/src/external/validate.ts
git commit -m "feat(#918): validate module auth/storage/web manifest declarations"
```

### Task 3: `ReconciledExternalModule.web`

**Files:**

- Modify: `packages/module-registry/src/external/types.ts`

**Interfaces:**

- Produces: `ReconciledExternalModule` gains `readonly web: { readonly entrypoint: string; readonly contractVersion: number } | null;` — consumed by Tasks 4, 18, 19.

- [ ] **Step 1: Add the field**

In `ReconciledExternalModule` (currently `{id, name, version, publisher, status, active, drifted, disabledReason}`), add:

```ts
/** Web contribution declared by the manifest, or null when the module has no web surface (#918). */
readonly web: { readonly entrypoint: string; readonly contractVersion: number } | null;
```

- [ ] **Step 2: Typecheck (expect reconcile.ts failure), fix in Task 4**

Run: `pnpm typecheck`
Expected: FAIL in `reconcile.ts` (missing `web`) — this is the failing-state that Task 4 resolves. Do not commit yet; Tasks 3+4 commit together.

### Task 4: Carry `manifest.web` through reconciliation

**Files:**

- Modify: `packages/module-registry/src/external/reconcile.ts`

**Interfaces:**

- Consumes: Task 3's field; `discovery.manifest.web` from Task 1.
- Produces: every reconciled module (all four truth-table branches) carries `web`.

- [ ] **Step 1: Add `web` to the shared `base` object**

The function builds one `base` literal (`id`, `name`, `version`, `publisher` from the manifest) used by all four branches. Add one line:

```ts
web: discovery.manifest.web ?? null,
```

- [ ] **Step 2: Typecheck + commit Tasks 3+4**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add packages/module-registry/src/external/types.ts packages/module-registry/src/external/reconcile.ts
git commit -m "feat(#918): carry web declaration through external module reconciliation"
```

### Task 5: Kysely table types

**Files:**

- Modify: `packages/db/src/types.ts` (interfaces near `ExternalModulesTable`; registration in `JarvisDatabase` immediately after `"app.external_modules": ExternalModulesTable;`)

**Interfaces:**

- Produces: `ModuleCredentialsTable`, `ModuleKvTable`, registered as `"app.module_credentials"` / `"app.module_kv"`. Consumed by Tasks 11, 12, 21.

- [ ] **Step 1: Add the interfaces (match the file's existing helper-type style — `Generated`, `ColumnType`, `JsonColumn`)**

```ts
/**
 * Module credential secrets (#918 Slice 2). encrypted_secret is an AES-256-GCM
 * EncryptedSecret envelope, nullable because revoke scrubs it in place
 * (app_runtime has no DELETE grant — protected table).
 */
export interface ModuleCredentialsTable {
  id: Generated<string>;
  module_id: string;
  credential_id: string;
  scope: "instance" | "user";
  owner_user_id: string | null;
  display_name: string;
  encrypted_secret: JsonColumn | null;
  revoked_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Module KV storage (#918 Slice 2). value is plain module data, never secrets. */
export interface ModuleKvTable {
  id: Generated<string>;
  module_id: string;
  namespace: string;
  scope: "instance" | "user";
  owner_user_id: string | null;
  key: string;
  value: JsonColumn;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

(If the file expresses nullable timestamps differently — e.g. `Date | null` directly — copy the nearest existing nullable-timestamp column's exact style instead.)

- [ ] **Step 2: Register both tables in `JarvisDatabase`**

Immediately after `"app.external_modules": ExternalModulesTable;`:

```ts
"app.module_credentials": ModuleCredentialsTable;
"app.module_kv": ModuleKvTable;
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/db/src/types.ts
git commit -m "feat(#918): register module_credentials and module_kv table types"
```

### Task 6: Migration `NNNN_module_credentials.sql`

**Files:**

- Create: `packages/settings/sql/NNNN_module_credentials.sql` (**coordinator assigns NNNN at build time** — next global number after the current highest; do not guess)

**Interfaces:**

- Produces: `app.module_credentials` with FORCE RLS; consumed by Tasks 8, 9, 11, 21, 25.

- [ ] **Step 1: Write the migration (mirror `0152_external_modules.sql`'s idempotent style)**

```sql
-- Module credential secrets (#918, Open module system Slice 2).
-- One row per (module, credential id, scope[, owner]). encrypted_secret holds an
-- AES-256-GCM EncryptedSecret envelope (packages/db/src/secret-cipher.ts) produced
-- by ModuleCredentialCipher — never plaintext. Revoke is an UPDATE that scrubs the
-- envelope (encrypted_secret = NULL, revoked_at = now()); jarvis_app_runtime has NO
-- DELETE grant (protected table, mirroring app.connector_accounts' soft-revoke).
-- 'instance' rows are admin-managed with no owner; 'user' rows are owner-managed
-- and cascade-delete with the user (delete-user-data relies on this FK).

CREATE TABLE IF NOT EXISTS app.module_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id text NOT NULL,
  credential_id text NOT NULL,
  scope text NOT NULL CONSTRAINT module_credentials_scope_ck
    CHECK (scope IN ('instance', 'user')),
  owner_user_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  display_name text NOT NULL CONSTRAINT module_credentials_display_name_ck
    CHECK (char_length(display_name) BETWEEN 1 AND 200),
  encrypted_secret jsonb,
  revoked_at timestamptz,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_credentials_scope_owner_ck CHECK (
    (scope = 'instance' AND owner_user_id IS NULL)
    OR (scope = 'user' AND owner_user_id IS NOT NULL)
  )
);

-- Uniqueness is scope-shaped: instance credentials are singletons per
-- (module, credential); user credentials per (module, credential, owner).
-- Partial indexes because owner_user_id is NULL for instance rows.
CREATE UNIQUE INDEX IF NOT EXISTS module_credentials_instance_uq
  ON app.module_credentials (module_id, credential_id)
  WHERE scope = 'instance';
CREATE UNIQUE INDEX IF NOT EXISTS module_credentials_user_uq
  ON app.module_credentials (module_id, credential_id, owner_user_id)
  WHERE scope = 'user';

ALTER TABLE app.module_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_credentials FORCE ROW LEVEL SECURITY;

-- User rows: owner-only. Instance rows: admin-only (configuration power).
-- No DELETE policy and no DELETE grant: revoke = UPDATE scrubbing the envelope.
DROP POLICY IF EXISTS module_credentials_select ON app.module_credentials;
CREATE POLICY module_credentials_select ON app.module_credentials
  FOR SELECT TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_credentials_insert ON app.module_credentials;
CREATE POLICY module_credentials_insert ON app.module_credentials
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_credentials_update ON app.module_credentials;
CREATE POLICY module_credentials_update ON app.module_credentials
  FOR UPDATE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  )
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

GRANT SELECT, INSERT, UPDATE ON app.module_credentials TO jarvis_app_runtime;
-- No jarvis_worker_runtime grant: Slice 2 has no worker consumer. Slice 3's RPC
-- seam adds its own migration with the narrowest grant it needs (least privilege).
```

- [ ] **Step 2: Commit**

```bash
git add packages/settings/sql/NNNN_module_credentials.sql
git commit -m "feat(#918): add app.module_credentials with FORCE RLS and no-DELETE posture"
```

### Task 7: Migration `NNNN_module_kv.sql`

**Files:**

- Create: `packages/settings/sql/NNNN_module_kv.sql` (number = credentials migration + 1, assigned by coordinator)

**Interfaces:**

- Produces: `app.module_kv` with FORCE RLS; consumed by Tasks 8, 12, 20, 21, 26.

- [ ] **Step 1: Write the migration**

```sql
-- Module KV storage (#918, Open module system Slice 2). Plain module data,
-- never secrets (secrets go in app.module_credentials). No module code can
-- reach this table until Slice 3's ctx.kv RPC — Slice 2 writes happen only
-- through platform code. 'user' rows cascade-delete with the user; 'instance'
-- rows are shared instance state.

CREATE TABLE IF NOT EXISTS app.module_kv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id text NOT NULL,
  namespace text NOT NULL,
  scope text NOT NULL CONSTRAINT module_kv_scope_ck CHECK (scope IN ('instance', 'user')),
  owner_user_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  key text NOT NULL CONSTRAINT module_kv_key_ck CHECK (char_length(key) BETWEEN 1 AND 512),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_kv_scope_owner_ck CHECK (
    (scope = 'instance' AND owner_user_id IS NULL)
    OR (scope = 'user' AND owner_user_id IS NOT NULL)
  ),
  -- Guard against unbounded values long before Slice 3 exposes writes to modules.
  CONSTRAINT module_kv_value_size_ck CHECK (octet_length(value::text) <= 65536)
);

CREATE UNIQUE INDEX IF NOT EXISTS module_kv_instance_uq
  ON app.module_kv (module_id, namespace, key)
  WHERE scope = 'instance';
CREATE UNIQUE INDEX IF NOT EXISTS module_kv_user_uq
  ON app.module_kv (module_id, namespace, owner_user_id, key)
  WHERE scope = 'user';

ALTER TABLE app.module_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_kv FORCE ROW LEVEL SECURITY;

-- Reads: user rows owner-only; instance rows readable by any authenticated actor
-- (shared instance state is the point of the scope).
DROP POLICY IF EXISTS module_kv_select ON app.module_kv;
CREATE POLICY module_kv_select ON app.module_kv
  FOR SELECT TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR scope = 'instance'
  );

-- Writes: user rows owner-only; instance rows admin-only in Slice 2 (fail-closed —
-- no consumer exists yet; Slice 3's RPC design may relax this via a NEW policy
-- migration, never by editing this one).
DROP POLICY IF EXISTS module_kv_insert ON app.module_kv;
CREATE POLICY module_kv_insert ON app.module_kv
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_kv_update ON app.module_kv;
CREATE POLICY module_kv_update ON app.module_kv
  FOR UPDATE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  )
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_kv_delete ON app.module_kv;
CREATE POLICY module_kv_delete ON app.module_kv
  FOR DELETE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

-- Real DELETE grant (per-key deletes are a KV primitive) — this is why module_kv
-- is NOT in scripts/audit-release-hardening.ts's protectedTables.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_kv TO jarvis_app_runtime;
-- No jarvis_worker_runtime grant (same rationale as module_credentials).
```

- [ ] **Step 2: Commit**

```bash
git add packages/settings/sql/NNNN_module_kv.sql
git commit -m "feat(#918): add app.module_kv with FORCE RLS and scope-shaped policies"
```

### Task 8: `foundation.test.ts` migration rows

**Files:**

- Modify: `tests/integration/foundation.test.ts` (the full-list `toEqual` migration assertion; last row today is `{ version: "0152", name: "0152_external_modules.sql" }` at ~line 336)

- [ ] **Step 1: Append the two new rows after the `0152` row, using the real assigned numbers**

```ts
{ version: "NNNN", name: "NNNN_module_credentials.sql" },
{ version: "NNNN", name: "NNNN_module_kv.sql" }
```

(Replace `NNNN` with the coordinator-assigned numbers from Tasks 6/7. The assertion is `toEqual` over the FULL list — a missing row fails the whole foundation suite, and only the full run catches it.)

- [ ] **Step 2: Run the foundation suite + commit**

Run: `pnpm test:integration tests/integration/foundation.test.ts`
Expected: PASS (migrations apply cleanly and the list matches).

```bash
git add tests/integration/foundation.test.ts
git commit -m "test(#918): register module_credentials/module_kv migrations in foundation list"
```

### Task 9: `protectedTables` registration

**Files:**

- Modify: `scripts/audit-release-hardening.ts` (the `protectedTables` array, lines ~32-47)

- [ ] **Step 1: Insert `"module_credentials"` alphabetically (between `"email_messages"` and `"notification_reads"`)**

```ts
"module_credentials",
```

Do NOT add `module_kv` — it needs real per-key DELETE; its FORCE-RLS migration satisfies the script's dynamic coverage check without a static entry.

- [ ] **Step 2: Run the audit script against a migrated DB + commit**

Run: the script's package.json entry (see `pnpm run | grep audit`), after `pnpm test:integration tests/integration/foundation.test.ts` has migrated the test DB.
Expected: PASS — `module_credentials` shows no app_runtime DELETE grant; `module_kv` passes dynamic coverage.

```bash
git add scripts/audit-release-hardening.ts
git commit -m "chore(#918): protect module_credentials from runtime DELETE in release audit"
```

### Task 10: Credential cipher

**Files:**

- Create: `packages/settings/src/module-credential-crypto.ts`
- Test: `tests/unit/module-credential-crypto.test.ts`

**Interfaces:**

- Consumes: `JsonSecretCipher`, `resolveKeyring`, `EncryptedSecret` from `@jarv1s/db` (all exported — `packages/connectors/src/crypto.ts` imports them the same way).
- Produces: `ModuleCredentialCipher`, `createModuleCredentialSecretCipher(env?)`, `EncryptedModuleCredentialSecret`. Consumed by Tasks 11, 14, 25.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from "vitest";

import { createModuleCredentialSecretCipher } from "../../packages/settings/src/module-credential-crypto.js";

describe("module credential cipher", () => {
  it("round-trips a value without the envelope containing plaintext", () => {
    const cipher = createModuleCredentialSecretCipher({});
    const envelope = cipher.encryptJson({ value: "super-secret-plaintext-123" });
    expect(envelope.version).toBe(1);
    expect(envelope.algorithm).toBe("aes-256-gcm");
    expect(JSON.stringify(envelope)).not.toContain("super-secret-plaintext-123");
    expect(cipher.decryptJson(envelope)).toEqual({ value: "super-secret-plaintext-123" });
  });
});
```

(Adjust the relative import to match how existing `tests/unit` files import package sources — copy a neighboring test's import style.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/module-credential-crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (three-part mirror of `packages/connectors/src/crypto.ts`)**

```ts
import { JsonSecretCipher, resolveKeyring, type EncryptedSecret, type Keyring } from "@jarv1s/db";

/**
 * AES-256-GCM envelope stored in app.module_credentials.encrypted_secret (#918).
 * NOTE: Slice 2 has ZERO production decrypt call sites — the only consumer of
 * stored module credentials is Slice 3's worker RPC (ctx.auth.getCredential).
 * decryptJson exists on the base class and is exercised only by unit tests.
 */
export type EncryptedModuleCredentialSecret = EncryptedSecret;

export class ModuleCredentialCipher extends JsonSecretCipher {
  constructor(keyring: Keyring) {
    super(keyring, "module credential secret");
  }
}

/**
 * Dedicated key family so module-credential keys rotate independently of
 * connector/AI keys. Hardened env requires a >=32-byte secret via
 * JARVIS_MODULE_CREDENTIAL_SECRET_KEY (resolveKeyring enforces this); the dev
 * default is only ever used outside hardened mode.
 */
export function createModuleCredentialSecretCipher(
  env: NodeJS.ProcessEnv = process.env
): ModuleCredentialCipher {
  return new ModuleCredentialCipher(
    resolveKeyring(
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEY",
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEY_ID",
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEYS",
      "jarv1s-development-module-credential-secret",
      env
    )
  );
}
```

(Verify the exact `resolveKeyring` parameter order against `packages/connectors/src/crypto.ts` before writing — mirror its call verbatim with the new env-var names. If the base class exposes `parseEnvelope`, no extra export is needed here.)

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `pnpm vitest run tests/unit/module-credential-crypto.test.ts` → PASS.

```bash
git add packages/settings/src/module-credential-crypto.ts tests/unit/module-credential-crypto.test.ts
git commit -m "feat(#918): module credential AES-256-GCM cipher with dedicated key family"
```

### Task 11: Credentials repository

**Files:**

- Create: `packages/settings/src/repository-module-credentials.ts` (mirror `repository-external-modules.ts`'s structure: standalone exported functions taking `scopedDb` + an audit-writer closure)

**Interfaces:**

- Consumes: Task 5 table types; Task 10 `EncryptedModuleCredentialSecret`; the same audit-writer closure type `repository-external-modules.ts` uses (import/reuse its type if exported, else declare structurally identical).
- Produces (consumed by Task 14):
  - `listModuleCredentialMetadata(scopedDb, moduleId): Promise<ModuleCredentialMetadataRow[]>`
  - `upsertModuleCredential(scopedDb, input: UpsertModuleCredentialInput, writeAuditEvent): Promise<void>`
  - `revokeModuleCredential(scopedDb, input: RevokeModuleCredentialInput, writeAuditEvent): Promise<boolean>`

- [ ] **Step 1: Implement**

```ts
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

import type { EncryptedModuleCredentialSecret } from "./module-credential-crypto.js";

export interface ModuleCredentialMetadataRow {
  readonly id: string;
  readonly module_id: string;
  readonly credential_id: string;
  readonly scope: "instance" | "user";
  readonly owner_user_id: string | null;
  readonly display_name: string;
  readonly has_secret: boolean;
  readonly revoked_at: Date | null;
  readonly updated_at: Date;
}

export interface UpsertModuleCredentialInput {
  readonly moduleId: string;
  readonly credentialId: string;
  readonly scope: "instance" | "user";
  /** null for scope='instance'; the acting user's own id for scope='user'. */
  readonly ownerUserId: string | null;
  readonly displayName: string;
  readonly encryptedSecret: EncryptedModuleCredentialSecret;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RevokeModuleCredentialInput {
  readonly moduleId: string;
  readonly credentialId: string;
  readonly scope: "instance" | "user";
  readonly ownerUserId: string | null;
  readonly actorUserId: string;
  readonly requestId: string;
}

export async function listModuleCredentialMetadata(
  scopedDb: DataContextDb,
  moduleId: string
): Promise<ModuleCredentialMetadataRow[]> {
  assertDataContextDb(scopedDb);
  // SECURITY: metadata projection only — encrypted_secret is NEVER selected here
  // (Slice 2 has no decrypt consumer at all; Slice 3's RPC gets its own query).
  // RLS already scopes rows: user rows to the actor, instance rows to admins.
  return await scopedDb.db
    .selectFrom("app.module_credentials")
    .select([
      "id",
      "module_id",
      "credential_id",
      "scope",
      "owner_user_id",
      "display_name",
      "revoked_at",
      "updated_at",
      sql<boolean>`encrypted_secret IS NOT NULL AND revoked_at IS NULL`.as("has_secret")
    ])
    .where("module_id", "=", moduleId)
    .orderBy("credential_id")
    .execute();
}

export async function upsertModuleCredential(
  scopedDb: DataContextDb,
  input: UpsertModuleCredentialInput,
  writeAuditEvent: (event: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
    requestId: string;
  }) => Promise<void>
): Promise<void> {
  assertDataContextDb(scopedDb);
  // Scope-shaped PARTIAL unique indexes rule out a plain .onConflict(columns)
  // target, so upsert is SELECT -> UPDATE-or-INSERT. Safe: the route runs this
  // inside one withDataContext transaction, and the unique index still backstops
  // a lost race with a constraint error rather than a duplicate row.
  const ownerFilter = (eb: { (...args: unknown[]): unknown }) =>
    input.ownerUserId === null
      ? (eb as any)("owner_user_id", "is", null)
      : (eb as any)("owner_user_id", "=", input.ownerUserId);
  const existing = await scopedDb.db
    .selectFrom("app.module_credentials")
    .select("id")
    .where("module_id", "=", input.moduleId)
    .where("credential_id", "=", input.credentialId)
    .where("scope", "=", input.scope)
    .where(ownerFilter as never)
    .executeTakeFirst();

  if (existing) {
    await scopedDb.db
      .updateTable("app.module_credentials")
      .set({
        display_name: input.displayName,
        encrypted_secret: input.encryptedSecret as unknown as Record<string, unknown>,
        revoked_at: null,
        updated_at: sql`now()` as never
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await scopedDb.db
      .insertInto("app.module_credentials")
      .values({
        module_id: input.moduleId,
        credential_id: input.credentialId,
        scope: input.scope,
        owner_user_id: input.ownerUserId,
        display_name: input.displayName,
        encrypted_secret: input.encryptedSecret as unknown as Record<string, unknown>,
        created_by: input.actorUserId
      })
      .execute();
  }

  // SECURITY: metadata-only audit — ids and scope ONLY. Never the value, the
  // envelope, or even displayName (per-sink audit in the plan's section B).
  await writeAuditEvent({
    actorUserId: input.actorUserId,
    action: "module.credential.set",
    targetType: "module_credential",
    targetId: `${input.moduleId}/${input.credentialId}`,
    metadata: { moduleId: input.moduleId, credentialId: input.credentialId, scope: input.scope },
    requestId: input.requestId
  });
}

export async function revokeModuleCredential(
  scopedDb: DataContextDb,
  input: RevokeModuleCredentialInput,
  writeAuditEvent: Parameters<typeof upsertModuleCredential>[2]
): Promise<boolean> {
  assertDataContextDb(scopedDb);
  // Revoke destroys the secret in place (UPDATE, not DELETE — app_runtime has
  // no DELETE grant on this protected table).
  const result = await scopedDb.db
    .updateTable("app.module_credentials")
    .set({
      encrypted_secret: null,
      revoked_at: sql`now()` as never,
      updated_at: sql`now()` as never
    })
    .where("module_id", "=", input.moduleId)
    .where("credential_id", "=", input.credentialId)
    .where("scope", "=", input.scope)
    .where((eb) =>
      input.ownerUserId === null
        ? eb("owner_user_id", "is", null)
        : eb("owner_user_id", "=", input.ownerUserId)
    )
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  const revoked = (result.numUpdatedRows ?? 0n) > 0n;
  if (revoked) {
    await writeAuditEvent({
      actorUserId: input.actorUserId,
      action: "module.credential.revoke",
      targetType: "module_credential",
      targetId: `${input.moduleId}/${input.credentialId}`,
      metadata: { moduleId: input.moduleId, credentialId: input.credentialId, scope: input.scope },
      requestId: input.requestId
    });
  }
  return revoked;
}
```

Style note for the implementer: replace the `as never`/`as any` shims with whatever `repository-external-modules.ts` actually does for `sql\`now()\`` sets and null-vs-value where-clauses — copy its idiom exactly; the shims above only mark where Kysely's types need the file's established pattern. Reuse its exported audit-writer type instead of the inline structural type if one exists.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/settings/src/repository-module-credentials.ts
git commit -m "feat(#918): module credential repository — metadata-only reads, scrubbing revoke"
```

### Task 12: KV repository

**Files:**

- Create: `packages/settings/src/repository-module-kv.ts`

**Interfaces:**

- Produces (consumed by Task 26's test and Slice 3 later):
  - `getModuleKvValue(scopedDb, key: ModuleKvKey): Promise<Record<string, unknown> | null>`
  - `setModuleKvValue(scopedDb, key: ModuleKvKey, value: Record<string, unknown>): Promise<void>`
  - `deleteModuleKvKey(scopedDb, key: ModuleKvKey): Promise<boolean>`
  - `listModuleKvKeys(scopedDb, ns: Omit<ModuleKvKey, "key">): Promise<string[]>`

- [ ] **Step 1: Implement**

```ts
import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";

export interface ModuleKvKey {
  readonly moduleId: string;
  readonly namespace: string;
  readonly scope: "instance" | "user";
  /** null for scope='instance'; the acting user's own id for scope='user'. */
  readonly ownerUserId: string | null;
  readonly key: string;
}

// No audit writer here: KV is module data-plane state, not admin configuration.
// RLS is the authorization layer (owner-only user rows; admin-only instance writes).

function baseWhere<QB extends { where: (...args: never[]) => QB }>(
  qb: QB,
  k: Omit<ModuleKvKey, "key">
): QB {
  // Copy repository-external-modules.ts's where-chaining idiom; the null-vs-value
  // owner filter matches Task 11's.
  return qb;
}

export async function getModuleKvValue(
  scopedDb: DataContextDb,
  k: ModuleKvKey
): Promise<Record<string, unknown> | null> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("value")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where((eb) =>
      k.ownerUserId === null
        ? eb("owner_user_id", "is", null)
        : eb("owner_user_id", "=", k.ownerUserId)
    )
    .where("key", "=", k.key)
    .executeTakeFirst();
  return (row?.value as Record<string, unknown> | undefined) ?? null;
}

export async function setModuleKvValue(
  scopedDb: DataContextDb,
  k: ModuleKvKey,
  value: Record<string, unknown>
): Promise<void> {
  assertDataContextDb(scopedDb);
  // Same SELECT -> UPDATE-or-INSERT shape as Task 11, for the same partial-
  // unique-index reason; the route/caller supplies the transaction.
  const existing = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("id")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where((eb) =>
      k.ownerUserId === null
        ? eb("owner_user_id", "is", null)
        : eb("owner_user_id", "=", k.ownerUserId)
    )
    .where("key", "=", k.key)
    .executeTakeFirst();
  if (existing) {
    await scopedDb.db
      .updateTable("app.module_kv")
      .set({ value: value as never, updated_at: sql`now()` as never })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await scopedDb.db
      .insertInto("app.module_kv")
      .values({
        module_id: k.moduleId,
        namespace: k.namespace,
        scope: k.scope,
        owner_user_id: k.ownerUserId,
        key: k.key,
        value: value as never
      })
      .execute();
  }
}

export async function deleteModuleKvKey(scopedDb: DataContextDb, k: ModuleKvKey): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const result = await scopedDb.db
    .deleteFrom("app.module_kv")
    .where("module_id", "=", k.moduleId)
    .where("namespace", "=", k.namespace)
    .where("scope", "=", k.scope)
    .where((eb) =>
      k.ownerUserId === null
        ? eb("owner_user_id", "is", null)
        : eb("owner_user_id", "=", k.ownerUserId)
    )
    .where("key", "=", k.key)
    .executeTakeFirst();
  return (result.numDeletedRows ?? 0n) > 0n;
}

export async function listModuleKvKeys(
  scopedDb: DataContextDb,
  ns: Omit<ModuleKvKey, "key">
): Promise<string[]> {
  assertDataContextDb(scopedDb);
  const rows = await scopedDb.db
    .selectFrom("app.module_kv")
    .select("key")
    .where("module_id", "=", ns.moduleId)
    .where("namespace", "=", ns.namespace)
    .where("scope", "=", ns.scope)
    .where((eb) =>
      ns.ownerUserId === null
        ? eb("owner_user_id", "is", null)
        : eb("owner_user_id", "=", ns.ownerUserId)
    )
    .orderBy("key")
    .execute();
  return rows.map((r) => r.key);
}
```

Remove the unused `baseWhere` sketch if the implementer inlines the filters as shown (preferred — delete it; it exists in this plan only to say "don't invent a new chaining idiom"). Same style note as Task 11 for the `as never` shims.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/settings/src/repository-module-kv.ts
git commit -m "feat(#918): module KV repository with scope-shaped keys"
```

### Task 13: Credential DTOs + schemas in `platform-api.ts`

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (next to `ExternalModuleDto`/`externalModuleSchema`, ~lines 840-928)

**Interfaces:**

- Produces (consumed by Tasks 14, 24, 25): `ModuleCredentialStatusDto`, `ListModuleCredentialsResponse`, `SetModuleCredentialRequest`, and route schemas `listModuleCredentialsRouteSchema`, `setModuleCredentialRouteSchema`, `revokeModuleCredentialRouteSchema`.

- [ ] **Step 1: Add DTOs**

```ts
/**
 * Credential slot status (#918). METADATA ONLY by construction — there is no
 * field that could carry plaintext or the ciphertext envelope, and the strict
 * response schema below (additionalProperties: false) strips any accidentally
 * emitted extra field (fast-json-stringify drops undeclared fields silently —
 * that trap works FOR us here).
 */
export interface ModuleCredentialStatusDto {
  readonly credentialId: string;
  readonly displayName: string;
  readonly scope: "instance" | "user";
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface ListModuleCredentialsResponse {
  readonly moduleId: string;
  readonly credentials: readonly ModuleCredentialStatusDto[];
}

export interface SetModuleCredentialRequest {
  readonly value: string;
}
```

- [ ] **Step 2: Add schemas (mirror `externalModuleSchema` / `listExternalModulesRouteSchema` structure and error-response reuse exactly)**

```ts
const moduleCredentialStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["credentialId", "displayName", "scope", "configured", "updatedAt"],
  properties: {
    credentialId: { type: "string" },
    displayName: { type: "string" },
    scope: { type: "string", enum: ["instance", "user"] },
    configured: { type: "boolean" },
    updatedAt: { type: ["string", "null"] }
  }
} as const;

const moduleCredentialParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moduleId", "credentialId"],
  properties: {
    moduleId: { type: "string", minLength: 1, maxLength: 100 },
    credentialId: { type: "string", minLength: 1, maxLength: 200 }
  }
} as const;

export const listModuleCredentialsRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["moduleId"],
    properties: { moduleId: { type: "string", minLength: 1, maxLength: 100 } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["moduleId", "credentials"],
      properties: {
        moduleId: { type: "string" },
        credentials: { type: "array", items: moduleCredentialStatusSchema }
      }
    }
    // + the file's standard 401/403/404 error responses, reused verbatim from
    // listExternalModulesRouteSchema's error entries.
  }
} as const;

export const setModuleCredentialRouteSchema = {
  params: moduleCredentialParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "string", minLength: 1, maxLength: 4096 } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["credential"],
      properties: { credential: moduleCredentialStatusSchema }
    }
    // + standard 400/401/403/404 error responses.
  }
} as const;

export const revokeModuleCredentialRouteSchema = {
  params: moduleCredentialParamsSchema,
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["credential"],
      properties: { credential: moduleCredentialStatusSchema }
    }
    // + standard 401/403/404 error responses.
  }
} as const;
```

The `// + standard ... error responses` comments are instructions to copy the file's existing shared error-schema entries (the same constants `listExternalModulesRouteSchema` references) into those response maps — every declared status code the route can return must be present.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/shared/src/platform-api.ts
git commit -m "feat(#918): module credential DTOs and strict route schemas"
```

### Task 14: Credential routes

**Files:**

- Create: `packages/settings/src/routes-module-credentials.ts`

**Interfaces:**

- Consumes: Task 10 cipher, Task 11 repository, Task 13 schemas; ctx shape mirrors `routes-modules.ts` (`{dependencies, repository, assertAdminUser, requireRequestId}` — see `routes.ts:782`), extended with `cipher`.
- Produces: `registerModuleCredentialRoutes(server, ctx)` registering six routes:
  - `GET /api/admin/modules/:moduleId/credentials` (instance-scope slots)
  - `PUT /api/admin/modules/:moduleId/credentials/:credentialId`
  - `DELETE /api/admin/modules/:moduleId/credentials/:credentialId` (soft-revoke)
  - `GET /api/me/modules/:moduleId/credentials` (user-scope slots)
  - `PUT /api/me/modules/:moduleId/credentials/:credentialId`
  - `DELETE /api/me/modules/:moduleId/credentials/:credentialId`

- [ ] **Step 1: Implement**

Follow `routes-modules.ts` verbatim for: imports, `handleRouteError`, `HttpError`, access-context resolution, and the ctx interface. Core content:

```ts
import type { FastifyInstance } from "fastify";

import type { ModuleAuthDeclaration } from "@jarv1s/module-sdk";
import {
  listModuleCredentialsRouteSchema,
  revokeModuleCredentialRouteSchema,
  setModuleCredentialRouteSchema,
  type ListModuleCredentialsResponse,
  type ModuleCredentialStatusDto
} from "@jarv1s/shared";

import type { ModuleCredentialCipher } from "./module-credential-crypto.js";
import {
  listModuleCredentialMetadata,
  revokeModuleCredential,
  upsertModuleCredential,
  type ModuleCredentialMetadataRow
} from "./repository-module-credentials.js";

// ctx: same interface routes-modules.ts declares, plus the cipher. Copy its
// SettingsRepository / dependencies / assertAdminUser / requireRequestId types.
export interface ModuleCredentialRoutesContext {
  readonly dependencies: /* routes-modules.ts's dependencies type */ unknown;
  readonly repository: /* SettingsRepository */ unknown;
  readonly assertAdminUser: /* routes-modules.ts's type */ unknown;
  readonly requireRequestId: /* routes-modules.ts's type */ unknown;
  readonly cipher: ModuleCredentialCipher;
}

/**
 * Resolve the auth declarations for a module from the boot discovery snapshot.
 * Returns null when the feature is off or the module is unknown — callers map
 * that to a 404 AFTER authorization (never before).
 */
function declaredCredentials(
  ctx: ModuleCredentialRoutesContext,
  moduleId: string,
  scope: "instance" | "user"
): readonly ModuleAuthDeclaration[] | null {
  const ext = (
    ctx.dependencies as {
      externalModules?: {
        enabled: boolean;
        discoveries: readonly {
          id: string;
          manifest: { auth?: readonly ModuleAuthDeclaration[] };
        }[];
      };
    }
  ).externalModules;
  if (!ext?.enabled) return null;
  const discovery = ext.discoveries.find((d) => d.id === moduleId);
  if (!discovery) return null;
  return (discovery.manifest.auth ?? []).filter((a) => a.scope === scope);
}

function toStatusDto(
  declaration: ModuleAuthDeclaration,
  rows: readonly ModuleCredentialMetadataRow[]
): ModuleCredentialStatusDto {
  const row = rows.find((r) => r.credential_id === declaration.id);
  return {
    credentialId: declaration.id,
    // displayName comes from the manifest declaration (server-derived), never
    // from client input — one less field to sanitize.
    displayName: declaration.displayName,
    scope: declaration.scope,
    configured: row?.has_secret ?? false,
    updatedAt: row ? row.updated_at.toISOString() : null
  };
}
```

Then six handlers. The admin GET, shown fully — the other five repeat this frame with the noted deltas:

```ts
server.get(
  "/api/admin/modules/:moduleId/credentials",
  { schema: listModuleCredentialsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await ctx.dependencies.resolveAccessContext(request);
      ctx.requireRequestId(accessContext);
      const { moduleId } = request.params as { moduleId: string };
      return await ctx.dependencies.withDataContext(accessContext, async (scopedDb) => {
        // SECURITY: authorize FIRST — non-admins get 403 before any branch
        // could reveal whether the module exists or the feature is on.
        await ctx.assertAdminUser(ctx.repository, scopedDb, accessContext.actorUserId);
        const declarations = declaredCredentials(ctx, moduleId, "instance");
        if (declarations === null) throw new HttpError(404, "Unknown module");
        const rows = await listModuleCredentialMetadata(scopedDb, moduleId);
        const body: ListModuleCredentialsResponse = {
          moduleId,
          credentials: declarations.map((d) => toStatusDto(d, rows))
        };
        return body;
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Deltas for the remaining five:

- **Admin PUT** (`setModuleCredentialRouteSchema`): after `assertAdminUser` + declaration lookup (also 404 when `credentialId` is not among the instance-scope declarations), encrypt and upsert inside the same transaction:

  ```ts
  const { value } = request.body as { value: string };
  // Plaintext lifetime: this handler frame only. Encrypted before it touches
  // the repository; never logged, never audited, never returned.
  const envelope = ctx.cipher.encryptJson({ value });
  await upsertModuleCredential(
    scopedDb,
    {
      moduleId,
      credentialId,
      scope: "instance",
      ownerUserId: null,
      displayName: declaration.displayName,
      encryptedSecret: envelope,
      actorUserId: accessContext.actorUserId,
      requestId: accessContext.requestId
    },
    writeAuditEvent
  );
  const rows = await listModuleCredentialMetadata(scopedDb, moduleId);
  return { credential: toStatusDto(declaration, rows) };
  ```

  `writeAuditEvent` is the same audit-writer closure `routes-modules.ts` builds for its repository calls — construct it identically.

- **Admin DELETE** (`revokeModuleCredentialRouteSchema`): `revokeModuleCredential(scopedDb, { moduleId, credentialId, scope: "instance", ownerUserId: null, actorUserId, requestId }, writeAuditEvent)`; if it returns `false` throw `new HttpError(404, "Credential not configured")`; else return `{ credential: toStatusDto(declaration, refreshedRows) }`.
- **/me GET/PUT/DELETE**: identical frames WITHOUT `assertAdminUser` (any authenticated user manages their own user-scope slots; RLS owner-binds the rows), with `scope: "user"` and `ownerUserId: accessContext.actorUserId`, and `declaredCredentials(ctx, moduleId, "user")`.

Scope enforcement summary (state as a comment atop the file): instance-scope slots are reachable only through `/api/admin/...` (admin-asserted), user-scope slots only through `/api/me/...` (owner-bound) — a slot declared `scope: "user"` simply does not appear in the admin surface and vice versa, and RLS enforces the same split at the database layer even if a route bug slipped.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/settings/src/routes-module-credentials.ts
git commit -m "feat(#918): admin and per-user module credential routes (authorize-first)"
```

### Task 15: Wire the routes

**Files:**

- Modify: `packages/settings/src/routes.ts` (import block ~line 82; wiring at the end of `registerSettingsRoutes`, after the `registerModuleRoutes(...)` call at ~line 782)

- [ ] **Step 1: Import + register**

```ts
import { createModuleCredentialSecretCipher } from "./module-credential-crypto.js";
import { registerModuleCredentialRoutes } from "./routes-module-credentials.js";
```

After the existing `registerModuleRoutes(server, { dependencies, repository, assertAdminUser, requireRequestId });`:

```ts
registerModuleCredentialRoutes(server, {
  dependencies,
  repository,
  assertAdminUser,
  requireRequestId,
  cipher: createModuleCredentialSecretCipher()
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/settings/src/routes.ts
git commit -m "feat(#918): wire module credential routes into settings registration"
```

### Task 16: Route-guard allowlist

**Files:**

- Modify: `packages/module-registry/src/route-guard.ts` (`PLATFORM_UNGUARDED_ROUTES`, after the #917 entries at ~lines 90-92)

- [ ] **Step 1: Append the platform-owned routes**

```ts
// #918: module credential management + web asset serving are PLATFORM routes
// (external modules cannot declare routes[]). The asset handler enforces its
// own module-active fail-closed 404 (apps/api/src/server.ts).
routeKey("GET", "/api/admin/modules/:moduleId/credentials"),
routeKey("PUT", "/api/admin/modules/:moduleId/credentials/:credentialId"),
routeKey("DELETE", "/api/admin/modules/:moduleId/credentials/:credentialId"),
routeKey("GET", "/api/me/modules/:moduleId/credentials"),
routeKey("PUT", "/api/me/modules/:moduleId/credentials/:credentialId"),
routeKey("DELETE", "/api/me/modules/:moduleId/credentials/:credentialId"),
routeKey("GET", "/api/modules/:moduleId/web/*"),
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/module-registry/src/route-guard.ts
git commit -m "feat(#918): allowlist credential and web-asset platform routes"
```

### Task 17: Asset path containment (`web-assets.ts`)

**Files:**

- Create: `packages/module-registry/src/external/web-assets.ts`
- Modify: `packages/module-registry/src/node.ts` (add exports)
- Test: `tests/unit/module-web-assets.test.ts`

**Interfaces:**

- Produces (consumed by Task 19): `resolveModuleAssetPath(moduleDir, relPath): ResolvedModuleAsset`, `ModuleAssetPathError` (with `.reason`), `MODULE_WEB_ASSET_CONTENT_TYPES`.

- [ ] **Step 1: Write the failing unit test**

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ModuleAssetPathError,
  resolveModuleAssetPath
} from "../../packages/module-registry/src/external/web-assets.js";

const root = mkdtempSync(join(tmpdir(), "webassets-"));
const moduleDir = join(root, "pkg");
mkdirSync(join(moduleDir, "dist"), { recursive: true });
writeFileSync(join(moduleDir, "dist", "index.js"), "export default 1;\n");
writeFileSync(join(root, "outside-secret.js"), "// outside\n");
symlinkSync(join(root, "outside-secret.js"), join(moduleDir, "dist", "escape.js"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveModuleAssetPath", () => {
  it("resolves a clean relative path with content type", () => {
    const asset = resolveModuleAssetPath(moduleDir, "dist/index.js");
    expect(asset.contentType).toBe("text/javascript; charset=utf-8");
  });
  const reject = (rel: string, reason: string) =>
    expect(() => resolveModuleAssetPath(moduleDir, rel)).toThrowError(
      expect.objectContaining({ name: "ModuleAssetPathError", reason }) as Error
    );
  it("rejects traversal segments", () => reject("../outside-secret.js", "traversal"));
  it("rejects absolute paths", () => reject("/etc/hostname", "absolute"));
  it("rejects backslashes", () => reject("dist\\index.js", "absolute"));
  it("rejects empty and dot segments", () => reject("dist/./index.js", "traversal"));
  it("rejects disallowed extensions", () => reject("jarvis.module.json", "unsupported-type"));
  it("rejects symlink escapes via realpath containment", () =>
    reject("dist/escape.js", "outside-package"));
  it("rejects missing files without leaking paths", () => {
    try {
      resolveModuleAssetPath(moduleDir, "dist/missing.js");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleAssetPathError);
      expect((error as Error).message).not.toContain(moduleDir);
    }
  });
});
```

Note: `jarvis.module.json` fails on extension (`.json` IS allowed) — change that expectation to a file that exists with a disallowed extension: create `writeFileSync(join(moduleDir, ".env"), "X=1\n")` in setup and assert `reject(".env", "unsupported-type")` instead. (`.json` stays allowed for source maps/chunk metadata; the manifest being fetchable is harmless — it is already public to the admin API.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/module-web-assets.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Path containment for serving untrusted external-module web assets (#918).
// Threat model: a hostile package (or hostile request) using ".." segments,
// absolute paths, or symlinks placed inside the package to read arbitrary host
// files via GET /api/modules/:moduleId/web/*. Mirrors external/hash.ts's
// realpath+prefix containment and node.ts's never-leak-raw-fs-errors rule.
import { existsSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, sep } from "node:path";

export const MODULE_WEB_ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

export type ModuleAssetRejectionReason =
  | "empty"
  | "absolute"
  | "traversal"
  | "unsupported-type"
  | "not-found"
  | "outside-package";

export class ModuleAssetPathError extends Error {
  constructor(readonly reason: ModuleAssetRejectionReason) {
    // Reason token only — never the requested path or any resolved on-disk path.
    super(`module asset rejected: ${reason}`);
    this.name = "ModuleAssetPathError";
  }
}

export interface ResolvedModuleAsset {
  readonly absPath: string;
  readonly contentType: string;
}

export function resolveModuleAssetPath(moduleDir: string, relPath: string): ResolvedModuleAsset {
  if (relPath.length === 0 || relPath.includes("\0")) throw new ModuleAssetPathError("empty");
  // POSIX-relative only: reject absolute paths and backslash separators outright.
  if (isAbsolute(relPath) || relPath.includes("\\")) throw new ModuleAssetPathError("absolute");
  // Segment-level traversal check BEFORE any filesystem call. Fastify has
  // already percent-decoded the wildcard param, so encoded "..%2f" arrives
  // here as a literal ".." segment and is caught.
  if (relPath.split("/").some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
    throw new ModuleAssetPathError("traversal");
  }
  const contentType = MODULE_WEB_ASSET_CONTENT_TYPES[extname(relPath).toLowerCase()];
  if (!contentType) throw new ModuleAssetPathError("unsupported-type");

  // Realpath BOTH ends, then prefix-check — the same containment algorithm
  // external/hash.ts uses when packaging. This is what defeats symlinks: a
  // link inside the package pointing outside resolves to a real path that
  // fails the prefix check.
  const rootReal = realpathSync(moduleDir);
  const abs = join(rootReal, relPath);
  if (!existsSync(abs)) throw new ModuleAssetPathError("not-found");
  const real = realpathSync(abs);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    throw new ModuleAssetPathError("outside-package");
  }
  return { absPath: real, contentType };
}
```

- [ ] **Step 4: Export from the node entry**

In `packages/module-registry/src/node.ts`:

```ts
export {
  MODULE_WEB_ASSET_CONTENT_TYPES,
  ModuleAssetPathError,
  resolveModuleAssetPath,
  type ModuleAssetRejectionReason,
  type ResolvedModuleAsset
} from "./external/web-assets.js";
```

- [ ] **Step 5: Run the test to verify it passes, then commit**

Run: `pnpm vitest run tests/unit/module-web-assets.test.ts` → PASS.

```bash
git add packages/module-registry/src/external/web-assets.ts packages/module-registry/src/node.ts tests/unit/module-web-assets.test.ts
git commit -m "feat(#918): module web-asset path containment with symlink defense"
```

### Task 18: `web` field on `ModuleDto` / `ExternalModuleDto`

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (`ModuleDto` ~line 49-58 + its schema ~line 166; `ExternalModuleDto` ~line 840 + `externalModuleSchema` ~line 866)

**Interfaces:**

- Produces: `ModuleWebDto { entrypoint, contractVersion }`; `ModuleDto.web?: ModuleWebDto`; `ExternalModuleDto.web: ModuleWebDto | null` (stays field-identical to `ReconciledExternalModule` per its comment). Consumed by Tasks 19, 22, 23.

- [ ] **Step 1: Add the DTO type + fields**

```ts
/** Web contribution surface of an external module (#918). */
export interface ModuleWebDto {
  readonly entrypoint: string;
  readonly contractVersion: number;
}
```

On `ModuleDto`: `readonly web?: ModuleWebDto;` (absent for built-ins).
On `ExternalModuleDto`: `readonly web: ModuleWebDto | null;`.

- [ ] **Step 2: Update BOTH schemas (fast-json-stringify silently drops undeclared fields)**

Shared fragment:

```ts
const moduleWebSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entrypoint", "contractVersion"],
  properties: {
    entrypoint: { type: "string" },
    contractVersion: { type: "integer" }
  }
} as const;
```

- `moduleSchema` (the one behind `ModuleDto`): add `web: moduleWebSchema` to `properties`, do NOT add to `required` (optional, like `external`).
- `externalModuleSchema`: add `web: { ...moduleWebSchema, type: ["object", "null"] }` to `properties` AND to `required` (field-identical mirror; nullable via type array — Task 27's test asserts both the populated and null cases round-trip, guarding against a serializer quirk here).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/shared/src/platform-api.ts
git commit -m "feat(#918): expose module web declaration through module DTOs"
```

### Task 19: Asset route + serialization in `server.ts`

**Files:**

- Modify: `apps/api/src/server.ts` (`serializeExternalModule` ~lines 857-867; new route registration next to the `registerPlatformRoutes(...)` call ~line 794; imports at top)

**Interfaces:**

- Consumes: Task 17's `resolveModuleAssetPath`/`ModuleAssetPathError` (from `@jarv1s/module-registry`'s node entry), the boot-time discovery snapshot (~line 324-330), `getActiveExternalModules` (~line 337-343), `authRuntime.resolveAccessContext`.
- Produces: `GET /api/modules/:moduleId/web/*`; `serializeExternalModule` emits `web`.

- [ ] **Step 1: `serializeExternalModule` passthrough**

In the existing function (which hardcodes `lifecycle: "optional"`, empty navigation/settings, `external: true`), add:

```ts
...(m.web ? { web: m.web } : {}),
```

(`ModuleDto.web` is optional; omit rather than emit null.)

- [ ] **Step 2: Add the route function (new function beside `registerPlatformRoutes`)**

```ts
import { readFile } from "node:fs/promises";

import { ModuleAssetPathError, resolveModuleAssetPath } from "@jarv1s/module-registry";
```

(Use the same import specifier the file already uses for other node-entry registry imports — if it imports from a subpath like `@jarv1s/module-registry/node`, match it.)

```ts
function registerExternalModuleWebAssetRoute(
  server: FastifyInstance,
  authRuntime: /* same type registerPlatformRoutes takes */,
  discoveries: readonly ExternalModuleDiscovery[],
  getActiveExternalModules?: (accessContext: AccessContext) => Promise<readonly ReconciledExternalModule[]>
): void {
  server.get("/api/modules/:moduleId/web/*", async (request, reply) => {
    // Authenticated only: module assets are instance content, not public files.
    let accessContext: AccessContext;
    try {
      accessContext = await authRuntime.resolveAccessContext(request);
    } catch {
      return reply.code(401).send({ error: "Session is missing or expired" });
    }
    const { moduleId } = request.params as { moduleId: string };
    const relPath = (request.params as Record<string, string>)["*"] ?? "";

    // Fail closed on every branch: feature off, unknown module, no web
    // declaration, or module not ACTIVE for this actor are all
    // indistinguishable 404s (same posture as the route-enablement guard —
    // never reveal that a module exists but is disabled).
    const discovery = discoveries.find((d) => d.id === moduleId);
    if (!getActiveExternalModules || !discovery?.manifest.web) {
      return reply.code(404).send({ error: "Not found" });
    }
    let active: readonly ReconciledExternalModule[];
    try {
      active = await getActiveExternalModules(accessContext);
    } catch (error) {
      request.log.error({ err: error, moduleId }, "module web asset activity resolution failed");
      return reply.code(503).send({ error: "Service unavailable" });
    }
    if (!active.some((m) => m.id === moduleId)) {
      return reply.code(404).send({ error: "Not found" });
    }

    try {
      const asset = resolveModuleAssetPath(discovery.dir, relPath);
      const body = await readFile(asset.absPath);
      return reply
        .header("content-type", asset.contentType)
        // no-store: enablement can flip at any time; a cached asset must not
        // outlive a disable.
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .send(body);
    } catch (error) {
      // Reason token / errno code only — raw fs error messages embed absolute
      // host paths (node.ts discipline).
      const reason =
        error instanceof ModuleAssetPathError
          ? error.reason
          : ((error as NodeJS.ErrnoException).code ?? (error as Error).name);
      request.log.warn({ moduleId, reason }, "module web asset rejected (#918)");
      return reply.code(404).send({ error: "Not found" });
    }
  });
}
```

- [ ] **Step 3: Register it**

Immediately after the existing `registerPlatformRoutes(server, authRuntime, getActiveExternalModules)` call, using the same boot-time snapshot variable that feeds settings deps (`discoveries` from the `discoverExternalModules` result at ~line 324-330; pass an empty array when external modules are disabled):

```ts
registerExternalModuleWebAssetRoute(
  server,
  authRuntime,
  externalModuleDiscoveries,
  getActiveExternalModules
);
```

(`externalModuleDiscoveries` = whatever local name the snapshot already has in this scope — reuse it, do not re-discover.)

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add apps/api/src/server.ts
git commit -m "feat(#918): authenticated fail-closed module web asset route"
```

### Task 20: Delete-lifecycle count entries

**Files:**

- Modify: `scripts/delete-user-data.ts` (`userScopedCountQueries`, after `["app.member_onboarding", "user_id = $1::uuid"]` at line 119)

- [ ] **Step 1: Append**

```ts
// Module platform tables (#918): user-scope rows cascade via owner FK; instance
// rows have owner_user_id IS NULL so these predicates can never match them.
(["app.module_credentials", "owner_user_id = $1::uuid"],
  ["app.module_kv", "scope = 'user' AND owner_user_id = $1::uuid"]);
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS. (Behavioral verification lands in Task 26.)

```bash
git add scripts/delete-user-data.ts
git commit -m "feat(#918): count module credential/KV rows in user-delete dry run"
```

### Task 21: Export queries

**Files:**

- Modify: `packages/settings/src/data-export.ts` (`UserDataExportTables` interface lines 33-74; `readExportTables` lines 117-177; new query functions beside `connectorAccountsQuery` at ~line 307)

- [ ] **Step 1: Add interface fields (after `memoryLegacyFactMigrations`, matching the file's ordering style)**

```ts
readonly moduleCredentials: readonly Record<string, unknown>[];
readonly moduleKv: readonly Record<string, unknown>[];
```

- [ ] **Step 2: Add query functions (exact mirror of `connectorAccountsQuery`'s tagged-template + camelCase-alias + ORDER BY style)**

```ts
function moduleCredentialsQuery(userId: string) {
  // SECURITY: metadata only — the AES-256-GCM envelope is NEVER exported.
  // hasSecret mirrors connectorAccountsQuery's `encrypted_secret IS NOT NULL`.
  return sql<Record<string, unknown>>`
    SELECT
      module_id AS "moduleId",
      credential_id AS "credentialId",
      scope,
      display_name AS "displayName",
      encrypted_secret IS NOT NULL AS "hasSecret",
      revoked_at AS "revokedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.module_credentials
    WHERE owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}

function moduleKvQuery(userId: string) {
  // KV values are the user's plain module data (not secrets) — exported directly.
  return sql<Record<string, unknown>>`
    SELECT
      module_id AS "moduleId",
      namespace,
      key,
      value,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app.module_kv
    WHERE scope = 'user' AND owner_user_id = ${userId}::uuid
    ORDER BY created_at, id
  `;
}
```

- [ ] **Step 3: Wire both into `readExportTables`** exactly as the neighboring tables are (execute + `normalizeRow` mapping, assigned to the two new fields).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck` → PASS. (Behavioral verification lands in Task 26.)

```bash
git add packages/settings/src/data-export.ts
git commit -m "feat(#918): include module credentials metadata and KV values in user export"
```

### Task 22: External module web loader (frontend)

**Files:**

- Create: `apps/web/src/external-modules/loader.ts`

**Interfaces:**

- Consumes: Task 18's `ModuleWebDto` (via `@jarv1s/shared`); Task 19's asset route.
- Produces (consumed by Task 23): `JARVIS_WEB_CONTRACT_VERSION`, `installModuleHostRuntime()`, `loadExternalModuleContribution(entry): Promise<ComponentType>`.

- [ ] **Step 1: Implement**

```ts
import type { ComponentType } from "react";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";

export const JARVIS_WEB_CONTRACT_VERSION = 1;

/** Contract v1: the default export of an external module's web entrypoint. */
export interface ExternalWebContribution {
  readonly contractVersion: number;
  readonly Root: ComponentType;
}

/**
 * Host runtime handed to external bundles (#918). External module builds mark
 * react/react-dom as externals and read them from this global, so exactly ONE
 * React instance (the host's, pinned to the host version) ever exists — two
 * copies break hooks. Chosen over import maps: simpler, testable, and works
 * with Vite's dev server unchanged. Installed once at app boot (Task 23).
 */
export function installModuleHostRuntime(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__JARVIS_MODULE_RUNTIME__) return;
  w.__JARVIS_MODULE_RUNTIME__ = Object.freeze({
    contractVersion: JARVIS_WEB_CONTRACT_VERSION,
    react: React,
    reactDomClient: ReactDOMClient
  });
}

const Missing: ComponentType = () => null;

/**
 * Load one external module's web contribution. Fails closed to an empty
 * component on ANY defect: manifest contractVersion mismatch (checked BEFORE
 * the bundle is even fetched), import failure (404 = module disabled since the
 * module list was fetched), or a malformed/mismatched export.
 */
export async function loadExternalModuleContribution(entry: {
  readonly moduleId: string;
  readonly entrypoint: string;
  readonly contractVersion: number;
}): Promise<ComponentType> {
  if (entry.contractVersion !== JARVIS_WEB_CONTRACT_VERSION) return Missing;
  const url = `/api/modules/${encodeURIComponent(entry.moduleId)}/web/${entry.entrypoint}`;
  let mod: { default?: ExternalWebContribution };
  try {
    mod = (await import(/* @vite-ignore */ url)) as { default?: ExternalWebContribution };
  } catch {
    return Missing;
  }
  const contribution = mod.default;
  // The export re-asserts contractVersion: the manifest gate saves a fetch,
  // this gate defends against a manifest that lies about its bundle.
  if (
    !contribution ||
    contribution.contractVersion !== JARVIS_WEB_CONTRACT_VERSION ||
    typeof contribution.Root !== "function"
  ) {
    return Missing;
  }
  return contribution.Root;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add apps/web/src/external-modules/loader.ts
git commit -m "feat(#918): external module web contribution loader with contract gating"
```

### Task 23: Dock external module routes in `app.tsx`

**Files:**

- Modify: `apps/web/src/app.tsx` (imports at top; new `useMemo` inside `App` after `modulesQuery`; new `<Route>` mapping beside the existing built-in `moduleRoutes` render)

- [ ] **Step 1: Install the host runtime at module scope**

At the top of `app.tsx` (module scope, before any external bundle can ever be imported):

```ts
import {
  installModuleHostRuntime,
  loadExternalModuleContribution
} from "./external-modules/loader";

installModuleHostRuntime();
```

- [ ] **Step 2: Build external routes with stable lazy identity**

The existing built-in `moduleRoutes` const (module scope, ~lines 48-61) stays untouched — its stable-`lazy()`-identity rationale comment explains why. External modules are only known after `modulesQuery` resolves, so their routes are memoized on the query data (same identity guarantee, different lifetime). Inside `App`, after `modulesQuery`:

```tsx
const externalModuleRoutes = useMemo(
  () =>
    (modulesQuery.data?.modules ?? [])
      .filter((m) => m.external === true && m.web !== undefined)
      .map((m) => ({
        moduleId: m.id,
        path: `/m/${m.id}/*`,
        Component: lazy(async () => ({
          default: await loadExternalModuleContribution({
            moduleId: m.id,
            entrypoint: m.web!.entrypoint,
            contractVersion: m.web!.contractVersion
          })
        }))
      })),
  [modulesQuery.data]
);
```

(Add `useMemo` and `lazy` to the existing react import if not present.)

- [ ] **Step 3: Render them beside the built-in module routes**

In the `<Routes>` block, immediately after the existing `{moduleRoutes.map(...)}` render, inside the same layout wrapper those routes use:

```tsx
{
  externalModuleRoutes.map((route) => (
    <Route
      key={`ext:${route.moduleId}`}
      path={route.path}
      element={
        <Suspense fallback={null}>
          <route.Component />
        </Suspense>
      }
    />
  ));
}
```

(If the built-in module routes already sit inside a shared `<Suspense>`, drop the local one and rely on it — match the existing structure.)

- [ ] **Step 4: Typecheck + frontend gate + commit**

Run: `pnpm typecheck && pnpm --filter web lint` (use the repo's actual frontend lint script name) → PASS.

```bash
git add apps/web/src/app.tsx
git commit -m "feat(#918): mount external module web contributions at /m/:moduleId"
```

### Task 24: Credential settings UI

**Files:**

- Create: `apps/web/src/settings/module-credentials-section.tsx`
- Modify: `apps/web/src/api/client.ts` (credential API functions), `apps/web/src/settings/settings-admin-panes.tsx` (dock admin section into the existing external-modules pane, which already renders `ExternalModuleDto` rows)

**Interfaces:**

- Consumes: Task 13's DTOs (`ModuleCredentialStatusDto`, `ListModuleCredentialsResponse`, `SetModuleCredentialRequest`) via `@jarv1s/shared`; Task 14's routes.
- Produces: `<ModuleCredentialsSection moduleId={...} surface="admin" | "me" />`.

- [ ] **Step 1: API client functions (follow `client.ts`'s existing fetch-helper idiom exactly — same error handling, same JSON helpers)**

```ts
export function listModuleCredentials(
  surface: "admin" | "me",
  moduleId: string
): Promise<ListModuleCredentialsResponse> {
  return getJson(
    `/api/${surface === "admin" ? "admin" : "me"}/modules/${encodeURIComponent(moduleId)}/credentials`
  );
}

export function setModuleCredential(
  surface: "admin" | "me",
  moduleId: string,
  credentialId: string,
  value: string
): Promise<{ credential: ModuleCredentialStatusDto }> {
  return putJson(
    `/api/${surface === "admin" ? "admin" : "me"}/modules/${encodeURIComponent(moduleId)}/credentials/${encodeURIComponent(credentialId)}`,
    { value }
  );
}

export function revokeModuleCredential(
  surface: "admin" | "me",
  moduleId: string,
  credentialId: string
): Promise<{ credential: ModuleCredentialStatusDto }> {
  return deleteJson(
    `/api/${surface === "admin" ? "admin" : "me"}/modules/${encodeURIComponent(moduleId)}/credentials/${encodeURIComponent(credentialId)}`
  );
}
```

(`getJson`/`putJson`/`deleteJson` stand for the client's actual helpers — use its real names.)

- [ ] **Step 2: The section component (functional default per the functionality-pass rule — reuse existing `jds-*` and settings-pane primitives, no new visual language)**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { ModuleCredentialStatusDto } from "@jarv1s/shared";

import { listModuleCredentials, revokeModuleCredential, setModuleCredential } from "../api/client";

export function ModuleCredentialsSection(props: {
  readonly moduleId: string;
  readonly surface: "admin" | "me";
}) {
  const queryClient = useQueryClient();
  const queryKey = ["module-credentials", props.surface, props.moduleId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listModuleCredentials(props.surface, props.moduleId)
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const setMutation = useMutation({
    mutationFn: (input: { credentialId: string; value: string }) =>
      setModuleCredential(props.surface, props.moduleId, input.credentialId, input.value),
    onSuccess: invalidate
  });
  const revokeMutation = useMutation({
    mutationFn: (credentialId: string) =>
      revokeModuleCredential(props.surface, props.moduleId, credentialId),
    onSuccess: invalidate
  });

  if (query.isLoading || !query.data || query.data.credentials.length === 0) return null;
  return (
    <div>
      {query.data.credentials.map((credential) => (
        <CredentialRow
          key={credential.credentialId}
          credential={credential}
          onSet={(value) => setMutation.mutate({ credentialId: credential.credentialId, value })}
          onRevoke={() => revokeMutation.mutate(credential.credentialId)}
          busy={setMutation.isPending || revokeMutation.isPending}
        />
      ))}
    </div>
  );
}

function CredentialRow(props: {
  readonly credential: ModuleCredentialStatusDto;
  readonly onSet: (value: string) => void;
  readonly onRevoke: () => void;
  readonly busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <span>{props.credential.displayName}</span>
      <span>{props.credential.configured ? "Configured" : "Not configured"}</span>
      {/* type="password": the value must never be visible on screen or in the
          DOM longer than typing requires; it is cleared after submit. */}
      <input
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={props.credential.configured ? "Replace key" : "Enter key"}
      />
      <button
        disabled={props.busy || draft.length === 0}
        onClick={() => {
          props.onSet(draft);
          setDraft("");
        }}
      >
        Save
      </button>
      {props.credential.configured ? (
        <button disabled={props.busy} onClick={props.onRevoke}>
          Revoke
        </button>
      ) : null}
    </div>
  );
}
```

The bare `div`/`span`/`input`/`button` elements above define behavior only — at implementation time, wrap them in the settings pane's existing row/label/input/button primitives (whatever `settings-admin-panes.tsx` uses for its per-module rows) so the section inherits the authored design system. Do NOT call mutations inside a state updater (StrictMode double-fire trap).

- [ ] **Step 3: Dock the admin surface**

In `settings-admin-panes.tsx`, inside the per-module row/card the external-modules pane renders for each `ExternalModuleDto` (find via its `ExternalModuleDto` usage), append:

```tsx
<ModuleCredentialsSection moduleId={module.id} surface="admin" />
```

The section renders `null` when the module declares no instance-scope credentials, so it is safe to dock unconditionally. (A `/me` docking surface for user-scope credentials follows the same pattern wherever per-user module settings live; if no such surface exists yet, dock only the admin one and note the `/me` UI as a small follow-up in the PR description — the `/me` API routes still ship and are integration-tested.)

- [ ] **Step 4: Typecheck + frontend gate + commit**

Run: `pnpm typecheck` and the frontend lint/format gate → PASS.

```bash
git add apps/web/src/settings/module-credentials-section.tsx apps/web/src/api/client.ts apps/web/src/settings/settings-admin-panes.tsx
git commit -m "feat(#918): module credential settings UI (write-only, metadata display)"
```

### Task 25: Integration test — credential routes + plaintext-never-escapes

**Files:**

- Test: `tests/integration/module-credentials.test.ts`

Mirror `tests/integration/external-modules-routes.test.ts` structurally: `resetEmptyFoundationDatabase()` in `beforeAll`, temp module dir via `mkdtempSync(join(tmpdir(), "modcreds-"))` + `writeFileSync` of `jarvis.module.json`, server via `createApiServer({ appDb, logger: false, apiServerConfig: { host: "0.0.0.0", port: 0, mcpServerUrl: "http://127.0.0.1:0/api/mcp", enableExternalModules: true, externalModulesDir } })`, local `signUp(server, email, name)` helper POSTing `/api/auth/sign-up/email` (first signup = admin; password `"correct horse battery staple"`), `cookieHeader()` extraction, `server.inject` for all requests, `afterAll` = `Promise.allSettled([server?.close(), appDb?.destroy()])` + `rmSync(root, { recursive: true, force: true })`. Direct DB assertions use `new Client({ connectionString: connectionStrings.bootstrap })` from `./test-database.js` (superuser — bypasses RLS for verification only). Copy that file's helper code verbatim; only the manifest and the test bodies below are new.

- [ ] **Step 1: Write the test**

Manifest for the fixture module (id e.g. `creds-fixture`):

```json
{
  "id": "creds-fixture",
  "name": "Creds Fixture",
  "version": "0.1.0",
  "coreVersion": "*",
  "auth": [
    {
      "id": "creds-fixture.api",
      "displayName": "Fixture API key",
      "kind": "api-key",
      "scope": "instance"
    },
    {
      "id": "creds-fixture.user-token",
      "displayName": "Fixture user token",
      "kind": "api-key",
      "scope": "user"
    }
  ]
}
```

(Match whatever top-level fields Slice 1's validator requires — copy the existing test's manifest and add `auth`.)

Test bodies (each response also asserted with the shared plaintext guard):

```ts
const PLAINTEXT = "super-secret-plaintext-123";
const expectNoPlaintext = (body: string) => expect(body).not.toContain(PLAINTEXT);
```

1. **Admin enables the module** (existing PUT enable route), then `GET /api/admin/modules/creds-fixture/credentials` → 200, one slot (`creds-fixture.api`), `configured: false`, no `encrypted_secret`/`value` keys anywhere in the body.
2. **Admin PUT** `/api/admin/modules/creds-fixture/credentials/creds-fixture.api` body `{ value: PLAINTEXT }` → 200, `configured: true`, `expectNoPlaintext(res.body)`.
3. **Envelope at rest:** bootstrap-client `SELECT encrypted_secret FROM app.module_credentials WHERE credential_id = 'creds-fixture.api'` → JSON with `version: 1`, `algorithm: "aes-256-gcm"`, `iv`, `tag`, `ciphertext` present; `expect(JSON.stringify(row.encrypted_secret)).not.toContain(PLAINTEXT)`.
4. **Member forbidden on admin surface:** second signup, PUT/GET admin credential routes → 403, `expectNoPlaintext`.
5. **/me flow:** member PUT `/api/me/modules/creds-fixture/credentials/creds-fixture.user-token` `{ value: PLAINTEXT }` → 200; member GET → `configured: true`; a THIRD user's GET → `configured: false` (per-user isolation); admin GET on the /me surface shows only the admin's own user-scope state.
6. **Unknown credential id** on both surfaces → 404 (after authorize: member gets 403 on admin surface even for unknown ids).
7. **Revoke:** admin DELETE the instance credential → 200 `configured: false`; bootstrap-client re-select → `encrypted_secret IS NULL`, `revoked_at IS NOT NULL` (scrub, not row delete); second DELETE → 404.
8. **Anonymous** → 401 on all six routes.

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/module-credentials.test.ts` → PASS (requires local Postgres; if another agent session is running `test:integration`, wait — shared-instance contention crashes dev Postgres).

```bash
git add tests/integration/module-credentials.test.ts
git commit -m "test(#918): credential route integration coverage incl. plaintext-never-escapes"
```

### Task 26: Integration test — KV/credential export + delete lifecycle

**Files:**

- Test: `tests/integration/module-kv-lifecycle.test.ts`

Precedent: `tests/integration/release-hardening.test.ts` (line 11 imports and line ~34/109 call `await exportUserData({...})` from `../../scripts/export-user-data.js` — copy its exact options shape) and `memory-graph-export-delete.test.ts` (same for `deleteUserData` from `../../scripts/delete-user-data.js`).

- [ ] **Step 1: Write the test**

Setup: reset DB, sign up two users (admin + member), then seed directly via the bootstrap client (module rows don't need a live module for lifecycle testing — the tables stand alone):

```ts
// Seed: two user-scope KV rows for user A, one for user B, one instance row,
// and one user-scope credential row (envelope content irrelevant — lifecycle only).
await client.query(
  `INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
   VALUES ($1, $2, 'user', $3, 'k1', '"va1"'::jsonb),
          ($1, $2, 'user', $3, 'k2', '"va2"'::jsonb),
          ($1, $2, 'user', $4, 'k1', '"vb1"'::jsonb),
          ($1, $2, 'instance', NULL, 'shared', '"inst"'::jsonb)`,
  ["kv-fixture", "kv-fixture.cache", userAId, userBId]
);
await client.query(
  `INSERT INTO app.module_credentials (module_id, credential_id, scope, owner_user_id, display_name, encrypted_secret)
   VALUES ('kv-fixture', 'kv-fixture.user-token', 'user', $1, 'Token', '{"version":1,"algorithm":"aes-256-gcm","iv":"AA==","tag":"AA==","ciphertext":"AA=="}'::jsonb)`,
  [userAId]
);
```

Assertions:

1. **Export completeness:** `exportUserData` for user A → parsed export has `moduleKv` with exactly k1+k2 (values `"va1"`/`"va2"` present) and `moduleCredentials` with one row, `hasSecret: true`; `expect(JSON.stringify(export)).not.toContain("ciphertext")` (envelope never exported). User B's export contains only their own row; the instance KV row appears in NO user's export.
2. **Delete dry-run counts:** `deleteUserData({ userId: userAId, dryRun: true, ... })` → returned/reported counts include `app.module_credentials: 1` and `app.module_kv: 2` (this is what Task 20's entries buy — under-counting here is the regression this test pins).
3. **Real delete:** `deleteUserData({ userId: userAId, dryRun: false, confirmUserId: userAId, ... })` → bootstrap-client counts: user A's KV and credential rows = 0 (CASCADE), user B's row survives, the instance row survives.

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/module-kv-lifecycle.test.ts` → PASS.

```bash
git add tests/integration/module-kv-lifecycle.test.ts
git commit -m "test(#918): module KV/credential export and delete lifecycle coverage"
```

### Task 27: Integration test — web asset route + DTO round-trip

**Files:**

- Test: `tests/integration/module-web-assets.test.ts`

Same harness skeleton as Task 25. Fixture module manifest adds:

```json
"web": { "entrypoint": "dist/web/index.js", "contractVersion": 1 }
```

and the fixture dir gets a real `dist/web/index.js` (`writeFileSync`, any JS content), a real `dist/web/chunk.css`, plus a symlink `dist/web/escape.js` → a file created OUTSIDE the module dir (in the tmp root).

- [ ] **Step 1: Write the test**

1. **Serving:** admin enables module; `GET /api/modules/creds-fixture/web/dist/web/index.js` (session cookie) → 200, `content-type: text/javascript; charset=utf-8`, `cache-control: no-store`, `x-content-type-options: nosniff`, body matches the written file.
2. **Traversal:** `GET .../web/../jarvis.module.json` and `GET .../web/%2e%2e%2fjarvis.module.json` → 404; `expect(res.body).not.toContain(tmpdir())` (no host-path leak in any rejection body).
3. **Absolute:** `GET .../web//etc/hostname` → 404.
4. **Unsupported type:** create `dist/web/.env`, GET it → 404.
5. **Symlink escape:** `GET .../web/dist/web/escape.js` → 404 (realpath containment).
6. **Disabled module:** admin disables → same valid asset GET → 404 (indistinguishable from unknown).
7. **Member visibility:** member (module enabled instance-wide + user-enabled per Slice 1 semantics — mirror whatever enablement the existing routes test uses for member access) → 200; anonymous → 401.
8. **DTO round-trip (fast-json-stringify guard):** admin `GET /api/admin/modules/external` (or the actual external-list route from the Slice 1 test) → the fixture module's entry has `web: { entrypoint: "dist/web/index.js", contractVersion: 1 }`; `GET /api/modules` → the active module's `ModuleDto` carries the same `web` object. A module WITHOUT a web declaration round-trips `web: null` / absent respectively — this pins the schema additions from Task 18; without them the field is silently dropped.

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/module-web-assets.test.ts` → PASS.

```bash
git add tests/integration/module-web-assets.test.ts
git commit -m "test(#918): web asset route defense + module DTO web round-trip"
```

---

## Execution Notes

- **Migration numbers:** every `NNNN_*.sql` reference above is a placeholder by design — the coordinator assigns the real numbers at build time (global landing-order invariant). The build agent must rename the files AND the `foundation.test.ts` rows (Task 8) together.
- **Full gates at build time:** this plan-authoring lane runs nothing. The build lane must run the full `pnpm test:integration` (the `foundation.test.ts` full-list `toEqual` will not be caught by focused module tests) and `pnpm verify:foundation` before PR.
- **Execution choice (for the coordinator/Ben, not this lane):** Subagent-Driven (`superpowers:subagent-driven-development`, fresh subagent per task + review between tasks — recommended given the security tier) vs. Inline (`superpowers:executing-plans`). This lane stops at the plan document; security tier requires Ben/overnight-panel sign-off before any build lane spawns.
