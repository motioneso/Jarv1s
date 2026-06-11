## Phase 2 — Secrets, Vault & Credentials

**Model:** Sonnet 4.6 (Fable 5 unavailable — org model restriction)  
**Date:** 2026-06-10  
**Scope:** `packages/vault/src/`, `packages/ai/src/` (crypto + repository), `packages/connectors/src/` (crypto + repository + routes + google-connection), `packages/db/src/keyring.ts`, `scripts/delete-user-data.ts`, `scripts/export-user-data.ts`, `packages/shared/src/ai-api.ts`

---

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0  
- HIGH: 1  
- MED: 2  
- LOW: 2  
- INFO: 2  

---

### Findings

#### [HIGH] `delete-user-data.ts` does not delete the user's vault filesystem directory

**File:** `scripts/delete-user-data.ts:115`  
**Invariant violated:** "Private by default" — data is owner-only unless explicitly shared.  
**Detail:**  
The script deletes all of a user's DB rows via `DELETE FROM app.users WHERE id = $1::uuid` and relies on `CASCADE` for module tables. However, it never touches the filesystem. Each user has a private vault directory at `{JARVIS_VAULT_ROOT}/{actorUserId}/` (created with mode `0o700` by `VaultContextRunner.withVaultContext`). After user deletion the DB rows are gone but the vault files — which may contain note content, calendar summaries, email excerpts, and any other content the user or AI has written to vault — remain on disk indefinitely.

There is no vault cleanup call anywhere in the script. An operator running `pnpm delete:user` would have no indication that filesystem data survives the operation. A dry-run pass also omits vault file counts from its report.

This is a data-retention failure: deleted users' private content persists on the operating host.

**Suggested fix:**  
After the DB `COMMIT`, compute `path.join(getVaultBaseDir(), userId)` and call `fs.rm(..., { recursive: true, force: true })`. Log the outcome (deleted / not found) to the audit event metadata. Since `delete-user-data.ts` already uses a bootstrap connection that bypasses RLS, it has the authority to perform the cleanup; the `VaultContext` brand requirement does not apply to this maintenance script — document the explicit exception. The vault cleanup should happen after the DB commit succeeds, not inside the transaction (filesystem operations cannot be rolled back).

---

#### [MED] `delete-user-data.ts` and `export-user-data.ts` are missing several module tables

**Files:** `scripts/delete-user-data.ts:28-49`, `scripts/export-user-data.ts:34-53`  
**Invariant violated:** Data completeness on deletion; user data portability on export.  
**Detail:**  
`userScopedCountQueries` in `delete-user-data.ts` includes 20 tables but omits:

| Table | Module | Risk if orphaned |
|---|---|---|
| `app.memory_chunks` | memory | Embedding vectors + chunk text remain |
| `app.memory_links` | memory | Graph edges referencing deleted user |
| `app.memory_file_index` | memory | File index entries |
| `app.commitments` | commitments (if active) | User commitment records |
| `app.entities` | entities (if active) | Personal entity graph |
| `app.preferences` | structured-state | User preference rows |
| `app.connector_oauth_pending` | connectors | Encrypted Google client credentials (see INFO below) |
| `app.shares` (as granting owner) | shares | Share grants owned by the deleted user |

The deletion cascade from `app.users(id)` may or may not cover all of these — this depends on whether each module table declares `REFERENCES app.users(id) ON DELETE CASCADE`. If any module uses a soft FK or stores `owner_user_id` without a cascade, those rows are orphaned after user deletion.

`export-user-data.ts` is separately missing the same module tables from its export output: memory, entities, preferences, and connector pending state are not exported. Under GDPR data-portability obligations, these are user data.

Additionally, neither script exports or deletes the vault filesystem content — handled in the HIGH finding above.

**Suggested fix:**  
Audit all `owner_user_id` columns across `packages/*/sql/` to confirm CASCADE is declared. Add the missing tables to `userScopedCountQueries`. Add corresponding export queries to `readExportTables`. For `app.shares`, decide whether to delete the user's own grants (owned by the deleted user) vs. grants the user is a recipient of — the current query structure handles `grantee_user_id` side in `resourceGrantsQuery`, but does not handle the owner-of-share side.

---

#### [MED] User data export does not include vault file content

**File:** `scripts/export-user-data.ts:105-131`  
**Concern:** Data portability — vault content is user data, not a credential.  
**Detail:**  
`exportUserData` serializes 18 DB tables but makes no attempt to enumerate or include the user's vault directory at `{JARVIS_VAULT_ROOT}/{userId}/`. Vault files may contain the user's notes, calendar summaries, ingest results, and other content the application stores on their behalf. This content is not sensitive in the way credentials are — it should be included in a GDPR data-portability export.

The `connectorAccountsQuery` and `aiProviderConfigsQuery` correctly emit only boolean presence (`hasSecret`, `hasCredential`) for encrypted material — those are the fields that must NOT appear in the export. Vault file content is the opposite: user data that should appear.

**Suggested fix:**  
After the DB table queries, enumerate `{vaultBaseDir}/{userId}/` recursively and include the file list (paths + content, or at minimum paths + sizes) in the export bundle. Handle the case where the vault directory does not yet exist (user has never written vault content). Return vault files as a separate top-level key in `UserDataExport` to keep the schema clean.

---

#### [LOW] `credentialPayload` accepts unbounded `Record<string, unknown>` with no size limit

**Files:** `packages/shared/src/ai-api.ts:105,118`, `packages/connectors/src/routes.ts:229-251`  
**Concern:** Missing input validation before encryption.  
**Detail:**  
Both `CreateAiProviderConfigRequest.credentialPayload` and `CreateConnectorAccountRequest.tokenPayload` are typed as `Record<string, unknown>` with no size restriction in the Fastify JSON schema. A caller could submit an arbitrarily large object (e.g., 10 MB of data) as `credentialPayload`. The route encrypts this immediately via `secretCipher.encryptJson(body.credentialPayload)` without validating size or shape first. This causes:

1. The full object is serialized to JSON, encrypted, and stored in the DB `JSONB` column — bloating the column and potentially exceeding Postgres row size limits.
2. The encrypted blob is loaded into memory for every subsequent query that calls `selectProviderWithCredential()`.
3. No provider-specific schema validation means any garbage JSON is accepted and silently stored.

This is not exploitable for secret exfiltration (the data is encrypted), but is exploitable for storage abuse and memory pressure on the server.

**Suggested fix:**  
Add `maxLength` / `maxProperties` / `additionalProperties: { maxLength: N }` to the Fastify route schemas for `credentialPayload` and `tokenPayload`. For AI provider configs, validate the payload against the expected shape for the given `authMethod` (API key: `{ apiKey: string }`, at most 256 chars).

---

#### [LOW] Keyring `devDefault` uses a deterministic low-entropy string

**Files:** `packages/db/src/keyring.ts:33`, `packages/connectors/src/crypto.ts:89`, `packages/ai/src/crypto.ts` (analogous)  
**Concern:** Non-production environments using defaults have decryptable secrets if source is known.  
**Detail:**  
`resolveKeyring()` accepts a `devDefault` string (e.g., `"jarv1s-development-connector-secret"`) that is used as the raw AES key material when the env var is absent in non-production. The raw string is hashed via SHA-256 to produce the 256-bit key. The SHA-256 derivation is deterministic: anyone with the source code can decrypt any secret stored under the default key.

The guard is `NODE_ENV === "production"` — if a staging, UAT, or CI environment has `NODE_ENV` set to anything other than `"production"`, or if it simply doesn't set the key env vars, it silently operates with the default key. Any secrets written by a developer locally with the default key are decryptable by any other developer with source access.

This is acceptable for a local developer workflow but becomes risky if real OAuth tokens or API keys are ever written to a non-local environment using the defaults.

**Suggested fix:**  
Log a prominent `[WARN]` at boot if the default key is in use (`currentSecret` is undefined). Add a `JARVIS_STRICT_SECRETS=true` env var that causes a throw in any environment (useful for CI that touches real credentials). Consider generating a random dev secret the first time and storing it in `.env.local` rather than using a hardcoded string.

---

#### [INFO] OAuth `connector_oauth_pending` rows have no TTL — abandoned flows leave encrypted client credentials

**File:** `packages/connectors/src/google-connection.ts:40-58`  
**Detail:**  
`startAuthorization()` calls `upsertGooglePending()` to store an encrypted bundle of `{ clientId, clientSecret }` in `app.connector_oauth_pending`. On successful completion, `deleteGooglePending()` is called. However:

1. If the user starts the OAuth flow and never completes it (closes the browser, navigates away), the pending row is never cleaned up.
2. If `completeAuthorization()` throws after `getGooglePending()` but before `deleteGooglePending()` (e.g., the Google token exchange fails), the pending row also persists.
3. There is no scheduled cleanup or TTL column on `connector_oauth_pending`.

The encrypted client credentials (the user's Google Cloud app credentials) remain in the DB indefinitely for any abandoned OAuth attempt. Over time this accumulates stale encrypted blobs. More critically, if the user re-registers their own Google app later, the old pending row may interfere with `getGooglePending()` which appears to return the first/only row for the actor.

**Suggested fix:**  
Add a `created_at` / `expires_at` column to `connector_oauth_pending` and filter stale rows (`expires_at < NOW()`) in `getGooglePending`. Call `deleteGooglePending()` proactively at the start of `startAuthorization()` before upserting, to clear any prior pending state (already partially handled by `upsert`, but an explicit delete first makes intent clear).

---

#### [INFO] `scripts/rewrap-secrets.ts` not audited in this phase

**File:** `scripts/rewrap-secrets.ts`  
**Detail:**  
This script handles key rotation — re-encrypting all secrets from retired keys to the current key. It was not read in this phase. A future audit pass should verify:

1. It reads the encrypted blob, decrypts with the old key, re-encrypts with the new key — never logging the plaintext.
2. It uses a transaction or at least handles partial re-wrap failures so no secrets are lost.
3. It validates the keyring configuration before touching any rows.

---

### What was confirmed clean

- **VaultContext brand enforcement:** `assertVaultContext()` is called in every vault op; no raw `fs` calls in `vault-ops.ts` or any route handler. ✓  
- **Vault path traversal prevention:** `resolveVaultPath()` uses `path.resolve()` + prefix check; throws `VaultPathError` on escape attempt. ✓  
- **AI credential never in responses:** `safeProviderQuery()` explicitly excludes `encrypted_credential` from SELECT. `selectProviderWithCredential()` is the only method returning the blob, is clearly docstring-gated, and is only called from the capability router for in-process decryption. ✓  
- **Connector secret never in responses:** `safeAccountQuery()` excludes `encrypted_secret`. `serializeAccount()` returns `hasSecret` boolean. ✓  
- **Export file safe:** `aiProviderConfigsQuery` returns `encrypted_credential IS NOT NULL AS "hasCredential"`. `authAccountsQuery` returns boolean presence fields for `access_token`, `refresh_token`, `id_token`, `password`. Better-auth session `token` column is not selected. ✓  
- **credentialPayload in requests:** Immediately encrypted via `secretCipher.encryptJson(body.credentialPayload)` before any DB write; never returned in the response DTO. ✓  
- **AES-256-GCM implementation:** `randomBytes(12)` IV per encryption, GCM auth tag included, auth tag verified on decryption. keyId-versioned envelopes with legacy candidate fallback. Production requires key env vars — throws at boot if absent. ✓  
- **DataContextDb in AI and Connector repositories:** All `AiRepository` and `ConnectorsRepository` methods call `assertDataContextDb()`. ✓  
