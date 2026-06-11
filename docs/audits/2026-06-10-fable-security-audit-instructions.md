# Fable Security & Foundational Strength Audit — Jarv1s

**Date:** 2026-06-10  
**Model:** Fable 5 (`claude-fable-5`)  
**Focus:** Security and foundational correctness — not feature completeness.  
**Output directory:** `docs/audits/` — one findings file per phase (write before moving on; partial runs are durable).

---

## How to run this audit

Each phase is a **self-contained Fable session**. Run them in order (security-critical first).  
At the end of each phase, write findings to the output file listed, commit, then start the next phase.  
If usage caps mid-phase, the completed phases are already saved and still useful.

**Grounding preflight (REQUIRED before phase 1):** run `pnpm audit:preflight`. It must exit 0
(tree current with `origin/main`) before you ground anything — a stale checkout invalidates the
whole audit (it happened: see CLAUDE.md → "Grounding Discipline"). If it fails, ground on a detached
read-only worktree (`git worktree add /tmp/audit-ground origin/main`) — never `pull`/`checkout`/`reset`
the shared tree. **Record the verified commit at the top of every phase output file.**

**Worktree:** run from the main working tree (`~/Jarv1s`) unless noted.  
**Do not run tests or gates** (other than the preflight above) — trust CI is green. Spend tokens on adversarial review, not re-execution.  
**Do not fix code** — record findings. Fixes become follow-up issues.

### What to look for in every phase

The **hard invariants** from CLAUDE.md are the foundational bar. Every phase should verify these apply to the code under review:

- **No admin private-data bypass** — RLS applies to all actors including admins; no `BYPASSRLS` on `jarvis_app_runtime` / `jarvis_worker_runtime`.
- **Private by default** — data is owner-only unless explicitly shared; `owner_id` filter on every SELECT policy unless the table is in the `owner-or-share` or `recipient-only` category.
- **DataContextDb only** — every repository accepts only a branded `DataContextDb` handle, never a raw Kysely instance. `VaultContext` for all vault I/O — never raw `fs`.
- **AccessContext shape** — `{ actorUserId, requestId }` only. `workspaceId` was permanently removed.
- **Secrets never escape** — credentials, tokens, password hashes never reach frontend responses, logs, pg-boss job payloads, user exports, or AI prompts.
- **Metadata-only job payloads** — pg-boss payloads contain actor/resource IDs, job kind, idempotency key, and small command params only. No private content, prompts, or secrets.
- **Module isolation** — modules import only from declared public APIs/events; no cross-module internal imports or direct table queries.

### Findings format (each output file)

```markdown
## Phase N — <name>

### CRIT / HIGH / MED / LOW / INFO counts

### Findings

#### [SEVERITY] Short title
**File:** `path/to/file.ts:line`  
**Invariant violated / concern:**  
**Detail:**  
**Suggested fix:**
```

---

## Phase 1 — DB Foundation & RLS (highest priority)

**Why first:** every other security property depends on the DB layer being correct. A broken RLS policy or a BYPASSRLS leak undermines every module above it.

**Scope:**
- `infra/postgres/migrations/` — all 12 applied migrations (0001–0046, skipping withdrawn numbers)
- `packages/db/src/` — `data-context.ts`, `kysely.ts`, and all helpers
- `packages/auth/src/index.ts` — `resolveRequestAccessContext`, session/bearer auth paths, status enforcement
- The four DB roles: `jarvis_app_runtime`, `jarvis_worker_runtime`, `jarvis_auth_runtime`, `jarvis_superuser` — verify NOBYPASSRLS, FORCE RLS targets, EXECUTE grants

**Specs:** `docs/superpowers/specs/2026-06-09-p1-auth-secret-rls.md` (migrations 0045–0046)

**Key questions:**
1. Does every table that holds private user data have RLS ENABLED + FORCE RLS (or ENABLE RLS with an explicit policy that is restrictive)? Are there any tables missing a policy?
2. Does the `owner_id` filter appear on every SELECT/UPDATE/DELETE policy for owner-only tables? Check the RLS shareability map at `packages/db/src/` or `docs/architecture/` if present.
3. Is `BYPASSRLS` granted to any runtime role anywhere in migrations or bootstrap scripts?
4. Does `DataContextDb` branding hold — is there any `as Kysely<…>` cast or raw Kysely instance passed to a repository?
5. Does `resolveRequestAccessContext` enforce `status = 'active'` before granting an `AccessContext`? Does it apply to both bearer and session auth paths?
6. Does `current_actor_is_admin()` (migration 0050, once PR #93 lands) correctly return false when the actor GUC is unset?

**Output file:** `docs/audits/2026-06-10-fable-phase1-db-rls.md`

---

## Phase 2 — Secrets, Vault & Credentials

**Scope:**
- `packages/vault/src/` — all 5 files
- `packages/ai/src/` — focus on credential storage, encryption, and the `auth_method`/`encrypted_credential` paths in `packages/ai/sql/0033_ai_auth_method.sql`
- `packages/connectors/src/` — credential storage, OAuth token paths
- `scripts/delete-user-data.ts` — does deletion cover encrypted credentials?
- `packages/shared/src/` — any DTO types that might inadvertently carry secrets

**Specs:** `docs/superpowers/specs/m-a3-real-ai-providers.md`, `docs/superpowers/specs/2026-06-08-m-b1-google-connector-oauth.md`

**Key questions:**
1. Does every credential write go through `VaultContext`? Are there any raw `fs` calls or direct DB writes for secret material?
2. Are encrypted credentials (AES-256-GCM) decrypted only in-process and never serialized to responses, logs, or pg-boss payloads?
3. Does the connector/AI credential path ever reach a frontend DTO, an error message, or a log line?
4. On `delete-user-data.ts`: does vault cleanup run before or after the DB cascade? Could a partial deletion leave orphaned vault files pointing at deleted rows?
5. Does `packages/shared/` contain any type that includes a credential, token, or hash field that flows to the frontend?

**Output file:** `docs/audits/2026-06-10-fable-phase2-secrets-vault.md`

---

## Phase 3 — AI Gateway & Tool Security

**Scope:**
- `packages/ai/src/gateway/` — all files (`gateway.ts`, `types.ts`, policy/risk resolution)
- `packages/ai/src/` — capability router, provider selection
- `tests/integration/mcp-gateway.test.ts`, `tests/integration/ai.test.ts`, `tests/integration/ai-tools.test.ts`

**Specs:** `docs/superpowers/specs/2026-06-08-jarvis-chat-phase2-agentic-mcp.md`

**Key questions:**
1. Does `AssistantToolGateway.callTool()` enforce token→identity on every call path, with no bypass?
2. Is there any tool that could be called with an unverified or expired token and still succeed?
3. Do all tool inputs pass through validation before reaching dispatch? Is there any path where raw user input reaches a shell, SQL, or filesystem operation without sanitization?
4. Does the `resolvePolicy` risk tier correctly classify every registered tool — is there any `security`-tier operation classified as `routine`?
5. Does the allowlist enforcement mean a tool not in the allowlist is truly unreachable, or is there a fallback path?
6. Could a tool's output inadvertently include a secret (e.g., a vault file's raw content, a DB row with `encrypted_credential`)?

**Output file:** `docs/audits/2026-06-10-fable-phase3-ai-gateway.md`

---

## Phase 4 — Chat & MCP Transport

**Scope:**
- `packages/chat/src/` — all 17 TS files + 7 SQL migrations
- `tests/integration/chat-live.test.ts`, `chat-live-api.test.ts`, `chat-mcp-transport.test.ts`, `chat-recall.test.ts`

**Specs:** `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md`, `2026-06-08-jarvis-chat-phase2-agentic-mcp.md`, `2026-06-08-jarvis-chat-phase3-recall.md`

**Key questions:**
1. The CLI launch flags (`--permission-mode default`, `--tools ""` / `--allowedTools "mcp__jarvis__*"`, `--strict-mcp-config`) — are they hardcoded and non-overridable, or could a caller supply a different permission mode?
2. The MCP session token: it's injected via `send-keys` env prefix (visible in `ps` output). Is this the only place it appears? Does it ever reach a log, a DTO, or a pg-boss payload?
3. Does the chat module's SQL enforce owner-only RLS on transcripts and sessions? Is there any cross-user transcript read path?
4. Does `ConfirmationRegistry` correctly block a security-tier tool until the user confirms, with no race or timeout bypass?
5. Does the recall path (injecting memory into chat context) ever include another user's memories?

**Output file:** `docs/audits/2026-06-10-fable-phase4-chat-mcp.md`

---

## Phase 5 — Auth, Settings & Multi-User Lifecycle

**Scope:**
- `packages/auth/src/index.ts` (the full file — also reviewed in Phase 1 for access context; here focus on registration, session lifecycle, admin routes)
- `packages/settings/src/` — all routes, repository
- `infra/postgres/migrations/0045_auth_secret_rls.sql`, `0046_auth_sessions_rls.sql`
- Phase 2 Slice A migrations once merged (0050–0052): `packages/auth/sql/` or wherever they land
- `tests/integration/auth-settings.test.ts`, `tests/integration/release-hardening.test.ts`

**Specs:** `docs/superpowers/specs/2026-06-09-p1-auth-secret-rls.md`, `docs/superpowers/specs/2026-06-10-p2-multi-user-accounts-design.md`

**Note:** Run this phase **after PR #93 merges** so the bootstrap-owner delete guard fix is included.

**Key questions:**
1. Can a user register with `is_instance_admin: true` or `status: 'active'` set in the registration payload? (The spec says `input: false` blocks this — verify it is actually enforced in the better-auth handler.)
2. Does deactivation durably revoke all session types — both `better_auth_sessions` and any `app.auth_sessions` rows?
3. Is the bootstrap-owner protected on every mutation path: deactivate, demote, delete? (The Fable review of PR #93 found a gap on delete — verify the fix covers all paths.)
4. Is the last-admin guardrail applied on all paths that could reduce the active-admin count: demote, deactivate, delete?
5. Does the admin `UPDATE` RLS policy on `app.users` (migration 0050) correctly scope to non-secret columns only? Could an admin UPDATE a column that shouldn't be writable (e.g., `password_hash`, `encrypted_credential`)?

**Output file:** `docs/audits/2026-06-10-fable-phase5-auth-settings.md`

---

## Phase 6 — Module Data Layer (tasks, memory, vault content, structured-state)

**Scope:**
- `packages/tasks/src/` + `packages/tasks/sql/`
- `packages/memory/src/` + `packages/memory/sql/`
- `packages/structured-state/src/` + `packages/structured-state/sql/`
- `packages/vault/src/` (content access paths — not credential storage, covered in Phase 2)
- `tests/integration/tasks.test.ts`, `memory.test.ts`, `vault.test.ts`, `structured-state.test.ts`

**Specs:** `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md`, `docs/superpowers/specs/2026-06-06-memory-data-model-design.md`

**Key questions:**
1. For each module: does every repository method accept only `DataContextDb` (never raw Kysely)? Is `actorUserId` always sourced from `AccessContext`, never from the request body?
2. Does the memory module's embedding path write vectors directly to the DB? Could it write to another user's memory rows?
3. Does structured-state enforce owner-only access at the DB layer, or only at the route layer?
4. Are pg-boss job payloads for these modules metadata-only (IDs + kind), with no private content?
5. Does the vault read path (returning file content) ever bypass `VaultContext`?

**Output file:** `docs/audits/2026-06-10-fable-phase6-module-data.md`

---

## Phase 7 — API & Worker Entry Points

**Scope:**
- `apps/api/src/` — server wiring, route registration, middleware stack
- `apps/worker/src/` — pg-boss job registration, worker boot
- `apps/web/src/` — focus on auth flows, admin UI, any client-side credential handling
- `tests/integration/api-rate-limit.test.ts`, `api-health.test.ts`, `foundation.test.ts`, `release-hardening.test.ts`

**Specs:** `docs/superpowers/specs/2026-06-09-p1-rate-limiting.md`, `docs/superpowers/specs/2026-06-09-p1-crash-safety-health.md`

**Key questions:**
1. Is the rate-limit middleware applied to all auth-sensitive routes (login, registration, password reset, admin mutations)?
2. Does the health endpoint leak any internal state (DB connection details, version, env vars)?
3. Does the worker boot establish DB connections with the correct least-privilege role (`jarvis_worker_runtime`), never the superuser?
4. Are there any unauthenticated routes that touch private data — even indirectly (e.g., a public route that reads a shared resource without verifying the share grant)?
5. Does the web client ever store tokens, credentials, or session data in `localStorage` or `sessionStorage` (vs. `httpOnly` cookies)?

**Output file:** `docs/audits/2026-06-10-fable-phase7-api-worker-web.md`

---

## Phase 8 — Cross-cutting sweep (module isolation + invariants)

Run this phase last, with the prior findings in context (read the output files from phases 1–7).

**Scope:** the entire `packages/` tree, read selectively — focus on import relationships and invariant compliance, not line-by-line.

**Key questions:**
1. Does any module import from another module's internals (e.g., `packages/chat/src/` importing from `packages/memory/src/internal/`)? Module boundaries must be public-API only.
2. Does any module query another module's tables directly (bypassing the owning module's repository)?
3. Are there any `console.log` / `console.error` calls that could emit private data (user content, tokens, credentials)?
4. Does any code pass a plain `string` where `DataContextDb` is required (bypassing the brand check)?
5. Does any pg-boss job handler's payload schema include fields that shouldn't be there (private content, secrets)?

**Output file:** `docs/audits/2026-06-10-fable-phase8-cross-cutting.md`

---

## After the audit

1. Triage findings by severity across all phases — file GitHub issues for CRIT/HIGH immediately; batch MED/LOW into a follow-up issue per phase.
2. CRIT/HIGH findings that touch auth/RLS/secrets are security-tier — new PR per fix, cross-model QA, Ben merge sign-off.
3. Update the RLS shareability map in agentmemory if any Phase 1/2 findings change the classification.
