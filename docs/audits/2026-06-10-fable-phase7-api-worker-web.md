## Phase 7 — API & Worker Entry Points

**Model:** claude-sonnet-4-6
**Date:** 2026-06-10
**Scope:** `apps/api/src/server.ts`, `apps/worker/src/worker.ts`, `apps/web/src/` (auth flows, client, app shell), integration tests (rate-limit, health, foundation, release-hardening), rate-limiting and crash-safety specs.

---

### Finding counts

- CRIT: 0
- HIGH: 1
- MED: 3
- LOW: 1
- INFO: 3

---

### Findings

#### [HIGH] No HTTP security headers — CSP, X-Frame-Options, X-Content-Type-Options, HSTS absent

**File:** `apps/api/src/server.ts` (entire file — no hook or plugin sets security headers)
**Invariant violated / concern:** Defense-in-depth; secrets-never-escape (XSS can exfiltrate session cookies if CSP is absent).
**Detail:**
The Fastify server does not register `@fastify/helmet` or any `onSend` hook that emits `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Strict-Transport-Security`. A grep across the entire codebase (`apps/`, `packages/`) found zero occurrences of these header names being set programmatically. The web client uses `credentials: "include"` fetch with httpOnly cookies for session management (good), but without a `Content-Security-Policy` that restricts script sources, a DOM-based or reflected XSS could exfiltrate those cookies via a subdomain or injected `document.cookie` alternative. Without `X-Frame-Options: DENY` or `frame-ancestors 'none'`, the app can be framed in an attacker-controlled page, enabling clickjacking on auth forms. Without `X-Content-Type-Options: nosniff`, browsers may sniff content types on responses.

The spec for issue #54 (crash-safety/health) explicitly called out "Secrets never escape — health responses expose only `ok`/`"ok"|"down"` component flags; never the connection string, error stack to clients" — but the HTTP security header gap is orthogonal and was not addressed in any Phase 1 spec.

**Suggested fix:**
Register `@fastify/helmet` (or equivalent) in `createApiServer` before route registration. Minimal baseline:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (when behind TLS)

---

#### [MED] `/api/bootstrap/status` is unauthenticated and leaks instance-level state

**File:** `packages/settings/src/routes.ts:77`
**Invariant violated / concern:** Principle of least disclosure; information that enables targeted attacks (e.g., "this instance has no users yet — I can register freely") is exposed without any auth.
**Detail:**
`GET /api/bootstrap/status` returns `{ needsBootstrap: boolean, userCount: number }`. It is deliberately unauthenticated (used by the web client before login to decide whether to show sign-up). However, `userCount` is a count of all users in the instance — a non-zero value tells an attacker that active accounts exist and gives a concrete count. More critically, when `needsBootstrap: true`, the API signals that anyone can register the owner account at this moment. In a LAN deployment this is a narrow window, but the window is open as long as the route is reachable without auth.

The route itself touches no private data rows, so it does not directly violate "private by default." But returning a concrete `userCount` in the response body goes beyond what the UI actually needs (it only needs `needsBootstrap: boolean`).

**Suggested fix:**
Remove `userCount` from the `BootstrapStatusResponse` (the web client never uses it; it checks only `needsBootstrap`). Alternatively, suppress the response field in the route serialization. This closes the information-disclosure vector with zero UX impact.

---

#### [MED] Social-auth OAuth state/callback endpoints (`POST /api/auth/sign-in/social`, `/api/auth/callback/*`) not in `THROTTLED_AUTH_PATHS`

**File:** `apps/api/src/server.ts:157-163`
**Invariant violated / concern:** Rate-limiting spec intent; brute-force / replay attack surface.
**Detail:**
`THROTTLED_AUTH_PATHS` covers email sign-in, sign-up, forget-password, reset-password, and change-password. All matching is on `POST` only (all non-POST requests are unconditionally exempted via `allowList`). When social providers (Google, GitHub, Microsoft, OIDC) are configured via env vars, better-auth exposes additional POST endpoints such as `/api/auth/sign-in/social` (initiates OAuth flow) and `/api/auth/callback/:providerId` (exchanges the authorization code). These are not in `THROTTLED_AUTH_PATHS`, so they bypass the rate limiter entirely.

`POST /api/auth/sign-in/social` is not a credential-submission endpoint (it only redirects), so its risk is lower. However, `/api/auth/callback/:providerId` accepts an authorization code and can be replayed/hammered without any throttle, providing a path to token-exchange amplification and potential lockout via racing legitimate callback processing.

The rate-limiting spec (issue #53) explicitly scoped to email credentials and OAuth paste-back; social auth callbacks were not analyzed. The finding is that the scope may be narrower than the actual attack surface.

**Suggested fix:**
Add `"/api/auth/sign-in/social"` and `"/api/auth/callback/google"` (and other configured providers) to `THROTTLED_AUTH_PATHS`, or apply a broader pattern match on `POST /api/auth/*` with a generous shared budget rather than the tight per-path allowlist. Alternatively, document the exclusion with a rationale if the risk is accepted.

---

#### [MED] `requireAdmin` in `packages/connectors/src/routes.ts` queries raw `Kysely` (`dependencies.appDb`) directly, bypassing `DataContextDb`

**File:** `packages/connectors/src/routes.ts:258-262`
**Invariant violated / concern:** "DataContextDb only — Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance."
**Detail:**
The `requireAdmin` helper in the connectors routes executes a raw Kysely query directly against `dependencies.appDb` (the unbranded `Kysely<JarvisDatabase>` handle) to check `is_instance_admin`:

```ts
const user = await dependencies.appDb
  .selectFrom("app.users")
  .select(["id", "is_instance_admin"])
  .where("id", "=", accessContext.actorUserId)
  .executeTakeFirst();
```

This query runs without a data-context transaction, meaning the `SET LOCAL jarv1s.actor_user_id` is not set for this query. For the `users` table this is low risk because the table has RLS enabled (not FORCE RLS), and `jarvis_app_runtime` can SELECT from it. However, it breaks the invariant that all DB access goes through `DataContextDb`, creates inconsistency vs. the identical `requireAdmin` in `packages/settings/src/routes.ts` which also uses the same pattern, and means future tightening of `users` RLS could silently break this check.

**Suggested fix:**
Route the admin check through the `DataContextRunner.withDataContext` with the resolved `accessContext`, using `DataContextDb` for the query — the same pattern used in the rest of the connectors routes. A small `UsersRepository.getUserById` shared method (already present in the settings module) would make this clean without cross-module imports.

---

#### [LOW] `x-forwarded-proto` trusted unconditionally in `toWebRequest` regardless of `JARVIS_TRUST_PROXY`

**File:** `apps/api/src/server.ts:308-316` (`readForwardedProtocol`)
**Invariant violated / concern:** Defense-in-depth; `X-Forwarded-Proto` is attacker-controlled without a trusted proxy.
**Detail:**
`readForwardedProtocol` reads `X-Forwarded-Proto` from the incoming request headers to construct the URL passed to better-auth's handler. The rate-limiter keyGenerator correctly ignores XFF when `JARVIS_TRUST_PROXY` is unset (using only the socket IP). However, `toWebRequest` always reads `x-forwarded-proto` unconditionally, regardless of `trustProxy`. If `JARVIS_TRUST_PROXY` is not set and the server is directly exposed, an attacker can set `X-Forwarded-Proto: https` on a plain HTTP request, potentially confusing better-auth's CSRF origin validation or cookie `Secure` attribute decisions.

In the current single-instance LAN deployment this is low risk (the attacker is already on the network), but it is an inconsistency: the rate limiter got hardened against XFF spoofing, but the protocol header did not get the same treatment.

**Suggested fix:**
Guard `readForwardedProtocol` with the `JARVIS_TRUST_PROXY` env var (already read in `createApiServer`), returning `"http"` when the proxy is untrusted regardless of the header value.

---

#### [INFO] Worker uses `urls.worker` (correct `jarvis_worker_runtime` role) — verified OK

**File:** `apps/worker/src/worker.ts:12-19`
**Detail:**
`getJarvisDatabaseUrls().worker` resolves to `postgres://jarvis_worker_runtime:worker_password@...`. The worker creates both its `workerDb` Kysely handle and its pg-boss client with `urls.worker` only — no reference to superuser, migration owner, or app runtime credentials. The foundation integration test asserts `jarvis_worker_runtime` has `rolsuper: false` and `rolbypassrls: false`. Verified correct.

---

#### [INFO] Health endpoints correctly partition liveness vs. readiness — no internal state leak

**File:** `apps/api/src/server.ts:68-93`
**Detail:**
`GET /health` returns only `{ ok: true }` without DB access (correct liveness endpoint). `GET /health/ready` returns `{ ok, db, pgboss }` with only string status flags (`"ok"` or `"down"`). No connection string, stack trace, version string, or env var is included. Error messages from failed DB/pg-boss probes are caught and suppressed (the `catch {}` branches only set the status flag). Verified satisfies the spec and has no internal state disclosure.

---

#### [INFO] No `localStorage`/`sessionStorage` usage found in web client auth flows

**File:** `apps/web/src/` (entire directory)
**Detail:**
A full grep of the web client source found zero calls to `localStorage.setItem`, `sessionStorage.setItem`, or any direct token/session storage in client-side JavaScript. Authentication state is managed via httpOnly cookies set by better-auth (relayed through the Fastify handler). The `credentials: "include"` fetch option in `apps/web/src/api/client.ts:495` correctly includes cookies on every request. Verified OK.

---

### Summary

The API and worker entry points are well-structured for a personal self-hosted deployment: the worker correctly connects as `jarvis_worker_runtime`, the health endpoint does not leak internal state, and the web client does not store credentials in browser storage. The most significant gap is the complete absence of HTTP security headers (no CSP, no X-Frame-Options, no X-Content-Type-Options), which is the primary remaining browser-side defense-in-depth layer and would be a HIGH priority before any public network exposure. Two MED findings cover: the `userCount` field leaking instance state from the unauthenticated bootstrap endpoint, and a raw-Kysely invariant violation in the connectors admin check. Social OAuth callback paths are not covered by rate limiting, which is a spec gap worth addressing as social providers are enabled.
