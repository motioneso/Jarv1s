# Apps/API Audit — Thermo-Nuclear Code Quality Review

**Scope:** `apps/api/src/server.ts` + all module route files wired through it:
- `packages/module-registry/src/index.ts`
- `packages/auth/src/index.ts`
- `packages/settings/src/routes.ts` + `repository.ts`
- `packages/connectors/src/routes.ts`
- `packages/tasks/src/routes.ts`
- `packages/chat/src/routes.ts`, `live-routes.ts`, `mcp-transport.ts`
- `packages/ai/src/routes.ts`
- `packages/briefings/src/routes.ts`
- `packages/notifications/src/routes.ts`
- `packages/calendar/src/routes.ts`
- `packages/email/src/routes.ts`

**Date:** 2026-06-10
**Model:** claude-sonnet-4-6

---

## Finding Counts

- CRITICAL: 0
- HIGH: 3
- MEDIUM: 6
- LOW: 4
- INFO: 4

---

## Findings

### [HIGH] Notifications, calendar, and email `handleRouteError` swallow ALL errors as 401

- **File:** `packages/notifications/src/routes.ts:111–117`, `packages/calendar/src/routes.ts:89–91`, `packages/email/src/routes.ts:89–91`
- **Category:** Error Handling
- **Finding:** All three modules implement `handleRouteError` that unconditionally returns `401 Session is missing or expired` for every error — including database errors, RLS policy violations, unexpected thrown values, and internal errors. Any failure (even a network partition to Postgres) returns 401 with identical messaging.
- **Evidence:**
  ```ts
  // notifications/src/routes.ts
  function handleRouteError(error: unknown, reply: FastifyReply) {
    if (error instanceof Error && error.message.includes("Session")) {
      return reply.code(401).send({ error: "Session is missing or expired" });
    }
    return reply.code(401).send({ error: "Session is missing or expired" });
  }

  // calendar/src/routes.ts and email/src/routes.ts
  function handleRouteError(_error: unknown, reply: FastifyReply) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  ```
  The calendar and email versions suppress the error parameter entirely (`_error`).
- **Impact:**
  1. **Masking real errors:** A database outage, RLS violation, or any unexpected exception presents as "Session is missing or expired" to the caller, making it impossible to distinguish auth failures from system failures. Operators cannot triage real breakage.
  2. **Swallowed errors never reach the Fastify logger.** Unlike routes that re-`throw error` for unexpected cases, these handlers silently discard non-auth errors. Post-incident analysis has no log trail.
  3. **Wrong status code for non-auth errors:** RLS policy violations, foreign key constraint failures, and internal bugs should return 400 or 500, not 401. A client receiving 401 for a DB partition will loop re-authenticating uselessly.
- **Recommendation:** Implement the same `handleRouteError` pattern used in `tasks`, `ai`, and `settings` routes — classify auth errors as 401, known HTTP errors as their code, and re-throw unknown errors to reach the Fastify default error handler (which logs and returns 500). Remove the `_error` suppression in calendar and email entirely.

---

### [HIGH] `SettingsRepository` accepts raw `Kysely<JarvisDatabase>` — violates DataContextDb invariant; admin writes run without `app.actor_user_id` GUC

- **File:** `packages/settings/src/repository.ts:63–65`, `packages/settings/src/routes.ts:75`
- **Category:** Architecture / Security
- **Finding:** `SettingsRepository` is constructed with a raw `Kysely<JarvisDatabase>` handle (`dependencies.appDb`), not a `DataContextDb`. This directly violates the project hard invariant: *"DataContextDb only — Repositories accept only a branded DataContextDb handle, never a root Kysely instance."* All write operations (workspace creation, membership upserts, resource grant upserts, instance setting writes, audit event inserts) execute without setting `SET LOCAL app.actor_user_id`, which the `DataContextRunner` normally does inside its transaction.
- **Evidence:**
  ```ts
  // packages/settings/src/repository.ts
  export class SettingsRepository {
    constructor(private readonly db: Kysely<JarvisDatabase>) {}  // raw Kysely
  ```
  ```ts
  // packages/settings/src/routes.ts
  const repository = dependencies.repository ?? new SettingsRepository(dependencies.appDb);
  ```
  No `DataContextDb` brand, no `withDataContext` call, no `SET LOCAL app.actor_user_id` is issued for any repository write.
- **Impact:**
  1. **Hard invariant violation** (CLAUDE.md: "DataContextDb only"). The invariant exists to enforce a single, auditable path through which all DB access flows and the actor GUC is reliably set.
  2. **Future RLS tightening silently breaks.** The `users` table is `ENABLE ROW LEVEL SECURITY` (not `FORCE`). Admin writes to `workspace_memberships`, `workspaces`, `resource_grants`, and `admin_audit_events` are currently not RLS-gated, which is intentional for admin operations. However, if RLS is later added to any of these tables as part of multi-tenant hardening, the missing GUC will cause silent policy violations rather than clear invariant failures.
  3. **Audit log actor correctness.** `insertAuditEvent` manually passes `actorUserId` as a value (not via GUC), which is correct for the audit trail itself but inconsistent with the rest of the system's mechanism.
  4. Previously noted in the Phase 5 security audit (`docs/audits/2026-06-10-fable-phase5-auth-settings.md:128`) as MED; re-confirmed here as HIGH because the Phase 2 multi-user plan (`docs/superpowers/plans/2026-06-10-p2-multi-user-accounts.md`) is active and adds new admin-route write paths that will inherit this pattern.
- **Recommendation:** Refactor `SettingsRepository` to accept `DataContextDb` for all write methods and use `DataContextRunner.withDataContext` in the routes for those calls. Read-only admin queries (e.g., `listUsers`, `countUsers`) that intentionally bypass per-user scoping can stay as raw Kysely on a dedicated `AdminReadRepository` with an explicit architectural note. This resolves the invariant violation and ensures all writes flow through the standard GUC-setting path.

---

### [HIGH] `@fastify/rate-limit` is absent from `apps/api/package.json` direct dependencies — resolution relies on root hoisting

- **File:** `apps/api/package.json`, `apps/api/src/server.ts:1`
- **Category:** Architecture / Error Handling
- **Finding:** `apps/api/src/server.ts` imports `@fastify/rate-limit` directly, but `apps/api/package.json` lists no `@fastify/rate-limit` dependency. The package resolves only because it appears in the root `package.json`'s `dependencies` section. In a strict pnpm workspace with `hoist=false` or when the `api` package is deployed in isolation, this import would fail at runtime with a module-not-found error, silently removing all rate limiting.
- **Evidence:**
  ```json
  // apps/api/package.json — no @fastify/rate-limit
  {
    "dependencies": {
      "@jarv1s/auth": "workspace:*",
      "@jarv1s/db": "workspace:*",
      "@jarv1s/jobs": "workspace:*",
      "@jarv1s/module-registry": "workspace:*",
      "@jarv1s/shared": "workspace:*",
      "fastify": "^5.6.2",
      "kysely": "^0.29.2",
      "pg-boss": "^12.18.2"
    }
  }
  ```
  ```ts
  // apps/api/src/server.ts:1
  import rateLimit from "@fastify/rate-limit";
  ```
- **Impact:** If rate limiting silently fails to load (e.g., in a container deployment without workspace hoisting), the auth brute-force protection disappears entirely with no startup error. All `THROTTLED_AUTH_PATHS` become unlimited. This is a security-critical dependency that must be explicit.
- **Recommendation:** Add `"@fastify/rate-limit": "^10"` to `apps/api/package.json`'s `dependencies`. This is a one-line fix that prevents phantom resolution from silently removing a security control.

---

### [MEDIUM] No global Fastify error handler — unhandled route errors leak raw error messages to clients via Fastify's default serializer

- **File:** `apps/api/src/server.ts` (no `server.setErrorHandler(...)` call)
- **Category:** Security / Error Handling
- **Finding:** Route handlers in `tasks`, `settings`, `ai`, `connectors`, and `chat` modules all call `throw error` for unclassified exceptions inside `handleRouteError`. Fastify's default error serializer then returns `{ statusCode, error, message }` where `message` is the raw `Error.message` from the thrown error. No global error handler is registered to sanitize this output.
- **Evidence:**
  ```ts
  // packages/tasks/src/routes.ts:609
  function handleRouteError(error: unknown, reply: FastifyReply) {
    if (error instanceof HttpError) { ... }
    if (error instanceof Error && error.message === "Session is missing or expired") { ... }
    // ...
    throw error; // <-- reaches Fastify's default handler: leaks error.message
  }
  ```
  Fastify v5 default error response shape: `{ statusCode: 500, error: "Internal Server Error", message: "<error.message>" }`.
- **Impact:** Unexpected errors (Kysely query failures, network errors, unexpected null dereferences) expose their raw `.message` to the caller. A database error might include table names, schema structure, or constraint names in the message. A pg-boss error might include connection strings or queue metadata.
- **Recommendation:** Register a global `setErrorHandler` in `createApiServer` that:
  1. Logs the full error with `request.log.error({ err }, 'Unhandled route error')`.
  2. Returns `reply.code(500).send({ error: 'Internal server error' })` — no message field.
  This is a standard Fastify hardening step and takes about 10 lines.

---

### [MEDIUM] Pervasive duplication of `HttpError`, `handleRouteError`, `requireObject`, `requiredString`, `optionalString` across all route modules

- **File:** All `packages/*/src/routes.ts` files (7 independent copies)
- **Category:** Code Quality
- **Finding:** Every module reimplements the same error-handling and body-parsing primitives independently. There are at least 7 copies of `class HttpError`, 9 copies of `handleRouteError` (with different implementations, some broken), 5 copies of `requireObject`, 5 copies of `requiredString`, and 4 copies of `optionalString`.
- **Evidence (sampled):**
  ```
  packages/ai/src/routes.ts:756         class HttpError
  packages/connectors/src/routes.ts:383 class HttpError
  packages/tasks/src/routes.ts:612      class HttpError
  packages/settings/src/routes.ts:543   class HttpError
  packages/briefings/src/routes.ts:381  class HttpError

  packages/notifications/src/routes.ts:111  handleRouteError (broken — see HIGH finding)
  packages/calendar/src/routes.ts:89        handleRouteError (broken)
  packages/email/src/routes.ts:89           handleRouteError (broken)
  packages/tasks/src/routes.ts:598          handleRouteError (correct)
  packages/ai/src/routes.ts:765             handleRouteError (correct, but diverged)
  ```
- **Impact:** The divergence is not cosmetic. The `notifications`, `calendar`, and `email` modules diverged from the correct implementation and now exhibit the HIGH error-handling bug (Finding 1). Every future module added to the registry will either copy a correct or a broken version. There is no canonical helper to copy from.
- **Recommendation:** Extract a shared `@jarv1s/route-utils` package (or add to `@jarv1s/module-sdk`) containing:
  - `class HttpError`
  - `handleRouteError(error, reply)` — with the full correct implementation
  - `requireObject`, `requiredString`, `optionalString`, `optionalNullableString`
  This is a DELETE-complexity change: it removes ~250 lines of duplicate code and eliminates the divergence risk. The Development Standards ("prefer changes that delete complexity") explicitly call for this kind of consolidation.

---

### [MEDIUM] Seven routes in `chat/routes.ts` (memory/settings, memory/facts, action-requests/resolve) registered without a Fastify JSON schema — no response serialization

- **File:** `packages/chat/src/routes.ts:107–132, 158–226`
- **Category:** Code Quality / Security
- **Finding:** The following routes are registered without a `{ schema: ... }` option:
  - `POST /api/chat/action-requests/:id/resolve`
  - `GET /api/chat/memory/settings`
  - `PATCH /api/chat/memory/settings`
  - `GET /api/chat/memory/facts`
  - `DELETE /api/chat/memory/facts/:id`
  - `PATCH /api/chat/memory/facts/:id`
  These routes have no response schema, meaning Fastify performs no response serialization. Any extra fields present in the DB row (e.g., internal timestamps, foreign keys not intended for clients) will be included verbatim in the response.
- **Evidence:**
  ```ts
  server.get("/api/chat/memory/settings", async (request, reply) => { ... });
  server.patch("/api/chat/memory/settings", async (request, reply) => { ... });
  server.get("/api/chat/memory/facts", async (request, reply) => { ... });
  // etc. — no { schema: ... } argument
  ```
  Compare to routes that do have schemas:
  ```ts
  server.get("/api/chat/threads", { schema: listChatThreadsRouteSchema }, async (request, reply) => { ... });
  ```
- **Impact:** Without a response schema, Fastify does not strip undeclared fields. If the serializer functions (`serializeSettings`, `serializeFact`) ever return an object with extra properties (e.g., if an ORM adds `_raw`, a future column is added, or a developer forgets to pick fields), those fields reach the client silently.
- **Recommendation:** Add Fastify route schemas for all six unschema'd routes. The schemas already exist (or should be added) in `@jarv1s/shared` for each DTO shape; add `response: { 200: ... }` to each route definition.

---

### [MEDIUM] `POST /api/mcp` has no Fastify body schema — user-supplied `method` string is reflected verbatim in error responses

- **File:** `packages/chat/src/mcp-transport.ts:38, 98`
- **Category:** Security / Code Quality
- **Finding:** The MCP transport route has no Fastify `schema` option. The user-controlled `method` field from the request body is reflected directly into the error message returned to the caller: `` `Method not found: ${method}` ``. While the current risk is low (the endpoint requires a valid session token), this is an unrestricted reflection of arbitrary string input and the route accepts any JSON body shape without schema validation.
- **Evidence:**
  ```ts
  server.post<{ Body: McpRequest }>("/api/mcp", async (request, reply) => {
    // No { schema: ... } option — no body validation, no response schema
    // ...
    return reply.code(200).send(jsonRpcError(id, -32601, `Method not found: ${method}`));
    // method = (request.body as McpRequest).method ?? ""  — user-controlled
  ```
- **Impact:**
  1. A crafted `method` value containing newlines or log-forging characters will appear verbatim in the JSON-RPC error response (and potentially in server logs if the response body is logged).
  2. No body size validation: a very large `params` object can be sent to the `tools/call` handler, which forwards it directly to `deps.gateway.callTool(token, params.name, params.arguments ?? {})`. Fastify's default 1MB body limit applies, but the limit is not documented or tested for this route.
- **Recommendation:** Add a Fastify body schema for `/api/mcp` that restricts `method` to a string of reasonable length and `params` to a known shape. Sanitize `method` before reflecting it in error messages (e.g., truncate to 64 chars or replace non-printable chars).

---

### [MEDIUM] `GET /api/bootstrap/status` returns `userCount` and has no rate limit — information disclosure on unauthenticated endpoint

- **File:** `packages/settings/src/routes.ts:77–83`
- **Category:** Security
- **Finding:** This unauthenticated endpoint returns `{ needsBootstrap: boolean, userCount: number }`. It has no rate limit (global rate-limit is `false` and no per-route `config.rateLimit` is set), and it executes a DB query on every call (`app.count_all_users()` via a SECURITY DEFINER function).
- **Evidence:**
  ```ts
  server.get("/api/bootstrap/status", { schema: bootstrapStatusRouteSchema }, async () => {
    const userCount = await repository.countUsers();
    return { needsBootstrap: userCount === 0, userCount };
  });
  ```
- **Impact:**
  1. `userCount` reveals the number of registered accounts to any unauthenticated caller. The web client only needs `needsBootstrap: boolean`.
  2. No rate limit means unlimited DB queries to `count_all_users()` from a single IP.
  3. `needsBootstrap: true` is a public signal that the instance owner account is not yet claimed — this could trigger a race condition where an attacker registers first during initial deployment.
  Note: this finding was also raised in the Phase 7 audit (`docs/audits/2026-06-10-fable-phase7-api-worker-web.md`). Included here for completeness of the API audit trail.
- **Recommendation:** Remove `userCount` from the response. Apply a rate limit (e.g., 20 req/min per IP). Consider restricting `needsBootstrap: true` responses to a configurable setup window.

---

### [LOW] `POST /api/connectors/google/authorize` has no rate limit — creates DB records on every call

- **File:** `packages/connectors/src/routes.ts:60–77`
- **Category:** Security
- **Finding:** The Google OAuth `authorize` endpoint (authenticated, but calls `googleService.startAuthorization` which upserts a DB record with an encrypted `clientId`/`clientSecret`) has no per-route rate limit. The `complete` endpoint does have `JARVIS_RL_OAUTH_MAX` (default 5/min). The asymmetry is notable: `authorize` writes to the DB on every call just like `complete`.
- **Evidence:**
  ```ts
  server.post("/api/connectors/google/authorize",
    { schema: googleAuthorizeRouteSchema }, // no rateLimit config
    async (request, reply) => { ... })

  server.post("/api/connectors/google/complete",
    { schema: googleCompleteRouteSchema,
      config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } } }, // throttled
    async (request, reply) => { ... })
  ```
- **Impact:** An authenticated attacker can flood `/api/connectors/google/authorize` to exhaust DB write capacity or create excessive encrypted blobs in the pending-state table. The endpoint requires authentication, which limits the attack surface, but authenticated DoS against DB write paths is still a concern for a personal productivity tool.
- **Recommendation:** Apply the same `JARVIS_RL_OAUTH_MAX` (or a separate `JARVIS_RL_OAUTH_AUTHORIZE_MAX`) rate limit to the `authorize` endpoint, consistent with the `complete` endpoint.

---

### [LOW] `requireAdmin` in `connectors/routes.ts` queries `app.users` via raw `appDb` — identical to the already-documented invariant violation in settings

- **File:** `packages/connectors/src/routes.ts:253–272`
- **Category:** Architecture
- **Finding:** The connectors module's `requireAdmin` function queries `app.users` directly via `dependencies.appDb` (raw `Kysely<JarvisDatabase>`) without going through `DataContextRunner.withDataContext`. This is the same invariant violation as `SettingsRepository`, independently present in a second module.
- **Evidence:**
  ```ts
  async function requireAdmin(request, dependencies): Promise<AccessContext> {
    const accessContext = await dependencies.resolveAccessContext(request);
    const user = await dependencies.appDb          // raw Kysely — no GUC set
      .selectFrom("app.users")
      .select(["id", "is_instance_admin"])
      .where("id", "=", accessContext.actorUserId)
      .executeTakeFirst();
    ...
  }
  ```
- **Impact:** Same as `SettingsRepository` — currently safe because `users_app_runtime_select` policy is `USING(true)`, but future RLS tightening on `users` SELECT could silently break this check. Also breaks the `DataContextDb` invariant that all DB access uses branded handles.
- **Recommendation:** Already documented in the Phase 7 audit. Route the admin user fetch through `dataContext.withDataContext(accessContext, ...)`. A shared `requireAdminUser(dataContext, accessContext)` helper would eliminate duplication across both settings and connectors modules.

---

### [LOW] `x-forwarded-proto` is read unconditionally in `toWebRequest` regardless of `JARVIS_TRUST_PROXY` setting

- **File:** `apps/api/src/server.ts:308–316`
- **Category:** Security
- **Finding:** `readForwardedProtocol` reads `X-Forwarded-Proto` from every request and uses it to construct the URL passed to better-auth's handler. The `JARVIS_TRUST_PROXY` guard applies only to the rate-limiter IP resolution, not to this header read.
- **Evidence:**
  ```ts
  function readForwardedProtocol(headers: Headers): string {
    const value = headers.get("x-forwarded-proto"); // always read, no trustProxy check
    if (!value) return "http";
    return value.split(",", 1)[0]?.trim() || "http";
  }
  ```
- **Impact:** Without a trusted proxy, a client can set `X-Forwarded-Proto: https` on a plain HTTP request, potentially confusing better-auth's CSRF origin validation or cookie `Secure` attribute decisions. Low risk in a LAN deployment, but an inconsistency with the rate-limiter's hardened XFF treatment.
- **Recommendation:** Guard `readForwardedProtocol` with the same env var: return `"http"` unconditionally unless `process.env.JARVIS_TRUST_PROXY` is set. This finding was also raised in the Phase 7 audit.

---

### [LOW] No Fastify schema validation on `listTasksRouteSchema` query parameters — `quadrant` validated only in handler body

- **File:** `packages/tasks/src/routes.ts:67–92`
- **Category:** Code Quality
- **Finding:** `GET /api/tasks` accepts a `quadrant` query parameter, but `listTasksRouteSchema` (defined in `@jarv1s/shared/src/tasks-api.ts`) has only a `response` schema and no `querystring` schema. The `quadrant` value is validated manually in the route handler via `optionalString` and a manual enum check.
- **Evidence:**
  ```ts
  // packages/shared/src/tasks-api.ts
  export const listTasksRouteSchema = {
    response: { 200: listTasksResponseSchema }
    // no querystring schema
  } as const;

  // packages/tasks/src/routes.ts
  const query = request.query as Record<string, unknown>; // manual cast, no Fastify validation
  const quadrant = optionalString(query["quadrant"], "quadrant");
  ```
- **Impact:** Manual validation in handlers is not intrinsically wrong, but the cast `as Record<string, unknown>` bypasses Fastify's type system. Additional query params are not rejected. This is a code quality concern, not a security issue (the enum check is correct).
- **Recommendation:** Add a `querystring` schema to `listTasksRouteSchema` with `quadrant` as an optional enum string. This eliminates the manual cast, activates Fastify's AJV validation for free, and makes the accepted parameter contract explicit in the shared contract file.

---

### [INFO] `mcpServerUrl` hardcoded to `127.0.0.1:{PORT}` in module-registry — not configurable for multi-process or containerized deployments

- **File:** `packages/module-registry/src/index.ts:149`
- **Category:** Architecture
- **Finding:** The MCP server URL passed to the chat runtime is hardcoded to `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`. In a deployment where the API and worker run in separate containers or where the API is accessed via a different interface, this loopback address may be incorrect.
- **Evidence:**
  ```ts
  mcpServerUrl: `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`,
  ```
- **Impact:** Low risk in the current single-process deployment. The MCP endpoint is only called by the in-process chat session runtime, so the loopback address is always correct. However, this is a latent deployment configuration risk.
- **Recommendation:** Expose `JARVIS_MCP_SERVER_URL` as an env var override, defaulting to the current value. This costs one line and makes the URL configurable for future deployments.

---

### [INFO] `@fastify/rate-limit` missing from `apps/api` package but present in root `dependencies` — dependency graph inconsistency

- **File:** `apps/api/package.json` (see HIGH finding above)
- **Category:** Architecture
- **Finding:** Documented as HIGH above. The placement in root `dependencies` (not `devDependencies`) is itself unusual for a monorepo root — runtime dependencies should live in the package that imports them.
- **Recommendation:** Move `@fastify/rate-limit` from root `dependencies` to `apps/api/package.json` `dependencies`. Audit root `package.json` for other runtime deps that should be scoped to the packages that use them.

---

### [INFO] No CORS plugin registered — cross-origin requests handled entirely by `better-auth`'s `trustedOrigins`

- **File:** `apps/api/src/server.ts` (no `@fastify/cors` registration)
- **Category:** Security
- **Finding:** The Fastify server does not register `@fastify/cors`. CORS is effectively delegated to better-auth's `trustedOrigins` mechanism, which controls `Access-Control-Allow-Origin` only on the `/api/auth/*` routes (handled by better-auth). All other API routes (`/api/tasks`, `/api/chat`, etc.) return no `Access-Control-Allow-Origin` header. In the current single-origin deployment (web on `:5173` → API on `:3000` via Vite proxy) this does not cause browser errors, because the proxy strips the cross-origin requirement. However, if the web client ever communicates directly with the API (e.g., in production), all non-auth routes would fail with CORS errors.
- **Impact:** Currently low (Vite proxy masks the gap in development; production single-origin deployment works). If deployment topology changes to split origins without adding CORS, all API routes except auth would break for browser clients.
- **Recommendation:** Register `@fastify/cors` with appropriate `origin` configuration (matching `JARVIS_AUTH_TRUSTED_ORIGINS`) to explicitly manage CORS for all routes. Document the current proxy-based CORS assumption.

---

### [INFO] No security headers plugin (`@fastify/helmet`) registered

- **File:** `apps/api/src/server.ts` (no `@fastify/helmet` or `onSend` hook for security headers)
- **Category:** Security
- **Finding:** The server emits no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Strict-Transport-Security` headers. This was raised as a HIGH finding in the Phase 7 audit and is re-confirmed here as the most impactful missing security control for browser-facing deployments.
- **Recommendation:** Register `@fastify/helmet` in `createApiServer` before route registration. See Phase 7 audit for the full detail and suggested header values.

---

## Summary

The API server itself (`apps/api/src/server.ts`) is well-structured: auth bridge is correctly implemented, the rate-limiter setup correctly handles the `global: false` + per-route opt-in pattern, and the crash handler and pg-boss lifecycle hooks are clean.

The principal issues are distributed across the route modules wired through the server:

1. **Error handling divergence** (HIGH): Three modules (`notifications`, `calendar`, `email`) have a broken `handleRouteError` that swallows all errors — including system errors — as 401. This needs the duplicate-helper consolidation (MEDIUM finding 4) to be fixed reliably.

2. **DataContextDb invariant violation** (HIGH): `SettingsRepository` — the admin data layer — accepts raw `Kysely`, bypassing the GUC-setting mechanism. This is the systemic root of both this finding and the LOW connectors finding.

3. **Missing package dependency** (HIGH): `@fastify/rate-limit` must be in `apps/api/package.json`, not just the root.

4. **Missing global error handler** (MEDIUM): Fastify's default 500 response leaks raw `Error.message` to clients. A five-line `setErrorHandler` fixes this.

5. **Pervasive route-helper duplication** (MEDIUM): Seven copies of `HttpError`/`handleRouteError`/`requireObject` with diverging implementations. Consolidation into a shared utility is the structural fix that also closes the HIGH error-handling bug.

The security headers gap (INFO, confirmed from Phase 7) remains the most impactful single deployment risk.
