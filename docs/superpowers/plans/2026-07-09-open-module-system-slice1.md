# Open Module System — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load external (non-compiled) trusted-operator modules from a mounted directory and gate their activation fail-closed, without executing any of their code.

**Architecture:** A server-only loader reads `jarvis.module.json` from `JARVIS_MODULES_DIR` only when `JARVIS_ENABLE_EXTERNAL_MODULES=1`, validates each manifest as metadata-only, and hashes each package. Enablement state lives in a new admin-managed `app.external_modules` table (single source of truth). A module is active only when the flag is on **and** a persisted row says `status='enabled'` **and** the on-disk package hash still matches the hash trusted at enable time; every other condition (flag off, no row, `disabled`, hash drift, validation error) resolves to inactive. Drift on an enabled module auto-disables it — persisted only in the admin GET path (admin RLS context), read-only everywhere else.

**Tech Stack:** TypeScript, Fastify (plain REST + shared JSON-schema contracts), Kysely + Postgres (RLS), Node `crypto`/`fs` (server-only), React + TanStack Query (settings UI), Vitest (unit), Playwright (e2e), `tsx` migration runner.

**Governing spec:** `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md` (§Build slices — Slice 1). **Issue:** #917 (Part of #818; foundation for epic #860).

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec and `CLAUDE.md` Hard Invariants.

- **Flag off by default.** External modules load only when `JARVIS_ENABLE_EXTERNAL_MODULES` is exactly `"1"`. `JARVIS_MODULES_DIR` is a read-only mount; never write into it.
- **Metadata-only in Slice 1.** External manifests may declare identity/compat fields **only**. Any manifest that populates an executable/surface field (navigation, settings, routes, jobs, permissions, availability handlers, database, assistant tools/action families, feature flags, notifications, source behaviors, focus/proactive/person providers, data lifecycle, external sources, `auth`, `storage`) is **rejected**. No custom UI, credentials, KV, assistant-tool execution, or SQL migrations in this slice.
- **Fail-closed activation.** Active ⇔ flag on ∧ row `status='enabled'` ∧ on-disk `packageHash` === trusted `package_hash`. Flag off / no row / `status!='enabled'` / hash drift / validation error ⇒ inactive.
- **Never edit applied migrations.** Add a new migration file; the runner hash-checks applied files. Global monotonic `NNNN_name.sql`; next number is **0152**. Module SQL lives in the owning module's `sql/` dir (`packages/settings/sql/`), never in `infra/postgres/migrations/`.
- **No admin private-data bypass / RLS applies to admins.** No `BYPASSRLS`. `app.external_modules` gets `ENABLE`+`FORCE` RLS: SELECT to `jarvis_app_runtime, jarvis_worker_runtime`; INSERT/UPDATE/DELETE admin-only via `app.current_actor_is_admin()`.
- **DataContextDb only.** Repositories accept the branded `DataContextDb` handle (`assertDataContextDb` first), never a root Kysely instance.
- **AccessContext shape.** `{ actorUserId, requestId }` only. Do not add fields.
- **Secrets never escape.** N/A to Slice-1 metadata but keep the discipline: never log the modules dir contents wholesale; no secrets in audit metadata (module id + actor + requestId only).
- **Metadata-only job payloads / provider-agnostic AI.** Unaffected here; do not introduce either.
- **Module isolation.** The external-module admin HTTP surface lives in the settings module (which already owns `/api/admin/modules`). No module imports another module's internals.
- **Browser safety.** Browser bundles must stay free of `node:*`/`fs`. The fs loader and hashing live behind the server-only `@jarv1s/module-registry/node` subpath; pure validation/reconcile stay node-free.
- **No zod.** Runtime manifest validation is hand-rolled (TS types + explicit checks). Match the existing `satisfiesCoreVersion` style in `@jarv1s/module-sdk/core-version`.
- **Comment density.** Generous why-comments citing #917 on every non-obvious change.
- **Release-note summary.** Every commit ends with a short user-facing summary line (this feature is admin-facing: "Instance admins can now enable trusted external modules mounted into the container").
- **Full gate:** `pnpm verify:foundation` (lint, format:check, check:file-size, check:design-tokens, check:no-ambient-dates, check:package-deps, typecheck, test:unit, db:migrate, test:integration). Web has no unit tests — verify web via `pnpm --filter @jarv1s/web typecheck` + `build`, and the Playwright e2e via `pnpm test:e2e`.

## Task Overview

1. Migration `0152_external_modules.sql` + DB typing + foundation-test row.
2. SDK external manifest types (type-only, browser-safe).
3. Pure manifest validation (`validateExternalModuleManifest`).
4. Package + manifest hashing (server-only).
5. fs loader (`getExternalModuleRegistrations`, `./node` subpath).
6. Pure reconcile (active/drift computation).
7. Repository external-module state methods + RLS integration tests.
8. Config + composition wiring (startup discovery, thread into deps + `/api/modules`).
9. Shared DTOs/schemas + admin routes + `/api/modules` `external` field + web client.
10. Settings UI "External modules" group + trusted-operator warning + e2e.

## File Structure

- `packages/settings/sql/0152_external_modules.sql` — **new.** Table + RLS + grants (clone of `0103_provider_install_state.sql`).
- `packages/db/src/types.ts` — **modify.** `ExternalModulesTable` interface, `"app.external_modules"` map key, `ExternalModuleRow` alias.
- `tests/integration/foundation.test.ts` — **modify.** Append the `0152` migration-list row.
- `packages/module-sdk/src/index.ts` — **modify.** Type-only external manifest types (`JsonJarvisModuleManifest`, `ModuleAuthDeclaration`, `ModuleStorageDeclaration`, `ExternalJarvisModulePackage`).
- `packages/module-registry/src/external/validate.ts` — **new.** Pure `validateExternalModuleManifest`.
- `packages/module-registry/src/external/hash.ts` — **new.** `hashCanonicalManifest` + `hashExternalPackage` (node `crypto`/`fs`).
- `packages/module-registry/src/external/reconcile.ts` — **new.** Pure `reconcileExternalModules`.
- `packages/module-registry/src/external/types.ts` — **new.** `ExternalModuleDiscovery`, `ExternalModuleRejection`, `ExternalModuleLoadResult`, reconcile types.
- `packages/module-registry/src/node.ts` — **new.** Server-only `getExternalModuleRegistrations` (fs walk). Exposed via `./node` export.
- `packages/module-registry/src/index.ts` + `package.json` — **modify.** Re-export pure validate/reconcile/types from `.`; add `./node` export.
- `packages/settings/src/repository.ts` — **modify.** `listExternalModuleStates`, `setExternalModuleEnabled`, `setExternalModuleDisabled`, `autoDisableExternalModule`.
- `packages/shared/src/platform-api.ts` — **modify.** `ExternalModuleDto` + schemas + route contracts; add `external` to `ModuleDto`/`moduleSchema`.
- `packages/settings/src/routes.ts` — **modify.** `GET /api/admin/external-modules` + `POST /api/admin/external-modules/:id`; new `externalModules` dependency.
- `packages/settings/src/manifest.ts` + `packages/module-registry/src/route-guard.ts` — **modify.** Declare/allow the two new admin routes.
- `apps/api/src/server.ts` — **modify.** Config fields, startup discovery, thread into settings deps + `/api/modules`.
- `apps/web/src/api/client.ts` + `query-keys.ts` — **modify.** `listExternalModules` + `setExternalModuleEnablement` + query key.
- `apps/web/src/settings/settings-admin-panes.tsx` — **modify.** "External modules" group in `InstanceModulesPane`.
- `tests/e2e/external-modules.spec.ts` — **new.** Admin enable/disable + trusted-operator warning.

---

### Task 1: Migration `0152_external_modules.sql` + DB typing + foundation row

**Files:**

- Create: `packages/settings/sql/0152_external_modules.sql`
- Modify: `packages/db/src/types.ts` (add `ExternalModulesTable`, map key `"app.external_modules"`, `ExternalModuleRow`)
- Modify: `tests/integration/foundation.test.ts` (append `0152` to the asserted migration list)

**Interfaces:**

- Produces: table `app.external_modules` and Kysely types `ExternalModulesTable` / `ExternalModuleRow` (re-exported from `@jarv1s/db`). Columns: `id text PK`, `status text ('enabled'|'disabled')`, `manifest_hash text`, `package_hash text`, `disabled_reason text NULL`, `enabled_by uuid NULL`, `enabled_at timestamptz NULL`, `created_at`, `updated_at`. `'discovered'` is a **virtual** state (no row) — the table only ever holds enabled/disabled modules.

- [ ] **Step 0: Re-verify the next free migration number (do NOT trust `0152` from this text)**

Migrations land concurrently across parallel lanes, so `0152` may have been taken since this plan was written. Compute the current max prefix and use `max + 1`:

```bash
find packages apps infra -name '[0-9][0-9][0-9][0-9]_*.sql' | xargs -n1 basename \
  | grep -oE '^[0-9]{4}' | sort | tail -1
```

Expected at plan-authoring time: `0151` → next free is `0152`. **If the command prints `0152` or higher, use that value + 1 instead**, and substitute it for every `0152` reference in this task: the SQL filename, the `foundation.test.ts` row (both `version` and `name`), and the DB-types comment. The number is monotonic and assigned by landing order — never reuse or renumber an already-applied migration.

- [ ] **Step 1: Write the failing test (foundation migration list)**

In `tests/integration/foundation.test.ts`, find the last entry of the asserted migration array (currently `{ version: "0151", name: "0151_news_prefs.sql" }` with no trailing comma). Add a comma and the new row:

```ts
    { version: "0151", name: "0151_news_prefs.sql" },
    { version: "0152", name: "0152_external_modules.sql" }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:integration -- foundation`
Expected: FAIL — the DB has no `0152` applied migration yet, so the actual list is shorter than the asserted list (`toEqual` mismatch on the trailing row).

- [ ] **Step 3: Write the migration SQL**

Create `packages/settings/sql/0152_external_modules.sql` (clone the RLS/grant shape of `0103_provider_install_state.sql`):

```sql
-- External (non-compiled) trusted-operator module enablement state (#917, epic #860).
--
-- Slice 1 of the open module system. The loader reads module packages from a
-- read-only mount (JARVIS_MODULES_DIR) only when JARVIS_ENABLE_EXTERNAL_MODULES=1;
-- THIS table is the single source of truth for whether a discovered module is
-- active. A module is active only when a row here says status='enabled' AND the
-- on-disk package hash still matches `package_hash` captured at enable time.
-- There is deliberately NO 'discovered' status: an undiscovered/never-enabled
-- module simply has no row (virtual 'discovered'), so the fail-closed default is
-- structural, not a value we could forget to check.
--
-- Instance-global, admin-managed (mirrors provider_install_state 0103): readable
-- by all authed actors so the /api/modules resolver can compute active-state under
-- any actor, writable by admins only. NO private data — only module identity,
-- content hashes, and an audit pointer to the enabling admin. All statements
-- idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS app.external_modules (
  -- Module id == its directory name under JARVIS_MODULES_DIR (validated equal at load).
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('enabled', 'disabled')),
  -- SHA-256 of the canonical (sorted-key) jarvis.module.json, captured at enable.
  manifest_hash text NOT NULL,
  -- SHA-256 over the module package (jarvis.module.json + dist/worker.js + dist/web/**),
  -- captured at enable. Drift from the on-disk hash auto-disables the module (#917).
  package_hash text NOT NULL,
  -- Human-readable reason when status='disabled' (e.g. 'package changed since enable',
  -- 'disabled by admin'). NEVER a secret.
  disabled_reason text NULL,
  CONSTRAINT external_modules_disabled_reason_len_ck
    CHECK (disabled_reason IS NULL OR length(disabled_reason) <= 2000),
  -- Admin who last enabled the module (audit pointer). NULL for disabled rows.
  enabled_by uuid NULL,
  enabled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.external_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.external_modules FORCE ROW LEVEL SECURITY;

-- Readable by all authed actors: the /api/modules resolver computes active-state
-- under the requesting actor's context, so every actor must SELECT the instance
-- rows. Never owner-scoped (instance-global).
DROP POLICY IF EXISTS external_modules_select ON app.external_modules;
CREATE POLICY external_modules_select ON app.external_modules
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (true);

-- Writes are admin-only (enable/disable and drift auto-disable are instance-level
-- admin actions). RLS applies to admins too — this is the ONLY write path.
DROP POLICY IF EXISTS external_modules_insert ON app.external_modules;
CREATE POLICY external_modules_insert ON app.external_modules
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS external_modules_update ON app.external_modules;
CREATE POLICY external_modules_update ON app.external_modules
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS external_modules_delete ON app.external_modules;
CREATE POLICY external_modules_delete ON app.external_modules
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.external_modules TO jarvis_app_runtime;
GRANT SELECT ON app.external_modules TO jarvis_worker_runtime;
```

- [ ] **Step 4: Add the Kysely typing**

In `packages/db/src/types.ts`, add the table interface next to `ModuleEnablementTable`:

```ts
// External trusted-operator module enablement (#917). Instance-global, admin-managed.
// `'discovered'` is virtual (no row); only enabled/disabled modules have a row.
export interface ExternalModulesTable {
  id: string;
  status: "enabled" | "disabled";
  manifest_hash: string;
  package_hash: string;
  disabled_reason: string | null;
  enabled_by: string | null;
  enabled_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

Add the map key inside `interface JarvisDatabase` (next to `"app.module_enablement"`):

```ts
  "app.external_modules": ExternalModulesTable;
```

Add the `Selectable` alias next to `ModuleEnablementRow`:

```ts
export type ExternalModuleRow = Selectable<ExternalModulesTable>;
```

- [ ] **Step 5: Apply the migration and run the foundation test to green**

Run: `pnpm db:migrate && pnpm test:integration -- foundation`
Expected: PASS — `0152_external_modules.sql` is applied and the asserted list matches.

- [ ] **Step 6: Typecheck the db package**

Run: `pnpm --filter @jarv1s/db typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/settings/sql/0152_external_modules.sql packages/db/src/types.ts tests/integration/foundation.test.ts
git commit -m "feat(#917): app.external_modules table + RLS + db typing for external module enablement"
```

### Task 2: SDK external manifest types (type-only, browser-safe)

**Files:**

- Modify: `packages/module-sdk/src/index.ts` (append new interfaces near `JarvisModuleManifest`)
- Test: `tests/unit/module-sdk-external-types.test.ts`

**Interfaces:**

- Consumes: `ModuleLifecycle` (`"required" | "optional" | "user-toggleable" | "workspace-toggleable"`) and `ModuleCompatibility` (`{ readonly jarv1s: string }`) — both already exported from `@jarv1s/module-sdk`.
- Produces (all `type`-only, no runtime, no `node:*`):
  - `ModuleAuthDeclaration = { id: string; kind: "api-key" | "oauth2"; label: string }`
  - `ModuleStorageDeclaration = { namespace: string; kind: "kv" }`
  - `JsonJarvisModuleManifest` — the JSON subset of `JarvisModuleManifest`: required `id`, `name`, `version`, `publisher`, `lifecycle`, `compatibility`; optional `description`, `auth`, `storage`. **No function-valued or executable-surface fields.**
  - `ExternalJarvisModulePackage = { manifest: JsonJarvisModuleManifest; manifestHash: string; packageHash: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/module-sdk-external-types.test.ts`. This is a compile-plus-assert test: it constructs a valid metadata-only manifest typed as `JsonJarvisModuleManifest`, so it fails to compile (and Vitest fails) until the type exists.

```ts
import { describe, expect, it } from "vitest";

import type { ExternalJarvisModulePackage, JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

describe("external module manifest types (#917)", () => {
  it("accepts a metadata-only manifest", () => {
    const manifest: JsonJarvisModuleManifest = {
      id: "acme-widgets",
      name: "Acme Widgets",
      version: "0.1.0",
      publisher: "Acme, Inc.",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" }
    };
    const pkg: ExternalJarvisModulePackage = {
      manifest,
      manifestHash: "sha256:deadbeef",
      packageHash: "sha256:cafebabe"
    };
    expect(pkg.manifest.id).toBe("acme-widgets");
    expect(pkg.manifest.compatibility.jarv1s).toBe(">=0.1.0");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- module-sdk-external-types`
Expected: FAIL — `Module '"@jarv1s/module-sdk"' has no exported member 'JsonJarvisModuleManifest'`.

- [ ] **Step 3: Add the types**

In `packages/module-sdk/src/index.ts`, immediately after the `JarvisModuleManifest` interface (ends at the line with `readonly externalSources?: ...` then `}`), add:

```ts
/**
 * A single credential a module declares it needs. RESERVED for a future slice —
 * Slice 1 (#917) rejects any external manifest that populates `auth`, so this type
 * exists only to make the manifest forward-compatible and let the validator name
 * what it refused. `id` must be prefixed `${moduleId}.` when a later slice honors it.
 */
export interface ModuleAuthDeclaration {
  readonly id: string;
  readonly kind: "api-key" | "oauth2";
  readonly label: string;
}

/**
 * A single key-value storage namespace a module declares. RESERVED for a future
 * slice — Slice 1 (#917) rejects any external manifest that populates `storage`.
 * `namespace` must be `${moduleId}` or `${moduleId}.<slug>` when later honored.
 */
export interface ModuleStorageDeclaration {
  readonly namespace: string;
  readonly kind: "kv";
}

/**
 * The JSON-serializable subset of {@link JarvisModuleManifest} that an EXTERNAL
 * (non-compiled) module ships as `jarvis.module.json` (#917). It deliberately omits
 * every function-valued or executable-surface field of the compiled manifest —
 * external modules contribute identity/compat metadata only in Slice 1. `auth` and
 * `storage` are declaration-only and REJECTED at load in this slice (see the
 * metadata-only invariant); they are typed here for forward compatibility.
 */
export interface JsonJarvisModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly description?: string;
  readonly lifecycle: ModuleLifecycle;
  readonly compatibility: ModuleCompatibility;
  readonly auth?: readonly ModuleAuthDeclaration[];
  readonly storage?: readonly ModuleStorageDeclaration[];
}

/**
 * A validated external module package: its parsed metadata-only manifest plus the
 * two content hashes the platform trusts it by (#917). `manifestHash` is over the
 * canonical (sorted-key) manifest JSON; `packageHash` is over the whole package
 * (manifest + dist/worker.js + dist/web/**). Drift in `packageHash` from the value
 * recorded at admin-enable auto-disables the module.
 */
export interface ExternalJarvisModulePackage {
  readonly manifest: JsonJarvisModuleManifest;
  readonly manifestHash: string;
  readonly packageHash: string;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test:unit -- module-sdk-external-types`
Expected: PASS.

- [ ] **Step 5: Typecheck the SDK**

Run: `pnpm --filter @jarv1s/module-sdk typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/module-sdk/src/index.ts tests/unit/module-sdk-external-types.test.ts
git commit -m "feat(#917): external module manifest types (JSON subset, metadata-only)"
```

### Task 3: Pure manifest validation

**Files:**

- Create: `packages/module-registry/src/external/validate.ts`
- Test: `tests/unit/external-validate.test.ts`

**Interfaces:**

- Consumes: `JsonJarvisModuleManifest`, `ModuleLifecycle` from `@jarv1s/module-sdk`; `satisfiesCoreVersion` from `@jarv1s/module-sdk/core-version`.
- Produces:
  - `type ExternalModuleValidation = { ok: true; manifest: JsonJarvisModuleManifest } | { ok: false; errors: readonly string[] }`
  - `function validateExternalModuleManifest(raw: unknown, expectedId: string, coreVersion?: string): ExternalModuleValidation`
  - `const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`
  - No `node:*` imports — this file must be browser-safe (it is re-exported from `@jarv1s/module-registry`'s main entry).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/external-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

const base = {
  id: "acme-widgets",
  name: "Acme Widgets",
  version: "0.1.0",
  publisher: "Acme, Inc.",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.1.0" }
};

describe("validateExternalModuleManifest (#917)", () => {
  it("accepts a well-formed metadata-only manifest", () => {
    const result = validateExternalModuleManifest(base, "acme-widgets", "0.1.0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.id).toBe("acme-widgets");
  });

  it("rejects a non-object", () => {
    const result = validateExternalModuleManifest(null, "acme-widgets");
    expect(result.ok).toBe(false);
  });

  it("rejects an id that does not match the directory name", () => {
    const result = validateExternalModuleManifest(base, "other-dir");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("directory");
  });

  it("rejects an id that is not a slug", () => {
    const result = validateExternalModuleManifest({ ...base, id: "Acme_Widgets" }, "Acme_Widgets");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { publisher, ...withoutPublisher } = base;
    const result = validateExternalModuleManifest(withoutPublisher, "acme-widgets");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("publisher");
  });

  it("rejects an incompatible core-version range", () => {
    const result = validateExternalModuleManifest(
      { ...base, compatibility: { jarv1s: ">=9.9.9" } },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("compatible");
  });

  it("rejects an executable/surface field (navigation)", () => {
    const result = validateExternalModuleManifest(
      { ...base, navigation: [{ id: "x", label: "X", path: "/x" }] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("navigation");
  });

  it("rejects declared auth in this slice", () => {
    const result = validateExternalModuleManifest(
      { ...base, auth: [{ id: "acme-widgets.key", kind: "api-key", label: "Key" }] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("auth");
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm test:unit -- external-validate`
Expected: FAIL — `validateExternalModuleManifest` is not exported.

- [ ] **Step 3: Implement the validator**

Create `packages/module-registry/src/external/validate.ts`:

```ts
// Pure, browser-safe validation of an external module's jarvis.module.json (#917).
// Slice 1 accepts METADATA ONLY: identity + compatibility. Any executable or
// surface-contributing field is rejected so an external module can never inject
// nav/routes/tools/SQL before the slices that safely host those land. No node:*
// imports here — this is re-exported from @jarv1s/module-registry's browser entry.
import type { JsonJarvisModuleManifest, ModuleLifecycle } from "@jarv1s/module-sdk";
import { satisfiesCoreVersion } from "@jarv1s/module-sdk/core-version";

export type ExternalModuleValidation =
  | { readonly ok: true; readonly manifest: JsonJarvisModuleManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Module ids are lowercase kebab slugs; the id also names the package directory. */
export const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const LIFECYCLES: readonly ModuleLifecycle[] = [
  "required",
  "optional",
  "user-toggleable",
  "workspace-toggleable"
];

// Every field of the compiled JarvisModuleManifest that carries executable behavior
// or a UI/data surface. Presence of ANY of these in an external manifest is a
// Slice-1 rejection (metadata-only). `auth`/`storage` are declaration-only but still
// out of scope this slice.
const FORBIDDEN_FIELDS: readonly string[] = [
  "availability",
  "database",
  "navigation",
  "settings",
  "permissions",
  "featureFlags",
  "notifications",
  "routes",
  "jobs",
  "shareableResources",
  "assistantActionFamilies",
  "assistantTools",
  "sourceBehaviors",
  "focusSignal",
  "proactiveMonitor",
  "personContextProvider",
  "dataLifecycle",
  "externalSources",
  "auth",
  "storage"
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateExternalModuleManifest(
  raw: unknown,
  expectedId: string,
  coreVersion?: string
): ExternalModuleValidation {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest must be a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;

  // Identity.
  if (!isNonEmptyString(obj.id)) {
    errors.push("id is required and must be a non-empty string");
  } else if (!MODULE_ID_RE.test(obj.id)) {
    errors.push(`id "${obj.id}" is not a valid lowercase kebab-case slug`);
  } else if (obj.id !== expectedId) {
    errors.push(`id "${obj.id}" must equal the module directory name "${expectedId}"`);
  }

  if (!isNonEmptyString(obj.name)) errors.push("name is required");
  if (!isNonEmptyString(obj.version)) errors.push("version is required");
  if (!isNonEmptyString(obj.publisher)) errors.push("publisher is required");
  if (obj.description !== undefined && typeof obj.description !== "string") {
    errors.push("description must be a string when present");
  }

  if (!isNonEmptyString(obj.lifecycle) || !LIFECYCLES.includes(obj.lifecycle as ModuleLifecycle)) {
    errors.push(`lifecycle must be one of: ${LIFECYCLES.join(", ")}`);
  }

  // Compatibility — fail closed on an unparseable or out-of-range core version.
  const compatibility = obj.compatibility as Record<string, unknown> | undefined;
  if (
    typeof compatibility !== "object" ||
    compatibility === null ||
    !isNonEmptyString(compatibility.jarv1s)
  ) {
    errors.push("compatibility.jarv1s is required and must be a non-empty string");
  } else if (!satisfiesCoreVersion(compatibility.jarv1s, coreVersion)) {
    errors.push(
      `module is not compatible with this core (compatibility.jarv1s="${compatibility.jarv1s}")`
    );
  }

  // Metadata-only gate: reject any executable/surface field (#917).
  for (const field of FORBIDDEN_FIELDS) {
    if (obj[field] !== undefined) {
      errors.push(`field "${field}" is not permitted for external modules in this slice`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Re-shape to exactly the allowed fields (drop unknown keys defensively).
  const manifest: JsonJarvisModuleManifest = {
    id: obj.id as string,
    name: obj.name as string,
    version: obj.version as string,
    publisher: obj.publisher as string,
    lifecycle: obj.lifecycle as ModuleLifecycle,
    compatibility: { jarv1s: (compatibility as { jarv1s: string }).jarv1s },
    ...(typeof obj.description === "string" ? { description: obj.description } : {})
  };
  return { ok: true, manifest };
}
```

- [ ] **Step 4: Re-export from the package entry**

In `packages/module-registry/src/index.ts`, add near the other exports:

```ts
export * from "./external/validate.js";
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test:unit -- external-validate`
Expected: PASS (all 8 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/module-registry/src/external/validate.ts packages/module-registry/src/index.ts tests/unit/external-validate.test.ts
git commit -m "feat(#917): pure metadata-only validation for external module manifests"
```

### Task 4: Package + manifest hashing (server-only)

**Files:**

- Create: `packages/module-registry/src/external/hash.ts`
- Test: `tests/unit/external-hash.test.ts`

**Interfaces:**

- Consumes: `JsonJarvisModuleManifest` from `@jarv1s/module-sdk`; `node:crypto`, `node:fs`, `node:path`.
- Produces:
  - `function hashCanonicalManifest(manifest: JsonJarvisModuleManifest): string` — `"sha256:<hex>"` over the canonical (recursively sorted-key) JSON.
  - `function hashExternalPackage(dir: string): string` — `"sha256:<hex>"` over the package's hashable files (`jarvis.module.json`, `dist/worker.js`, and every file under `dist/web/`), each contributing `relpath\0<filehash>` in sorted `relpath` order. Missing files are simply absent from the digest.
  - **Not** re-exported from the browser entry — imported only by `src/node.ts` (Task 5), because it uses `node:*`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/external-hash.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashCanonicalManifest, hashExternalPackage } from "@jarv1s/module-registry/node";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "extmod-hash-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hashCanonicalManifest (#917)", () => {
  it("is stable regardless of key order", () => {
    const a = hashCanonicalManifest({
      id: "m",
      name: "M",
      version: "0.1.0",
      publisher: "P",
      lifecycle: "optional",
      compatibility: { jarv1s: "*" }
    });
    const b = hashCanonicalManifest({
      compatibility: { jarv1s: "*" },
      publisher: "P",
      lifecycle: "optional",
      version: "0.1.0",
      name: "M",
      id: "m"
    } as never);
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });
});

describe("hashExternalPackage (#917)", () => {
  it("changes when a dist file changes", () => {
    writeFileSync(join(dir, "jarvis.module.json"), '{"id":"m"}');
    mkdirSync(join(dir, "dist", "web"), { recursive: true });
    writeFileSync(join(dir, "dist", "worker.js"), "export const a = 1;");
    writeFileSync(join(dir, "dist", "web", "index.js"), "export const b = 1;");
    const before = hashExternalPackage(dir);

    writeFileSync(join(dir, "dist", "worker.js"), "export const a = 2;");
    const after = hashExternalPackage(dir);

    expect(before).not.toBe(after);
    expect(before.startsWith("sha256:")).toBe(true);
  });

  it("is stable across repeated calls with no changes", () => {
    writeFileSync(join(dir, "jarvis.module.json"), '{"id":"m"}');
    expect(hashExternalPackage(dir)).toBe(hashExternalPackage(dir));
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm test:unit -- external-hash`
Expected: FAIL — `@jarv1s/module-registry/node` subpath / functions do not exist yet.

- [ ] **Step 3: Implement hashing**

Create `packages/module-registry/src/external/hash.ts`:

```ts
// Content hashing for external module packages (#917). Server-only (node:*): the
// manifest hash is the trust anchor recorded at admin-enable, and the package hash
// is compared against it on every load — any drift auto-disables the module. Both
// are deterministic and independent of filesystem ordering.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Recursively sort object keys so JSON.stringify is canonical (order-independent). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonicalManifest(manifest: unknown): string {
  return `sha256:${sha256Hex(JSON.stringify(canonicalize(manifest)))}`;
}

/** All files under `root` (recursive), returned as root-relative POSIX paths. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  }
  return out;
}

export function hashExternalPackage(dir: string): string {
  // The hashable set: the manifest, the worker bundle, and everything the web bundle
  // ships. Anything else in the mounted dir is ignored so unrelated files can't churn
  // the hash. Files that don't exist are simply omitted (a Slice-1 metadata-only module
  // may ship only the manifest).
  const relPaths: string[] = [];
  if (existsSync(join(dir, "jarvis.module.json"))) relPaths.push("jarvis.module.json");
  if (existsSync(join(dir, "dist", "worker.js"))) relPaths.push("dist/worker.js");
  const webDir = join(dir, "dist", "web");
  if (existsSync(webDir) && statSync(webDir).isDirectory()) {
    for (const rel of walkFiles(webDir)) relPaths.push(`dist/web/${rel}`);
  }

  const digest = createHash("sha256");
  for (const rel of relPaths.sort()) {
    const fileHash = sha256Hex(readFileSync(join(dir, rel)));
    digest.update(`${rel}\0${fileHash}\n`);
  }
  return `sha256:${digest.digest("hex")}`;
}
```

- [ ] **Step 4: Create the server-only `./node` entry + export map**

The test imports from `@jarv1s/module-registry/node`, the server-only subpath that keeps `node:*` out of the browser entry. Create `packages/module-registry/src/node.ts` as a thin re-export (Task 5 extends it with the loader):

```ts
// Server-only entry for @jarv1s/module-registry (#917). Everything reachable from
// here may use node:* (fs, crypto). The browser-safe surface stays in ./index.ts.
export * from "./external/hash.js";
```

In `packages/module-registry/package.json`, add the `./node` subpath to the `exports` map (keep the existing `.` entry):

```json
  "exports": {
    ".": "./src/index.ts",
    "./node": "./src/node.ts"
  },
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test:unit -- external-hash`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/module-registry/src/external/hash.ts packages/module-registry/src/node.ts packages/module-registry/package.json tests/unit/external-hash.test.ts
git commit -m "feat(#917): deterministic manifest + package hashing for external modules"
```

### Task 5: fs loader (`getExternalModuleRegistrations`)

**Files:**

- Create: `packages/module-registry/src/external/types.ts` (node-free shared types)
- Modify: `packages/module-registry/src/node.ts` (add the loader; already re-exports hash from Task 4)
- Modify: `packages/module-registry/src/index.ts` (re-export `./external/types.js`)
- Test: `tests/unit/external-loader.test.ts`

**Interfaces:**

- Consumes: `validateExternalModuleManifest`, `MODULE_ID_RE` (Task 3); `hashCanonicalManifest`, `hashExternalPackage` (Task 4); `JsonJarvisModuleManifest` (Task 2); `node:fs`, `node:path`.
- Produces (`types.ts`, node-free):
  - `interface ExternalModuleDiscovery { id: string; dir: string; manifest: JsonJarvisModuleManifest; manifestHash: string; packageHash: string }`
  - `interface ExternalModuleRejection { id: string; reason: string }`
  - `interface ExternalModuleLoadResult { discoveries: readonly ExternalModuleDiscovery[]; rejected: readonly ExternalModuleRejection[] }`
- Produces (`node.ts`):
  - `function getExternalModuleRegistrations(options: { modulesDir: string; coreVersion?: string }): ExternalModuleLoadResult`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/external-loader.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getExternalModuleRegistrations } from "@jarv1s/module-registry/node";

let root: string;
let modulesDir: string;

const validManifest = (id: string) =>
  JSON.stringify({
    id,
    name: "Acme Widgets",
    version: "0.1.0",
    publisher: "Acme, Inc.",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.1.0" }
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "extmod-loader-"));
  modulesDir = join(root, "modules");
  mkdirSync(modulesDir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("getExternalModuleRegistrations (#917)", () => {
  it("returns an empty result when the dir does not exist", () => {
    const result = getExternalModuleRegistrations({
      modulesDir: join(root, "nope"),
      coreVersion: "0.1.0"
    });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("discovers a valid module and hashes it", () => {
    const dir = join(modulesDir, "acme-widgets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), validManifest("acme-widgets"));

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toHaveLength(1);
    expect(result.discoveries[0]!.id).toBe("acme-widgets");
    expect(result.discoveries[0]!.manifestHash.startsWith("sha256:")).toBe(true);
    expect(result.discoveries[0]!.packageHash.startsWith("sha256:")).toBe(true);
  });

  it("rejects a module whose manifest id != directory name", () => {
    const dir = join(modulesDir, "acme-widgets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), validManifest("something-else"));

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("directory");
  });

  it("rejects a module with invalid JSON", () => {
    const dir = join(modulesDir, "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis.module.json"), "{ not json");

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected[0]!.reason.toLowerCase()).toContain("json");
  });

  it("rejects a symlinked directory that escapes the modules root", () => {
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "jarvis.module.json"), validManifest("escapee"));
    symlinkSync(outside, join(modulesDir, "escapee"), "dir");

    const result = getExternalModuleRegistrations({ modulesDir, coreVersion: "0.1.0" });
    expect(result.discoveries).toEqual([]);
    expect(result.rejected[0]!.reason.toLowerCase()).toContain("symlink");
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm test:unit -- external-loader`
Expected: FAIL — `getExternalModuleRegistrations` not exported.

- [ ] **Step 3: Create the shared types**

Create `packages/module-registry/src/external/types.ts`:

```ts
// Node-free shared types for external module discovery (#917). Kept out of node.ts so
// the browser entry (index.ts) and the pure reconcile step can import them too.
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

/** A validated, on-disk external module: its metadata-only manifest + content hashes. */
export interface ExternalModuleDiscovery {
  readonly id: string;
  readonly dir: string;
  readonly manifest: JsonJarvisModuleManifest;
  readonly manifestHash: string;
  readonly packageHash: string;
}

/** A directory under the modules root that was NOT loaded, with a human-readable reason. */
export interface ExternalModuleRejection {
  readonly id: string;
  readonly reason: string;
}

export interface ExternalModuleLoadResult {
  readonly discoveries: readonly ExternalModuleDiscovery[];
  readonly rejected: readonly ExternalModuleRejection[];
}
```

Re-export from `packages/module-registry/src/index.ts`:

```ts
export * from "./external/types.js";
```

- [ ] **Step 4: Implement the loader**

Append to `packages/module-registry/src/node.ts`:

```ts
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { hashCanonicalManifest, hashExternalPackage } from "./external/hash.js";
import { MODULE_ID_RE, validateExternalModuleManifest } from "./external/validate.js";
import type {
  ExternalModuleDiscovery,
  ExternalModuleLoadResult,
  ExternalModuleRejection
} from "./external/types.js";

/**
 * Discover external modules under `modulesDir` (#917). Server-only. Read-only: never
 * writes into the mount. Fail-closed per directory — any error (bad slug, symlink
 * escape, missing/invalid manifest, validation failure) rejects THAT module with a
 * reason and never throws, so one bad module can't blank the whole set. Callers gate
 * the call behind JARVIS_ENABLE_EXTERNAL_MODULES; the loader itself just reads a dir.
 */
export function getExternalModuleRegistrations(options: {
  readonly modulesDir: string;
  readonly coreVersion?: string;
}): ExternalModuleLoadResult {
  const { modulesDir, coreVersion } = options;
  const discoveries: ExternalModuleDiscovery[] = [];
  const rejected: ExternalModuleRejection[] = [];

  if (!existsSync(modulesDir)) {
    return { discoveries, rejected };
  }

  // Resolve the root through symlinks once so we can prove each module dir is contained.
  const rootReal = realpathSync(modulesDir);

  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    // A module directory's name IS the module id — reject non-slug names outright
    // (also blocks any "." / ".." style trickery the fs might surface).
    const id = entry.name;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!MODULE_ID_RE.test(id)) {
      rejected.push({ id, reason: `directory name "${id}" is not a valid module id slug` });
      continue;
    }

    const dir = join(modulesDir, id);
    // Symlink-escape guard: the real path must stay inside the real modules root.
    const dirReal = realpathSync(dir);
    if (dirReal !== rootReal && !dirReal.startsWith(rootReal + sep)) {
      rejected.push({ id, reason: `symlink target escapes the modules root: ${id}` });
      continue;
    }

    const manifestPath = join(dir, "jarvis.module.json");
    if (!existsSync(manifestPath)) {
      rejected.push({ id, reason: `missing jarvis.module.json in ${id}` });
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      rejected.push({ id, reason: `invalid JSON in ${id}/jarvis.module.json: ${String(error)}` });
      continue;
    }

    const validation = validateExternalModuleManifest(raw, id, coreVersion);
    if (!validation.ok) {
      rejected.push({ id, reason: validation.errors.join("; ") });
      continue;
    }

    discoveries.push({
      id,
      dir,
      manifest: validation.manifest,
      manifestHash: hashCanonicalManifest(validation.manifest),
      packageHash: hashExternalPackage(dir)
    });
  }

  // Deterministic order so downstream lists/hashes are stable.
  discoveries.sort((a, b) => a.id.localeCompare(b.id));
  rejected.sort((a, b) => a.id.localeCompare(b.id));
  return { discoveries, rejected };
}
```

> The symlink-escape guard uses `sep` from the top-of-file `import { join, relative, sep } from "node:path";` (already present in the loader source above). Never use `require(...)` — the package is `"type": "module"` and CommonJS `require` is not defined in ESM.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test:unit -- external-loader`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @jarv1s/module-registry typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/module-registry/src/external/types.ts packages/module-registry/src/node.ts packages/module-registry/src/index.ts tests/unit/external-loader.test.ts
git commit -m "feat(#917): fs loader for external modules with symlink + slug bounds"
```

### Task 6: pure reconcile (`reconcileExternalModules`)

**Files:**

- Modify: `packages/module-registry/src/external/types.ts` (add reconcile types)
- Create: `packages/module-registry/src/external/reconcile.ts`
- Modify: `packages/module-registry/src/index.ts` (re-export `./external/reconcile.js`)
- Test: `tests/unit/external-reconcile.test.ts`

**Interfaces:**

- Consumes: `ExternalModuleDiscovery` (Task 5).
- Produces (`types.ts`):
  - `interface ExternalModuleStateInput { id: string; status: "enabled" | "disabled"; packageHash: string | null; disabledReason: string | null }` — one per persisted `app.external_modules` row.
  - `type ExternalModuleStatus = "discovered" | "enabled" | "disabled";`
  - `interface ReconciledExternalModule { id: string; name: string; version: string; publisher: string; status: ExternalModuleStatus; active: boolean; drifted: boolean; disabledReason: string | null }`
  - `interface ExternalReconcileResult { modules: ReconciledExternalModule[]; driftDisable: Array<{ id: string; reason: string }> }`
- Produces (`reconcile.ts`):
  - `const DRIFT_DISABLED_REASON = "package changed since it was enabled";`
  - `function reconcileExternalModules(discoveries: readonly ExternalModuleDiscovery[], rows: readonly ExternalModuleStateInput[]): ExternalReconcileResult`

**Reconcile rules (#917 — fail-closed):**

- Only on-disk discoveries produce output modules. A DB row with no matching discovery is ignored (module vanished from the mount) — its row stays untouched; nothing to render.
- No row → `status:"discovered"`, `active:false`, `drifted:false`.
- Row `status:"disabled"` → `status:"disabled"`, `active:false`, carry `disabledReason`.
- Row `status:"enabled"` **and** `row.packageHash === discovery.packageHash` → `status:"enabled"`, `active:true`, `drifted:false`.
- Row `status:"enabled"` **but** hash mismatch → **drift**: emit `status:"disabled"`, `active:false`, `drifted:true`, `disabledReason:DRIFT_DISABLED_REASON`, **and** push `{ id, reason: DRIFT_DISABLED_REASON }` onto `driftDisable`. The reconcile itself never writes — `driftDisable` is the to-persist list the admin GET path applies under an admin RLS context (Task 9).
- Output `modules` sorted by `id`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/external-reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DRIFT_DISABLED_REASON, reconcileExternalModules } from "@jarv1s/module-registry";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";

const discovery = (id: string, packageHash: string): ExternalModuleDiscovery => ({
  id,
  dir: `/modules/${id}`,
  manifest: {
    id,
    name: `Name ${id}`,
    version: "0.1.0",
    publisher: "Acme",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.1.0" }
  },
  manifestHash: `sha256:m-${id}`,
  packageHash
});

describe("reconcileExternalModules (#917)", () => {
  it("marks a discovery with no row as discovered + inactive", () => {
    const { modules, driftDisable } = reconcileExternalModules([discovery("a", "sha256:1")], []);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      id: "a",
      status: "discovered",
      active: false,
      drifted: false
    });
    expect(driftDisable).toEqual([]);
  });

  it("marks an enabled row with matching hash as active", () => {
    const { modules, driftDisable } = reconcileExternalModules(
      [discovery("a", "sha256:1")],
      [{ id: "a", status: "enabled", packageHash: "sha256:1", disabledReason: null }]
    );
    expect(modules[0]).toMatchObject({ id: "a", status: "enabled", active: true, drifted: false });
    expect(driftDisable).toEqual([]);
  });

  it("auto-disables (drift) an enabled row whose hash no longer matches", () => {
    const { modules, driftDisable } = reconcileExternalModules(
      [discovery("a", "sha256:NEW")],
      [{ id: "a", status: "enabled", packageHash: "sha256:OLD", disabledReason: null }]
    );
    expect(modules[0]).toMatchObject({
      id: "a",
      status: "disabled",
      active: false,
      drifted: true,
      disabledReason: DRIFT_DISABLED_REASON
    });
    expect(driftDisable).toEqual([{ id: "a", reason: DRIFT_DISABLED_REASON }]);
  });

  it("keeps an explicitly disabled row disabled and carries its reason", () => {
    const { modules } = reconcileExternalModules(
      [discovery("a", "sha256:1")],
      [
        {
          id: "a",
          status: "disabled",
          packageHash: "sha256:1",
          disabledReason: "admin turned it off"
        }
      ]
    );
    expect(modules[0]).toMatchObject({
      id: "a",
      status: "disabled",
      active: false,
      drifted: false
    });
    expect(modules[0]!.disabledReason).toBe("admin turned it off");
  });

  it("ignores a row whose module is no longer on disk", () => {
    const { modules } = reconcileExternalModules(
      [],
      [{ id: "ghost", status: "enabled", packageHash: "sha256:1", disabledReason: null }]
    );
    expect(modules).toEqual([]);
  });

  it("sorts output modules by id", () => {
    const { modules } = reconcileExternalModules(
      [discovery("b", "sha256:1"), discovery("a", "sha256:1")],
      []
    );
    expect(modules.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm test:unit -- external-reconcile`
Expected: FAIL — `reconcileExternalModules` / `DRIFT_DISABLED_REASON` not exported.

- [ ] **Step 3: Add the reconcile types**

Append to `packages/module-registry/src/external/types.ts`:

```ts
/** One persisted app.external_modules row, narrowed to what reconcile needs (#917). */
export interface ExternalModuleStateInput {
  readonly id: string;
  readonly status: "enabled" | "disabled";
  readonly packageHash: string | null;
  readonly disabledReason: string | null;
}

/** 'discovered' is virtual — it means "on disk, no DB row". Only enabled/disabled persist. */
export type ExternalModuleStatus = "discovered" | "enabled" | "disabled";

export interface ReconciledExternalModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly status: ExternalModuleStatus;
  readonly active: boolean;
  readonly drifted: boolean;
  readonly disabledReason: string | null;
}

export interface ExternalReconcileResult {
  readonly modules: ReconciledExternalModule[];
  readonly driftDisable: Array<{ id: string; reason: string }>;
}
```

- [ ] **Step 4: Implement the reconcile**

Create `packages/module-registry/src/external/reconcile.ts`:

```ts
// Pure fail-closed reconciliation of on-disk discoveries against persisted enablement
// rows (#917). No I/O, no node:* — safe to import from the browser bundle and from the
// admin route. Activation truth table lives here; the loader and repository are dumb.
import type {
  ExternalModuleDiscovery,
  ExternalModuleStateInput,
  ExternalReconcileResult,
  ReconciledExternalModule
} from "./types.js";

/** Written to disabled_reason when an enabled module's package hash drifts (#917). */
export const DRIFT_DISABLED_REASON = "package changed since it was enabled";

export function reconcileExternalModules(
  discoveries: readonly ExternalModuleDiscovery[],
  rows: readonly ExternalModuleStateInput[]
): ExternalReconcileResult {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const modules: ReconciledExternalModule[] = [];
  const driftDisable: Array<{ id: string; reason: string }> = [];

  for (const discovery of discoveries) {
    const { id, manifest, packageHash } = discovery;
    const base = {
      id,
      name: manifest.name,
      version: manifest.version,
      publisher: manifest.publisher
    };
    const row = rowsById.get(id);

    // No row → virtual 'discovered'. Fail-closed: inactive until an admin enables it.
    if (!row) {
      modules.push({
        ...base,
        status: "discovered",
        active: false,
        drifted: false,
        disabledReason: null
      });
      continue;
    }

    // Explicitly disabled → stay disabled, carry the admin's reason.
    if (row.status === "disabled") {
      modules.push({
        ...base,
        status: "disabled",
        active: false,
        drifted: false,
        disabledReason: row.disabledReason
      });
      continue;
    }

    // Enabled + hash still matches → active.
    if (row.packageHash === packageHash) {
      modules.push({
        ...base,
        status: "enabled",
        active: true,
        drifted: false,
        disabledReason: null
      });
      continue;
    }

    // Enabled but the package changed since enable → DRIFT. Fail closed (inactive) and
    // record the id so the admin GET path can persist the auto-disable under admin RLS.
    modules.push({
      ...base,
      status: "disabled",
      active: false,
      drifted: true,
      disabledReason: DRIFT_DISABLED_REASON
    });
    driftDisable.push({ id, reason: DRIFT_DISABLED_REASON });
  }

  modules.sort((a, b) => a.id.localeCompare(b.id));
  return { modules, driftDisable };
}
```

Re-export from `packages/module-registry/src/index.ts`:

```ts
export * from "./external/reconcile.js";
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm test:unit -- external-reconcile`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/module-registry/src/external/types.ts packages/module-registry/src/external/reconcile.ts packages/module-registry/src/index.ts tests/unit/external-reconcile.test.ts
git commit -m "feat(#917): pure fail-closed reconcile for external module activation + drift"
```

### Task 7: repository external-module state methods + RLS integration tests

**Files:**

- Modify: `packages/settings/src/repository.ts` (new input types + four methods)
- Test: `tests/integration/external-modules-repository.test.ts`

**Interfaces:**

- Consumes: `DataContextDb`, `assertDataContextDb`, `insertAuditEvent` (existing); `ExternalModuleStateInput` (Task 6); `ExternalModuleRow`/`"app.external_modules"` (Task 1).
- Produces (exported from `repository.ts`):
  - `interface SetExternalModuleEnabledInput { id: string; manifestHash: string; packageHash: string; actorUserId: string; requestId: string }`
  - `interface SetExternalModuleDisabledInput { id: string; reason: string; actorUserId: string; requestId: string }`
  - `SettingsRepository.listExternalModuleStates(db): Promise<ExternalModuleStateInput[]>`
  - `SettingsRepository.setExternalModuleEnabled(db, input: SetExternalModuleEnabledInput): Promise<void>`
  - `SettingsRepository.setExternalModuleDisabled(db, input: SetExternalModuleDisabledInput): Promise<void>`
  - `SettingsRepository.autoDisableExternalModule(db, input: SetExternalModuleDisabledInput): Promise<void>`

**Audit actions (metadata-only — module id + actor + requestId):** `module.external_enable`, `module.external_disable`, `module.external_auto_disable`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/external-modules-repository.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";

import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { connectionStrings, ids } from "./test-database.js";

describe("SettingsRepository external-module state (app.external_modules, #917)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  beforeAll(async () => {
    // Seeds userA, userB, adminUser.
    const { resetFoundationDatabase } = await import("./test-database.js");
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("admin can enable, then disable, an external module (audit written each time)", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "ext-1" }, (db) =>
      repo.setExternalModuleEnabled(db, {
        id: "acme-widgets",
        manifestHash: "sha256:m1",
        packageHash: "sha256:p1",
        actorUserId: ids.adminUser,
        requestId: "ext-1"
      })
    );

    let states = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "ext-r1" },
      (db) => repo.listExternalModuleStates(db)
    );
    const enabled = states.find((s) => s.id === "acme-widgets");
    expect(enabled).toMatchObject({
      id: "acme-widgets",
      status: "enabled",
      packageHash: "sha256:p1"
    });

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "ext-2" }, (db) =>
      repo.setExternalModuleDisabled(db, {
        id: "acme-widgets",
        reason: "disabled by admin",
        actorUserId: ids.adminUser,
        requestId: "ext-2"
      })
    );

    states = await runner.withDataContext({ actorUserId: ids.userA, requestId: "ext-r2" }, (db) =>
      repo.listExternalModuleStates(db)
    );
    expect(states.find((s) => s.id === "acme-widgets")).toMatchObject({
      status: "disabled",
      disabledReason: "disabled by admin"
    });

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "ext-r3" },
      (db) => repo.listAdminAuditEvents(db)
    );
    const actions = audit.filter((e) => e.target_id === "acme-widgets").map((e) => e.action);
    expect(actions).toContain("module.external_enable");
    expect(actions).toContain("module.external_disable");
  });

  it("autoDisableExternalModule flips an enabled row to disabled with the drift reason", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "ext-4" }, (db) =>
      repo.setExternalModuleEnabled(db, {
        id: "drifter",
        manifestHash: "sha256:m",
        packageHash: "sha256:old",
        actorUserId: ids.adminUser,
        requestId: "ext-4"
      })
    );

    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "ext-5" }, (db) =>
      repo.autoDisableExternalModule(db, {
        id: "drifter",
        reason: "package changed since it was enabled",
        actorUserId: ids.adminUser,
        requestId: "ext-5"
      })
    );

    const states = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "ext-r4" },
      (db) => repo.listExternalModuleStates(db)
    );
    expect(states.find((s) => s.id === "drifter")).toMatchObject({
      status: "disabled",
      disabledReason: "package changed since it was enabled"
    });

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "ext-r5" },
      (db) => repo.listAdminAuditEvents(db)
    );
    expect(
      audit.some((e) => e.target_id === "drifter" && e.action === "module.external_auto_disable")
    ).toBe(true);
  });

  it("RLS: a NON-admin actor cannot enable an external module", async () => {
    await expect(
      runner.withDataContext({ actorUserId: ids.userA, requestId: "ext-6" }, (db) =>
        repo.setExternalModuleEnabled(db, {
          id: "sneaky",
          manifestHash: "sha256:m",
          packageHash: "sha256:p",
          actorUserId: ids.userA,
          requestId: "ext-6"
        })
      )
    ).rejects.toThrow();

    // No row leaked in (admin read sees nothing for 'sneaky').
    const states = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "ext-r6" },
      (db) => repo.listExternalModuleStates(db)
    );
    expect(states.some((s) => s.id === "sneaky")).toBe(false);
  });

  it("RLS: every authed actor can SELECT external-module state", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "ext-7" }, (db) =>
      repo.setExternalModuleEnabled(db, {
        id: "visible-to-all",
        manifestHash: "sha256:m",
        packageHash: "sha256:p",
        actorUserId: ids.adminUser,
        requestId: "ext-7"
      })
    );
    const asUserB = await runner.withDataContext(
      { actorUserId: ids.userB, requestId: "ext-r7" },
      (db) => repo.listExternalModuleStates(db)
    );
    expect(asUserB.some((s) => s.id === "visible-to-all")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm vitest run tests/integration/external-modules-repository.test.ts`
Expected: FAIL — the four methods do not exist (and the `app.external_modules` table exists from Task 1's migration).

- [ ] **Step 3: Add the input types**

Add near `SetModuleDisabledInput` in `packages/settings/src/repository.ts`:

```ts
// External-module admin state transitions (#917). All admin-gated at the RLS layer.
export interface SetExternalModuleEnabledInput {
  readonly id: string;
  readonly manifestHash: string;
  readonly packageHash: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface SetExternalModuleDisabledInput {
  readonly id: string;
  readonly reason: string;
  readonly actorUserId: string;
  readonly requestId: string;
}
```

Add the reconcile-input import at the top of the file (type-only):

```ts
import type { ExternalModuleStateInput } from "@jarv1s/module-registry";
```

- [ ] **Step 4: Implement the four methods**

Add to the `SettingsRepository` class in `packages/settings/src/repository.ts`:

```ts
  /**
   * All external-module enablement rows visible under RLS (#917). SELECT is granted to
   * every authed actor (instance-global state, mirrors provider_install_state), so this
   * is the read used by both the public resolver and the admin GET. Narrowed to the
   * shape reconcileExternalModules() needs.
   */
  async listExternalModuleStates(scopedDb: DataContextDb): Promise<ExternalModuleStateInput[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.external_modules")
      .select(["id", "status", "package_hash", "disabled_reason"])
      .orderBy("id")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      packageHash: r.package_hash,
      disabledReason: r.disabled_reason
    }));
  }

  /**
   * Admin: enable an external module, recording the manifest + package hashes trusted at
   * this moment (#917). Upsert — enabling an already-enabled module re-captures the hash
   * (an admin re-approving a changed package). RLS INSERT/UPDATE require
   * current_actor_is_admin(); a non-admin call is rejected at the policy layer.
   */
  async setExternalModuleEnabled(
    scopedDb: DataContextDb,
    input: SetExternalModuleEnabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.external_modules")
      .values({
        id: input.id,
        status: "enabled",
        manifest_hash: input.manifestHash,
        package_hash: input.packageHash,
        disabled_reason: null,
        enabled_by: input.actorUserId,
        enabled_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          status: "enabled",
          manifest_hash: input.manifestHash,
          package_hash: input.packageHash,
          disabled_reason: null,
          enabled_by: input.actorUserId,
          enabled_at: new Date(),
          updated_at: new Date()
        })
      )
      .execute();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: "module.external_enable",
      targetType: "module",
      targetId: input.id,
      metadata: { moduleId: input.id },
      requestId: input.requestId
    });
  }

  /**
   * Admin: explicitly disable an external module (#917). Upsert so a never-enabled
   * (virtual 'discovered') module can be pinned disabled too. Clears the enable pointer.
   */
  async setExternalModuleDisabled(
    scopedDb: DataContextDb,
    input: SetExternalModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await this.writeDisabledRow(scopedDb, input, "module.external_disable");
  }

  /**
   * Drift auto-disable (#917). Same persisted effect as an admin disable, but a distinct
   * audit action so the log distinguishes "admin turned it off" from "we turned it off
   * because the package changed". Called ONLY from the admin GET path (admin RLS context)
   * when reconcile reports drift on an enabled module.
   */
  async autoDisableExternalModule(
    scopedDb: DataContextDb,
    input: SetExternalModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await this.writeDisabledRow(scopedDb, input, "module.external_auto_disable");
  }

  /** Shared disable upsert + audit for the two disable entry points above (#917). */
  private async writeDisabledRow(
    scopedDb: DataContextDb,
    input: SetExternalModuleDisabledInput,
    action: "module.external_disable" | "module.external_auto_disable"
  ): Promise<void> {
    await scopedDb.db
      .insertInto("app.external_modules")
      .values({
        id: input.id,
        status: "disabled",
        // A disabled row still needs the NOT NULL hash columns; empty sentinels are
        // fine because activation requires status='enabled' AND a hash match — a
        // disabled row is never active regardless of what hash it carries.
        manifest_hash: "",
        package_hash: "",
        disabled_reason: input.reason,
        enabled_by: null,
        enabled_at: null,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          status: "disabled",
          disabled_reason: input.reason,
          enabled_by: null,
          enabled_at: null,
          updated_at: new Date()
        })
      )
      .execute();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action,
      targetType: "module",
      targetId: input.id,
      metadata: { moduleId: input.id, reason: input.reason },
      requestId: input.requestId
    });
  }
```

> Note the `metadata.reason` above is the internal drift/admin reason string (never a secret — it is a fixed English phrase), consistent with the metadata-only audit invariant.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm vitest run tests/integration/external-modules-repository.test.ts`
Expected: PASS (all 5 cases). RLS admin-gating is exercised by the non-admin rejection case.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @jarv1s/settings typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/settings/src/repository.ts tests/integration/external-modules-repository.test.ts
git commit -m "feat(#917): external-module admin state repo methods + RLS integration tests"
```

### Task 8: config fields + startup discovery + composition wiring

**Files:**

- Modify: `apps/api/src/server.ts` (config fields; `discoverExternalModules`; static `./node` import; thread snapshot into settings deps)
- Modify: `packages/settings/src/routes.ts` (add optional `externalModules` dep + `ExternalModulesDependencies` type — consumed by Task 9)
- Test: `tests/unit/api-server-config.test.ts` (extend) + `tests/unit/external-modules-discovery.test.ts` (new)

**Interfaces:**

- Consumes: `getExternalModuleRegistrations` (Task 5) via the server-only `@jarv1s/module-registry/node` subpath; `CORE_VERSION` from `@jarv1s/module-sdk`; `ExternalModuleLoadResult`/`ExternalModuleDiscovery`/`ExternalModuleRejection` (Tasks 5).
- Produces:
  - `ApiServerConfig` gains `readonly enableExternalModules: boolean; readonly externalModulesDir: string | null`.
  - `function discoverExternalModules(config: ApiServerConfig, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): ExternalModuleLoadResult` (exported for the unit test).
  - `interface ExternalModulesDependencies { enabled: boolean; discoveries: readonly ExternalModuleDiscovery[]; rejected: readonly ExternalModuleRejection[] }` (in `settings/src/routes.ts`; Task 9 route handlers consume it).
  - `SettingsRoutesDependencies` gains `readonly externalModules?: ExternalModulesDependencies`.

> **Why a static import, not dynamic.** `apps/api/src/server.ts` is server-only (never in the browser bundle), so importing the `node:*`-using `/node` subpath directly is safe and keeps `createApiServer` synchronous. The browser-safety invariant only constrains the web bundle.
>
> **Why a startup snapshot.** The trusted-operator mount is read-only and changes only across a redeploy (which restarts the process). Hashing every module on every request would be wasteful, so discovery runs once at boot. A package swapped and then the container restarted is re-hashed at the next boot; the DB still holds the previously-trusted hash, so reconcile (Task 6) sees the drift and auto-disables. Document this restart-to-rescan behavior in the config comment.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/api-server-config.test.ts`:

```ts
describe("resolveApiServerConfig external-module flags (#917)", () => {
  it("enables external modules only when the flag is exactly '1' and a dir is set", () => {
    const config = resolveApiServerConfig({
      JARVIS_ENABLE_EXTERNAL_MODULES: "1",
      JARVIS_MODULES_DIR: "/srv/modules"
    } as NodeJS.ProcessEnv);
    expect(config.enableExternalModules).toBe(true);
    expect(config.externalModulesDir).toBe("/srv/modules");
  });

  it("treats any flag value other than '1' as disabled (fail-closed)", () => {
    for (const value of ["0", "true", "yes", "", undefined]) {
      const config = resolveApiServerConfig({
        JARVIS_ENABLE_EXTERNAL_MODULES: value,
        JARVIS_MODULES_DIR: "/srv/modules"
      } as NodeJS.ProcessEnv);
      expect(config.enableExternalModules).toBe(false);
    }
  });

  it("defaults the modules dir to null when unset", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect(config.externalModulesDir).toBeNull();
  });
});
```

Create `tests/unit/external-modules-discovery.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { discoverExternalModules } from "../../apps/api/src/server.js";

const log = { info: vi.fn(), warn: vi.fn() };

describe("discoverExternalModules (#917)", () => {
  it("returns an empty snapshot when the flag is off, without touching disk", () => {
    const result = discoverExternalModules(
      {
        host: "0.0.0.0",
        port: 3000,
        mcpServerUrl: "http://127.0.0.1:3000/api/mcp",
        enableExternalModules: false,
        externalModulesDir: "/does/not/matter"
      },
      log
    );
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("returns an empty snapshot when enabled but no dir is configured", () => {
    const result = discoverExternalModules(
      {
        host: "0.0.0.0",
        port: 3000,
        mcpServerUrl: "http://127.0.0.1:3000/api/mcp",
        enableExternalModules: true,
        externalModulesDir: null
      },
      log
    );
    expect(result.discoveries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm test:unit -- api-server-config external-modules-discovery`
Expected: FAIL — `enableExternalModules`/`externalModulesDir` undefined; `discoverExternalModules` not exported.

- [ ] **Step 3: Add the config fields**

In `apps/api/src/server.ts`, extend `ApiServerConfig` (currently `apps/api/src/server.ts:89-93`):

```ts
export interface ApiServerConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpServerUrl: string;
  // #917: external (non-compiled) trusted-operator modules. Off unless the flag is
  // exactly "1" AND a read-only mount dir is provided. Fail-closed: any other flag
  // value disables the whole feature.
  readonly enableExternalModules: boolean;
  readonly externalModulesDir: string | null;
}
```

In `resolveApiServerConfig` (currently `apps/api/src/server.ts:104-118`), add before the `return`:

```ts
// #917: the flag must equal exactly "1" — no truthy coercion, so "true"/"0"/"yes"
// all read as OFF. The modules dir is a read-only mount; null when unset.
const enableExternalModules = env.JARVIS_ENABLE_EXTERNAL_MODULES === "1";
const externalModulesDir = env.JARVIS_MODULES_DIR ?? null;
```

and include them in the returned object:

```ts
return {
  host,
  port,
  mcpServerUrl: env.JARVIS_MCP_SERVER_URL ?? `http://127.0.0.1:${port}/api/mcp`,
  enableExternalModules,
  externalModulesDir
};
```

- [ ] **Step 4: Add the static import + discovery helper**

Add to the imports at the top of `apps/api/src/server.ts`:

```ts
// Server-only subpath (#917). Safe here — the api is never browser-bundled — and keeps
// createApiServer synchronous (no dynamic import()).
import { getExternalModuleRegistrations } from "@jarv1s/module-registry/node";
import type {
  ExternalModuleDiscovery,
  ExternalModuleLoadResult,
  ExternalModuleRejection
} from "@jarv1s/module-registry";
import { CORE_VERSION } from "@jarv1s/module-sdk";
```

Add the helper near `resolveApiServerConfig` in `apps/api/src/server.ts`:

```ts
/**
 * Discover external modules ONCE at boot (#917). Fail-closed: an empty snapshot when the
 * feature flag is off or no dir is configured, without reading disk. When on, walks the
 * read-only mount and returns validated discoveries + rejections. Rescan requires a
 * process restart (the mount is read-only and changes only across a redeploy). Logs
 * counts + rejection ids/reasons only — never file contents (secrets-never-escape).
 */
export function discoverExternalModules(
  config: ApiServerConfig,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }
): ExternalModuleLoadResult {
  if (!config.enableExternalModules || !config.externalModulesDir) {
    return { discoveries: [], rejected: [] };
  }
  const snapshot = getExternalModuleRegistrations({
    modulesDir: config.externalModulesDir,
    coreVersion: CORE_VERSION
  });
  log.info(
    { discovered: snapshot.discoveries.length, rejected: snapshot.rejected.length },
    "external modules discovered (#917)"
  );
  for (const rejection of snapshot.rejected) {
    log.warn(
      { moduleId: rejection.id, reason: rejection.reason },
      "external module rejected (#917)"
    );
  }
  return snapshot;
}
```

- [ ] **Step 5: Thread the snapshot into the settings deps**

Immediately before the `registerBuiltInApiRoutes(server, { ... })` call (currently `apps/api/src/server.ts:350`), compute the snapshot:

```ts
// #917: boot-time external-module discovery snapshot, threaded into the settings
// module (admin GET reconciles it against app.external_modules) and the /api/modules
// surface (Task 9). Empty unless the flag is on and a dir is mounted.
const externalModuleSnapshot = discoverExternalModules(apiServerConfig, server.log);
```

Add to the `registerBuiltInApiRoutes(server, { ... })` deps object:

```ts
      externalModules: {
        enabled: apiServerConfig.enableExternalModules,
        discoveries: externalModuleSnapshot.discoveries,
        rejected: externalModuleSnapshot.rejected
      },
```

> Keep `externalModuleSnapshot` in `createApiServer` scope — Task 9 also references it when building the `/api/modules` external-module provider passed to `registerPlatformRoutes`.

- [ ] **Step 6: Declare the dependency in settings routes**

In `packages/settings/src/routes.ts`, add the import (type-only) near the other `@jarv1s/module-registry` imports:

```ts
import type { ExternalModuleDiscovery, ExternalModuleRejection } from "@jarv1s/module-registry";
```

Add the type just above `SettingsRoutesDependencies`:

```ts
/**
 * Boot-time external-module discovery snapshot (#917), injected by the composition root.
 * The admin GET route reconciles `discoveries` against app.external_modules; `rejected`
 * is surfaced read-only so admins can see why a mounted dir did not load. Absent/`enabled:
 * false` ⇒ the external-module admin surface reports the feature off.
 */
export interface ExternalModulesDependencies {
  readonly enabled: boolean;
  readonly discoveries: readonly ExternalModuleDiscovery[];
  readonly rejected: readonly ExternalModuleRejection[];
}
```

Add the field to `SettingsRoutesDependencies` (near `repository?`):

```ts
  /** #917 external-module discovery snapshot; routes added in Task 9 consume it. */
  readonly externalModules?: ExternalModulesDependencies;
```

- [ ] **Step 7: Run the unit tests to confirm they pass**

Run: `pnpm test:unit -- api-server-config external-modules-discovery`
Expected: PASS.

- [ ] **Step 8: Typecheck the touched packages**

Run: `pnpm --filter @jarv1s/api typecheck && pnpm --filter @jarv1s/settings typecheck`
Expected: PASS (the new `externalModules` dep is optional, so no call site breaks).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/server.ts packages/settings/src/routes.ts tests/unit/api-server-config.test.ts tests/unit/external-modules-discovery.test.ts
git commit -m "feat(#917): external-module config flags + boot-time discovery snapshot wiring"
```

### Task 9: shared DTOs + admin routes + `/api/modules` `external` field + web client

**Files:**

- Modify: `packages/shared/src/platform-api.ts` (DTOs, schemas, `external` on `ModuleDto`/`moduleSchema`)
- Modify: `apps/api/src/server.ts` (`serializeModule` gains `external:false`; `serializeExternalModule`; `registerPlatformRoutes` provider; build the provider closure)
- Modify: `packages/settings/src/routes.ts` (GET/POST `/api/admin/external-modules`)
- Modify: `packages/settings/src/manifest.ts` (declare the two routes for RBAC)
- Modify: `packages/module-registry/src/route-guard.ts` (allowlist the two routes)
- Modify: `apps/web/src/api/client.ts` + `apps/web/src/api/query-keys.ts`
- Test: `tests/integration/external-modules-routes.test.ts` (admin GET/POST via `app.inject`)

**Interfaces:**

- Consumes: `reconcileExternalModules`, `ReconciledExternalModule`, `DRIFT_DISABLED_REASON` (Task 6); repo methods (Task 7); `ExternalModulesDependencies` (Task 8); `assertAdminUser`, `HttpError`, `handleRouteError`, `requireRequestId` (existing in `settings/src/routes.ts`).
- Produces (`platform-api.ts`):
  - `interface ExternalModuleDto { id: string; name: string; version: string; publisher: string; status: "discovered" | "enabled" | "disabled"; active: boolean; drifted: boolean; disabledReason: string | null }`
  - `interface ExternalModuleRejectionDto { id: string; reason: string }`
  - `interface ListExternalModulesResponse { enabled: boolean; modules: readonly ExternalModuleDto[]; rejected: readonly ExternalModuleRejectionDto[] }`
  - `interface SetExternalModuleEnablementRequest { enabled: boolean }`
  - `const listExternalModulesRouteSchema`, `const setExternalModuleEnablementRouteSchema`
  - `ModuleDto` gains optional `readonly external?: boolean`.

> **Why `external` is optional, not required.** Declaring it in `moduleSchema.properties` defeats the fast-json-stringify strip trap (undeclared fields are silently dropped — see the `[fast-json-stringify schema strip]` memory). Leaving it OUT of `required[]` means the many existing built-in `ModuleDto` producers and the e2e `mock-modules.ts` fixtures need no edit. Built-ins still emit `external: false` explicitly via `serializeModule`.

#### Part A — shared contracts

- [ ] **Step 1: Add `external` to `ModuleDto` + `moduleSchema`**

In `packages/shared/src/platform-api.ts`, add to the `ModuleDto` interface (after `settings`):

```ts
  /** #917: true for active external (non-compiled) modules. Absent/false for built-ins. */
  readonly external?: boolean;
```

Add to `moduleSchema.properties` (do NOT add to `required`):

```ts
    external: { type: "boolean" },
```

- [ ] **Step 2: Add the external-module DTOs + schemas**

Append to `packages/shared/src/platform-api.ts` (near the other module schemas):

```ts
export interface ExternalModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly status: "discovered" | "enabled" | "disabled";
  readonly active: boolean;
  readonly drifted: boolean;
  readonly disabledReason: string | null;
}

export interface ExternalModuleRejectionDto {
  readonly id: string;
  readonly reason: string;
}

export interface ListExternalModulesResponse {
  readonly enabled: boolean;
  readonly modules: readonly ExternalModuleDto[];
  readonly rejected: readonly ExternalModuleRejectionDto[];
}

export interface SetExternalModuleEnablementRequest {
  readonly enabled: boolean;
}

const externalModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "version", "publisher", "status", "active", "drifted", "disabledReason"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    publisher: { type: "string" },
    status: { type: "string", enum: ["discovered", "enabled", "disabled"] },
    active: { type: "boolean" },
    drifted: { type: "boolean" },
    disabledReason: { type: ["string", "null"] }
  }
} as const;

const externalModuleRejectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "reason"],
  properties: { id: { type: "string" }, reason: { type: "string" } }
} as const;

export const listExternalModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "modules", "rejected"],
      properties: {
        enabled: { type: "boolean" },
        modules: { type: "array", items: externalModuleSchema },
        rejected: { type: "array", items: externalModuleRejectionSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const setExternalModuleEnablementRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["enabled"],
    properties: { enabled: { type: "boolean" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["module"],
      properties: { module: { ...externalModuleSchema } }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema
  }
} as const;
```

#### Part B — settings admin routes

- [ ] **Step 3: Add imports to `settings/src/routes.ts`**

```ts
import {
  listExternalModulesRouteSchema,
  setExternalModuleEnablementRouteSchema,
  type ExternalModuleDto
} from "@jarv1s/shared";
import { reconcileExternalModules, DRIFT_DISABLED_REASON } from "@jarv1s/module-registry";
import type { ReconciledExternalModule } from "@jarv1s/module-registry";
```

- [ ] **Step 4: Add a DTO mapper + the two routes**

Add a small mapper near the other module helpers in `packages/settings/src/routes.ts`:

```ts
// Reconcile output → wire DTO (#917). Pure field copy; no secrets (metadata only).
function toExternalModuleDto(m: ReconciledExternalModule): ExternalModuleDto {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    publisher: m.publisher,
    status: m.status,
    active: m.active,
    drifted: m.drifted,
    disabledReason: m.disabledReason
  };
}
```

Add the routes inside `registerSettingsRoutes` (next to the `/api/admin/modules` routes):

```ts
// #917: list discovered external modules with reconciled activation state. Admin-only.
// This is the ONE path that PERSISTS drift auto-disables — it runs in an admin RLS
// context, so autoDisableExternalModule's UPDATE passes current_actor_is_admin().
server.get(
  "/api/admin/external-modules",
  { schema: listExternalModulesRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const ext = dependencies.externalModules;
      const body = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          if (!ext || !ext.enabled) {
            // Feature off: still admin-gated, just an empty read-only surface.
            return { enabled: false, modules: [] as ExternalModuleDto[], rejected: [] };
          }
          const states = await repository.listExternalModuleStates(scopedDb);
          const { modules, driftDisable } = reconcileExternalModules(ext.discoveries, states);
          // Persist any drift auto-disables discovered this read (admin context only).
          for (const d of driftDisable) {
            await repository.autoDisableExternalModule(scopedDb, {
              id: d.id,
              reason: d.reason,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
          return {
            enabled: true,
            modules: modules.map(toExternalModuleDto),
            rejected: ext.rejected.map((r) => ({ id: r.id, reason: r.reason }))
          };
        }
      );
      return body;
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

// #917: admin enable/disable of a single external module. Enable captures the CURRENT
// on-disk hashes as the trusted baseline; disable pins it off. 404 if the id is not a
// current on-disk discovery; 409 if the feature is off.
server.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
  "/api/admin/external-modules/:id",
  { schema: setExternalModuleEnablementRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const ext = dependencies.externalModules;
      const enable = request.body.enabled;
      const dto = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          // Authorize FIRST (same non-leak discipline as /api/admin/modules).
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          if (!ext || !ext.enabled) {
            throw new HttpError(409, "External modules are not enabled on this instance");
          }
          const discovery = ext.discoveries.find((d) => d.id === request.params.id);
          if (!discovery) throw new HttpError(404, "External module not found");

          if (enable) {
            await repository.setExternalModuleEnabled(scopedDb, {
              id: discovery.id,
              manifestHash: discovery.manifestHash,
              packageHash: discovery.packageHash,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          } else {
            await repository.setExternalModuleDisabled(scopedDb, {
              id: discovery.id,
              reason: "disabled by admin",
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }

          // Recompute this module's reconciled DTO from fresh state.
          const states = await repository.listExternalModuleStates(scopedDb);
          const { modules } = reconcileExternalModules(ext.discoveries, states);
          const updated = modules.find((m) => m.id === discovery.id);
          if (!updated) throw new HttpError(404, "External module not found");
          return toExternalModuleDto(updated);
        }
      );
      return { module: dto };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

> `HttpError`, `handleRouteError`, `requireRequestId`, and `assertAdminUser` already exist in this file (used by the `/api/admin/modules` routes above). Reuse them — do not redefine.

- [ ] **Step 5: Declare the routes for RBAC + enablement allowlist**

In `packages/settings/src/manifest.ts`, add after the `/api/admin/modules/:id` entry:

```ts
    {
      method: "GET",
      path: "/api/admin/external-modules",
      permissionId: "settings.manage"
    },
    {
      method: "POST",
      path: "/api/admin/external-modules/:id",
      permissionId: "settings.manage"
    },
```

In `packages/module-registry/src/route-guard.ts`, add to `PLATFORM_UNGUARDED_ROUTES` after the `/api/me/modules/:id` line:

```ts
  // #917 external-module admin surface (settings-owned; settings is required/always-on).
  routeKey("GET", "/api/admin/external-modules"),
  routeKey("POST", "/api/admin/external-modules/:id"),
```

#### Part C — `/api/modules` surfacing (active external modules)

- [ ] **Step 6: Extend `registerPlatformRoutes` + serializers in `apps/api/src/server.ts`**

Add imports:

```ts
import { reconcileExternalModules } from "@jarv1s/module-registry";
import type { ReconciledExternalModule } from "@jarv1s/module-registry";
import { SettingsRepository } from "@jarv1s/settings";
import type { AccessContext } from "@jarv1s/db";
```

Set `external: false` in `serializeModule` (currently `apps/api/src/server.ts:712`) return object:

```ts
    settings: (module.settings ?? []).map((surface) => ({
      id: surface.id,
      label: surface.label,
      path: surface.path,
      scope: surface.scope,
      order: surface.order ?? null
    })),
    external: false
```

Add an external serializer near `serializeModule`:

```ts
// #917: an ACTIVE external module surfaces on /api/modules as metadata only — no
// navigation, no settings surfaces (Slice 1 modules declare none). external:true lets
// the shell tag it without loading any of its code.
function serializeExternalModule(m: ReconciledExternalModule): ModuleDto {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    lifecycle: "optional",
    navigation: [],
    settings: [],
    external: true
  };
}
```

Change `registerPlatformRoutes` to accept an optional provider and merge active external modules:

```ts
function registerPlatformRoutes(
  server: FastifyInstance,
  authRuntime: JarvisAuthRuntime,
  getActiveExternalModules?: (
    accessContext: AccessContext
  ) => Promise<readonly ReconciledExternalModule[]>
): void {
  server.get("/api/modules", { schema: listModulesRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await authRuntime.resolveAccessContext(request);
      const builtIns = getBuiltInModuleManifests().map(serializeModule);
      // Append ACTIVE external modules (fail-closed: [] when the feature is off or the
      // provider is absent). reconcile already filtered to active === true.
      const external = getActiveExternalModules
        ? (await getActiveExternalModules(accessContext)).map(serializeExternalModule)
        : [];
      return { modules: [...builtIns, ...external] };
    } catch (error) {
      const code =
        (error instanceof Error && (error as Error & { code?: string }).code) || undefined;
      if (code === "account_pending_approval" || code === "account_deactivated") {
        return reply.code(403).send({ error: (error as Error).message, code });
      }
      return reply.code(401).send({ error: "Session is missing or expired" });
    }
  });
}
```

> Note the handler now resolves `accessContext` into a variable (the original discarded the return). The provider runs the actor's own data context, so `/api/modules` reflects only what reconcile marks active.

- [ ] **Step 7: Build the provider closure + pass it in**

Where `registerPlatformRoutes(server, authRuntime)` is called (currently `apps/api/src/server.ts:263`), replace with:

```ts
// #917: active-external-module provider for /api/modules. Read-only: reconciles the
// boot discovery snapshot against app.external_modules in the ACTOR's context and
// returns only active modules. Never persists drift here (non-admin context) — the
// admin GET path owns persistence. Undefined-safe: empty when the flag is off.
const externalModulesRepository = new SettingsRepository();
const getActiveExternalModules = apiServerConfig.enableExternalModules
  ? async (accessContext: AccessContext): Promise<readonly ReconciledExternalModule[]> => {
      const states = await dataContext.withDataContext(accessContext, (scopedDb) =>
        externalModulesRepository.listExternalModuleStates(scopedDb)
      );
      const { modules } = reconcileExternalModules(externalModuleSnapshot.discoveries, states);
      return modules.filter((m) => m.active);
    }
  : undefined;
registerPlatformRoutes(server, authRuntime, getActiveExternalModules);
```

> `externalModuleSnapshot` and `dataContext` are already in `createApiServer` scope (Task 8 + existing). If `registerPlatformRoutes(server, authRuntime)` sits above the line where `externalModuleSnapshot` is computed, move the snapshot computation (Task 8 Step 5) up so it precedes this call.

#### Part D — web client

- [ ] **Step 8: Add client methods + query key**

In `apps/web/src/api/client.ts`:

```ts
import type { ListExternalModulesResponse, ExternalModuleDto } from "@jarv1s/shared";

/** Admin: list discovered external modules with reconciled activation state (#917). */
export async function listExternalModules(): Promise<ListExternalModulesResponse> {
  return requestJson<ListExternalModulesResponse>("/api/admin/external-modules");
}

/** Admin: enable/disable a single external module (#917). */
export async function setExternalModuleEnabled(
  id: string,
  enabled: boolean
): Promise<{ module: ExternalModuleDto }> {
  return requestJson<{ module: ExternalModuleDto }>(
    `/api/admin/external-modules/${encodeURIComponent(id)}`,
    { method: "POST", body: { enabled } }
  );
}
```

In `apps/web/src/api/query-keys.ts`, the `settings` object is FLAT (keys like `adminModules`, `adminUsers` — there is no nested `settings.admin` sub-object). Add a sibling key next to `adminModules`, following that naming convention:

```ts
    adminExternalModules: ["settings", "admin", "external-modules"] as const,
```

#### Part E — route integration test

- [ ] **Step 9: Write the route test**

Create `tests/integration/external-modules-routes.test.ts`. It boots the real server with the flag ON pointed at a temp modules dir containing one valid module, then drives the admin GET/POST via `app.inject` as an admin session.

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiServer } from "../../apps/api/src/server.js";
import { resetFoundationDatabase, ids, adminAuthHeaders } from "./test-database.js";

let modulesDir: string;
let root: string;
let app: Awaited<ReturnType<typeof createApiServer>>["server"];

beforeAll(async () => {
  await resetFoundationDatabase();
  root = mkdtempSync(join(tmpdir(), "extmod-routes-"));
  modulesDir = join(root, "modules");
  const dir = join(modulesDir, "acme-widgets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "jarvis.module.json"),
    JSON.stringify({
      id: "acme-widgets",
      name: "Acme Widgets",
      version: "0.1.0",
      publisher: "Acme, Inc.",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" }
    })
  );
  const created = createApiServer({
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      enableExternalModules: true,
      externalModulesDir: modulesDir
    }
  });
  app = created.server;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("external-module admin routes (#917)", () => {
  it("lists the discovered module as 'discovered' + inactive before enable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/external-modules",
      headers: await adminAuthHeaders()
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0]).toMatchObject({
      id: "acme-widgets",
      status: "discovered",
      active: false
    });
  });

  it("enables the module, then /api/modules includes it with external:true", async () => {
    const enableRes = await app.inject({
      method: "POST",
      url: "/api/admin/external-modules/acme-widgets",
      headers: await adminAuthHeaders(),
      payload: { enabled: true }
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json().module).toMatchObject({ status: "enabled", active: true });

    const modulesRes = await app.inject({
      method: "GET",
      url: "/api/modules",
      headers: await adminAuthHeaders()
    });
    const listed = modulesRes.json().modules.find((m: { id: string }) => m.id === "acme-widgets");
    expect(listed).toMatchObject({ id: "acme-widgets", external: true });
  });

  it("returns 404 for POST to an unknown external module id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/external-modules/ghost",
      headers: await adminAuthHeaders(),
      payload: { enabled: true }
    });
    expect(res.statusCode).toBe(404);
  });
});
```

> **Auth-header helper:** use whatever the codebase already provides to mint an admin session for `app.inject` (grep `tests/integration/` for the existing pattern — e.g. an `adminAuthHeaders()` / session-cookie helper in `test-database.ts` or a sibling test). If none is exported, follow the closest existing `app.inject`-based admin test (e.g. an admin `/api/admin/users` test) and reuse its session-minting approach verbatim. Do not invent a new auth path.

- [ ] **Step 10: Run + typecheck + commit**

```bash
pnpm --filter @jarv1s/shared typecheck
pnpm --filter @jarv1s/settings typecheck
pnpm --filter @jarv1s/api typecheck
pnpm --filter @jarv1s/web typecheck
pnpm vitest run tests/integration/external-modules-routes.test.ts
git add packages/shared/src/platform-api.ts apps/api/src/server.ts packages/settings/src/routes.ts packages/settings/src/manifest.ts packages/module-registry/src/route-guard.ts apps/web/src/api/client.ts apps/web/src/api/query-keys.ts tests/integration/external-modules-routes.test.ts
git commit -m "feat(#917): external-module admin API + /api/modules surfacing + web client"
```

### Task 10: settings UI (External modules pane) + e2e

**Files:**

- Modify: `apps/web/src/settings/settings-admin-panes.tsx` (`InstanceModulesPane`)
- Test: `tests/e2e/external-modules.spec.ts`
- Modify: `tests/e2e/mock-modules.ts` (add an external-modules mock helper)

**Interfaces:**

- Consumes: `listExternalModules`, `setExternalModuleEnabled` (Task 9 Step 8); `queryKeys.settings.adminExternalModules` (Task 9 Step 8); existing authored primitives `Group`, `Note`, `Switch`/`Toggle`, `Stack` already used by `InstanceModulesPane`.
- Produces: nothing consumed by later tasks (final task).

> **Design discipline (CLAUDE.md).** Reuse the SAME authored primitives `InstanceModulesPane` already uses for built-in modules — do not introduce new card styling, and no curved accent left-border (`[No curved accent left-border]` memory). The trusted-operator warning uses the existing `<Note>` primitive. This is a functional default; Ben annotates the look separately (`[Functionality vs design passes]` memory) — do not ask about visuals.

#### Part A — the pane

- [ ] **Step 1: Read the current `InstanceModulesPane`**

Run: `grep -n "InstanceModulesPane" apps/web/src/settings/settings-admin-panes.tsx`
Read that component and note: the exact `Group`/`Note`/`Switch` imports, the `useQuery`/`useMutation` + `queryClient.invalidateQueries` pattern it uses for built-in modules, and the loading/empty-state primitives. Mirror them exactly.

- [ ] **Step 2: Add the External modules section to `InstanceModulesPane`**

Inside `InstanceModulesPane`, add a second query + a `<Group>` below the built-in modules group. Use the file's existing query/mutation idiom (this is the shape to match — adapt names to the ones already imported in the file):

```tsx
const externalModulesQuery = useQuery({
  queryKey: queryKeys.settings.adminExternalModules,
  queryFn: listExternalModules
});

const setExternalEnabled = useMutation({
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
    setExternalModuleEnabled(id, enabled),
  onSuccess: () => {
    // Refetch both surfaces: enabling changes /api/modules too.
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminExternalModules });
    void queryClient.invalidateQueries({ queryKey: queryKeys.modules });
  }
});

const external = externalModulesQuery.data;
```

Render, after the built-in modules `<Group>`:

```tsx
{
  external?.enabled ? (
    <Group
      title="External modules"
      description="User-authored modules loaded from this instance's modules directory."
    >
      {/* #917: trusted-operator warning — enabling runs third-party code on the box. */}
      <Note tone="warning">
        External modules are not reviewed by Jarvis. Only enable modules you authored or fully trust
        — an enabled module runs with the same access as built-in features.
      </Note>

      {external.modules.length === 0 ? (
        <Note>No external modules are present in the modules directory.</Note>
      ) : (
        <Stack gap="sm">
          {external.modules.map((module) => (
            <div key={module.id} className="jds-setting-row">
              <div>
                <div className="jds-setting-row__label">
                  {module.name} <span className="jds-setting-row__hint">v{module.version}</span>
                </div>
                <div className="jds-setting-row__hint">
                  {module.publisher}
                  {module.drifted
                    ? " · disabled: package changed since it was enabled"
                    : module.disabledReason
                      ? ` · ${module.disabledReason}`
                      : ""}
                </div>
              </div>
              <Switch
                checked={module.status === "enabled"}
                disabled={setExternalEnabled.isPending}
                onCheckedChange={(next) =>
                  setExternalEnabled.mutate({ id: module.id, enabled: next })
                }
                aria-label={`Enable ${module.name}`}
              />
            </div>
          ))}
        </Stack>
      )}
    </Group>
  ) : null;
}
```

> The exact primitive names (`Group` vs `SettingsGroup`, `Switch` vs `Toggle`, `Note` tone prop) MUST match what the file already imports — Step 1's read tells you which. The class names above (`jds-setting-row*`) are illustrative; reuse whatever the built-in module rows already use. Do NOT add new CSS to `tokens.css` for this.

- [ ] **Step 3: Add the imports**

At the top of `apps/web/src/settings/settings-admin-panes.tsx`, add to the existing `@/api/client` import group:

```tsx
import { listExternalModules, setExternalModuleEnabled } from "@/api/client";
```

(`queryKeys` and the primitives are already imported by this file.)

- [ ] **Step 4: Typecheck + build the web app**

Run: `pnpm --filter @jarv1s/web typecheck && pnpm --filter @jarv1s/web build`
Expected: PASS (web has no component unit tests — typecheck + build is the gate; e2e follows).

#### Part B — e2e

- [ ] **Step 5: Add an external-modules mock helper**

Read `tests/e2e/mock-modules.ts` first (`grep -n "export" tests/e2e/mock-modules.ts`). Append a helper that mocks both admin endpoints with in-memory enable/disable, mirroring the file's existing `page.route` style:

```ts
import type { Page } from "@playwright/test";
import type { ListExternalModulesResponse } from "@jarv1s/shared";

// Stateful mock for the #917 external-modules admin surface. Starts with one
// discovered-but-inactive module; POST flips its status so the UI can round-trip.
export async function mockExternalModules(page: Page): Promise<void> {
  const state: ListExternalModulesResponse = {
    enabled: true,
    rejected: [],
    modules: [
      {
        id: "acme-widgets",
        name: "Acme Widgets",
        version: "0.1.0",
        publisher: "Acme, Inc.",
        status: "discovered",
        active: false,
        drifted: false,
        disabledReason: null
      }
    ]
  };

  await page.route("**/api/admin/external-modules", async (route) => {
    await route.fulfill({ json: state });
  });

  await page.route("**/api/admin/external-modules/*", async (route) => {
    const enabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
    const target = state.modules[0];
    const updated = {
      ...target,
      status: enabled ? ("enabled" as const) : ("disabled" as const),
      active: enabled
    };
    state.modules = [updated];
    await route.fulfill({ json: { module: updated } });
  });
}
```

- [ ] **Step 6: Write the e2e spec**

Create `tests/e2e/external-modules.spec.ts`. Model the setup (admin sign-in, `mockApi`, navigation to Instance modules) on the CLOSEST existing admin-settings spec — grep for one first: `grep -rln "Instance modules\|InstanceModules\|admin" tests/e2e`.

```ts
import { test, expect } from "@playwright/test";

import { mockApi } from "./mock-api";
import { mockExternalModules } from "./mock-modules";

test.describe("External modules admin pane (#917)", () => {
  test("admin can see the trusted-operator warning and enable a module", async ({ page }) => {
    // Reuse the existing admin-session mock helper (mockApi seeds an admin user).
    await mockApi(page, { role: "admin" });
    await mockExternalModules(page);

    await page.goto("/settings");
    // Navigate to the Instance modules pane using the app's real nav label.
    await page.getByRole("link", { name: /instance modules/i }).click();

    // Section + trusted-operator warning are present.
    await expect(page.getByText("External modules")).toBeVisible();
    await expect(page.getByText(/only enable modules you authored or fully trust/i)).toBeVisible();

    // Toggle the module on.
    const toggle = page.getByRole("switch", { name: /enable acme widgets/i });
    await expect(toggle).toBeVisible();
    await toggle.click();

    // The mock flips status to enabled; the switch reflects the new checked state.
    await expect(page.getByRole("switch", { name: /enable acme widgets/i })).toBeChecked();
  });
});
```

> The exact `mockApi` signature and the admin-nav label (`Instance modules` vs `Modules`) MUST match what the codebase uses — the grep in Step 6 tells you. Do NOT invent a sign-in flow; every existing settings spec already establishes one.

- [ ] **Step 7: Run the e2e spec**

Run: `pnpm --filter @jarv1s/web test:e2e external-modules`
Expected: PASS. (If the runner needs the built app, run `pnpm --filter @jarv1s/web build` first — match how the other e2e specs are invoked in `package.json`.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx tests/e2e/external-modules.spec.ts tests/e2e/mock-modules.ts
git commit -m "feat(#917): external-modules settings pane + e2e"
```

---

## Self-Review

Run against the spec (`docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md`, §Build slices — Slice 1) and issue #917.

**1. Spec / issue coverage**

| #917 requirement                                                                                               | Task(s)                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read `jarvis.module.json` from `JARVIS_MODULES_DIR` only when `JARVIS_ENABLE_EXTERNAL_MODULES=1` (exact `"1"`) | Task 8 (config parse, exactly-`"1"` fail-closed) + Task 5 (fs loader)                                                                             |
| `app.external_modules` migration in `packages/settings/sql/`                                                   | Task 1 (`0152_external_modules.sql`, RLS ENABLE+FORCE, admin-only writes)                                                                         |
| Validate external package manifests (reject executable/surface fields)                                         | Task 2 (types) + Task 3 (`validateExternalModuleManifest`, FORBIDDEN_FIELDS)                                                                      |
| List discovered modules in `/api/modules` and settings                                                         | Task 9 (`/api/modules` `external:true` for active) + Task 10 (settings pane) + Task 9 admin GET                                                   |
| Inactive unless `status = 'enabled'`                                                                           | Task 6 (reconcile: no-row→discovered/inactive; enabled+hash-match→active)                                                                         |
| Auto-disable on manifest/package hash drift                                                                    | Task 4 (hashing) + Task 6 (drift branch) + Task 9 (admin GET persists via `autoDisableExternalModule`)                                            |
| Trusted-operator warning                                                                                       | Task 10 (`<Note tone="warning">`)                                                                                                                 |
| Server-only loader                                                                                             | Task 4/5 (`@jarv1s/module-registry/node` subpath; pure validate/reconcile/types stay node-free)                                                   |
| No custom UI, credentials, KV, or assistant tool execution this slice                                          | Enforced structurally: metadata-only DTOs, empty `navigation`/`settings`, no worker registrations (documented in Task 8/9); `worker.ts` untouched |

No uncovered requirement found.

**2. Placeholder scan** — grepped the plan for `TODO`/`TBD`/`implement later`/"add appropriate"/"handle edge cases"/"similar to Task": none present. Every code step carries complete code; every "adapt to the existing X" note names the exact grep that resolves it (auth-header helper in Task 9 Step 9; primitive names + nav label in Task 10). These are deliberate "match the existing pattern" hooks, not missing content.

**3. Type consistency** — verified by cross-referencing symbol occurrences across tasks:

- Repository calls in Task 9 match Task 7 signatures exactly: `setExternalModuleEnabled(db, {id, manifestHash, packageHash, actorUserId, requestId})`, `setExternalModuleDisabled`/`autoDisableExternalModule(db, {id, reason, actorUserId, requestId})`.
- `reconcileExternalModules(discoveries, rows) → { modules, driftDisable }`; `driftDisable` elements are `{ id, reason }` (Task 6) — matches the Task 9 `autoDisableExternalModule` loop.
- `ExternalModuleLoadResult { discoveries, rejected }` (Task 5) threads into `dependencies.externalModules { enabled, discoveries, rejected }` (Task 8) and is read as `ext.enabled/ext.discoveries/ext.rejected` (Task 9).
- `ReconciledExternalModule` fields (`id,name,version,publisher,status,active,drifted,disabledReason`) map 1:1 in `toExternalModuleDto` (Task 9) and `ExternalModuleDto`.
- **Fixed during review:** query-keys.ts is flat — `queryKeys.settings.adminExternalModules`, not `queryKeys.settings.admin.externalModules` (the settings key object has no nested `admin` sub-object). Corrected in Tasks 9 and 10.
- Verified real host symbols exist before referencing: `HttpError` (imported in `routes.ts:40`), `handleRouteError`/`requireRequestId`/`assertAdminUser` (routes.ts), `adminModuleParamsSchema`/`errorResponseSchema` (platform-api.ts), `dependencies.dataContext.withDataContext(accessContext, cb)` pattern.

**4. Invariant compliance (CLAUDE.md Hard Invariants)**

- No admin bypass: RLS ENABLE+FORCE on `app.external_modules`; writes gated by `app.current_actor_is_admin()`; SELECT to app+worker roles; no BYPASSRLS (Task 1). Drift auto-disable runs only in an admin RLS context (Task 9 GET).
- DataContextDb only: every repo method takes the scoped `db` from `withDataContext`; no root Kysely (Task 7).
- AccessContext shape untouched (`{actorUserId, requestId}`).
- Secrets never escape: DTOs are pure metadata (id/name/version/publisher/status/hashes never leave the server; only status booleans + reason strings surface). Audit payloads are metadata-only, fixed-English reasons (Task 7).
- Never edit applied migrations: new file `0152_external_modules.sql` in the owning module's `sql/`; foundation.test row appended (Task 1).
- Module isolation: external modules contribute no worker registrations and no cross-module imports; the api reaches settings only through `SettingsRepository`'s public methods.
- Provider-agnostic AI / metadata-only job payloads: N/A this slice (no AI, no jobs enqueued).

---

## Definition of Done

- [ ] `pnpm --filter @jarv1s/module-sdk typecheck` and `@jarv1s/module-registry`, `@jarv1s/settings`, `@jarv1s/shared`, `@jarv1s/api`, `@jarv1s/web` all typecheck.
- [ ] `pnpm test:integration` green, including the appended `foundation.test.ts` row for `0152` and the new `tests/integration/external-modules-repository.test.ts` + `tests/integration/external-modules-routes.test.ts`.
- [ ] `pnpm vitest run tests/unit` green, including `external-loader`, `external-reconcile`, `external-modules-discovery`, and the extended `api-server-config` tests.
- [ ] `pnpm --filter @jarv1s/web test:e2e external-modules` green.
- [ ] `pnpm verify:foundation` green (full local gate: lint + format:check + check:file-size + typecheck + tests).
- [ ] With `JARVIS_ENABLE_EXTERNAL_MODULES` unset, `/api/modules` and the settings pane behave exactly as today (external surface absent) — fail-closed default confirmed.
- [ ] Each task committed separately with a `feat(#917): …` message carrying a one-line user-facing summary.

**User-facing summary (for the squash/PR body):** Jarvis can now discover user-authored "external" modules from a trusted directory on the box and let an admin turn each one on or off from Settings → Instance modules — off by default, with a clear "only enable modules you trust" warning, and automatic disabling if a module's files change after it was enabled. This slice surfaces and gates modules only; external modules don't yet contribute any UI, background jobs, or assistant tools.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-open-module-system-slice1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (1→10 in order; they build on each other), review between tasks, fast iteration. Best here because the tasks are already ordered by dependency and each ends in an independently testable deliverable.

**2. Inline Execution** — execute the tasks in this session with `superpowers:executing-plans`, batching with checkpoints for review.

**Which approach?**
