# Module runtime write seams — worker credential write + declared instance-KV write policy

**Status:** Approved (Ben, in-session 2026-07-18, as FIN-00 of the finance-module epic — approach A)
**Grounded on:** `origin/main` @ `bbe6558f`, verified current before authoring
**Depends on:** #818 (open module system) Slices 2–3 as shipped; #932 worker capabilities as shipped
**Consumed by:** the finance external module (see `2026-07-18-finance-module-design.md`)

## Problem

Two host-enforced gaps block any external module whose external source mints credentials at
runtime (OAuth-style token exchange) or whose users share data across the instance:

1. **`ctx.auth` is read-only.** `auth.getCredential` exists
   (`packages/module-registry/src/external/worker-rpc-host.ts`), but the only writers are the
   human-driven settings routes (`packages/settings/src/routes-module-credentials.ts`): admin PUT
   for instance scope, owner PUT for user scope. A worker that completes a Plaid
   `public_token → access_token` exchange has no sanctioned place to store the token. KV is
   explicitly not for secrets (open-module-system spec §5).
2. **Instance-KV writes are admin-gated unconditionally.** `worker-rpc-host.ts` rejects
   `kv.set`/`kv.delete` on instance scope unless `isActorAdmin()` — correct as a default, but it
   makes any "shared across users of this instance" module feature impossible for non-admin
   actors (user-scoped schedules run as the scheduling user).

## Goals

- Workers can write **user-scoped, manifest-declared** credential slots via a new
  `auth.setCredential` RPC.
- A module can declare, per instance-scoped KV namespace, that module handlers may write it
  regardless of the acting user's admin status.
- Both seams stay fail-closed, audited, and within the existing trusted-operator security model.

## Non-goals

- Instance-scope credential writes from workers (admin settings routes remain the only writer).
- Dynamic/wildcard credential slot ids (a slot holds one string; modules needing per-item tokens
  store a JSON map inside one declared slot — see the finance design for the worked example).
- Any change to the browser-facing web contract, the settings UI, or credential _deletion_ from
  workers (revocation stays human-driven via existing routes).
- Cross-user reads of user-scoped KV (sharing goes through instance-scoped namespaces only).

## Design

### D1. `auth.setCredential` worker RPC

`packages/module-sdk/src/worker.ts` — extend the context:

```ts
readonly auth: {
  getCredential(authId: string): Promise<string>;
  setCredential(authId: string, value: string): Promise<void>;
};
```

Child side sends `auth.setCredential { authId, value }` over the existing JSON-RPC transport.

Host side (`createExternalModuleRpcHandler` in `worker-rpc-host.ts`), mirroring the
`auth.getCredential` branch:

- `authId` must be a **declared** `ModuleAuthDeclaration` of this module, else
  `undeclared_auth` (existing error id).
- `declaration.scope` must be `"user"`, else new typed error `forbidden_instance_credential_write`.
- `input.toolRisk === "read"` → `forbidden_credential_write` (same posture as
  `forbidden_kv_mutation`: read-risk tools cannot mutate).
- `value` must be a non-empty string ≤ **32 KiB** UTF-8, else `credential_value_invalid`.
  (Cap chosen to hold a JSON map of a few hundred provider tokens with headroom; single API
  keys are a few hundred bytes.)
- Write path reuses `upsertModuleCredential`
  (`packages/settings/src/repository-module-credentials.ts`) with
  `ownerUserId = input.actorUserId` and the existing AES-256-GCM cipher
  (`input.cipher.encryptJson({ value })` — same envelope shape `readModuleCredentialSecret`
  decrypts today). No new table, no schema change: `app.module_credentials` rows written by
  workers are indistinguishable from owner-PUT rows, so export/delete lifecycle and the
  metadata-only list APIs are unchanged.
- **Redaction:** the written value is immediately added to the invocation's `resolvedSecrets`
  set (same as `getCredential`'s `rememberSecret`) so the D6 composition guard rejects any
  subsequent `ctx.ai` / `ctx.fetch` input containing it, and stdout/stderr best-effort
  redaction covers it.
- **Audit:** `upsertModuleCredential` already requires an `ExternalModuleAuditWriter`; the host
  satisfies it with the sanctioned cross-module `recordAuditEvent` API
  (`packages/settings/src/repository.ts`, the path wellness's worker export job already uses),
  bound to the invocation's scoped db — no new dep threads through the two RPC call sites. One
  metadata-only event per successful set (`action: "module.credential.worker-set"`: moduleId,
  authId, scope — never the value). `jarvis_worker_runtime` already holds
  `admin_audit_events` INSERT (migration 0136).
- **Migration (one, additive):** `jarvis_worker_runtime` currently holds only SELECT on
  `app.module_credentials` (migration 0157). A new settings-owned migration grants
  INSERT + UPDATE to `jarvis_worker_runtime` with RLS policies restricted to
  `scope = 'user' AND owner_user_id = app.current_actor_user_id()` plus the existing
  module-binding predicate (`module_id = app.current_module_id()`, module enabled) — DB-level
  defense in depth mirroring the app-level user-scope-only rule above. Instance-scope
  credential writes remain impossible for the worker role at the database itself.

Concurrency: last-writer-wins at the row level, same as the owner PUT route today. Modules that
store JSON maps must serialize their own read-modify-write (the finance module runs per-user
syncs on a single per-user queue, which serializes naturally); the spec makes this an explicit
authoring rule in the module developer guide.

### D2. Declared instance-KV write policy

`ModuleStorageDeclaration` (`packages/module-sdk/src/index.ts`) gains one optional field:

```ts
export interface ModuleStorageDeclaration {
  readonly namespace: string;
  readonly scopes: readonly ("instance" | "user")[];
  /** Who may write instance-scoped rows from module handlers. Default "admin". */
  readonly instanceWritePolicy?: "admin" | "module";
}
```

- `validate.ts` (`packages/module-registry/src/external/validate.ts`) accepts the field only
  when `scopes` includes `"instance"`; any other placement rejects the manifest (fail-closed,
  consistent with existing manifest validation).
- `worker-rpc-host.ts` replaces the unconditional admin check with: policy `"module"` → allow;
  policy `"admin"` (or absent) → existing `isActorAdmin()` gate. Reads are unchanged (instance
  reads were already open to module handlers). `toolRisk === "read"` still blocks all mutation.
- Security posture: enabling a module is an explicit admin action on a reviewed manifest;
  `instanceWritePolicy: "module"` is part of what the admin approves. The manifest hash pin
  (existing) means the policy cannot drift post-enable. Surfacing the flag in the admin enable
  UI is deliberately deferred (the enable surface today already shows the raw manifest).

### D3. Contract versioning

Both changes are **additive**: old workers never call `auth.setCredential`; old manifests omit
`instanceWritePolicy` and keep today's behavior exactly. `MODULE_WORKER_CONTRACT_VERSION` stays
at 1 (the contract version gates message _shape_, not method vocabulary; unknown methods already
fail closed with `invalid_rpc` on old hosts, and a module declaring a minimum host via
`compatibility.jarv1s` is the existing mechanism for requiring the seam).

## Testing

- Unit (`tests/unit/`): host handler cases — undeclared authId, instance-scope declaration,
  read-risk tool, oversize value, happy path persists via repository + lands in
  `resolvedSecrets`; manifest validation accept/reject matrix for `instanceWritePolicy`;
  non-admin instance `kv.set` allowed under `"module"`, still rejected under default.
- Integration (`tests/integration/`): end-to-end worker invocation writes a user-scoped
  credential and reads it back in a second invocation; composition guard rejects a prompt
  containing the just-written value; audit row asserted metadata-only. Follows the
  `external-module-job-search` fixture-module pattern.

## Rollout

One PR with one additive migration (worker-role grants/policies on `app.module_credentials`
only — no schema change; `foundation.test.ts`'s full migration list gains the new row). Module
developer guide gains a "runtime credential write" subsection with the JSON-map-slot pattern
and the serialize-your-own-RMW rule.
