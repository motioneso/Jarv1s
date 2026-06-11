# PLO Thermo-Nuclear Audit — Executive Summary

**Date:** 2026-06-10  
**Scope:** Full Jarv1s monorepo — 28 audit files across 4 security dimensions, 14 modules, 3 application layers, integration tests, infrastructure/migrations, standards compliance, and e2e/operator scripts  
**Reviewer:** Automated subagent fleet (claude-sonnet-4-6)

---

## Overall Grades by Dimension

| Dimension | Grade | Rationale |
|---|---|---|
| **A. Security — DB / RLS** | D+ | Architecture is sound (NOBYPASSRLS, FORCE RLS pattern, 4-role separation) but execution has critical gaps: 5 admin tables have no RLS at all, pg-boss schema unprotected, worker memory path fully non-functional. |
| **B. Security — Secrets / Vault** | C | Keyring + AES-256-GCM at-rest encryption is correct; but Google API key travels as URL query param, OAuth client secret sent from browser, MCP token written to disk, SHA-256 key derivation (not HKDF). Vault files stored plaintext with 0o644 permissions. |
| **C. Security — AI Gateway** | C+ | MCP endpoint has no rate limit; Codex token ps-visible; no input-length cap on `/api/chat/turn`; prompt-injection via XML unmitigated. SessionTokenRegistry in-memory only. Positive: confirmation bridge for write tools is a strong architectural control. |
| **D. Security — API / Auth** | C | PKCE and argon2id correct; but DataContextDb invariant broken in SettingsRepository and connectors admin path; blanket 401 masking hides real errors in 3 modules; no global bodyLimit; /api/bootstrap/status leaks user count unauthenticated. |
| **E. Module Quality** | C+ | DataContextDb branding and migration hash-check hold across most modules. Memory module worker path is completely broken. Structured-state misses assertDataContextDb in all 3 repos. Tasks contribute grant inert; task activity insert allows view-share grantees to write. |
| **F. Infrastructure / Migrations** | B- | pgvector image correct; advisory lock on migrations; never-edit-applied-migrations enforced. Dead schema objects (has_resource_grant_level, current_workspace_id) accumulate. Bootstrap runs without transactions. Missing FK indexes on 2 tables. |
| **G. Standards / Tests / Tooling** | C+ | Zero `as any`, zero raw `require()`, one justified `@ts-expect-error`. Test isolation gaps (3 DB connection leaks, 3 RLS tests verifying absence not block). audit-release-hardening script omits 13 tables — a critical false-confidence finding. delete-user-data leaves vault files on disk. |

**Overall Grade: C+**

The foundational security architecture (NOBYPASSRLS, FORCE RLS, DataContextDb branding, SECURITY DEFINER auth layer, argon2id) is well-designed. The codebase fails at the execution layer: the admin data tier has no RLS, the memory worker pipeline is non-functional due to a policy gap, a hard invariant (DataContextDb only) is broken in two production repositories, and the release hardening audit script provides false assurance by omitting 13 tables from its coverage.

---

## Total Finding Counts

| Severity | Count |
|---|---|
| **CRITICAL** | 6 |
| **HIGH** | 47 |
| **MEDIUM** | 68 |
| **LOW** | 68 |
| **INFO** | 28 |

Note: These counts reflect de-duplicated unique findings. Several findings appear in multiple audit files (e.g., the Google API key in URL is flagged in 02-secrets, 03-ai-gateway, module-ai, and module-connectors — counted once). The HIGH count is lower than the raw per-file sum because cross-cutting patterns (handleRouteError blanket-401, DataContextDb bypass) were consolidated.

---

## Critical Findings

### CRIT-01: Five admin tables have no RLS — all rows visible to any authenticated user

**Files:** `infra/postgres/migrations/0004_auth_workspaces_settings.sql`, `0005_admin_audit_events.sql`  
**Tables affected:** `app.workspaces`, `app.workspace_memberships`, `app.resource_grants`, `app.instance_settings`, `app.admin_audit_events`

All five tables have `GRANT` permissions for `jarvis_app_runtime` but no `ENABLE ROW LEVEL SECURITY`, no `FORCE ROW LEVEL SECURITY`, and no policies. Any query running as the application role can SELECT all rows from all five tables regardless of the authenticated user. `resource_grants` exposes every sharing relationship in the system. `admin_audit_events` exposes all admin actions for all users. The only protection is application-layer gating (`requireAdmin`), which is a single line of defence for the most sensitive tables in the schema.

**Hard invariant violated:** "Private by default — data is owner-only unless explicitly shared."

---

### CRIT-02: pg-boss schema has no RLS — all job payloads visible cross-user

**File:** `01-security-db-rls.md`  
**Schema:** `pgboss.*`

`jarvis_app_runtime` and `jarvis_worker_runtime` are granted full access to all pg-boss tables with no RLS. Any actor who can issue SQL as the application role can read all job payloads, including those of other users. Even though payloads are supposed to be metadata-only, this makes cross-user job enumeration trivially possible.

**Hard invariant violated:** "Private by default."

---

### CRIT-03: Worker runtime GRANTs on memory tables with zero RLS policies — silent data loss

**Files:** `packages/memory/sql/0040_memory_chat_source.sql`; `packages/memory/sql/0030_memory_index.sql`

Migration `0040` grants `jarvis_worker_runtime` SELECT/INSERT/UPDATE/DELETE on `app.memory_chunks`, `app.memory_file_index`, and SELECT on `app.memory_links`. All three tables have `FORCE ROW LEVEL SECURITY`. Their existing policies specify `TO jarvis_app_runtime` only — `jarvis_worker_runtime` has no matching policy. Under FORCE RLS, a role with no policy sees zero rows and all DML silently affects zero rows without error. The chat embed-turn and extract-facts worker jobs run as `jarvis_worker_runtime`. They read nothing, write nothing, and report success. Memory recall and embedding ingestion are completely non-functional for the worker path.

**Hard invariant violated:** "Private by default" (broken enforcement architecture causing silent data loss rather than unauthorised disclosure, but the invariant's enforcement mechanism is non-functional).

---

### CRIT-04: SettingsRepository accepts raw Kysely — bypasses all RLS session context

**Files:** `packages/settings/src/repository.ts`, `packages/module-registry/src/index.ts`

`SettingsRepository` is constructed with a bare `Kysely<JarvisDatabase>` instance, not the branded `DataContextDb`. All queries execute without the `app.actor_user_id` GUC set. The class is re-exported as public API from `packages/settings/src/index.ts` and passed in by every module that imports it. This is the most prominent violation of the DataContextDb hard invariant in the codebase and normalises bypassing RLS context.

**Hard invariant violated:** "DataContextDb only — repositories accept only a branded DataContextDb handle, never a root Kysely instance."

---

### CRIT-05: OAuth client secret transmitted from browser in shared request body

**File:** `packages/shared/src/connectors-api.ts` (`GoogleAuthorizeRequest`)

`GoogleAuthorizeRequest` includes a `clientSecret` field. This means the OAuth client secret travels from the browser to the API server in the HTTP request body. OAuth client secrets are confidential credentials that must never leave the server. A MITM, XSS, or browser extension could capture the secret. The correct pattern is to store client credentials server-side only and never accept them as API inputs.

**Hard invariant violated:** "Secrets never escape — connector/AI credentials never reach frontend responses, logs, job payloads, user exports, or AI prompts." (The inverse — secrets flowing from the frontend — is equally prohibited.)

---

### CRIT-06: audit-release-hardening omits 13 RLS-protected tables — false confidence

**File:** `scripts/audit-release-hardening.ts`; `tests/integration/release-hardening.test.ts`

The `protectedTables` list covers only 14 tables. At least 13 additional tables in `app` have `ENABLE + FORCE RLS` applied in their migrations but are never checked: `memory_chunks`, `memory_links`, `memory_file_index`, `chat_memory_facts`, `chat_user_memory_settings`, `task_lists`, `task_tags`, `task_tag_assignments`, `task_preferences`, `connector_definitions`, `commitments`, `entities`, `preferences`. The integration test asserts `report.passed === true`, which passes today only because the gaps are not checked. If FORCE RLS is accidentally removed from any of these tables, the audit will not detect it and will continue reporting `passed: true`.

**Hard invariant violated:** "No admin private-data bypass" and "Private by default" — the enforcement verification mechanism is materially incomplete.

---

## High-Severity Findings (Top 20 by Impact)

| # | Finding | File(s) | Invariant |
|---|---|---|---|
| H-01 | connectors `requireAdmin` uses raw Kysely to query `app.users` — no RLS context | `packages/connectors/src/routes.ts:258` | DataContextDb only |
| H-02 | Google API key transmitted as URL query param (`?key=...`) | `packages/connectors/src/google/client.ts` | Secrets never escape |
| H-03 | MCP endpoint (`/api/mcp`) has no rate limit — DoS / prompt-injection amplification | `packages/chat/src/routes.ts` | — |
| H-04 | delete-user-data does not delete vault filesystem files — orphaned personal data | `scripts/delete-user-data.ts` | — |
| H-05 | backup-full.sh uses `eval` with operator-controlled env var — code injection | `scripts/backup-full.sh:112` | — |
| H-06 | smoke-compose polls `/health` (trivial 200) not `/health/ready` (DB + pgboss) | `scripts/smoke-compose.ts:27` | — |
| H-07 | Vault files written with 0o644 (world-readable) instead of 0o600 | `packages/vault/src/vault-context.ts` | Secrets never escape |
| H-08 | Vault files stored plaintext — no at-rest encryption | `packages/vault/src/vault-context.ts` | Secrets never escape |
| H-09 | chat_memory_facts FK to `app.chat_threads` — cross-module schema dependency | `packages/memory/sql/0041_memory_facts.sql` | Module isolation |
| H-10 | ToolSummarize return value carries raw user-supplied content to frontend | `packages/module-sdk/src/tools.ts` | Secrets never escape |
| H-11 | permissionId declared in tool manifest but never enforced at execution time | `packages/module-sdk/src/` | — |
| H-12 | listTools() ignores actorUserId — returns all tools regardless of session identity | `packages/module-sdk/src/` | — |
| H-13 | ownerUserId caller-supplied in structured-state (not pinned to actorUserId) | `packages/structured-state/src/` | Private by default |
| H-14 | YAML frontmatter injection via newline in entity name / life_area | `packages/structured-state/src/` | Secrets never escape |
| H-15 | assertDataContextDb absent from ALL structured-state repositories | `packages/structured-state/src/` | DataContextDb only |
| H-16 | task_activity INSERT policy allows view-share grantees to write | `packages/tasks/sql/` | Private by default |
| H-17 | POST /api/tasks/:id/activity has no task-visibility pre-check | `packages/tasks/src/routes.ts` | Private by default |
| H-18 | OIDC issuer validation is off by default | `packages/auth/src/` | — |
| H-19 | Confirmation bridge race condition — concurrent confirmations may cross wires | `packages/ai/src/` | — |
| H-20 | notifications/calendar/email handleRouteError both branches identical — all errors become 401 | Multiple modules | — |

Additional HIGH findings not listed above: unsafeSelectVisibleProbeIdsForTest on production DataContextRunner; admin RLS policies bound to `jarvis_migration_owner` (dead at runtime) in connectors; no rate limit on Google OAuth authorize endpoint; OIDC issuer validation off; briefing tool called with fabricated ToolContext (`actorUserId: ""`); share grantees with manage level can update owned briefing definitions via PATCH; chat clear() races against in-flight turn; Gemini settings.json with MCP token never deleted after session; no input length cap on `/api/chat/turn`; boss.on("error") re-throws in EventEmitter context; toAccessContext does not validate actorUserId as UUID.

---

## Top 5 Systemic Issues

### 1. Admin data tier has no database-level access control

Five tables that represent the system's entire admin/sharing surface (`workspaces`, `workspace_memberships`, `resource_grants`, `instance_settings`, `admin_audit_events`) have no RLS at all. Every row in these tables is readable by every authenticated user via the application runtime role. The project's stated principle of "DB-level defense-in-depth, not conventions" is violated for the most sensitive tier of the schema. This is not compensated for by application-layer `requireAdmin` checks because those checks are bypassed anywhere the raw Kysely instance is used (SettingsRepository, connectors admin path).

### 2. DataContextDb invariant broken at the admin and settings layer

The hardest invariant in CLAUDE.md states that repositories must accept only branded `DataContextDb`, never raw Kysely. This invariant is broken in `SettingsRepository` (public API, used for all user lookups), the connectors admin check (raw Kysely query against `app.users`), and the bootstrap user creation path. Three additional repositories in `packages/structured-state` never call `assertDataContextDb`. The pattern of bypassing DataContextDb has been copied across modules and normalised. Until `SettingsRepository` is fixed and made the canonical example, future contributors will follow the broken pattern.

### 3. Worker runtime memory pipeline is architecturally non-functional

The memory embedding and recall pipeline (embed-turn and extract-facts worker jobs) runs as `jarvis_worker_runtime`. This role has GRANTs on the memory tables but no RLS policies. Under FORCE RLS, every read returns zero rows and every write affects zero rows silently. The workers run, process jobs, and report success — but nothing is stored or retrieved. This means the entire memory feature (recall of past conversations, semantic search, fact extraction) is non-functional via the worker path. This is a product-level regression masquerading as passing tests.

### 4. Secrets escape via multiple vectors

Despite having AES-256-GCM encryption for connector secrets, the codebase has at least four active secret-escape paths: (a) Google API key in URL query parameters (logged by any HTTP proxy, access log, or browser history); (b) OAuth client secret transmitted from browser in request body; (c) MCP session token written to Gemini settings.json on disk and never cleaned up; (d) Codex token visible in process list via `ps aux`. The SHA-256 key derivation in `keyring.ts` is also weak (should be HKDF or PBKDF2). These are all preventable and represent a gap between the stated security model and the actual implementation.

### 5. Test and audit tooling provide false confidence

The `audit-release-hardening` script — the primary mechanical gate for the "Private by default" invariant — silently omits 13 of the ~27 RLS-protected tables in the schema. The integration test asserts `passed: true` which it always will because the gaps are not checked. Separately, multiple integration tests verify RLS isolation by querying as a user who has no data (empty result = trivially correct) rather than by inserting adversarial data and asserting it is blocked. Three RLS isolation tests in `memory.test.ts` and `chat-recall.test.ts` use this weak pattern. The result is a test suite that passes with high confidence while real isolation regressions would go undetected.

---

## Most Concerning Module

**`packages/memory`** and **`packages/settings`** are jointly the most concerning, for different reasons.

`packages/memory` has a CRITICAL architectural gap: the worker-runtime RLS policy was never written for this module. The grant was added in migration `0040` without corresponding policies, following the exact pattern the project memory explicitly warned against from a prior incident. The result is that the entire memory feature (recall, embedding ingestion, fact extraction) is silently non-functional via the worker path. No tests catch this because the memory integration tests run as `jarvis_app_runtime` (via DataContextRunner), which does have policies.

`packages/settings` is the most concerning from a standards-compliance perspective. It holds the only repository in the codebase that explicitly violates the DataContextDb hard invariant and is exported as public API. It is the dependency anchor that propagates the raw Kysely pattern into module-registry and potentially into future callers. It also sits above the 5 admin tables that have no RLS. Fixing SettingsRepository is the single highest-leverage correctness change available.

---

## Quick Wins (Low Effort, High Impact)

1. **Add `assertDataContextDb` to all 3 structured-state repositories** — one-line fix per method, eliminates a HIGH finding family.
2. **Delete dead "Workspace context is unavailable" branches** from 3 route modules — 3 identical 3-line deletions.
3. **Change smoke-compose.ts `healthUrl` to `/health/ready`** — one-line fix, eliminates a HIGH false-negative smoke test.
4. **Add `{ mode: 0o600 }` to vault file writes and export-user-data writeFile** — two-line fixes, closes vault file permission finding.
5. **Add save/restore to the 3 connectors-google.test.ts beforeAll blocks** — 6-line fix, eliminates a HIGH test isolation finding.
6. **Remove stale Docker Compose volume entry for deleted `packages/notes`** — one-line deletion.
7. **Add `afterAll(() => appDb.destroy())` to chat-live.test.ts and mcp-gateway.test.ts** — 2-line fixes per file, eliminates connection-leak HIGH findings.
8. **Change `eval` in backup-full.sh to array invocation** — 5-line fix, closes code-injection HIGH finding.
9. **Remove `GoogleAuthorizeRequest.clientSecret` from the shared API schema** — requires a coordinated change to connectors routes and the shared API package, but the interface change is small.
10. **Add `TO jarvis_app_runtime, jarvis_worker_runtime` to the 8 policies in `chat_memory_facts` and `chat_user_memory_settings`** — migration-only change, closes a MEDIUM policy-clarity finding.

---

## Recommended Fix Order

### Phase 0 — Stop-the-bleeding (do immediately, no spec required)

1. **Write worker RLS policies for memory tables** — migration adding `TO jarvis_app_runtime, jarvis_worker_runtime` policies for `memory_chunks`, `memory_file_index`, `memory_links`. This restores the memory feature. Pattern: follow `0036_chat_worker_runtime_grants.sql`.
2. **Remove `clientSecret` from `GoogleAuthorizeRequest`** — move credential handling fully server-side. This closes the OAuth client-secret-in-browser CRITICAL.
3. **Fix `SettingsRepository` to accept `DataContextDb`** — split out the `countUsers()` bootstrap helper, convert all user-facing methods to DataContextDb. Closes the most visible DataContextDb invariant violation.
4. **Fix Google API key URL param** — move to `Authorization: Bearer` header or request body. Closes CRIT/HIGH secret-escape finding.

### Phase 1 — Admin data tier hardening (requires migrations)

5. **Enable + FORCE RLS on all 5 admin tables** — add policies per table: admin-read-all via `is_instance_admin()`, owner/actor-scoped for runtime. This closes CRIT-01 and CRIT-02 (pg-boss).
6. **Add pg-boss RLS policies** — scope job reads to `owner_user_id = current_actor_user_id()` or admin.
7. **Expand `protectedTables` in audit-release-hardening** — add all 13 missing tables. Update integration test to assert minimum count. Closes CRIT-06.

### Phase 2 — Security hygiene (1-3 days each)

8. **Vault file permissions and encryption** — `0o600` on write (immediate), at-rest encryption (requires design spec).
9. **Rate limit MCP endpoint** — add `@fastify/rate-limit` to apps/api, apply to `/api/mcp`.
10. **MCP token lifecycle** — ensure Gemini settings.json is deleted after session end; session-persist token registry to a DB table.
11. **Fix blanket-401 error masking** — give notifications, calendar, email modules proper error handlers.
12. **Fix connectors admin path** — replace raw Kysely `app.users` query with DataContextRunner.

### Phase 3 — Correctness and standards (backlog)

13. **Fix structured-state ownerUserId pinning** — assert `ownerUserId === actorUserId` in create/upsert paths.
14. **Fix YAML frontmatter injection** — sanitise entity name / life_area inputs.
15. **Fix task activity insert RLS** — scope insert policy to owner only; add visibility pre-check to route.
16. **Remove dead schema objects** — `app.has_resource_grant_level()`, workspace GUC dead-code, stale Docker Compose volume, dead exports from settings index.
17. **Strengthen SHA-256 key derivation** — migrate keyring.ts to HKDF or PBKDF2.
18. **Fix test RLS coverage** — adversarial-insert patterns for memory, chat-recall, structured-state RLS tests.

---

## Hard Invariant Status

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 1 | No admin private-data bypass — NOBYPASSRLS on all roles | PASS | All 4 roles declared with `NOBYPASSRLS` in bootstrap SQL; confirmed by `cross-standards.md` grep sweep. |
| 2 | Private by default — owner-only unless explicitly shared | FAIL | 5 admin tables have no RLS (CRIT-01). pg-boss schema unprotected (CRIT-02). audit-release-hardening does not verify 13 tables (CRIT-06). |
| 3 | DataContextDb only — repos accept only branded DataContextDb; VaultContext for vault I/O | FAIL | SettingsRepository uses raw Kysely (CRIT-04). Connectors admin path uses raw Kysely. Structured-state repositories skip assertDataContextDb. Persona fs calls in chat bypass VaultContext. |
| 4 | AccessContext shape — only { actorUserId, requestId }, workspaceId permanently removed | PASS | No workspaceId found in any AccessContext usage; workspace teardown migration confirmed. One gap: toAccessContext in apps/worker does not validate actorUserId as UUID. |
| 5 | Secrets never escape — credentials never in frontend, logs, job payloads, exports, AI prompts | FAIL | Google API key in URL (logged). OAuth clientSecret from browser (CRIT-05). MCP token in settings.json on disk. Codex token ps-visible. Vault files plaintext 0o644. |
| 6 | Metadata-only job payloads — IDs, job kind, idempotency key, small params only | PARTIAL PASS | Tasks, briefings, memory payload types are correct. Chat embed/extract payloads are structurally metadata-only but have no runtime guard (`isChatPayloadMetadataOnly` not enforced). idempotencyKey is a dead field (stored but never wired to pg-boss deduplication). |
| 7 | Provider-agnostic AI — no hardcoded provider or model | PASS | No hardcoded provider or model found. `max_tokens: 8192` for Anthropic is a LOW finding but not a provider lock-in. |
| 8 | Spec before build — no feature without approved spec in docs/superpowers/specs/ | UNVERIFIED | No spec file found for briefings module. Other modules not fully verified. Process compliance is partially auditable from this codebase review alone. |
| 9 | Module isolation — modules collaborate only through declared public APIs/events | FAIL | `chat_memory_facts` has a FK to `app.chat_threads` (cross-module schema dependency). Structured-state contribute/manage grant levels declared but RLS policies do not enforce them. |
| 10 | pgvector image — Docker Compose uses pgvector/pgvector:pg17 | PASS | Confirmed by `cross-standards.md` and `cross-infra.md`: `pgvector/pgvector:pg17` in docker-compose.yml; no `postgres:17-alpine` present. |
| 11 | Never edit applied migrations — hash-checked; module SQL in module's sql/ dir | PASS | SHA-256 hash enforcement confirmed in module-db audit. All module SQL in owning module's `sql/` directory. No applied migration content was found edited. |

**Invariant score: 5 PASS, 4 FAIL, 1 PARTIAL PASS, 1 UNVERIFIED**

---

## Strengths Worth Preserving

The following patterns represent genuine architectural strength and should be protected from regression:

- **NOBYPASSRLS on all 4 runtime roles** — enforced at the PostgreSQL role level, not application code. Cannot be accidentally bypassed.
- **FORCE RLS pattern** — applied consistently across all product module tables. The gaps are at the admin data tier, not the product tier.
- **DataContextDb brand + assertDataContextDb** — the pattern is correct and enforced in the majority of repositories. The exceptions are clustered in settings and structured-state.
- **SECURITY DEFINER auth layer** — better-auth functions run as `jarvis_auth_runtime` with a separate pool, cleanly isolated from the application runtime.
- **argon2id password hashing** — best-practice choice.
- **PKCE enforcement** — correctly implemented in the OIDC/OAuth flow.
- **Migration hash-check** — prevents applied migration edits with SHA-256 per-file verification.
- **Advisory lock on migration runner** — prevents concurrent migration execution.
- **pg-boss metadata-only payload types** — the type definitions are correct; the gap is enforcement at the framework layer.
- **VaultContextRunner path traversal protection** — lexical path check prevents basic `../` traversal.
- **MCP write-tool confirmation bridge** — architecturally strong; write tools block pending user confirmation before execution. The race condition is a real finding but the design is correct.
- **Bootstrap/seed RLS testing pattern in `shares.test.ts`** — the gold standard for adversarial RLS testing; should be replicated across all modules.
- **release-hardening.test.ts role-privilege assertions** — the mechanical checks on DELETE privilege absence and FORCE RLS are a strong regression net, but the table coverage must be expanded (CRIT-06).
