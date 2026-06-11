# Secrets & Vault Security Audit

**Scope:** `packages/vault/src/`, `packages/connectors/src/`, `packages/auth/src/`, `packages/ai/src/`, `apps/api/src/`, operator scripts  
**Date:** 2026-06-10  
**Auditor:** Automated thermo-nuclear review (Sonnet 4.6 subagent)

---

## Executive Summary

The vault and secrets architecture is generally sound: AES-256-GCM encryption is applied consistently before persistence, safe serializers are used everywhere in API responses, export scripts redact encrypted fields, and the vault path traversal guard is robust. No plaintext credential storage at rest was found. No `console.log` of decrypted secrets exists in production paths.

However, five findings warrant attention: a Google API key embedded in an outbound URL query parameter (logged by Fastify request infrastructure in error paths), the Google OAuth token-endpoint error body surfaced in Fastify server logs, an MCP session token persisted in a plain-text JSON file on disk for Gemini sessions, dead RLS policies targeting the wrong DB role, and the Claude launch command line embedding the MCP Bearer token where it is visible in `ps` output.

---

## Findings

### [HIGH] Google API Key Embedded in Outbound Fetch URL

- **File:** `packages/ai/src/adapters/http-api.ts:100`
- **Category:** Security
- **Finding:** For the `google` provider kind, the API key is appended as a URL query parameter (`?key=${this.apiKey}`) in the outbound fetch URL. This differs from the Anthropic (`x-api-key` header) and OpenAI-compatible (`Authorization: Bearer` header) approaches where the secret stays in a request header and never appears in a URL.
- **Evidence:**
  ```typescript
  case "google": {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${this.apiKey}`;
    return {
      url,
      headers: { "content-type": "application/json" },
      ...
    };
  }
  ```
- **Impact:** The full URL (including `?key=<secret>`) will appear in:
  1. Any Node.js unhandled-rejection or error stack that logs the URL.
  2. Network-layer debug logging if `NODE_DEBUG=https` or similar is ever enabled.
  3. Google's own error responses, which echo the request URL back in some error bodies — those bodies then appear in Fastify server logs (see next finding).
  4. Reverse-proxy or load-balancer access logs if the API server sits behind one that logs upstream request URIs.
- **Recommendation:** Move the API key to the `x-goog-api-key` request header (Google's documented alternative), matching the pattern used for Anthropic and OpenAI. The URL-key form should be considered legacy for browser use; server-side code must use headers.

---

### [HIGH] Google OAuth Token-Endpoint Error Body Surfaces in Server Logs

- **File:** `packages/connectors/src/oauth.ts:109-111`, `packages/connectors/src/routes.ts:392-418`
- **Category:** Security
- **Finding:** When the Google token exchange fails, `postToken()` throws with: `Google token endpoint returned ${response.status}: ${detail}` where `detail = await response.text()`. This raw error is not a `GoogleConnectError`, so `handleRouteError` (routes.ts:418) re-throws it. Fastify's built-in request logger then logs the exception — including the full `detail` string — at `error` level before returning a generic 500 to the client.
- **Evidence:**
  ```typescript
  // oauth.ts:109-111
  const detail = await response.text().catch(() => "");
  throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);

  // routes.ts:418 — the catch block re-throws anything not matched above
  throw error;
  ```
  Google's token endpoint error responses include: `error`, `error_description`, and sometimes the submitted `client_id`. If the caller submits an invalid client secret, the `error_description` will confirm the secret was rejected (a signal to any log reader with access).
- **Impact:** Operator log files containing Google OAuth failure details become a secondary exposure surface for credential confirmation. Any system with access to server logs (SIEM, log aggregator, cloud logging) will capture these messages.
- **Recommendation:** Catch `Error` thrown by `postToken` in `handleRouteError`, sanitize it to `GoogleConnectError("Google token exchange failed")` before re-throwing, and log only the HTTP status code. The internal `detail` should be logged at `debug` level with a structured field, not in the error message.

---

### [MEDIUM] MCP Session Token Written to Plain-Text Disk File (Gemini Sessions)

- **File:** `packages/chat/src/live/cli-chat-engine.ts:78-95`
- **Category:** Security
- **Finding:** For Gemini sessions, the MCP Bearer token (`jst_<uuid>` from `SessionTokenRegistry`) is written to `~/.jarvis/chat/<userId>/.gemini/settings.json` as a plain-text HTTP Authorization header value. This file is not encrypted, is not managed by `VaultContext`, and persists after the session ends (it is overwritten on next launch but never explicitly deleted on session teardown).
- **Evidence:**
  ```typescript
  const settings = {
    mcpServers: {
      jarvis: {
        httpUrl: opts.mcpServerUrl,
        headers: { Authorization: `Bearer ${opts.mcpToken}` },
        ...
      }
    }
  };
  await this.io.writeFile(join(settingsDir, "settings.json"), JSON.stringify(settings, null, 2));
  ```
- **Impact:** Any process or user with read access to `~/.jarvis/chat/` can extract an active (until revoked) MCP session token, which grants the full MCP tool surface for that user's session. File permissions are not explicitly set (relies on the `umask`). Although the token is revoked at engine reap, a crash or SIGKILL during a session leaves a live token on disk.
- **Recommendation:** (1) Set restrictive file permissions (`mode 0o600`) when writing `settings.json`. (2) Delete or overwrite the token value on session teardown / engine kill. (3) Consider writing the Authorization header value to an environment variable ref rather than inline, if the Gemini CLI supports it.

---

### [MEDIUM] MCP Bearer Token Visible in `ps` Output and tmux History (Claude Sessions)

- **File:** `packages/chat/src/live/cli-chat-engine.ts:207-233`
- **Category:** Security
- **Finding:** For Claude Code sessions, the MCP config JSON (containing `Authorization: Bearer <jst_token>`) is passed as a `--mcp-config` flag inline on the CLI launch line sent via `tmux send-keys`. The code acknowledges this for Codex (line 239 comment) but the same exposure exists for Claude. The full command line, including the JSON blob with the token, is visible in:
  - `ps aux` or `/proc/<pid>/cmdline` to any local user or process.
  - `tmux list-panes -a` output showing the pane command.
  - Shell history files (`~/.bash_history`, `~/.zsh_history`) if the shell records `send-keys` input.
- **Evidence:**
  ```typescript
  const mcpConfig = JSON.stringify({
    mcpServers: {
      jarvis: {
        type: "http",
        url: opts.mcpServerUrl,
        headers: { Authorization: `Bearer ${opts.mcpToken}` },
        ...
      }
    }
  });
  parts.push(`--mcp-config ${shellQuote(mcpConfig)}`);
  ```
- **Impact:** On a multi-user server this would be critical. On a dedicated single-user host (the documented deployment model) the blast radius is limited, but it still violates the invariant that session tokens should not appear in process tables. A compromised process running as the same OS user gets a valid MCP token.
- **Recommendation:** Write the MCP config to a temporary file (like the approach already used for the persona and prompt files), pass `--mcp-config /path/to/file`, and delete the file after the engine has launched (or at kill). This is the pattern Claude Code itself recommends for sensitive MCP configs.

---

### [MEDIUM] Weak Key Derivation: SHA-256 of a Short String

- **File:** `packages/db/src/keyring.ts:34`
- **Category:** Security
- **Finding:** Both the connector and AI secret keys are derived as `createHash("sha256").update(rawSecret).digest()`. SHA-256 is a fast, non-iterative hash function. When the secret is a human-memorable string (e.g. a password or passphrase) rather than a randomly-generated 256-bit key, this derivation provides no brute-force resistance. The development defaults — `"jarv1s-development-connector-secret"` and `"jarv1s-development-ai-secret"` — are known strings; any attacker with a copy of the database and knowledge of these defaults can decrypt all records without needing the env var.
- **Evidence:**
  ```typescript
  // keyring.ts:34
  const currentKeyBuffer = createHash("sha256").update(rawCurrentSecret).digest();

  // connectors/crypto.ts:88
  "jarv1s-development-connector-secret",

  // ai/crypto.ts:88
  "jarv1s-development-ai-secret",
  ```
- **Impact:** In production with a strong random key (e.g. `openssl rand -hex 32`) this is fine — the input is already 256 bits of entropy and SHA-256 is adequate as an identity transform. The risk is when operators choose a short passphrase instead. There is no documentation warning against this pattern, and the key env var names (`JARVIS_CONNECTOR_SECRET_KEY`, `JARVIS_AI_SECRET_KEY`) suggest "secret key" without specifying that the value must be high-entropy. Additionally, if a staging or development database is ever exported alongside a leaked `devDefault` value, all encrypted records are recoverable.
- **Recommendation:** (1) Replace `sha256(secret)` with HKDF or PBKDF2 (with a stored salt) when the input may be human-typed. (2) Emit an explicit startup warning if the key string is shorter than 32 bytes. (3) Document in the runbook that the env var must be a 32-byte random hex string, not a passphrase.

---

### [LOW] Dead RLS Policies Granted to `jarvis_migration_owner` Instead of `jarvis_app_runtime`

- **File:** `packages/connectors/sql/0010_connector_admin_safe_metadata.sql:3-28`
- **Category:** Security / Architecture
- **Finding:** Two RLS policies — `connector_definitions_admin_metadata_select` and `connector_accounts_admin_metadata_select` — are created with `TO jarvis_migration_owner`. The `jarvis_app_runtime` role (which the application actually uses) has no such policy, so these policies are effectively dead code. The actual admin access is served by the `SECURITY DEFINER` function `list_connector_account_safe_metadata()` granted to `jarvis_app_runtime`, which is correct. But the dead policies attached to `jarvis_migration_owner` create false confidence during a future security audit and could become active unexpectedly if migration-owner privileges are ever elevated.
- **Evidence:**
  ```sql
  CREATE POLICY connector_definitions_admin_metadata_select
  ON app.connector_definitions
  FOR SELECT
  TO jarvis_migration_owner   -- should be jarvis_app_runtime or dropped entirely
  USING ( ... is_instance_admin check ... );
  ```
- **Impact:** No active security hole (the policies are unreachable by the application at runtime), but these policies will confuse future auditors and could be mistakenly relied upon if the role mapping changes.
- **Recommendation:** Drop these two dead policies in a cleanup migration, or convert them to `TO jarvis_app_runtime` if direct table access is ever intended. The SECURITY DEFINER function is the right pattern and should remain.

---

### [LOW] `rewrap-secrets.ts` Logs Row IDs After Each Re-encryption

- **File:** `scripts/rewrap-secrets.ts:82-84, 99-101, 118-120`
- **Category:** Security
- **Finding:** The rewrap script logs each successfully re-encrypted row ID and the new `keyId`. While neither of these fields is itself a secret, the log output of an operator credential-rotation script should be kept minimal. More significantly, the error catch blocks log `err.message` on failure:
  ```typescript
  console.error(
    `connector_accounts row ${row.id} SKIPPED: ${err instanceof Error ? err.message : String(err)}`
  );
  ```
  If decryption fails due to a GCM authentication tag mismatch, `decipher.final()` throws a `crypto.Decryption` error whose message is `"Unsupported state or unable to authenticate data"`. This is safe. However, if the error is a JSON parse failure on `rawPlaintext`, the message could include a portion of the decrypted binary content if it happens to be valid text.
- **Evidence:**
  The `decryptJson` function at `connectors/src/crypto.ts:72` calls `JSON.parse(rawPlaintext.toString("utf8"))` and if it throws, the V8 `SyntaxError` message includes up to ~256 bytes of the invalid JSON string — which could be decrypted-but-malformed credential data.
- **Impact:** Low: decryption succeeding but JSON parsing failing implies the plaintext is not valid JSON, which would not happen with correctly stored secrets. This is a defense-in-depth gap that would only matter for corrupted rows.
- **Recommendation:** Wrap the `JSON.parse` call in a try/catch that throws a generic message: `"Connector secret payload is not valid JSON"`. This is already partially done in `decryptJson`'s final type check but the parse itself is not guarded.

---

### [LOW] Google Token Exchange Error Body May Contain Client Credentials Echo

- **File:** `packages/connectors/src/oauth.ts:109-112`
- **Category:** Security
- **Finding:** When Google's token endpoint returns an error, the full response body is captured as `detail` and included in the thrown error message. Google's error response for invalid credentials includes fields like `error: "invalid_client"` and `error_description: "The OAuth client was not found."`. Some Google API error responses also echo back the submitted `client_id` in their body.
- **Evidence:**
  ```typescript
  const detail = await response.text().catch(() => "");
  throw new Error(`Google token endpoint returned ${response.status}: ${detail}`);
  ```
- **Impact:** If `detail` contains the `client_id` and the error surfaces in server logs, an attacker with log access gains confirmation of which Google project is being used. Combined with the `clientId` already being sent by the frontend in the authorize request body, this adds no new exposure, but the log entry is unnecessarily verbose.
- **Recommendation:** Log only `response.status` in the thrown error; log `detail` separately at debug level with a structured field.

---

### [INFO] Auth Tokens Correctly Excluded from User Export

- **File:** `scripts/export-user-data.ts:159-178`
- **Category:** Security
- **Finding:** The user data export script correctly exports `auth_accounts` and `better_auth_sessions` using boolean presence fields (`hasAccessToken`, `hasRefreshToken`, `hasIdToken`, `hasPassword`) instead of the actual token/hash values. This is properly implemented.
- **Evidence:**
  ```typescript
  access_token IS NOT NULL AS "hasAccessToken",
  refresh_token IS NOT NULL AS "hasRefreshToken",
  id_token IS NOT NULL AS "hasIdToken",
  password IS NOT NULL AS "hasPassword",
  ```
- **Impact:** No exposure. Noted as a positive control.
- **Recommendation:** None required.

---

### [INFO] Connector and AI Secret Encrypted Fields Excluded from Response Serializers

- **File:** `packages/connectors/src/repository.ts:263-286`, `packages/ai/src/repository.ts:400-418`
- **Category:** Security
- **Finding:** Both `safeAccountQuery` (connectors) and `safeProviderQuery` (AI) explicitly select only safe fields. The `encrypted_secret` / `encrypted_credential` columns are excluded from all list/get responses. The boolean `has_secret` / `has_credential` is derived via `sql<boolean>` expression, ensuring the raw blob never reaches `serializeAccount` or `serializeProvider`.
- **Evidence:**
  ```typescript
  sql<boolean>`accounts.encrypted_secret IS NOT NULL`.as("has_secret"),
  // encrypted_secret column is NOT in the .select() list
  ```
- **Impact:** No exposure. Noted as a positive control.
- **Recommendation:** None required.

---

### [INFO] VaultContext Path Traversal Guard Is Sound

- **File:** `packages/vault/src/vault-path.ts`
- **Category:** Security
- **Finding:** `resolveVaultPath` uses `resolve()` to normalize the path and then checks both `normalized !== normalizedRoot` (rejects requests for the root itself) and `!normalized.startsWith(normalizedRoot + sep)` (prevents traversal above the root). This correctly handles all Unix path normalization edge cases including `..` sequences, symlink-aware resolve, and trailing-separator variations.
- **Evidence:**
  ```typescript
  const normalized = resolve(vaultRoot, relativePath);
  const normalizedRoot = resolve(vaultRoot);
  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relativePath);
  }
  ```
- **Impact:** No exposure. Noted as a positive control.
- **Recommendation:** None required.

---

### [INFO] No Direct Vault Table Queries Bypass VaultContext

- **Scope:** All packages in audit scope
- **Category:** Architecture
- **Finding:** A full search for `selectFrom.*vault`, `insertInto.*vault`, and `updateTable.*vault` across all non-vault packages returned no results. Vault file I/O exclusively goes through `readVaultFile`, `writeVaultFile`, and related ops in `packages/vault/src/vault-ops.ts`, all of which require a branded `VaultContext`. The raw `node:fs` imports found outside vault (`tmux-bridge.ts`, `persona.ts`) operate on transcript files and persona system-prompt files respectively, neither of which store credentials or user-private encrypted data.
- **Impact:** No exposure.
- **Recommendation:** None required.

---

### [INFO] Credential Payload Transits HTTP Request Body Unencrypted (by Design)

- **File:** `packages/shared/src/connectors-api.ts:42`, `packages/shared/src/ai-api.ts:105`
- **Category:** Security
- **Finding:** `CreateConnectorAccountRequest.tokenPayload` and `CreateAiProviderConfigRequest.credentialPayload` carry raw credential material (OAuth tokens, API keys) from the frontend to the API server over HTTP. The API then encrypts them before storage. This is the correct server-side encryption pattern: encryption at rest, not at rest + in transit. The invariant relies entirely on TLS for the transport leg.
- **Evidence:** The `GoogleAuthorizeRequest` similarly sends `clientId` and `clientSecret` in the request body.
- **Impact:** Zero exposure if TLS is enforced end-to-end. However, there is no code-level enforcement of HTTPS-only (`Strict-Transport-Security`, redirect-to-https), so a misconfigured deployment with HTTP could expose credentials in transit. The `JARVIS_AUTH_TRUSTED_ORIGINS` and `JARVIS_TRUST_PROXY` env vars suggest awareness of this concern.
- **Recommendation:** Document explicitly in `docs/operations/` that TLS is required and provide a checklist item for the production deployment gate. Consider adding an `HSTS` header via a Fastify plugin when `NODE_ENV=production`.

---

## Positive Controls Summary

| Control | Status |
|---|---|
| AES-256-GCM encryption for connector secrets | Correct |
| AES-256-GCM encryption for AI provider credentials | Correct |
| `encrypted_secret` / `encrypted_credential` excluded from all API responses | Correct |
| Boolean-only presence flag (`has_secret`, `has_credential`) returned to clients | Correct |
| User export script redacts all token/hash/password fields | Correct |
| VaultContext brand enforced for all vault I/O | Correct |
| Path traversal guard in `resolveVaultPath` | Correct |
| No direct Kysely queries on vault tables outside vault package | Correct |
| RLS + FORCE RLS on `connector_accounts`, `ai_provider_configs`, `connector_oauth_pending` | Correct |
| Production guard for `BETTER_AUTH_SECRET` | Correct |
| Production guard for `JARVIS_CONNECTOR_SECRET_KEY` and `JARVIS_AI_SECRET_KEY` | Correct |
| Dev-default keys blocked in `NODE_ENV=production` | Correct |
| `SessionTokenRegistry` keeps tokens in memory only, never persisted to DB | Correct |
| MCP token never appears in pg-boss job payloads | Correct |
| Google OAuth token-endpoint receives `client_secret` only server-side (never client-side) | Correct |
| `ConnectorSecretCipher` and `AiSecretCipher` are structurally identical — no logic drift | Correct |

---

## Priority Fix Order

1. **[HIGH]** Move Google API key from URL query param to `x-goog-api-key` header (`http-api.ts:100`)
2. **[HIGH]** Sanitize Google token-endpoint error body before logging (`oauth.ts:110-111`)
3. **[MEDIUM]** Delete / overwrite Gemini `settings.json` with Bearer token on engine kill (`cli-chat-engine.ts:78-95`)
4. **[MEDIUM]** Write MCP config to a temp file for Claude sessions, delete after launch (`cli-chat-engine.ts:207-233`)
5. **[MEDIUM]** Document / warn that key env vars must be high-entropy random values, not passphrases (`keyring.ts:34`)
6. **[LOW]** Drop or correct the dead `jarvis_migration_owner` RLS policies (`0010_connector_admin_safe_metadata.sql`)
7. **[LOW]** Guard `JSON.parse` in `decryptJson` to avoid error message with partial plaintext
