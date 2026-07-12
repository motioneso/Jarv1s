# Open module system — user-authored modules

**Status:** Approved — RFA after Opus + Fable adversarial review fixes and Ben approval  
**Date:** 2026-07-08  
**Owner:** Ben  
**GitHub:** #818  
**Grounded on:** `origin/main` @ `5f7784a7d687`, with `codebase-memory-mcp` fast index refreshed
during spec authoring. Builds on module enablement, module web registry, dataset connector SDK, and
data-lifecycle ports.

---

## Goal

Let an operator install a module that is not compiled into the Jarv1s repo. A local module package
declares its manifest, runtime web/settings bundle, assistant tools, permissions, credential shape,
and platform-owned state needs. Jarv1s validates the manifest and keeps the module inactive until an
admin enables it. Enabled modules can contribute UI, use a small platform KV store, receive declared
credentials in trusted backend handlers, and route assistant tools through the existing
confirm/audit gateway.

This is **trusted-operator mode**, not a marketplace sandbox. Operators review local module code
outside the app before installing it. Jarv1s provides guardrails around activation, RLS, credentials,
state, and gateway routing; it does not claim OS/container sandboxing, package signing, network
egress enforcement, or in-app code review in v1.

## Current state

Jarv1s already has the first-party module substrate this feature must reuse:

- `JarvisModuleManifest` in `packages/module-sdk/src/index.ts` declares availability, routes, jobs,
  permissions, settings, notifications, assistant tools, external sources, and data lifecycle.
- `getBuiltInModuleManifests()` returns the static `BUILT_IN_MODULES` list from
  `packages/module-registry/src/index.ts`.
- `createActiveModulesResolver()` filters active modules using instance/user disable rows in
  `app.module_enablement`.
- The assistant gateway resolves executable tools from active manifests and records pending
  `app.ai_assistant_action_requests` for confirm-gated actions.
- The web registry work already defines the "module contributes UI without shared web edits" shape
  for first-party modules.

What does not exist: a runtime loader for packages outside `BUILT_IN_MODULES`, fail-closed
activation for discovered external modules, runtime web asset loading from a mounted modules
directory, encrypted module credentials, module-owned KV state, or a backend worker contract for
out-of-process tool handlers.

## Decisions

External modules are trusted local package directories. Support is off unless
`JARVIS_ENABLE_EXTERNAL_MODULES=1` is set.

The host operator mounts a modules directory into the container:

```txt
JARVIS_MODULES_DIR=/var/lib/jarv1s/modules
```

Recommended compose shape:

```yaml
services:
  jarv1s:
    volumes:
      - ./modules:/var/lib/jarv1s/modules:ro
```

Modules are read from that directory only. Jarv1s never runs `npm install`, `pnpm install`, package
postinstall scripts, git commands, or arbitrary shell commands for a module. A module package must
ship prebuilt, self-contained assets:

```txt
modules/<module-id>/
  package.json
  jarvis.module.json
  dist/worker.js
  dist/web/index.js
```

- `dist/worker.js` is one pre-bundled Node ESM file with dependencies vendored. It must not resolve
  against Jarv1s repo-relative paths or the app image's `node_modules`.
- `dist/web/index.js` is a prebuilt browser ESM bundle. It runs in the Jarv1s web app context, not
  an iframe sandbox.
- The worker runs under the Node version shipped by the Jarv1s image; the module manifest declares a
  compatible worker contract version.
- Module packages are mounted read-only by default. Persistent module state goes through
  `app.module_kv`, not writes to the package directory.

Local-directory install is the only v1 acquisition path. No package upload through the web UI, remote
registry, npm install button, marketplace, git sync, hot reload, AI workflow builder, or credential
pre-injection. Those remain follow-up scope (#827 / future marketplace work).

Trusted-mode warning copy for Admin -> Modules -> External modules:

```txt
External modules are enabled in trusted-operator mode.

Modules installed from local directories run code on this Jarv1s host and may include web UI that
runs in the Jarv1s app. Jarv1s validates the manifest and routes assistant tool calls through the
normal approval/audit path, but this is not a marketplace sandbox. Only install modules you trust.
```

## Architecture

### 1. External package manifest

Add a JSON-compatible external package schema in `@jarv1s/module-sdk`:

```ts
export interface ExternalJarvisModulePackage {
  readonly schemaVersion: 1;
  readonly manifest: JsonJarvisModuleManifest;
  readonly runtime: {
    readonly workerEntrypoint: string; // e.g. "dist/worker.js"
    readonly workerContractVersion: 1;
  };
  readonly web?: {
    readonly entrypoint: string; // e.g. "dist/web/index.js"
    readonly contractVersion: 1;
  };
  readonly auth?: readonly ModuleAuthDeclaration[];
  readonly storage?: readonly ModuleStorageDeclaration[];
  readonly review?: {
    readonly expectedHosts?: readonly string[]; // review-only in v1, not enforced
  };
}
```

`JsonJarvisModuleManifest` mirrors `JarvisModuleManifest` but removes executable function fields.
Any contribution that needs code references a handler id.

```json
{
  "assistantTools": [
    {
      "name": "acme.weather.lookup",
      "risk": "read",
      "permissionId": "acme.weather.lookup",
      "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } },
      "handler": "lookup"
    }
  ]
}
```

Loader rules:

- External module ids, tool names, permission ids, auth ids, and KV namespaces must be prefixed with
  the module id (for example `acme.weather.lookup`). This prevents masquerading as first-party tools
  such as `notes.read`.
- Reject duplicate module ids, routes, permissions, tool names, source ids, auth ids, storage
  namespaces, and lifecycle tables.
- Reject `database.ownedTables` and external SQL migrations in v1.
- Ignore any built-in `availability.defaultEnabled` vocabulary for external activation; external
  activation is controlled only by `app.external_modules.status`.
- Reject path traversal, absolute paths, symlinks escaping the module directory, and non-JSON
  manifest constructs.
- Record a manifest hash and package hash when an admin enables a module. The package hash covers
  `jarvis.module.json`, `dist/worker.js`, and `dist/web/**` when present. On startup or tool/UI load,
  hash drift auto-disables the module with `disabled_reason = 'package changed since enable'`.

Copying a folder into the modules directory never exposes routes, UI, tools, credentials, or
handlers by itself.

### 2. Fail-closed registry composition

External module discovery is fail-closed:

- `JARVIS_ENABLE_EXTERNAL_MODULES` unset -> no external registrations are loaded, regardless of DB
  rows.
- `JARVIS_ENABLE_EXTERNAL_MODULES=1` -> Jarv1s scans `JARVIS_MODULES_DIR` from a server-only loader.
- A discovered module is inactive unless `app.external_modules.status = 'enabled'`.
- Absence of an `app.external_modules` row means inactive.
- Existing instance/user disable rows in `app.module_enablement` still apply on top of external
  enablement. A user may disable a user-toggleable external module for themselves after an admin
  enables it.

`getExternalModuleRegistrations(modulesDir)` must live in a server-only package or subpath, for
example `@jarv1s/module-registry/node`. Browser-reachable module-registry/module-sdk entries must
stay free of `node:*`, `fs`, and path scanning imports.

Composition root shape:

```ts
const moduleRegistrations = [
  ...getBuiltInModuleRegistrations(),
  ...getExternalModuleRegistrations(config.modulesDir)
];
```

The rest of the app continues to consume `readonly JarvisModuleManifest[]` through the existing
active-module resolver, route guard, settings serializers, assistant tool listing, and lifecycle
declarations. The external loader adapts into the existing registry; it is not a second module
system.

### 3. Runtime web/settings UI

V1 includes external web/settings UI in the main Jarv1s app context. Runtime local installs cannot
use Vite build-time imports, so external UI uses a runtime ESM contribution loader:

- Module package ships `dist/web/index.js`.
- API serves enabled module web assets read-only from the mounted module directory:
  `/api/modules/:moduleId/web/*`.
- Serving is path-normalized inside that module's `dist/web`; traversal and symlink escapes return 404.
- Assets return 404 unless external modules are enabled and the module status is `enabled`.
- The shell dynamically imports the module's declared `web.entrypoint`.
- The web bundle declares `react` and `react-dom` as externals. Jarv1s provides an import map or
  equivalent contribution host that pins these to the app's shared React instance.
- `web.contractVersion` must match the host's external web contribution API version.

This is not a browser sandbox. External UI can run code in the Jarv1s web context. The trusted-mode
warning and external review checklist are the v1 control.

### 4. Backend worker contract

External backend handler code runs in a child process:

- spawned per module, lazy on first call, with idle shutdown;
- started with a scrubbed environment allowlist;
- current working directory set to the module directory;
- no secrets in env vars;
- JSON-RPC over stdio;
- protocol carries a version field checked at spawn;
- hard timeout per invocation;
- bounded stdout/stderr capture with best-effort redaction of known credential values before logs;
- invocations are serialized per module process in v1;
- crash returns a typed gateway error and the process is respawned on the next call.

`@jarv1s/module-sdk` exports the worker authoring contract:

```ts
defineModuleWorker({
  handlers: {
    lookup: async (ctx) => {
      const token = await ctx.auth.getCredential("acme.weather.api_key");
      const value = await ctx.kv.get("user", "acme.weather.preferences");
      return { content: [{ type: "text", text: "..." }], value };
    }
  }
});
```

The parent process binds `module_id` from the registered module process, never from worker input.
Handlers receive no `DataContextDb`, Kysely instance, root app DB, VaultContext, root app filesystem
handle, or root environment.

No direct network sandbox is claimed in v1. Backend handlers may make outbound network calls.
Modules may declare expected hosts for operator review, but Jarv1s does not enforce a host allowlist
in v1. A stronger OS/container sandbox and/or enforced outbound host policy is a future marketplace
upgrade path.

### 5. Credentials

External modules declare credential needs:

```ts
interface ModuleAuthDeclaration {
  readonly id: string; // must be module-id-prefixed
  readonly displayName: string;
  readonly kind: "api-key";
  readonly scope: "instance" | "user";
}
```

Credential scope is explicit:

- `scope: "instance"` for shared admin-managed keys, such as a weather API key.
- `scope: "user"` for personal tokens, such as GitHub, Notion, Linear, or Todoist.

Storage uses AES-256-GCM at rest, matching connector/AI credential posture. List APIs return
metadata only: `hasCredential`, labels, scope, timestamps. They never return encrypted or decrypted
secret values.

Runtime access:

- `ctx.auth.getCredential(authId)` validates that `authId` is declared by this module.
- The declaration owns the scope; there is no caller-supplied scope and no cross-scope fallback.
- For `scope: "user"`, resolution is keyed only by the invocation `actorUserId`; a handler cannot
  request another user's credential.
- For `scope: "instance"`, the admin-managed credential is usable by enabled module handlers for
  actors allowed to use the module.
- Missing credentials return typed `credential_missing` errors with no values.

Decryption happens in the trusted parent process. Plaintext crosses only the JSON-RPC boundary to the
trusted backend handler. Decrypted credentials never enter env vars, frontend code, prompts, logs,
pg-boss payloads, web responses, exports, KV, or persistent output. Stdout/stderr redaction is
best-effort against known credential values, not a guarantee; trusted-operator mode is the security
boundary.

### 6. Module KV store

External modules may persist small durable state through a platform KV store instead of creating
tables:

```ts
interface ModuleStorageDeclaration {
  readonly namespace: string; // must be module-id-prefixed
  readonly scopes: readonly ("instance" | "user")[];
}
```

Data model:

- `app.module_kv`: `module_id`, `namespace`, `scope`, nullable `owner_user_id`, `key`, JSON value or
  encrypted blob, `sensitive`, timestamps.
- Unique key: `(module_id, namespace, scope, owner_user_id, key)`.
- Values are plain JSON by default. A write may mark a value `sensitive`, storing it encrypted.
- Secrets belong in module credentials, not KV.

Access rules:

- `ctx.kv.*` validates that `namespace` is declared by this module.
- User-scoped KV is keyed by invocation `actorUserId`.
- Instance-scoped KV reads are available to enabled module handlers.
- Instance-scoped KV writes/deletes require an admin actor. Non-admin invocations get a typed
  `forbidden_instance_kv_write` error.
- Modules access KV only through SDK/RPC helpers. They never receive a DB handle.

KV is for small state, preferences, and cache metadata. Large artifacts and relational data remain
out of scope for external modules in v1.

### 7. Assistant tools and approval

External module assistant tools enter the normal gateway:

- visible only when `JARVIS_ENABLE_EXTERNAL_MODULES=1`, the module is `enabled`, and the module is
  active for the actor after instance/user disable resolution;
- tool names and permission ids are module-id-prefixed;
- `risk: "read" | "write" | "destructive"` uses the existing policy floor;
- write/destructive actions create/resolve `app.ai_assistant_action_requests`;
- every execution is audited through the current action gateway path.

No external module may bypass `AssistantToolGateway`, call another module's internals, or query
another module's tables. Feature code still requests capabilities/tools; it never imports an
external module package.

## Data model

All new SQL belongs to the **settings module**, because settings already owns module enablement and
admin instance configuration. Migrations land as new numbered files in `packages/settings/sql/`,
never in `infra/postgres/migrations/`. Applied migrations are hash-checked and must never be edited.

Slice mapping:

- Slice 1: `app.external_modules`.
- Slice 2: `app.module_credentials` and `app.module_kv`.

Every new migration adds its row to the full-list `toEqual` assertion in `foundation.test.ts`; run
full `test:integration`, not only focused tests.

### Tables and RLS

| Table                    | Classification                                                        | RLS posture                                              | Policies                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.external_modules`   | Instance admin configuration; no private data or secrets              | `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` | SELECT to authenticated app/worker runtime roles so module lists/resolvers can read status; INSERT/UPDATE/DELETE to app runtime only when `app.current_actor_is_admin()`                                                                       |
| `app.module_credentials` | Encrypted secrets; instance or owner-only user credentials            | `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` | User-scope rows owner-only (`owner_user_id = app.current_actor_user_id()`); instance-scope rows admin-writable and execution-readable for enabled module runtime; safe list queries must project metadata only, never encrypted secret columns |
| `app.module_kv`          | Module state; user rows owner-only, instance rows admin/module config | `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` | User-scope rows owner-only; instance-scope reads for enabled module runtime; instance-scope writes/deletes only when `app.current_actor_is_admin()`                                                                                            |

Register these tables in protected-table/data-lifecycle coverage so future audits see them.

### Lifecycle

User-scoped `module_credentials` and `module_kv` participate in account export/delete:

- Account delete purges user-scoped credential rows and user-scoped KV rows.
- Export includes plain, non-sensitive user KV values.
- Export includes metadata only for sensitive KV values and credentials (`moduleId`, `scope`, label,
  `hasValue`, timestamps). Secret material is never exported.
- Instance-scoped credentials and KV are not touched by user deletion.

Uninstall semantics:

- Disabling a module sets `app.external_modules.status = 'disabled'`.
- Removing the module directory makes the module unavailable but does not immediately purge
  credentials/KV.
- Admin purge action deletes external module status, instance credentials, instance KV, and all
  user-scoped rows for that module. This is separate from ordinary disable.

## Build slices

### Slice 1 — local manifest loader + fail-closed activation

- Read `jarvis.module.json` from `JARVIS_MODULES_DIR` only when `JARVIS_ENABLE_EXTERNAL_MODULES=1`.
- Add `app.external_modules` in `packages/settings/sql/`.
- Validate external package manifests, path bounds, id prefixes, duplicate ids, package hash, and
  contract versions.
- List discovered modules in `/api/modules` and settings.
- Keep modules inactive unless `app.external_modules.status = 'enabled'`.
- Auto-disable on manifest/package hash drift.
- Show the trusted-operator warning.
- No custom UI, credentials, KV, or assistant tool execution yet.

### Slice 2 — runtime web/settings UI + credentials + KV

- Serve enabled module web assets from `/api/modules/:moduleId/web/*`.
- Add runtime ESM contribution loader for external web/settings UI.
- Add `app.module_credentials` and generic credential settings UI from manifest declarations.
- Add `app.module_kv`, parent-side repositories, and lifecycle export/delete integration.
- Do not expose module-facing KV/auth RPC helpers until Slice 3.

### Slice 3 — backend assistant tool execution

- Add child-process JSON-RPC runtime and `defineModuleWorker` SDK contract.
- Wire external assistant tool handlers into `AssistantToolGateway`.
- Support read/write/destructive risk tiers through the existing confirm/audit path.
- Pass decrypted declared credentials to trusted backend handlers at execution time.
- Add KV/auth RPC helpers.
- Tests prove a write tool creates a pending action request for confirm-gated users.
- Add tests for metadata-only responses, RLS, revocation, lifecycle purge/export, and log redaction.

## Non-goals

- No marketplace, remote registry, npm install button, or web-initiated package installation.
- No package upload through the web UI in v1.
- No git sync, hot reload, AI workflow builder, or credential pre-injection (#827).
- No external module SQL migrations/tables in v1.
- No in-process third-party backend execution.
- No iframe/browser sandbox; external UI runs in the main app context in trusted-operator mode.
- No in-app code-review screen.
- No enforced outbound host allowlist in v1.
- No package signing in v1.
- No provider/model hardcoding.

## Security and invariants

- **Trusted-operator mode:** external modules are local trusted code, loaded only when
  `JARVIS_ENABLE_EXTERNAL_MODULES=1` is set and activated only when an admin enables the module.
- **Fail closed:** absent DB status row, disabled status, flag off, package hash drift, or validation
  error all mean inactive.
- **No admin private-data bypass:** user-scoped credentials and KV are owner-only; admin power over
  external modules is configuration power, not private user data access.
- **Secrets never escape:** decrypted credentials never enter env vars, logs, job payloads, web
  responses, prompts, frontend code, exports, KV, or persistent output. Backend handler input is the
  one allowed runtime exception in trusted-operator mode.
- **Metadata-only jobs:** if module execution becomes async, payloads carry ids and command params,
  not user content or secrets.
- **Module isolation:** external modules do not get raw DB handles or imports of module internals;
  assistant actions still go through gateway tools.
- **Provider-agnostic AI:** modules declare capabilities/tools, not model/provider choices.
- **Private by default:** discovered external modules are inactive until admin enablement, and
  per-user disable still applies where supported.

## Verification

- Unit: manifest schema validation, id-prefix enforcement, duplicate detection, path traversal and
  symlink escape rejection, package hash stability, package-hash drift auto-disable,
  external+built-in registry merge.
- Unit: external registry loader lives behind a server-only entry; browser bundle safety test proves
  no `node:*`/`fs` import reaches web-bundled entries.
- Integration: newly discovered external module resolves inactive for all actors until admin enable.
- Integration: disabled external module contributes no routes, web assets, settings UI, tools,
  credentials, or handlers.
- Integration: enabled web assets serve only inside module `dist/web`; disabled module assets 404.
- Integration: enabled read tool lists for the actor; write tool goes through pending action request;
  destructive always confirms.
- Security: handler never receives DB handles, root app filesystem paths, unrelated env vars, or
  credentials it did not declare.
- Security: user-scoped credential lookup cannot obtain another user's credential by guessing auth id.
- Security: frontend never receives encrypted or decrypted credentials.
- Lifecycle: account delete purges user-scoped module credentials/KV; export includes plain KV and
  metadata only for sensitive KV/credentials.
- Migration gate: `foundation.test.ts` migration list updated for each new SQL file.
- Existing gate: `pnpm verify:foundation` plus full `test:integration`.

## Approval state

No open product questions remain from the spec interview. The Opus/Fable blocker pass has been folded
in and Ben approved the spec for RFA.

## Revisions

- 2026-07-10 (Slice 1 revision, PR #924): On-disk jarvis.module.json uses a flat metadata-only
  envelope with a single top-level schemaVersion: 1, validated at load. runtime.workerContractVersion
  and optional web.contractVersion validation are deferred to Slices 2-3, where the web-asset and
  worker loaders that consume them first exist; Slice 1 ships no worker execution or web serving, so
  those fields would guard nothing this slice. No narrowing of Slice 1's metadata validation.
