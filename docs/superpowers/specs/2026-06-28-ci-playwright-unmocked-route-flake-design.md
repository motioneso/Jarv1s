# CI Playwright unmocked-route flake — design

- **Issue:** #584 — CI flake: Playwright smoke fails with ECONNREFUSED on API proxy
- **Date:** 2026-06-28
- **Scope:** test harness only (`tests/e2e/`); no production code, no CI workflow change
- **Status:** approved design, ready for implementation plan

## Problem

`Verify foundation and app` intermittently fails with repeated `ECONNREFUSED` on
Vite proxy routes (`/api/me/themes`, `/api/me/sessions`, `/api/goals`, …). It
presents as flaky: `main` passes, and PR #581 (ui-polish) triggers it despite
making no changes to CI config, API startup, or Playwright setup.

## Root cause (corrects the issue's hypothesis)

The issue hypothesised "a race between API container startup and the Playwright
runner." That is wrong: **the `verify` CI job runs no API server.** The e2e suite
mocks the API entirely in-browser via Playwright `page.route("**/api/...")`
handlers, installed by `mockApi(page, …)` in `tests/e2e/mock-api.ts`.

The actual mechanism:

- `mock-api.ts` registers handlers for the routes specs use, but has **no
  catch-all fallback**.
- Playwright matches route handlers **most-recently-registered-first**. A request
  matching no handler is not intercepted, so it passes through to the dev server.
- `playwright.config.ts` starts **only Vite** (`:4173`); Vite proxies `/api` to
  `JARVIS_API_PROXY_TARGET ?? http://localhost:3000`, which is not running in the
  `verify` job → `ECONNREFUSED`.

Whether a given run fails depends on request timing and on which client API calls
a branch introduces. UI-polish PR #581 adds/changes client calls
(`apps/web/src/api/query-keys.ts`, `today/goals-section.tsx`, `today/today-page.tsx`,
settings panes) whose routes are not mocked — so it surfaces the latent gap. This
is a real, recurring defect class, not a transient infra race; re-run and waiver
(the issue's listed options) do not fix it.

## Fix

Two parts, both in `tests/e2e/`. Every spec file calls `mockApi(page, …)` as its
first mock step (verified across all 10 specs in `tests/e2e/*.spec.ts`), so a
single install point inside `mockApi` covers 100% of e2e tests.

### 1. Catch-all fallback (eliminates the ECONNREFUSED class)

Register a wildcard `**/api/**` handler as the **first** `page.route` call inside
`mockApi(page, …)`, before any specific route:

```ts
await page.route("**/api/**", (route) =>
  route.fulfill({
    status: 599,
    contentType: "text/plain",
    body: `UNMOCKED ${route.request().method()} ${route.request().url()}`
  })
);
```

Because it is registered first, it is the lowest-precedence handler: every
specific mock in `mockApi` and every per-spec `page.route` override (registered
later) still wins. The catch-all fires only for genuinely unmocked routes,
intercepting them so no request ever reaches the dead Vite proxy again. A `599`
with the method+URL in the body makes the gap visible in the response and the
Playwright trace.

### 2. Add the genuinely-missing mocks

With the catch-all in place, a run emits `599 UNMOCKED <method> <url>` bodies that
name the exact unmocked routes (observed: themes, sessions, goals). Add real
default-fixture handlers for those routes in `mock-api.ts` so PR #581 passes on the
merits rather than by silencing. The authoritative list comes from the failing
run, not from guessing in this spec.

## Verification

- `pnpm test:e2e` runs green locally with **zero** `ECONNREFUSED`.
- Temporarily delete one specific mock and confirm the affected spec now fails with
  `UNMOCKED <method> <url>` (deterministic) instead of an `ECONNREFUSED` proxy
  race.
- Rebase #581 on the fix and confirm `Verify foundation and app` is green.

## Optional hardening (noted, non-gating)

Some unmocked requests are background polls whose failures the app's data layer
may swallow, so a `599` alone would not necessarily fail the test. To convert
those silent misses into hard failures, the harness may collect catch-all hits and
assert the set is empty in an `afterEach`. Out of scope for the minimal fix; record
as a follow-up if silent background misses prove to be a problem.

## Non-goals

- No real API server in CI.
- No change to the `verify` job steps in `.github/workflows/ci.yml`.
- No production application code change.
