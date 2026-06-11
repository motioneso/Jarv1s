## Phase 23 — apps/api (Fastify API)

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4
- INFO: 2

### Findings

#### [HIGH] No global rate limit — only auth + OAuth routes are throttled; all module routes (chat/AI/tasks) are unthrottled
**File:** `apps/api/src/server.ts:59-65`  
**Invariant violated / concern:** Quality/security smell — denial-of-service and cost-amplification exposure on expensive endpoints.  
**Detail:** The rate-limit plugin is registered with `global: false`, so it only applies where a route opts in via `config.rateLimit`. Grepping the codebase, the only opt-ins are the better-auth catch-all (`server.ts:174`) and the connectors OAuth route (`packages/connectors/src/routes.ts:85`). Every other route — chat (`/api/chat/*`), AI (`/api/ai/*`), tasks, briefings, calendar, email, notifications, and the MCP gateway — has no throttle at all. Chat/AI routes drive real per-user CLI engines and (M-A3) real provider calls; an authenticated user (or a leaked session) can hammer these with no ceiling, causing unbounded cost and resource exhaustion. The composition root is the right place to set a sane global default and let routes raise/lower it.  
**Suggested fix:** Either set `global: true` with a conservative default `max`/`timeWindow` and let sensitive routes tighten via `config.rateLimit`, or explicitly add per-route limits to the chat/AI/MCP routes. Document the policy so new module routes inherit a default instead of being unthrottled by omission.

#### [MED] No security-response-header middleware (no helmet) and no CORS policy registered
**File:** `apps/api/src/server.ts:47-65`  
**Invariant violated / concern:** Defense-in-depth quality bar — missing standard hardening headers.  
**Detail:** Neither `@fastify/helmet` nor `@fastify/cors` is a dependency (`apps/api/package.json:16-20`) and neither is registered anywhere in the repo (grep for `fastify/cors`/`fastify/helmet` returns nothing). The API serves authenticated private data and sets session cookies. With no `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or `Strict-Transport-Security`, responses lack baseline browser hardening. (The same-origin Vite-proxy dev model means CORS is intentionally absent, which is acceptable, but the *absence of any explicit decision* is itself the risk — a future LAN/remote deployment will silently inherit no policy.)  
**Suggested fix:** Register `@fastify/helmet` with a tuned config (at minimum `noSniff`, `frameguard`, `referrerPolicy`, and HSTS when TLS-terminated). Make the CORS stance explicit — either register `@fastify/cors` with an allowlist driven by `JARVIS_AUTH_TRUSTED_ORIGINS`, or add a comment documenting the same-origin-proxy assumption so it is a decision, not an accident.

#### [MED] Auth is enforced per-handler by convention, not by a route-level hook — a new route that forgets `resolveAccessContext` is silently public
**File:** `apps/api/src/server.ts:98-106` (registration) and `server.ts:197-207` (the pattern)  
**Invariant violated / concern:** Private by default (Hard Invariant #2) — auth is opt-in per handler instead of enforced structurally.  
**Detail:** There is no `onRequest`/`preHandler` auth hook in the composition root. Each module route (chat `routes.ts:112`, tasks `routes.ts:69`, and `/api/modules` here) independently calls `resolveAccessContext` inside its own try/catch and returns 401 on failure. The invariant holds today only because every handler remembers to do this. A route added without that call is reachable unauthenticated with no failing test to catch it — the gate enforces nothing structurally. This is also the largest code-judo opportunity in the API: a single `preHandler` that resolves the AccessContext, attaches it to `request`, and short-circuits with 401 would delete the repeated try/catch + 401 boilerplate from every handler across every module (dozens of sites).  
**Suggested fix:** Add a single authentication `preHandler`/`onRequest` decorator at the composition root that runs for all `/api/*` routes except the public allowlist (`/health`, `/health/ready`, the better-auth catch-all). Decorate `request.access` and have handlers read it. This makes "private by default" structural and collapses the duplicated auth+401 branches everywhere.

#### [MED] `/api/modules` reimplements the auth-then-401 pattern inline instead of reusing the shared mechanism
**File:** `apps/api/src/server.ts:196-208`  
**Invariant violated / concern:** Quality bar — duplicated bespoke helper for a canonical concern (auth gate).  
**Detail:** `registerPlatformRoutes` hand-rolls `try { await resolveAccessContext(request) } catch { return reply.code(401)... }`, duplicating the exact pattern that chat (`routes.ts:112-114`) and tasks already repeat. The platform route lives in `apps/api` while module routes live in their packages, so the duplication straddles the layer boundary. Note also it discards the resolved `AccessContext` — it is called purely for its throw side-effect, which obscures the real intent (it is a gate, not a fetch).  
**Suggested fix:** Fold into the route-level auth hook from the preceding finding. If a hook is not adopted, at least extract a shared `requireSession(request, reply)` helper and call it as a `preHandler` so the side-effect-only call reads as a gate.

#### [MED] No global error handler or 404 handler — uncaught errors fall through to Fastify defaults
**File:** `apps/api/src/server.ts:67-107`  
**Invariant violated / concern:** Error handling quality bar / Secrets-never-escape (Hard Invariant #5) defense-in-depth.  
**Detail:** The composition root registers no `setErrorHandler` or `setNotFoundHandler`. `handleBetterAuthRequest` (`server.ts:233-256`) has no try/catch, so a throw inside `authRuntime.auth.handler` produces Fastify's default 500. Fastify's default error serializer omits the stack in the JSON body (good), but it logs the full error and any `error.message` that a downstream module throws can be surfaced verbatim to clients (e.g. chat `routes.ts:273-277` matches on `error.message` and echoes it). Without a single normalizing error boundary, each module decides independently what reaches the client, and there is no central place guaranteeing internal messages/secrets are not leaked in error responses.  
**Suggested fix:** Register a `setErrorHandler` at the composition root that maps known error types to safe status+message and returns a generic body (with a `requestId`) for everything else, logging the detail server-side only. Add a `setNotFoundHandler` returning a consistent JSON 404. This also lets module handlers `throw` instead of each crafting `reply.code(...).send(...)`.

#### [LOW] `readForwardedProtocol`/`host` are read unconditionally from client-controlled headers to build the better-auth request URL, ignoring `JARVIS_TRUST_PROXY`
**File:** `apps/api/src/server.ts:258-262`, `308-316`  
**Invariant violated / concern:** Concern — inconsistency with the deliberate `trustProxy` opt-in gating elsewhere.  
**Detail:** `toWebRequest` builds the URL handed to better-auth from `x-forwarded-proto` (via `readForwardedProtocol`) and the `host` header with no trust gate, while the rate limiter (`server.ts:51,64`) deliberately only honors XFF when `JARVIS_TRUST_PROXY` is set. The constructed URL feeds better-auth's request handling; trusted-origin/CSRF checks are driven by the Origin/Referer headers and `trustedOrigins`, so practical impact is limited, but reading proxy headers in one path while explicitly distrusting them in another is an inconsistent trust model that invites a future regression.  
**Suggested fix:** Gate `readForwardedProtocol` (and ideally the `host`) behind the same `JARVIS_TRUST_PROXY` flag, falling back to the connection scheme/`request.protocol` when untrusted, so proxy-header trust is decided in exactly one place.

#### [LOW] `serializeModule` uses a `ReturnType<typeof ...>[number]` inferred parameter type instead of the public manifest type
**File:** `apps/api/src/server.ts:210`  
**Invariant violated / concern:** TypeScript quality bar — obscured contract via inferred structural type.  
**Detail:** The function parameter is typed `ReturnType<typeof getBuiltInModuleManifests>[number]` rather than the exported `JarvisModuleManifest`. This couples the serializer to the inferred shape of a function return rather than the named domain type, making the real contract harder to read and refactor-fragile (the file already imports from `@jarv1s/shared`).  
**Suggested fix:** Type the parameter as `JarvisModuleManifest` (import the type) so the contract is explicit.

#### [LOW] `/health/ready` swallows the underlying DB/pg-boss error with bare `catch {}`
**File:** `apps/api/src/server.ts:74-87`  
**Invariant violated / concern:** Error handling quality bar — fully swallowed errors hide root cause.  
**Detail:** Both readiness probes use `catch { dbStatus = "down" }` / `catch { pgbossStatus = "down" }` with no logging. Returning `"down"` to the client without infra detail is correct (no leak), but discarding the error entirely means an operator debugging a flapping readiness probe has nothing in the logs to explain *why* the dependency is unhealthy.  
**Suggested fix:** Log the caught error at `warn`/`error` server-side (`request.log.warn({ err }, ...)`) while still returning only the coarse `"down"` status to the client.

#### [LOW] Crash drain uses a 2s `setTimeout` race with no guarantee the server closed; potential abrupt exit mid-flush
**File:** `apps/api/src/server.ts:131-144`  
**Invariant violated / concern:** Quality smell — fixed-timeout race in shutdown path.  
**Detail:** `handleCrash` races `server.close()` against a 2000ms timer and then unconditionally `process.exit(1)`. The magic 2000 is undocumented, and on a slow drain in-flight requests/log flushes can be cut off. Minor for a crash path, but the constant and the rationale are undocumented.  
**Suggested fix:** Extract the timeout to a named constant with a comment, and log whether the drain completed or timed out before exiting.

#### [INFO] Composition root is clean, thin (324 lines), and well under the 1000-line limit; routes correctly delegate to module public APIs
**File:** `apps/api/src/server.ts:1-124`  
**Invariant violated / concern:** Reviewed — clean.  
**Detail:** `apps/api` is a single 324-line file that does exactly composition: it builds `appDb`, `boss`, and `authRuntime`, tracks ownership for correct teardown (`ownsAppDb`/`ownsBoss`/`ownsAuthRuntime`), and registers routes via the `@jarv1s/module-registry` public API (`registerBuiltInApiRoutes`). It does not import any module's internals or query any module's tables directly (Module Isolation, Hard Invariant #9 — upheld). `DataContextRunner` is constructed once from `appDb` and passed down; no root Kysely handle is leaked to handlers (Hard Invariant #3 path is respected at this layer). The rate-limit-before-routes ordering via `server.after()` is correctly explained in the inline comment.  
**Detail (cont.):** The `THROTTLED_AUTH_PATHS` percent-decode-before-match logic (`server.ts:178-188`) correctly closes the `%65mail` allowlist-bypass and fails closed (malformed sequence → throttled). The `trustProxy`/`keyGenerator: request.ip` pairing for the rate limiter is the correct, documented secure default. No secrets, hashes, or tokens are present in any response serializer in this file (`serializeModule` returns only public manifest metadata; `/health` returns booleans/coarse status strings only — no infra detail leaked).

#### [INFO] better-auth header proxying correctly strips `content-length` and re-emits `set-cookie` via the multi-value getter
**File:** `apps/api/src/server.ts:240-256`, `318-324`  
**Invariant violated / concern:** Reviewed — clean.  
**Detail:** `handleBetterAuthRequest` copies response headers but skips `content-length` (recomputed by Fastify from the Buffer body) and `set-cookie` (handled separately), then re-applies all Set-Cookie values via `Headers.getSetCookie()` so multiple cookies are preserved as an array rather than being flattened/clobbered. Body is reconstituted from `arrayBuffer()` into a Buffer and an empty body sends no payload. This is a correct and minimal web-Response↔Fastify-reply bridge with no secret leakage beyond the cookies better-auth itself intends to set.
