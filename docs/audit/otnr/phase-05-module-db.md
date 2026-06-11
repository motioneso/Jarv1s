## Phase 5 — Module db

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4
- INFO: 3

### Findings

#### [HIGH] `runSqlMigrations` shares one `schema_migrations` table across all directories, keyed only on numeric version — silent cross-directory collisions
**File:** `packages/db/src/migrations/sql-runner.ts:34-96` (caller `scripts/migrate.ts:17-31`)  
**Invariant violated / concern:** "Never edit applied migrations" (hash-check integrity) + non-atomic / structurally-unsound migration tracking.  
**Detail:** `scripts/migrate.ts` calls `runSqlMigrations` once for `infra/postgres/migrations` and once per module `sql/` directory, all with the default `migrationsSchema="app"` / `migrationsTable="schema_migrations"`. The applied-set is keyed on `version` = the filename's numeric prefix only (`fileName.split("_", 1)`), which is the PRIMARY KEY. The whole "never edit an applied migration" guarantee therefore depends entirely on the human convention that prefixes are globally unique across ~10 independent directories. If two different files in two directories ever share a prefix (e.g. both ship `0050_*.sql`), the runner does **not** detect a duplicate-version-different-name condition: whichever runs second hits the checksum branch and either (a) throws the misleading `"Migration X has changed after being applied"` for a file that was never applied, or (b) if contents happen to match, is silently `skipped` and **never executed**. There is no guard that the `name` recorded for a `version` matches the file currently presenting that version. The hash-check protects content-stability of a version but not version-identity across directories.  
**Suggested fix:** Make the applied-set identity directory-aware: either include the file `name` (or a directory key) in the primary key / uniqueness check, or assert that an existing row's `name` equals the incoming file's `name` before treating a matching checksum as "already applied" (and raise a distinct, accurate error when a version is reused by a different file). At minimum, fail loudly on `version` reuse-with-different-name instead of emitting the "has changed" message.

#### [MED] `unsafeSelectVisibleProbeIdsForTest` is a production-bundled RLS-bypass-ish read on the root (non-data-context) Kysely
**File:** `packages/db/src/data-context.ts:41-49`  
**Invariant violated / concern:** "DataContextDb only" — repositories/queries must go through the branded scoped handle; test-only escape hatches leaking into shipped code.  
**Detail:** `DataContextRunner` ships a public method that runs a raw `selectFrom("app.rls_probe_items")` directly on `this.rootDb` with **no** `withDataContext` wrapper, so no `app.actor_user_id` GUC is set. It is named `…ForTest` and is only ever called from `tests/integration/foundation.test.ts` and the spike, but it is exported as a normal public method on a class used in production (`apps/worker`, API). Its safety relies solely on RLS denying rows when the GUC is unset — exactly the property the test exists to assert — so the method is both the thing under test and shipped, callable, attack surface. Any future caller that invokes it expecting "visible to actor" semantics gets "whatever RLS returns with no actor set."  
**Suggested fix:** Move this probe helper out of the shipped class — into the integration test harness (`tests/integration/test-database.ts`) as a free function taking a root Kysely, or behind a clearly test-only module not re-exported from `index.ts`. The production `DataContextRunner` should expose only `withDataContext`.

#### [MED] `JsonColumn` insert/update types accept bare `string`, weakening the JSON contract on every metadata/secret column
**File:** `packages/db/src/types.ts:9-13` (applied to `encrypted_secret`/`encrypted_credential`, `metadata`, `model_metadata`, `tool_metadata`, `external_metadata`, `value`, etc.)  
**Invariant violated / concern:** Cast-heavy / loose contracts that obscure the real invariant (TS dimension D).  
**Detail:** `JsonColumn = ColumnType<Record<string, unknown>, Record<string, unknown> | string | undefined, …>`. The `| string` insert/update arm lets callers pass an arbitrary unparsed string into any JSON column — including the encrypted-secret envelope columns (`encrypted_secret`, `encrypted_credential`). That defeats the structural guarantee that these columns hold objects, invites accidental double-encoding (storing `"[object Object]"` or a raw JSON string that the read side then re-parses), and makes it impossible for the type system to distinguish "a JSON object" from "a string that should have been an object." The select arm is correctly `Record<string, unknown>`, so the looseness is purely on the write path and is not justified by any pg driver requirement (pg serializes objects to JSON itself).  
**Suggested fix:** Drop the `| string` from the insert/update positions of `JsonColumn` (and `TextArrayColumn` similarly drops the `string` insert arm). If a small number of call sites genuinely need to write pre-serialized JSON, give them an explicit `sql\`...\`::jsonb` cast rather than widening the shared column type for the whole schema.

#### [MED] Migration `BEGIN/COMMIT` driven by string statements rather than a managed transaction, and `runSqlFiles` runs multi-statement SQL with no transaction at all
**File:** `packages/db/src/migrations/sql-runner.ts:70-87` and `98-116`  
**Invariant violated / concern:** Non-atomic multi-step updates that can leave half-applied state.  
**Detail:** `runSqlMigrations` wraps each migration in literal `client.query("BEGIN")` / `"COMMIT"` / `"ROLLBACK"` strings. This works, but if `file.sql` itself contains a `COMMIT`/`BEGIN` (or a statement that implicitly commits, e.g. some DDL paths), the manual transaction bracketing silently desynchronizes and a failure can leave the migration row inserted without the DDL, or vice-versa. Separately, `runSqlFiles` (used for bootstrap **and** the runtime-grants directory, `scripts/migrate.ts:15,34`) executes each file's full contents with **no** transaction wrapper, so a grants file that fails partway leaves a partially-granted role set with no rollback and no record of what applied — a security-relevant half-state for least-privilege roles.  
**Suggested fix:** Use the driver's transaction control or wrap grant files in an explicit `BEGIN/COMMIT` inside `runSqlFiles` too, and document/forbid transaction-control statements inside migration `.sql` bodies (or detect and reject them).

#### [MED] No `setLocal` for the worker/system actor path — actor-id is the only RLS gate and it is set from an untyped string with no format validation
**File:** `packages/db/src/data-context.ts:26-38, 62-68`  
**Invariant violated / concern:** Private-by-default / RLS-applies-to-all-actors depends entirely on `app.actor_user_id`; weak validation of that single load-bearing value.  
**Detail:** The entire RLS posture hinges on `set_config('app.actor_user_id', accessContext.actorUserId, true)`. The only validation is `if (!accessContext.actorUserId)` (falsy check). A caller could pass any non-empty string (e.g. `" "`, a comma-list, a crafted value) and it is injected verbatim into the session GUC; RLS policies then compare it against `owner_user_id` (a uuid). A malformed actor id won't escalate (it simply matches nothing), but it also won't fail fast, so a bug upstream that produces a wrong-but-truthy actor id silently yields a context that sees zero rows or — if it coincides with another user's id — that user's rows. Given this is the single security pivot of the whole module, it deserves a strict uuid-shape assertion.  
**Suggested fix:** Validate `actorUserId` as a uuid (the table key type) before `setLocal`, throwing on malformed input. Cheap, and converts a class of silent-wrong-context bugs into loud failures at the boundary.

#### [LOW] `resolveKeyring` JSON.parse of `keysEnvVar` is untyped, unvalidated, and casts to `Record<string,string>`
**File:** `packages/db/src/keyring.ts:44-52`  
**Invariant violated / concern:** Unsafe cast / missing boundary validation (D, E).  
**Detail:** `JSON.parse(keysJson) as Record<string, string>` trusts the env var's shape. Non-object JSON (`"5"`, `[...]`, `null`), or values that aren't strings, pass the cast and then flow into `createHash(...).update(secret)` where a non-string `secret` throws a cryptic crypto error rather than a clear "JARVIS_*_KEYS is malformed." A retired key with an empty-string secret would also be hashed into a usable decrypt candidate without warning.  
**Suggested fix:** Validate the parsed value is a plain object of string→non-empty-string before building the keyring, with a clear error message naming `keysEnvVar`.

#### [LOW] `legacyCandidates` can contain duplicate buffers and ordering is brittle
**File:** `packages/db/src/keyring.ts:42-57`  
**Invariant violated / concern:** Incidental complexity / subtle correctness around secret rotation.  
**Detail:** `legacyCandidates = [currentKeyBuffer, ...retiredBuffers]`. If the current key id also appears in `keysEnvVar` (a plausible misconfiguration during rotation), its buffer is tried twice. Harmless functionally but indicative that the legacy-decrypt fallback is convention-driven rather than de-duplicated/validated, and the comment-encoded ordering rules are easy to get wrong on the next edit.  
**Suggested fix:** De-duplicate `legacyCandidates` (e.g. dedupe by buffer hex) and assert the current key id is not redundantly listed in the retired-keys map.

#### [LOW] `RlsProbeRepository.getById` silently swallows not-found vs not-visible
**File:** `packages/db/src/probes/rls-probe-repository.ts:12-20`  
**Invariant violated / concern:** Swallowed distinction at a security boundary (E).  
**Detail:** `getById` returns `undefined` both when the row does not exist and when RLS hides it from the actor. For a probe used to *prove* RLS behavior this is fine, but the method is exported as a general repository accessor and the undefined collapse means callers can't distinguish 404 from 403 — a pattern worth not propagating to real owner-or-share resources. Flagging as the canonical example so it isn't copied.  
**Suggested fix:** Keep as-is for the probe, but document that the undefined-collapse is intentional here; ensure real repositories that need 403/404 distinction don't mirror this shape.

#### [LOW] Default credentials baked into `getJarvisDatabaseUrls` connection-string fallbacks
**File:** `packages/db/src/urls.ts:14-30`  
**Invariant violated / concern:** Secrets handling / dev-default leakage into a shipped library (A).  
**Detail:** Every role URL falls back to a hardcoded `role:password@host` string (e.g. `jarvis_app_runtime:app_password`, `postgres:postgres`). These are dev defaults and the env vars override them, but they live in a shipped package with no `NODE_ENV==="production"` guard (unlike `resolveKeyring`, which *does* hard-fail in production). A production deploy that forgets one of the five env vars silently connects with a well-known password instead of failing.  
**Suggested fix:** Mirror the keyring's production guard: in `NODE_ENV==="production"`, require the explicit URL (or at least the password component) and throw rather than substituting a known-weak default.

#### [INFO] `createDatabase` pools are never closed by this module — lifecycle owned externally (reviewed, acceptable)
**File:** `packages/db/src/database.ts:14-26`  
**Invariant violated / concern:** Potential connection-pool leak (reviewed).  
**Detail:** `createDatabase` constructs a `pg.Pool` (`max` default 4) wrapped in Kysely and returns it; nothing in the module calls `.destroy()`/`pool.end()`. This is correct for a factory — process owners (api/worker) own teardown — but there is no leak guard in long-lived test harnesses. No defect; noting that pool disposal is intentionally the caller's responsibility and confirmed not leaked within this package.  
**Suggested fix:** None required; ensure app/worker entrypoints and the integration harness call `db.destroy()` on shutdown (out of scope for this package).

#### [INFO] `AuthSessionResolver` correctly routes through a SECURITY DEFINER function — secret-isolation invariant upheld
**File:** `packages/db/src/auth-session.ts:8-32`  
**Invariant violated / concern:** "Secrets never escape" / auth-account RLS (reviewed clean).  
**Detail:** Resolution selects only `user_id` via `app.resolve_auth_session(...)` (owned by `jarvis_auth_runtime`, migration 0046) so `jarvis_app_runtime` never holds direct SELECT on `auth_sessions`/`auth_accounts`. The `${sessionId}::uuid` parameter is bound via the tagged template (parameterized), not interpolated. Returns only `{ actorUserId, requestId }`, matching the AccessContext shape invariant exactly. No tokens, hashes, or session bodies leave the function. Reviewed and clean.  
**Suggested fix:** None.

#### [INFO] Repositories consistently brand-check via `assertDataContextDb`; raw SQL is parameterized; identifier interpolation is guarded
**File:** `packages/db/src/sharing/shares-repository.ts:25,57,69,80`, `packages/db/src/migrations/sql-runner.ts:173-179`  
**Invariant violated / concern:** DataContextDb-only + SQL-injection (reviewed clean).  
**Detail:** Every `SharesRepository` / `RlsProbeRepository` method opens with `assertDataContextDb(scopedDb)` and operates on `scopedDb.db`, never a root Kysely. The one raw SQL in shares (`app.has_share(...)`) binds all user values as parameters. The migration runner's only string-interpolated identifiers (`schema`, `table`) pass through `quoteIdentifier`, which rejects anything not matching `^[a-zA-Z_][a-zA-Z0-9_]*$`. `setLocal` binds GUC name/value as parameters via `set_config`. No injection vector found in this package.  
**Suggested fix:** None.
