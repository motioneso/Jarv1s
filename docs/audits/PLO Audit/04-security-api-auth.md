# Audit 04 — API Surface & Auth Security

**Scope:** `apps/api/src/`, `packages/auth/src/`, `apps/worker/src/`
**Supporting files read:** `packages/tasks/src/routes.ts`, `packages/connectors/src/routes.ts`, `packages/connectors/src/oauth.ts`, `packages/settings/src/routes.ts`, `packages/settings/src/repository.ts`, `packages/chat/src/routes.ts`, `packages/chat/src/live-routes.ts`, `packages/chat/src/mcp-transport.ts`, `packages/notifications/src/routes.ts`, `packages/calendar/src/routes.ts`, `packages/email/src/routes.ts`, `packages/ai/src/routes.ts`, `packages/ai/src/gateway/session-tokens.ts`, `packages/ai/src/gateway/gateway.ts`, `packages/jobs/src/pg-boss.ts`, `packages/db/src/data-context.ts`, `packages/db/src/auth-session.ts`, `packages/memory/sql/0041_memory_facts.sql`
**Date:** 2026-06-10
**Auditor:** Claude (subagent, thermo-nuclear pass)
**Severity scale:** CRITICAL > HIGH > MEDIUM > LOW > INFO

---

## Summary Table

| # | Severity | Area | Title |
|---|----------|------|-------|
| 1 | HIGH | DataContextDb invariant | `requireAdmin` in connectors bypasses DataContextDb — uses raw `appDb` Kysely |
| 2 | HIGH | DataContextDb invariant | `SettingsRepository` uses raw `Kysely<JarvisDatabase>` for all admin reads/writes |
| 3 | HIGH | Missing input validation | Multiple chat route handlers have no Fastify schema registered |
| 4 | HIGH | Error handling | `notifications`, `calendar`, `email` route error handlers swallow 500s as 401 |
| 5 | MEDIUM | Rate limiting | `POST /api/connectors/google/authorize` has no rate limit; accepts client secrets |
| 6 | MEDIUM | Information disclosure | `GET /api/bootstrap/status` discloses total user count with no auth |
| 7 | MEDIUM | Error leakage | MCP transport `tools/call` error path returns raw internal `err.message` to client |
| 8 | MEDIUM | Missing schema | `live-routes.ts` — all four live-chat endpoints lack Fastify schemas |
| 9 | MEDIUM | Server configuration | No global `bodyLimit`; Fastify default (1 MiB) applies uniformly, no per-route tuning |
| 10 | LOW | OIDC misconfiguration | `JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION=false` disables issuer check at runtime |
| 11 | LOW | Rate limit key accuracy | `JARVIS_TRUST_PROXY` is binary; no documentation on valid proxy-count values |
| 12 | LOW | Auth fallback ordering | Bearer-token check precedes cookie session; malformed Authorization header throws before cookie is tried |
| 13 | LOW | Bootstrap race window | Advisory lock is taken after `better-auth` writes the user row — not before |
| 14 | LOW | Admin audit log completeness | `SettingsRepository.deleteResourceGrant` does not verify the actor is an admin before deletion |
| 15 | INFO | Worker trust model | `actorUserId` in pg-boss payload is trusted on dequeue; no signature or HMAC |
| 16 | INFO | Session token registry | `SessionTokenRegistry` is in-memory; tokens are lost on API restart (active CLI sessions drop) |
| 17 | INFO | Connector `as` cast | `request.body as GoogleAuthorizeRequest` in connectors route is an unsafe TypeScript cast despite schema being registered |
| 18 | INFO | `readForwardedProtocol` | `X-Forwarded-Proto` is consumed even when `JARVIS_TRUST_PROXY` is unset, forwarding untrusted header to better-auth URL construction |

---

## Finding 1 — HIGH

**File:** `packages/connectors/src/routes.ts:253-272`
**Category:** Hard Invariant Violation — DataContextDb Only
**Finding:** The local `requireAdmin` function queries `dependencies.appDb` (a raw `Kysely<JarvisDatabase>`) directly to check `is_instance_admin`. This bypasses the `DataContextDb` branded type, which is the project's single enforced mechanism for running queries inside a row-level security transaction. The invariant states: "Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance."
**Evidence:**
```typescript
async function requireAdmin(
  request: FastifyRequest,
  dependencies: ConnectorsRoutesDependencies
): Promise<AccessContext> {
  const accessContext = await dependencies.resolveAccessContext(request);
  const user = await dependencies.appDb          // <-- raw Kysely, no RLS GUC
    .selectFrom("app.users")
    .select(["id", "is_instance_admin"])
    .where("id", "=", accessContext.actorUserId)
    .executeTakeFirst();
  ...
}
```
**Impact:** Medium-to-high in isolation — the query reads `app.users` outside an RLS transaction. In the current schema `app.users` has `ENABLE RLS` (migration 0045); the `jarvis_app_runtime` role's policy is a self-row (`id = app.current_actor_user_id()`). Without the GUC set, the query runs as the connection role, and the self-row policy may be bypassed by a SECURITY DEFINER context difference, or fail with 0 rows if RLS is enforced for the role without the GUC. Either outcome is wrong: silently returning `is_instance_admin = false` (no row) would deny legitimate admins access; returning a row via a policy gap would silently succeed. The code pattern is also a maintenance hazard — a future table-level FORCE RLS addition would silently break admin routes.
**Recommendation:** Replace the local `requireAdmin` query with `dependencies.dataContext.withDataContext(accessContext, ...)` and pass the `DataContextDb` to a repository method (or use the existing settings `requireAdmin` pattern via a shared helper that accepts a `DataContextDb`). The `GET /api/admin/connectors/accounts` route then follows the same path as every other authenticated route.

---

## Finding 2 — HIGH

**File:** `packages/settings/src/repository.ts:63-506`, `packages/settings/src/routes.ts` (admin routes)
**Category:** Hard Invariant Violation — DataContextDb Only
**Finding:** `SettingsRepository` accepts a `Kysely<JarvisDatabase>` directly in its constructor, not a `DataContextDb`. All admin reads (`listUsers`, `listWorkspaces`, `listMembershipsForWorkspace`, `listResourceGrants`, etc.) and writes (`createWorkspace`, `upsertWorkspaceMembership`, `upsertResourceGrant`, etc.) run through this raw handle without an RLS GUC set. The invariant requires repositories to accept only `DataContextDb`.
**Evidence:**
```typescript
export class SettingsRepository {
  constructor(private readonly db: Kysely<JarvisDatabase>) {}
  // All 15 public methods call this.db directly — no withDataContext wrapping
```
**Impact:** Admin queries on tables that have ENABLE/FORCE RLS may return wrong results or zero rows depending on how the `jarvis_app_runtime` role's policies are structured without a GUC. Admin writes (workspace creation, membership upsert, resource grant) bypass the `owner_user_id = current_actor_user_id()` insert-check policies. If FORCE RLS is later applied to any of these tables the admin panel will silently break. The pattern also violates the stated architecture invariant which exists precisely because ad-hoc raw handles were the source of prior security issues.
**Recommendation:** Either (a) add a dedicated `jarvis_admin_runtime` DB role with an explicit `BYPASSRLS`-free but `USING(true)` policy for admin tables, wrapped in a `DataContextDb` channel, or (b) pass the `actorUserId` GUC through `withDataContext` and rely on admin-specific policies that allow admins to read all rows. Either approach must go through `DataContextDb`. The `SettingsRepository` constructor type must change to `DataContextDb`.

---

## Finding 3 — HIGH

**File:** `packages/chat/src/routes.ts`
**Category:** Missing Input Validation — No Fastify Schema
**Finding:** Four route handlers in `chat/routes.ts` have no Fastify `schema` registered. Without a schema, Fastify performs no request body validation or serialization and the `ajv` validation pipeline is skipped entirely.

Routes without schemas:
- `POST /api/chat/action-requests/:id/resolve`
- `GET /api/chat/memory/settings`
- `PATCH /api/chat/memory/settings`
- `GET /api/chat/memory/facts`
- `DELETE /api/chat/memory/facts/:id`
- `PATCH /api/chat/memory/facts/:id`

**Evidence:** Route definitions in `routes.ts` use `server.post(...)`, `server.patch(...)`, etc. with no second argument object containing a `schema` key for these paths.
**Impact:** No structural type enforcement on incoming JSON. A malformed or oversized body passes through to repository calls. The `PATCH /api/chat/memory/settings` and `PATCH /api/chat/memory/facts/:id` handlers that mutate data are particularly exposed — unexpected field injection or type confusion could reach DB queries. Additionally, response serialization is unguarded, raising the risk of accidental field leakage if repository return types change.
**Recommendation:** Add Fastify JSON schemas (request body + params + response) to all six routes, following the pattern established in `packages/tasks/src/routes.ts`. Export schema constants from `@jarv1s/shared` to keep contracts co-located with the shared API types.

---

## Finding 4 — HIGH

**File:** `packages/notifications/src/routes.ts`, `packages/calendar/src/routes.ts`, `packages/email/src/routes.ts`
**Category:** Error Handling — 500 Errors Silently Swallowed as 401
**Finding:** All three module route files implement a `handleRouteError` function that returns a 401 for every error, regardless of the actual error type. Genuine 500-level errors (DB connectivity loss, unhandled promise rejections, programming bugs) are returned to the client as `{ error: "Session is missing or expired" }` with status 401. This masks failures and makes debugging nearly impossible without server-side log correlation.

**Evidence (notifications — identical pattern in calendar and email):**
```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && error.message.includes("Session")) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  // FALLTHROUGH — every other error also returns 401:
  return reply.code(401).send({ error: "Session is missing or expired" });
}
```
**Impact:** Operational: any DB error, null dereference, or unhandled promise in these three modules looks like an auth failure to the client and monitoring. This delays incident detection. Security: from a security perspective the pattern hides implementation errors behind a benign-looking auth response, which could mask an exploited code path. Conversely, if a client auto-retries on 401 (e.g., attempts token refresh), it will retry indefinitely on a non-auth error.
**Recommendation:** Propagate non-auth errors as 500 (do not leak stack traces or internal messages). A correct pattern:
```typescript
function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error && (
    error.message === "Session is missing or expired" ||
    error.message === "Invalid bearer token"
  )) {
    return reply.code(401).send({ error: error.message });
  }
  // Let Fastify's default error handler log and return 500
  throw error;
}
```

---

## Finding 5 — MEDIUM

**File:** `packages/connectors/src/routes.ts:60-77`
**Category:** Missing Rate Limit — Credential Endpoint
**Finding:** `POST /api/connectors/google/authorize` accepts `clientId` and `clientSecret` in the request body but has no rate limit configured. The sibling endpoint `POST /api/connectors/google/complete` does have `{ max: oauthMax, timeWindow: "1 minute" }` (defaulting to 5/min via `JARVIS_RL_OAUTH_MAX`). Because the rate-limit plugin uses `global: false`, routes without an explicit `config.rateLimit` block are entirely unthrottled.
**Evidence:** `server.post("/api/connectors/google/authorize", { schema: googleAuthorizeRouteSchema }, ...)` — no `config` key present.
**Impact:** An authenticated user (or compromised session) can make unlimited authorize calls, potentially triggering unlimited outbound OAuth redirect requests to Google's endpoints, causing API quota exhaustion or using the endpoint as an amplification vector. The endpoint stores `clientSecret` encrypted at rest; unlimited calls also means unlimited attempts to re-key the secret store.
**Recommendation:** Add `config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } }` matching the complete endpoint, or a tighter limit since authorize is called once per connector setup, not repeatedly.

---

## Finding 6 — MEDIUM

**File:** `packages/settings/src/routes.ts` (`GET /api/bootstrap/status`)
**Category:** Information Disclosure — Unauthenticated User Count
**Finding:** The unauthenticated bootstrap status endpoint returns `{ needsBootstrap: boolean, userCount: number }`. The `userCount` field is populated by `SettingsRepository.countUsers()` which calls the `app.count_all_users()` SECURITY DEFINER function. Any unauthenticated HTTP client can determine the exact number of registered users on the instance.
**Evidence:** Route is registered without `resolveAccessContext`, and response includes `userCount`.
**Impact:** Instance enumeration: an attacker probing a network-exposed Jarv1s instance learns whether the instance has been bootstrapped and exactly how many accounts exist. On a personal/single-user deployment this exposes `userCount: 1` confirming user existence. On a small team deployment it leaks headcount. Combined with the email-based sign-in, this can inform targeted credential-stuffing strategies.
**Recommendation:** The boolean `needsBootstrap` is legitimately needed unauthenticated (the UI needs it before login). Remove `userCount` from the unauthenticated response entirely. If the count is needed elsewhere, expose it only to authenticated admins via the existing `/api/admin/...` surface.

---

## Finding 7 — MEDIUM

**File:** `packages/chat/src/mcp-transport.ts`
**Category:** Error Message Leakage — MCP Tool Call Error Path
**Finding:** In the `tools/call` handler, when a tool throws an exception the error message from the exception is returned verbatim to the MCP client:
```typescript
const message = err instanceof Error ? err.message : "Internal error";
return { ok: false, error: `Tool ${found.dto.name} failed: ${message}` };
```
**Impact:** Tool implementations may embed internal detail in their `Error.message` — DB error strings (table names, column values), file paths, or secret-adjacent context. All of this propagates to the MCP client (the CLI session), and from there to the chat transcript which may be stored or logged. The risk is higher here than in the regular HTTP API because MCP errors are not subject to the same Fastify error-handler pipeline that strips non-auth errors.
**Recommendation:** Sanitize the message: log `err` server-side at error level (with requestId), and return only `"Tool ${found.dto.name} failed"` (no message content) to the client. This matches the sanitization pattern used in `gateway.ts` `callTool`:
```typescript
return { ok: false, error: `Tool ${found.dto.name} failed` };
```

---

## Finding 8 — MEDIUM

**File:** `packages/chat/src/live-routes.ts`
**Category:** Missing Input Validation — No Fastify Schema on Live Chat Routes
**Finding:** All four live-chat route handlers (`POST /api/chat/turn`, `POST /api/chat/clear`, `POST /api/chat/switch`, `GET /api/chat/stream`) have no Fastify `schema` registered. These routes handle arbitrary chat input that is passed through to the CLI engine.
**Evidence:** Confirmed by reading `live-routes.ts` — all `server.post(...)` / `server.get(...)` calls lack a `schema` argument.
**Impact:** `POST /api/chat/turn` accepts a `message` body that is forwarded to the CLI process. Without a schema, there is no server-side length limit on the message field (beyond Fastify's 1 MiB global body limit). Extremely large chat messages can consume memory disproportionately while being buffered into the CLI stdin pipe. Schema absence also prevents response shape enforcement, leaving the streaming/JSON responses unguarded against accidental field leakage.
**Recommendation:** Add Fastify schemas for request body (at minimum a `message: string` with `maxLength`) and params. For `GET /api/chat/stream` register a response schema. Export types from `@jarv1s/shared`.

---

## Finding 9 — MEDIUM

**File:** `apps/api/src/server.ts`
**Category:** Server Configuration — No Global Body Size Limit
**Finding:** `Fastify({...})` is called without a `bodyLimit` option. Fastify's default is 1 MiB per request. No per-route override is set for any route. For most Jarv1s routes this is larger than necessary; for the chat turn endpoint it may be too permissive.
**Evidence:** Lines 47-52 of `server.ts` — no `bodyLimit` in the Fastify options object.
**Impact:** An authenticated attacker can send 1 MiB bodies to every route simultaneously, potentially exhausting Node.js heap and triggering OOM. The 1 MiB default is not documented as intentional, so future contributors may not realize it is the effective limit.
**Recommendation:** Set an explicit `bodyLimit` at the server level (e.g., 64 KiB for most routes) and override per-route for routes that legitimately require larger bodies (e.g., `POST /api/connectors/accounts` for token payloads, `POST /api/chat/turn` for messages). Document the chosen values.

---

## Finding 10 — LOW

**File:** `packages/auth/src/index.ts:448`
**Category:** OIDC Misconfiguration — Issuer Validation Disable
**Finding:** `requireIssuerValidation: readBoolean(env, "JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION")` allows setting `JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION=false` at runtime, which disables OIDC issuer validation in the `genericOAuth` plugin.
**Evidence:**
```typescript
requireIssuerValidation: readBoolean(env, "JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION"),
```
**Impact:** If an operator sets this to `false` (perhaps to work around a non-compliant IdP), any token from any OIDC issuer would be accepted, enabling token substitution attacks from a different provider. There is no guard preventing this from being set in production.
**Recommendation:** Remove the env-variable escape hatch or, at minimum, log a loud warning at startup if `JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION=false` in any environment. The safer default is `undefined` (let the library decide) or `true` explicitly — the current code already does this by default since `readBoolean` returns `undefined` when the var is absent.

---

## Finding 11 — LOW

**File:** `apps/api/src/server.ts:51`
**Category:** Rate Limit Key Accuracy — Binary Trust-Proxy Flag
**Finding:** `trustProxy: !!process.env.JARVIS_TRUST_PROXY` treats the flag as boolean. Fastify's `trustProxy` option also accepts a number (how many proxy hops to trust) or a CIDR string. Using a simple truthy env var means operators set `JARVIS_TRUST_PROXY=1` to trust *all* XFF hops rather than exactly one (the direct upstream proxy). In a multi-proxy topology this allows an attacker to prepend IPs to the XFF chain to spoof their source IP and bypass per-IP rate limiting.
**Evidence:** Line 51 — `!!process.env.JARVIS_TRUST_PROXY`.
**Impact:** In multi-proxy deployments, per-IP rate limiting on auth endpoints can be bypassed by injecting a spoofed first entry in the XFF header. In the typical single-proxy (Nginx/Traefik) Jarv1s deployment this is low risk, but the API surface permits riskier topologies.
**Recommendation:** Document that `JARVIS_TRUST_PROXY=1` (meaning "trust exactly one hop") is the recommended value. Consider changing the implementation to `Number(process.env.JARVIS_TRUST_PROXY) || false` so numeric values are passed through to Fastify's hop-aware XFF parsing.

---

## Finding 12 — LOW

**File:** `packages/auth/src/index.ts:332-345`
**Category:** Auth Fallback Ordering — Malformed Authorization Header Throws Before Cookie
**Finding:** `resolveRequestAccessContext` calls `readBearerToken(headers)` before attempting the cookie session. If the request contains an `Authorization` header with an invalid format (e.g., `Authorization: Basic dXNlcjpwYXNz` or a malformed bearer), `readBearerToken` throws `"Invalid bearer token"` and the cookie session is never checked.
**Evidence:**
```typescript
const bearerToken = readBearerToken(headers);  // throws on malformed Authorization header
if (bearerToken) {
  return options.legacySessions.resolveAccessContext(bearerToken, requestId);
}
const session = await options.auth.api.getSession({ headers });  // never reached
```
**Impact:** A browser that sends a valid cookie session AND an unrelated `Authorization` header (e.g., a browser extension injecting Basic auth) will receive a 401 despite having a valid session. More significantly, this could be triggered deliberately to force session downgrade: inject a malformed `Authorization` header in a CSRF context to deny service on an otherwise authenticated request.
**Recommendation:** Treat an unrecognized/malformed `Authorization` header as absent rather than throwing — fall through to cookie session check. Only throw if the header is specifically a `Bearer` scheme with an invalid token value.

---

## Finding 13 — LOW

**File:** `packages/auth/src/index.ts:233-307`
**Category:** Bootstrap Race Window — Advisory Lock Placement
**Finding:** `bootstrapFirstJarvisUser` is called inside better-auth's `databaseHooks.user.create.after` hook — meaning the user row already exists in `app.users` when the function runs. The advisory lock `jarv1s:first-user-bootstrap` is acquired *after* the row is written. Two concurrent sign-ups could both write their rows before either acquires the lock; both would then see `count_all_users() === 2` and neither would be made admin.
**Evidence:** The `after` hook fires post-INSERT. `pg_advisory_xact_lock` is the first statement inside the hook's transaction, but the INSERT already committed.
**Impact:** On a fresh instance where two users sign up within the same millisecond (e.g., automated test or rapid user provisioning), neither receives `is_instance_admin = true`. The instance would have no admin and require manual DB intervention to bootstrap. In normal human usage the window is negligible.
**Recommendation:** Document the known limitation. A more robust approach would use a `before` hook (pre-INSERT) to acquire the lock, or use a DB trigger on the users table to atomically set `is_instance_admin` for the first row.

---

## Finding 14 — LOW

**File:** `packages/settings/src/repository.ts:316-346`
**Category:** Admin Boundary — `deleteResourceGrant` Missing Actor Validation
**Finding:** `SettingsRepository.deleteResourceGrant` does not verify the `actorUserId` matches any authorization rule before deleting a resource grant. The route handler calls `requireAdmin` before invoking the repository, so in practice only admins reach this code. However, the repository method itself accepts any `actorUserId` string in its input and would delete the grant regardless. If the method were ever called from a non-admin path this would be a privilege escalation.
**Evidence:**
```typescript
async deleteResourceGrant(input: DeleteResourceGrantInput): Promise<ResourceGrant> {
  return this.db.transaction().execute(async (transaction) => {
    const grant = await transaction
      .deleteFrom("app.resource_grants")
      // No check that actorUserId is an admin or the grantor
      .where("resource_type", "=", input.resourceType)
      .where("resource_id", "=", input.resourceId)
      .where("grantee_user_id", "=", input.granteeUserId)
      .returningAll()
      .executeTakeFirst();
```
**Impact:** Low in current call graph (admin route guards protect it), but the repository method violates the principle of defense in depth — it trusts callers to have done the auth check.
**Recommendation:** Either (a) add an admin check inside the repository method using the `actorUserId`, or (b) accept `DataContextDb` (once Finding 2 is resolved) and rely on a DB-level policy that restricts grant deletion to admins. At minimum add a code comment explaining why the admin check is not duplicated in the repository.

---

## Finding 15 — INFO

**File:** `packages/jobs/src/pg-boss.ts`
**Category:** Worker Trust Model — Unsigned Job Payloads
**Finding:** The pg-boss worker dequeues jobs and constructs `AccessContext` directly from the `actorUserId` field in the job payload JSON. There is no HMAC, signature, or integrity check on the payload. Integrity relies entirely on database-level access control: only `jarvis_app_runtime` can enqueue, and the pg-boss tables are not RLS-protected by default.
**Evidence:**
```typescript
const actorUserId = job.data?.actorUserId;
if (!actorUserId) throw new Error(`Job ${job.id} is missing actorUserId`);
return { actorUserId, requestId: job.data.requestId ?? randomUUID() };
```
**Impact:** If an attacker gained `jarvis_app_runtime` DB credentials they could enqueue a job with any `actorUserId`, impersonating any user in the worker. This is a second-order concern (DB credential compromise is already game over) but worth noting in a threat model.
**Recommendation:** Document the trust model explicitly in `pg-boss.ts`. Optionally add a job payload HMAC signed with an app secret, verified on dequeue, as defense-in-depth against DB-level manipulation.

---

## Finding 16 — INFO

**File:** `packages/ai/src/gateway/session-tokens.ts`
**Category:** In-Memory Session Registry — Token Loss on Restart
**Finding:** `SessionTokenRegistry` stores MCP session tokens in a plain `Map`. On API process restart, all tokens are lost. Any active MCP client (CLI session) would receive auth errors until the CLI re-authenticates and obtains a new token.
**Impact:** Operational availability only — no security issue. But in combination with Finding 12 (auth header precedence), a restart could cause CLI sessions to fail in a way that appears as an auth error rather than a connectivity error.
**Recommendation:** Acceptable for the current single-process deployment. If multi-process or horizontal scaling is introduced, tokens must be persisted (e.g., short-TTL Redis entries or a DB table with auto-expiry). Add a comment noting this limitation.

---

## Finding 17 — INFO

**File:** `packages/connectors/src/routes.ts:64`
**Category:** Unsafe TypeScript Cast
**Finding:** `const body = request.body as GoogleAuthorizeRequest` is an unsafe type assertion. A Fastify schema (`googleAuthorizeRouteSchema`) is registered for this route, so the body will have been validated against the JSON schema by the time the handler runs. However, the TypeScript cast circumvents the type system rather than using a typed generic (`FastifyRequest<{ Body: GoogleAuthorizeRequest }>`). If the schema is ever changed without updating the cast, the type mismatch will be silently hidden.
**Impact:** InfoSec impact is zero given the schema validation happens at runtime. Developer experience and type-safety hazard only.
**Recommendation:** Use Fastify's generic typing: `server.post<{ Body: GoogleAuthorizeRequest }>(...)` so `request.body` is already typed without an `as` cast. This is the pattern used in `tasks/routes.ts` and elsewhere.

---

## Finding 18 — INFO

**File:** `apps/api/src/server.ts:258-316`
**Category:** X-Forwarded-Proto Header Trust Without Proxy Guard
**Finding:** `readForwardedProtocol` reads `X-Forwarded-Proto` from the request headers and uses it to construct the URL passed to better-auth's handler (`${protocol}://${host}${request.url}`). This function is called unconditionally regardless of `JARVIS_TRUST_PROXY`.
**Evidence:**
```typescript
function toWebRequest(request: FastifyRequest): Request {
  const headers = toWebHeaders(request.headers);
  const protocol = readForwardedProtocol(headers);  // reads X-Forwarded-Proto unconditionally
  ...
  const url = `${protocol}://${host}${request.url}`;
```
**Impact:** When `JARVIS_TRUST_PROXY` is not set, Fastify correctly ignores XFF for IP resolution, but `X-Forwarded-Proto` is still accepted and used to construct the better-auth URL. A direct HTTP client can inject `X-Forwarded-Proto: https` to make better-auth believe the request arrived over HTTPS. This can affect cookie `Secure` flag enforcement and CSRF checks inside better-auth. In practice, better-auth uses the URL only for constructing redirect URIs and cross-origin checks — but accepting an attacker-controlled protocol string is a latent vulnerability.
**Recommendation:** Mirror the proxy guard: only trust `X-Forwarded-Proto` when `JARVIS_TRUST_PROXY` is set. Otherwise, default to `"http"`. Example:
```typescript
const protocol = process.env.JARVIS_TRUST_PROXY
  ? readForwardedProtocol(headers)
  : "http";
```

---

## Hard Invariant Check Summary

| Invariant | Status | Notes |
|-----------|--------|-------|
| No admin private-data bypass (no BYPASSRLS) | PASS | No BYPASSRLS on runtime roles confirmed |
| Private by default | PASS | RLS policies are owner-only by default |
| DataContextDb only | FAIL | Findings 1, 2 — connectors `requireAdmin` and `SettingsRepository` use raw Kysely |
| AccessContext shape (`actorUserId` + `requestId` only) | PASS | No extra fields found |
| Secrets never escape | PASS | Connector secrets AES-256-GCM; no secrets in error responses or job payloads |
| Metadata-only job payloads | PASS | `isDeferredTaskStatusPayloadMetadataOnly` check before enqueue confirmed |
| Provider-agnostic AI | PASS | No hardcoded provider/model references found in API/auth/worker |
| Spec before build | NOT AUDITED | Process gate, not code |
| Module isolation | PASS | No cross-module internal imports observed |
| pgvector image | NOT AUDITED | Infrastructure, not in scope |
| Never edit applied migrations | NOT AUDITED | Migration files not audited in this pass |

---

## Prioritized Remediation Order

1. **Finding 2** (HIGH) — `SettingsRepository` raw Kysely: most surface area, affects all admin operations
2. **Finding 1** (HIGH) — connectors `requireAdmin` raw Kysely: narrower but same invariant class
3. **Finding 4** (HIGH) — 500-as-401 swallowing in notifications/calendar/email: operational + security masking
4. **Finding 3** (HIGH) — missing schemas on chat routes: input validation gap on mutation endpoints
5. **Finding 8** (MEDIUM) — missing schemas on live-chat routes: body size and type enforcement
6. **Finding 7** (MEDIUM) — MCP error message leakage: low-effort sanitization fix
7. **Finding 6** (MEDIUM) — unauthenticated user count: one-line response field removal
8. **Finding 5** (MEDIUM) — missing rate limit on OAuth authorize endpoint: one config block addition
9. **Finding 18** (INFO→MEDIUM in proxy-less deployments) — `X-Forwarded-Proto` trust without guard
10. Remaining LOW/INFO findings as capacity allows
