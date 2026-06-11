# Email Module — Thermo-Nuclear Code Quality Audit

**Module:** `packages/email`
**Files reviewed:**
- `packages/email/src/index.ts`
- `packages/email/src/manifest.ts`
- `packages/email/src/repository.ts`
- `packages/email/src/routes.ts`
- `packages/email/src/tools.ts`
- `packages/email/sql/0012_email_module.sql`
- `packages/email/sql/0021_email_owner_or_share.sql`
- `packages/shared/src/email-api.ts` (shared contract)
- `tests/integration/calendar-email.test.ts`

---

## Findings

### [HIGH] ownerUserId exposed in every API response and AI tool output

- **File:** `packages/email/src/routes.ts:71`, `packages/shared/src/email-api.ts:4`
- **Category:** Security
- **Finding:** `serializeEmailMessage` maps `owner_user_id` directly into `EmailMessageDto.ownerUserId`, which is then serialized to every `GET /api/email/messages` and `GET /api/email/messages/:id` response, and also to every AI tool invocation result (`email.listVisibleMessages`). The owner's internal UUID is a personally-identifying handle that has no legitimate use on the client; this is information leakage in two directions: to the frontend consumer and to AI prompts.
- **Evidence:**
  ```ts
  // routes.ts:71
  ownerUserId: message.owner_user_id,
  ```
  ```ts
  // email-api.ts:4
  readonly ownerUserId: string;
  ```
- **Impact:** Any frontend code (or browser DevTools session) can enumerate which internal user UUID owns a shared message. AI tools receive and can surface user UUIDs from email data. The field is also in the AI tool output schema (`listEmailMessagesResponseSchema`), meaning it enters AI prompts.
- **Recommendation:** Remove `ownerUserId` from `EmailMessageDto` and the JSON schema entirely. Ownership is already enforced by RLS; the API consumer does not need the owner ID. If any future client feature requires it, scope it to an admin-only endpoint behind a separate permission. Also remove from the AI tool output schema.

---

### [HIGH] Blanket 401 masking hides internal 500 errors and database failures

- **File:** `packages/email/src/routes.ts:89-91`
- **Category:** Error Handling / Security
- **Finding:** `handleRouteError` unconditionally returns HTTP 401 for every thrown error, including database errors, query timeouts, constraint violations, and bug-induced panics. An attacker who triggers an error on a normally-accessible endpoint receives a 401, indistinguishable from a real auth failure, masking the true status. More critically, a real internal 500 is silently dropped and the caller sees a false 401 with a misleading message. The error is also swallowed entirely — there is no logging.
- **Evidence:**
  ```ts
  function handleRouteError(_error: unknown, reply: FastifyReply) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  ```
- **Impact:** (1) Production errors become invisible — database outages, broken queries, and bugs are all reported as auth failures. (2) Observability is zero for anything that throws after `resolveAccessContext`. (3) The message "Session is missing or expired" is only accurate for the actual auth error; all others are misrepresented.
- **Recommendation:** Inspect the error type. Return 401 only for authentication exceptions (e.g., errors thrown by `resolveAccessContext`). Let other errors propagate to Fastify's built-in error handler (which will log them and return 500). At minimum, `console.error` or pass to a logger before responding.

---

### [MEDIUM] Route param `id` lacks UUID format validation — open to oversized or injection-shaped input

- **File:** `packages/shared/src/email-api.ts:34-40`
- **Category:** Security / Architecture
- **Finding:** `emailMessageParamsSchema` validates that `id` is a `string` but applies no `format`, `pattern`, or `maxLength` constraint. Any string — including a multi-kilobyte token, a SQL-fragment, or a path-traversal sequence — passes schema validation and is forwarded to the Kysely query. Kysely uses parameterized queries so SQL injection is not a direct risk, but input is unbounded at the framework layer.
- **Evidence:**
  ```ts
  const emailMessageParamsSchema = {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" }
    }
  } as const;
  ```
- **Impact:** Unbounded string input reaches the database layer. While Kysely parameterization prevents SQL injection, the absence of a format constraint means malformed IDs (e.g., path fragments, very long strings) are never rejected at the boundary, which is a defensive depth gap. A UUID format constraint also closes a potential information-oracle: a non-UUID string that reaches the database will fail with a different error profile than a valid UUID that is not found.
- **Recommendation:** Add `format: "uuid"` to the `id` property in `emailMessageParamsSchema` (Fastify's ajv instance validates format keywords by default when `ajv.formats` is enabled). Cross-check the calendar module's equivalent param schema and apply consistently.

---

### [MEDIUM] `createCachedMessageForTest` is a permanent production method named for tests

- **File:** `packages/email/src/repository.ts:42-69`
- **Category:** Architecture / Code Quality
- **Finding:** `EmailRepository.createCachedMessageForTest` is exported from `packages/email/src/index.ts` (via `repository.ts` re-export) and is part of the module's public surface. The name suffix `ForTest` signals intent, but the method is compiled into the production build and exported. Any caller with a valid `DataContextDb` can invoke it, including an unintended production code path or a future connector integration that imports the repository.
- **Evidence:**
  ```ts
  // repository.ts:42
  async createCachedMessageForTest(
    scopedDb: DataContextDb,
    input: CreateCachedEmailMessageInput
  ): Promise<EmailMessage> {
  ```
  ```ts
  // index.ts:2
  export * from "./repository.js";
  ```
- **Impact:** A production-use insertion method exists that bypasses any connector-sync flow, emits no events, and has no idempotency key. If a connector integration is ever wired to this method, it will bypass all audit and event machinery. The method is also exported as a module public API, widening the attack surface.
- **Recommendation:** Two options: (1) Move the method to a `testing/` sub-path not exported from `index.ts` (follows the pattern used by some other modules). (2) Rename to `insertCachedMessage` (drop the `ForTest` suffix) and make it a first-class production method with proper event emission — then use it in both connector sync and tests. Option 2 is preferable if a sync path is ever added.

---

### [MEDIUM] `external_metadata` is an unbounded, untyped JSONB blob passed through to API responses and AI

- **File:** `packages/email/sql/0012_email_module.sql:12-14`, `packages/email/src/routes.ts:79`, `packages/shared/src/email-api.ts:71`
- **Category:** Security / Architecture
- **Finding:** `external_metadata` is a `jsonb NOT NULL DEFAULT '{}'` column with only an `jsonb_typeof = 'object'` check — no field list, no depth limit, no size cap. It is serialized verbatim in API responses (`externalMetadata: message.external_metadata`) and passed through the AI tool output. The column is intended to hold provider-sourced metadata (Gmail headers, MIME metadata, etc.); depending on what a connector writes there, it could contain email content snippets, attachment metadata, or PII beyond what is explicitly modeled.
- **Evidence:**
  ```ts
  // routes.ts:79
  externalMetadata: message.external_metadata,
  ```
  ```ts
  // email-api.ts:71
  externalMetadata: jsonObjectSchema,  // type: "object", additionalProperties: true
  ```
- **Impact:** (1) Unknown content from external providers reaches the frontend and AI verbatim. (2) If a connector stores sensitive data in this field (access tokens, raw MIME parts, PII), it leaks to every consumer. (3) There is no size bound — a malformed or adversarial connector could write megabytes here, causing unbounded serialization.
- **Recommendation:** (a) Define an explicit allowlist of metadata fields or strip the field from API/AI responses entirely — let the DTO carry only explicitly-known structured fields. (b) Add a `pg_column_size` or JSONB size constraint at the DB layer. (c) If external metadata must be passed to AI, sanitize it through a defined schema rather than `additionalProperties: true`.

---

### [MEDIUM] No pagination on `listVisible` — unbounded result set returned to both REST and AI

- **File:** `packages/email/src/repository.ts:21-30`, `packages/email/src/routes.ts:31-43`
- **Category:** Architecture / Code Quality
- **Finding:** `EmailRepository.listVisible` executes `selectAll()` with no `LIMIT` or cursor, and the route returns the full result set in a single response. For a user with a large connector-backed mailbox cache, this can return thousands of rows in one HTTP response and one AI tool invocation.
- **Evidence:**
  ```ts
  return scopedDb.db
    .selectFrom("app.email_messages")
    .selectAll()
    .orderBy("received_at", "desc")
    .orderBy("id")
    .execute();
  ```
- **Impact:** (1) Large response payloads cause high memory usage and slow responses. (2) When returned to an AI tool, thousands of email DTOs inflate the prompt token count, potentially hitting context limits or significantly increasing cost. (3) No growth bound is enforced even as the connector cache grows over time.
- **Recommendation:** Add a `limit`/`offset` or cursor-based pagination parameter to `listVisible`, default to a reasonable cap (e.g., 100 rows). Expose page/cursor params in the route schema and the AI tool input schema. Until a pagination spec is approved, at minimum enforce a hard `LIMIT` in the repository (e.g., 500 rows) with an explicit comment that pagination is tracked.

---

### [MEDIUM] No DELETE RLS policy — connector account CASCADE is the only deletion path

- **File:** `packages/email/sql/0012_email_module.sql:59`, `packages/email/sql/0021_email_owner_or_share.sql`
- **Category:** Security / Architecture
- **Finding:** `jarvis_app_runtime` is granted `SELECT, INSERT, UPDATE` on `app.email_messages` — DELETE is not granted and no DELETE RLS policy exists. Row deletion is only possible via `ON DELETE CASCADE` from `connector_accounts`. This means: (1) there is no API path for a user to delete a specific cached message; (2) there is no repository method for a connector sync to remove stale/deleted messages individually; (3) the entire cache is wiped only when the connector account is deleted.
- **Evidence:**
  ```sql
  GRANT SELECT, INSERT, UPDATE ON app.email_messages TO jarvis_app_runtime;
  -- No GRANT DELETE. No DELETE policy.
  ```
- **Impact:** Stale or retracted emails accumulate in the cache with no pruning path short of deleting the entire connector account. If an email is deleted from the provider's server, it persists in Jarv1s indefinitely. This is a GDPR/right-to-erasure concern for a user's own data.
- **Recommendation:** (a) Add a DELETE grant and owner-only DELETE policy if individual row deletion is required (for sync reconciliation or user-initiated removal). (b) Document explicitly in a spec that cache-only-grows-via-cascade is an accepted invariant, and add a test for it if it is intentional. Currently neither posture is explicitly documented.

---

### [LOW] Manifest `database.migrations` array is stale — only lists `0012`, not `0021`

- **File:** `packages/email/src/manifest.ts:25`
- **Category:** Architecture
- **Finding:** `emailModuleManifest.database.migrations` lists only `["sql/0012_email_module.sql"]`. The second email migration `sql/0021_email_owner_or_share.sql` is not listed. The migration runner uses `migrationDirectories` (which is correct and picks up all files in `packages/email/sql/`), but the `migrations` array in the manifest is misleading and would cause a documentation/tool consumer to believe only one migration exists.
- **Evidence:**
  ```ts
  database: {
    migrations: ["sql/0012_email_module.sql"],
    migrationDirectories: ["packages/email/sql"],
    ownedTables: ["app.email_messages"]
  },
  ```
- **Impact:** Low currently — the actual migration runner uses `migrationDirectories`, not the `migrations` array. However, any tooling, documentation generator, or future SDK feature that reads `database.migrations` to enumerate module migrations will see an incomplete picture.
- **Recommendation:** Either: (a) remove the `migrations` field entirely if `migrationDirectories` is the canonical source (and confirm no SDK code reads it), or (b) keep it in sync: `["sql/0012_email_module.sql", "sql/0021_email_owner_or_share.sql"]`. Apply the same pattern check to the calendar module manifest.

---

### [LOW] Module-level singleton `EmailRepository` in `tools.ts` is a latent concern

- **File:** `packages/email/src/tools.ts:7`
- **Category:** Architecture / Code Quality
- **Finding:** `tools.ts` creates a module-level singleton `const repository = new EmailRepository()` and closes over it in the `ToolExecute` closure. Currently `EmailRepository` is stateless (all state is DB-derived), so this is safe. However, if `EmailRepository` ever gains instance state (caches, config, connection handles), the singleton will silently share that state across all concurrent tool executions.
- **Evidence:**
  ```ts
  const repository = new EmailRepository();
  
  export const emailListVisibleMessagesExecute: ToolExecute = async (
    scopedDb,
    _input,
    _ctx
  ): Promise<ToolResult> => {
    assertDataContextDb(scopedDb);
    const messages = await repository.listVisible(scopedDb);
    ...
  };
  ```
- **Impact:** Low today — the repository is pure. Risk escalates if the class is extended.
- **Recommendation:** Instantiate `EmailRepository` inside the closure, or accept it as a parameter (matching the pattern in `routes.ts` where `repository` is injected via dependencies). Consistency with the route pattern also enables test injection without module-level mocking.

---

### [LOW] No HTML sanitization on `snippet` or `bodyExcerpt` before rendering

- **File:** `packages/email/sql/0012_email_module.sql:8-9`, `packages/shared/src/email-api.ts:67-68`
- **Category:** Security
- **Finding:** `snippet` and `body_excerpt` are untyped `text` columns with no content constraint. A connector ingesting an email could store HTML fragments in these fields. The API returns them as plain strings with no sanitization. If any frontend component renders these as `innerHTML` or passes them to a rich-text renderer without escaping, XSS is possible.
- **Evidence:**
  ```sql
  snippet text,
  body_excerpt text,
  ```
  ```ts
  snippet: nullableStringSchema,   // { anyOf: [{ type: "string" }, { type: "null" }] }
  bodyExcerpt: nullableStringSchema,
  ```
- **Impact:** The backend does not sanitize. The risk is deferred entirely to the frontend. If a future web component uses `dangerouslySetInnerHTML` or a markdown renderer for email preview, attacker-controlled HTML in a cached message could produce stored XSS. The field names (`snippet`, `body_excerpt`) suggest preview content, which commonly ends up in rendered UI.
- **Recommendation:** (a) At the backend, document explicitly that these fields must be treated as untrusted plain text (not HTML). (b) Add a constraint check or server-side sanitization if HTML content is expected from connectors. (c) Ensure the frontend renders these fields with text-only escaping (`textContent`, not `innerHTML`). If the frontend code is in scope, audit it separately.

---

### [LOW] No size constraint on `snippet`, `body_excerpt`, `sender`, `recipients` array

- **File:** `packages/email/sql/0012_email_module.sql:5-9`
- **Category:** Code Quality / Architecture
- **Finding:** `sender`, `snippet`, `body_excerpt`, and the `recipients` array all lack length constraints at the DB layer. A malformed or adversarial connector could write arbitrarily large content into these fields. Only `subject` and `sender` have a non-empty check; none have an upper bound.
- **Evidence:**
  ```sql
  sender text NOT NULL CHECK (length(btrim(sender)) > 0),
  recipients text[] NOT NULL DEFAULT ARRAY[]::text[],
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  snippet text,
  body_excerpt text,
  ```
- **Impact:** A connector writing a 10 MB `body_excerpt` will store it, serialize it in every API response, and pass it to every AI tool call untruncated. No error is raised.
- **Recommendation:** Add `CHECK (length(snippet) <= 2000)`, `CHECK (length(body_excerpt) <= 5000)`, and `CHECK (array_length(recipients, 1) <= 100)` (or similar domain-appropriate bounds). These can be applied in a new migration without editing the existing one.

---

### [INFO] Test method name `createCachedMessageForTest` signals production/test contract ambiguity

- **File:** `packages/email/src/repository.ts:42`
- **Category:** Tests
- **Finding:** The method is used in the integration test suite for seeding, but its `ForTest` suffix is not enforced by any access control — it is a naming convention only. This pattern (also used in `CalendarRepository`) is inconsistent with having the seed data inserted via the bootstrap PostgreSQL client in the same test file (`seedConnectorBackedReadData` uses a raw bootstrap connection, not the repository). There are two paths to seed email messages in tests: the raw SQL bootstrap function and the repository method.
- **Impact:** Dual seeding paths create confusion about which is canonical for a given test scenario, and the repository method bypasses the bootstrap connection's elevated privilege pattern, making it harder to reason about test isolation.
- **Recommendation:** Consolidate: use the raw bootstrap client for all seed data (as in `seedConnectorBackedReadData`), and remove the `createCachedMessageForTest` method if it has no production use. If the method is kept for testing convenience, document clearly which test scenarios use which path.

---

### [INFO] Integration test suite validates admin bypass is blocked — good positive coverage

- **File:** `tests/integration/calendar-email.test.ts:275-294`
- **Category:** Tests
- **Finding:** The test "keeps private calendar and email rows hidden from other users and admins" explicitly asserts that admin-context reads of another user's private messages return `undefined`. This directly tests the hard invariant "No admin private-data bypass." This is correct and thorough.
- **Impact:** Positive finding — this is the right pattern. No action required.
- **Recommendation:** No change needed. Note that this test should be maintained and never weakened.

---

## Summary Table

| Severity | Count | Key Issues |
|----------|-------|------------|
| HIGH     | 2     | ownerUserId in all responses/AI; 401-masking of all errors |
| MEDIUM   | 4     | No route param UUID format validation; test method in production; unbounded external_metadata; no pagination |
| LOW      | 4     | No DELETE policy or grant; stale manifest migrations array; singleton repository; no HTML sanitization signal |
| INFO     | 2     | Dual test seeding paths; positive admin-bypass test coverage |

## RLS Posture Assessment

The email module's RLS is correctly structured:
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` are both applied
- `jarvis_worker_runtime` has no grant (verified by integration test)
- The owner-or-share model (`0021`) correctly gates SELECT/UPDATE on `app.has_share()`
- INSERT policy correctly verifies connector account ownership and `provider_type = 'email'`
- Immutability trigger prevents `owner_user_id`, `connector_account_id`, and `external_id` from being changed after creation

The one gap (no DELETE policy/grant) is documented as a finding above. There is no evidence of BYPASSRLS, cross-user data leakage through RLS, or admin privilege escalation.

## Email-Specific Checklist

| Check | Result |
|-------|--------|
| RLS owner-only on email tables? | Owner-or-share (correct per spec, not purely owner-only) |
| HTML sanitization of snippet/bodyExcerpt? | NOT present — backend defers to frontend |
| Attachment handling / path traversal? | No attachment storage — only text metadata fields |
| SMTP/IMAP credentials via VaultContext? | No SMTP/IMAP in scope — read-only cache module |
| Cross-module queries (calendar/connector tables)? | No direct table queries — INSERT policy JOINs `connector_accounts` and `connector_definitions` via RLS, not application code |
| Email credentials encrypted, never in logs/payloads? | No email auth credentials in this module (connector secrets are in connectors module) |
