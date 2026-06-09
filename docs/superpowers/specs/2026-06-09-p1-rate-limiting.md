# Basic Rate-Limiting on Login + OAuth Paste-Back — Design (P1 #53)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09 **Owner:** Ben **Issue:** #53 (Part of epic #46)

## Context

There is no throttling anywhere in the API today. `@fastify/rate-limit` is absent from every
`package.json`. Two endpoint families are brute-force / abuse exposed:

- **Login / credential endpoints** — better-auth is mounted as a catch-all in
  `apps/api/src/server.ts` (`registerBetterAuthRoutes` → `POST/GET/... /api/auth/*`). Email+password
  is enabled (`packages/auth/src/index.ts`, `emailAndPassword: { enabled: true }`). The relevant
  abuse surface is `POST /api/auth/sign-in/email` (credential stuffing) and `POST /api/auth/sign-up/email`.
- **OAuth paste-back** — `POST /api/connectors/google/complete` (`packages/connectors/src/routes.ts`)
  takes a user-pasted `redirectUrl` and exchanges it for tokens. Repeated submission is both an abuse
  vector and a way to hammer Google's token endpoint.

Deployment is a single instance: `infra/docker-compose.yml` defines exactly one `api`, one `worker`,
one `postgres` — no replicas, no scaling, no load balancer. This is a LAN / port-forward self-host.

## Goals

1. Add `@fastify/rate-limit` and register it in `apps/api/src/server.ts`.
2. Throttle the login/credential endpoints under `/api/auth/*`.
3. Throttle `POST /api/connectors/google/complete`.
4. An integration test (via `server.inject()`) asserts a burst past the threshold returns `429`.

## Non-Goals

- Global rate-limiting of every route (only auth + paste-back this slice).
- A shared/distributed rate-limit store (Redis etc.) — single-instance deploy.
- CAPTCHA, account lockout, exponential backoff, or audit-logging of throttle events.
- Rate-limiting the worker, MCP gateway, or chat streaming endpoints.
- Per-user (authenticated-identity) limits — pre-auth endpoints have no trusted user yet.

## Resolved Decisions

| #   | Decision              | Choice                                                                                                                     | Why                                                                                                                    |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Plugin                | `@fastify/rate-limit`                                                                                                      | Official Fastify plugin; first-class v5 support; matches the "plain Fastify" invariant in CLAUDE.md.                   |
| 2   | Scope of registration | Register the plugin **globally disabled** (`global: false`) and opt specific routes in via their route `config.rateLimit`. | Avoids throttling read-heavy app routes; keeps blast radius to the two target surfaces.                                |
| 3   | Better-auth coverage  | Apply the limit on the better-auth catch-all route's `config`, keyed so only mutating credential paths count.              | Login lives behind the `/api/auth/*` catch-all — we cannot add a discrete route without forking better-auth's handler. |

## Resolved Decisions (was open)

**(A) Rate-limit store → in-memory.** Use `@fastify/rate-limit`'s default in-process LRU; no Redis
or shared store. The deploy is provably single-instance (one `api` container in compose, no scaling).
In-memory is zero-dependency and correct for one process; it resets on restart, which is acceptable
for abuse-throttling. Revisit only if/when the API is horizontally scaled (a separate spec).

**(B) Thresholds → 10/min login, 5/min OAuth paste-back, all env-overridable.**

- Login (`/api/auth/sign-in/email`, `/api/auth/sign-up/email`): **10 requests / 1 min** per key.
- OAuth paste-back (`/api/connectors/google/complete`): **5 requests / 1 min** per key.
  Both are exposed as env overrides (`JARVIS_RL_AUTH_MAX`, `JARVIS_RL_OAUTH_MAX`) so they can be tuned
  without a code change. (The window and other knobs are likewise env-overridable.)

**(C) Key function → per-IP via `x-forwarded-for` first hop.** Key per-IP using `x-forwarded-for`'s
first hop when present, else the socket IP. The app already honors `x-forwarded-proto` (see
`readForwardedProtocol` in `server.ts`), so a reverse proxy is expected; trust the first hop for the
key. Accepted caveat: behind a single port-forward, shared-NAT LAN clients may share one source IP,
so per-IP can over-throttle; acceptable for a personal/family self-host. Document the `trustProxy`
assumption in the PR.

## Approach

**`package.json` (root)** — add `@fastify/rate-limit` (matching Fastify v5). Add to root deps
alongside `fastify` (the version the API resolves).

**`apps/api/src/server.ts`:**

- `await server.register(import("@fastify/rate-limit"), { global: false, ... })` near the top of
  `createApiServer`, before route registration (registration must precede the routes it guards).
- Pass the keyGenerator (decision C) and read env-tunable maxes (decision B) once at registration.
- On `registerBetterAuthRoutes`: attach `config: { rateLimit: { max: AUTH_MAX, timeWindow: "1 minute" } }`
  to the `server.route({...})` call. Because the catch-all also serves cheap GET session checks,
  gate the limiter with an `allowList`/key predicate so only `POST` to the sign-in/sign-up subpaths
  consume budget (a custom keyGenerator returning `null` for non-throttled paths skips them).
- On `registerConnectorsRoutes` (`packages/connectors/src/routes.ts`): add
  `config: { rateLimit: { max: OAUTH_MAX, timeWindow: "1 minute" } }` to the existing
  `server.post("/api/connectors/google/complete", { schema, config }, ...)`. This is the connectors
  package, so the per-route config is the only connectors-side change; no plugin import there.

**Wiring note:** the limiter must be registered on the same Fastify instance before
`registerBetterAuthRoutes` / `registerBuiltInApiRoutes` run, so it is registered inside
`createApiServer` immediately after the `Fastify({...})` construction.

## Collision notes

- **#53 ↔ #54 share `apps/api/src/server.ts`.** Both edit `createApiServer`. #54 adds health routes +
  process handlers + pool timeout; #53 adds the rate-limit plugin registration. Land **#54 first**,
  then #53 rebases its single `server.register(rate-limit)` insertion on top.
- **#53 also touches root `package.json` (deps), shared with #51 / #58.** package.json + lockfile is
  a merge magnet. **Merge #53 last** of the package.json-touching trio so it rebases onto their
  dependency additions rather than the reverse.
- `packages/connectors/src/routes.ts` is touched only by #53 in this batch — low collision risk.

## Exit Criteria

1. `@fastify/rate-limit` present in root `package.json` and lockfile; `pnpm install` clean.
2. `pnpm verify:foundation` green (lint, format:check, check:file-size, typecheck, db:migrate,
   test:integration).
3. A burst of `POST /api/connectors/google/complete` past the threshold returns `429`
   (asserted via `server.inject()` in an integration test).
4. A burst of `POST /api/auth/sign-in/email` past the threshold returns `429` (asserted via
   `server.inject()`); a single login still succeeds/fails normally below the limit.
5. Normal app traffic (e.g. `GET /api/modules`, `GET /health`) is **not** throttled.
6. Thresholds are env-overridable; defaults documented in the PR.

## Hard Invariants honored

- Plain Fastify + shared TS contracts preserved — official Fastify plugin, no new contract layer.
- No secrets in logs/payloads — limiter keys on IP only; never logs the pasted `redirectUrl` or creds.
- Module isolation — connectors change is a per-route `config` on its own route; no cross-module import.
- No private-data bypass / RLS untouched — this is transport-layer throttling only.
