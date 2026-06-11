## Phase 29 — E2E Tests & Operator Scripts

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4
- INFO: 2

### Findings

#### [HIGH] `export:user` silently omits memory + structured-state private content (incomplete data-portability)
**File:** `scripts/export-user-data.ts:33-53,105-131`  
**Invariant violated / concern:** Operator-script completeness / data-portability correctness. The script presents itself as the full "sensitive user export" (`console.log("Wrote sensitive user export…")`), but its `UserDataExportTables` list is hard-coded to 19 tables that exclude every owner-scoped table that holds the user's richest private content.  
**Detail:** The following owner-scoped tables are NOT exported even though they contain first-class user data:
- `app.memory_chunks` — `text TEXT NOT NULL` holds full vault/connector chunk text (`packages/memory/sql/0030_memory_index.sql`), plus the 768-dim embeddings.
- `app.chat_memory_facts` — `content TEXT NOT NULL` holds extracted personal facts (`packages/memory/sql/0041_memory_facts.sql`).
- `app.commitments`, `app.entities`, `app.preferences` — structured-state, all `owner_user_id`-scoped private content (`packages/structured-state/sql/0031_structured_state.sql`).

Because the export is a fixed allowlist with no "did we cover every owner-scoped table?" assertion, new modules (memory, structured-state landed after the M7 export was written) drift out of coverage silently. The release-hardening test (`tests/integration/release-hardening.test.ts:32-83`) only asserts presence of the listed tables and absence of secrets — it never asserts the export is *exhaustive*, so the gap is invisible to CI. A GDPR/subject-access export that omits the user's memory and commitments is materially incomplete.  
**Suggested fix:** Either (a) derive the export table set from a single canonical registry of owner-scoped tables (the same source `delete-user-data` and the RLS audit should share), and add a test that fails when an `owner_user_id` table in `app` is missing from the export; or (b) explicitly document and assert the deliberate exclusions. Add `memory_chunks` (text + provenance, not the raw embedding vector if size is a concern), `chat_memory_facts`, `commitments`, `entities`, `preferences` to the export.

#### [MED] `delete:user` removes DB rows but never deletes on-disk vault data
**File:** `scripts/delete-user-data.ts:28-49,115-117`  
**Invariant violated / concern:** Right-to-erasure completeness. Deletion is `DELETE FROM app.users` relying on FK `ON DELETE CASCADE` (confirmed across module SQL), which correctly removes `memory_chunks`/`chat_memory_facts`/`commitments` rows. But the user's source content on the filesystem — the Obsidian vault that memory chunks are derived from — is never touched, and the script does not even surface that the vault is out of scope.  
**Detail:** `backup-full.sh:91-97` shows the vault is a real, backed-up data store at `JARVIS_VAULT_DIR`. After `delete:user --execute`, the derived `memory_chunks.text` is gone but the original markdown notes (and any per-user vault subtree) remain on disk. In the single-user house model the vault may be shared/global (so blanket deletion would be wrong), which is exactly why this needs an explicit decision rather than silence.  
**Suggested fix:** Document in the script header and `docs/operations/release-hardening.md` that vault content is out of scope for `delete:user` and must be handled separately, OR (if vault is partitioned per user via `VaultContext`) delete the user's vault subtree through `VaultContext` — never raw `fs`. At minimum, print a post-delete reminder that on-disk vault data is not removed.

#### [MED] Chat Approve/Deny e2e tests never verify the decision actually sent
**File:** `tests/e2e/app-shell.spec.ts:249-267,299-308`  
**Invariant violated / concern:** Test quality — assertions verify rendering, not behavior. Both the "Approve" and "Deny" tests register the same `**/api/chat/action-requests/*/resolve` mock that returns `204` unconditionally and never inspects `route.request().postData()`.  
**Detail:** The Approve test clicks "Approve" and asserts the card shows "Resolved."; the Deny test clicks "Deny" and asserts the identical "Resolved." A regression that swapped the decision (sent `deny` on Approve, or sent the wrong `actionRequestId`) would pass both tests. For a confirm-before-act security surface (the MCP blocking-confirm gate), the *decision payload* is the entire point and is exactly what is untested.  
**Suggested fix:** In each test, capture the resolve request and assert the body (e.g. `{ decision: "approve" }` vs `"deny"`) and the path `actionRequestId` match the card the user acted on, before fulfilling `204`.

#### [MED] E2E mock makes auth unconditionally succeed and the user an instance admin
**File:** `tests/e2e/mock-api.ts:49-98`  
**Invariant violated / concern:** Test coverage gap — no e2e exercises real auth-gated behavior. `sign-in/email` and `sign-up/email` always set `authenticated = true` and `/me` returns a hard-coded `isInstanceAdmin: true` owner. No test covers a failed sign-in, an expired/invalid session redirect on a *protected product route* (only `/me` and `/modules` 401), or a non-admin user hitting an admin-only surface (`/api/admin/*` are all mocked to 200 regardless of state).  
**Detail:** Because every flow runs as an instance admin with a guaranteed-valid session, the e2e suite cannot catch a regression that (a) renders admin-only UI to non-admins, or (b) fails to redirect an unauthenticated user away from `/tasks`, `/settings`, etc. The unauthenticated path is only verified at the sign-in screen (`app-shell.spec.ts:12-38`).  
**Suggested fix:** Add at least one spec with `authenticated: false` that navigates directly to a protected route and asserts the sign-in gate appears, and one with `isInstanceAdmin: false` that asserts admin-only settings sections are hidden / return 403 from the mock.

#### [MED] `restore:db` `--clean` runs against the bootstrap (superuser) connection with no environment guard
**File:** `scripts/restore-database.ts:31,40-54,63-77`  
**Invariant violated / concern:** Destructive-operation safety. `createRestorePlan` defaults to `getJarvisDatabaseUrls().bootstrap` and emits `pg_restore --clean --if-exists` (drops existing objects before reload). The only guard is `--confirm-restore`; there is no check of the target DB name or `NODE_ENV`, so a single mistyped/forgotten flag against a production bootstrap URL silently wipes and reloads the live DB.  
**Detail:** Backup (`backup-database.ts`) is read-only so the same lack of guard is benign there, but restore is the irreversible direction. The confirm flag is a good first gate; it is not sufficient on its own for a `--clean` reload of the superuser DB.  
**Suggested fix:** Echo the resolved target host + database name and require the operator to pass it back (e.g. `--confirm-database <name>` matching the URL's dbname), mirroring the `confirmUserId === userId` pattern already used in `delete-user-data.ts:56-58`.

#### [LOW] `rewrap-secrets.ts` casts ciphertext envelopes through `Parameters<…>[0]` instead of validating shape
**File:** `scripts/rewrap-secrets.ts:78-80,107-109,138-140`  
**Invariant violated / concern:** TypeScript — cast obscures the real contract. `row.encrypted_secret as Parameters<typeof connectorCipher.decryptJson>[0]` blind-casts a `jsonb` column (typed `unknown`/`Json`) to the cipher's expected envelope. A malformed/legacy envelope only fails at decrypt time inside the try/catch, where it is counted as `skipped` with a generic message.  
**Detail:** This is a maintenance operator script run with the API stopped, so blast radius is low, but the cast hides whether the failure was "wrong key" vs "not an envelope at all," which matters during a key-rotation incident.  
**Suggested fix:** Have the cipher expose a `parseEnvelope(json: unknown)` (or a Zod schema) that the script calls, so a shape failure is distinguishable from a decrypt failure and the cast disappears.

#### [LOW] `backup:db` / `restore:db` pass `decodeURIComponent(url.password)` via `PGPASSWORD` env without verifying the URL actually carried credentials
**File:** `scripts/backup-database.ts:21-51`, `scripts/restore-database.ts:31-60`  
**Invariant violated / concern:** Error handling at boundary — silent empty-credential path. `new URL(connectionString)` with no userinfo yields `url.username === ""` / `url.password === ""`; the plan is still built with `--username ` (empty) and `PGPASSWORD=""`, which fails opaquely inside `pg_dump`/`pg_restore` rather than with a clear "connection string is missing credentials" error.  
**Detail:** The release-hardening test only exercises a fully-populated URL (`release-hardening.test.ts:300-331`), so the degenerate case is untested. Putting the secret in `PGPASSWORD` (env, not argv) is the correct choice and is asserted — good — this is only about the missing-credential branch.  
**Suggested fix:** Validate `url.username` is non-empty (matching the existing `database` non-empty check) and throw a clear usage error otherwise.

#### [LOW] `smoke:compose` health check accepts any `{ ok: true }` body — does not confirm the migrated app actually answered
**File:** `scripts/smoke-compose.ts:112-133`  
**Invariant violated / concern:** Test meaningfulness — smoke asserts "a server returned ok:true," not "this stack is wired correctly." It never checks that the response came from the migrated API (e.g. DB connectivity, migration version, build/commit), so a `/health` that returns `{ ok: true }` before the DB is reachable would pass the smoke.  
**Detail:** The compose plan does run migrations and start api/web/worker, which is meaningful structurally; the weakness is purely the terminal assertion. A readiness endpoint that pings the DB would make the smoke catch the most common compose breakage (api up, DB unreachable).  
**Suggested fix:** Point the smoke at a readiness endpoint that verifies DB connectivity (or assert a `/health` payload field that is only true post-migration), not a bare `ok` flag.

#### [LOW] `mock-api.ts` is 918 lines — approaching the 1000-line gate with no module-level decomposition
**File:** `tests/e2e/mock-api.ts:1-918`  
**Invariant violated / concern:** File-size discipline (`pnpm check:file-size`, 1000-line cap). The single mock-API file aggregates the entire REST surface (auth, me, modules, admin, connectors, AI providers/models, tasks, notifications, calendar, email) in one file; it is 918 lines and growing one block per feature.  
**Detail:** Briefings and chat were already split out (`mock-briefings-api.ts`, `mock-chat-api.ts`), proving the decomposition pattern exists — the core file just hasn't followed it. The next module's routes will likely push it over the gate.  
**Suggested fix:** Split the remaining domains (connectors, AI, tasks/notifications) into `mock-*-api.ts` siblings registered by `mockApi`, the same way briefings/chat already are.

#### [INFO] Operator-script secret-redaction and RLS scoping are well-covered and pass
**File:** `tests/integration/release-hardening.test.ts:32-109,300-342,394-439`  
**Invariant violated / concern:** None — reviewed and clean. The export runs through the `jarvis_app_runtime` role under a real `DataContextRunner` scope, so RLS (not application logic) excludes another user's shared private rows (`"User B private task granted to A"` asserted absent), and every secret column is projected to a boolean `has*` flag with sentinel-string assertions proving ciphertext/tokens/password hashes never land in the JSON. `delete:user` is confirm-gated, audited with metadata-only payloads (no content/secrets), and dry-run by default. Backup/restore put the password in `PGPASSWORD` (not argv) and assert it never appears in the command string. This is a strong, real-DB test of the secret-never-escapes and private-by-default invariants.  
**Suggested fix:** None.

#### [INFO] `audit:release-hardening` genuinely enforces the RLS/role invariants it claims
**File:** `scripts/audit-release-hardening.ts:262-358`  
**Invariant violated / concern:** None — reviewed and clean. The audit reads `pg_roles` / `pg_class` / `has_table_privilege` directly (not application assumptions) and fails on: any runtime role with superuser/createdb/createrole/`rolbypassrls` (invariant 1, no-BYPASSRLS); protected tables missing `ENABLE`+`FORCE` RLS or holding app/worker `DELETE`; auth-secret tables where `jarvis_app_runtime` retains `SELECT`; and `admin_audit_events` being app-UPDATE/DELETE-able or worker-accessible (append-only audit). The `users` ENABLE-not-FORCE carve-out is explicitly documented and asserted. The set of audited tables is a hard-coded allowlist (same drift risk noted for the export in the HIGH finding) — a new protected table is not auto-detected — but for the tables it covers, the checks are correct and non-cosmetic.  
**Suggested fix:** Consider driving `protectedTables`/`authSecretTables` from the same canonical owner-scoped-table registry suggested for the export, so new modules are audited automatically.
