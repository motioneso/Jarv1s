# PR #1117 Live UAT RED Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the three confirmed live-UAT blockers on PR #1117 and leave focused checks proving onboarding destination, bounded Activity loading, and narrow Today layout behavior.

**Architecture:** Keep each fix at its existing boundary: onboarding owns its post-finish destination, the Activity API client bounds a hung audit request while the pane renders truthful recovery, and Today’s existing masthead gets one narrow responsive mode. Sports hero truncation remains deferred because it is a separate component/layout path.

**Tech Stack:** React, React Query, TypeScript, Fastify API client, Vitest, Playwright, existing CSS tokens.

---

## Grounding and scope

- Branch head verified: `4420663551afa52ad6da05e9f5696fe0e8d3ab60`.
- UAT evidence: PR #1117 comment `4997441312`, exact-head desktop `1280×1800` and narrow `390×844`.
- Confirmed blockers: onboarding Settings destination resolves to `/today`; Activity remains `Loading…` after 3.1 seconds; narrow Today lead copy collapses to one word per line.
- Lower residual: Sports desktop hero title truncation is not included in this plan; it uses `packages/sports/src/web/styles/sports-1.css` and has no shared root with Today’s masthead.
- Unproven UAT paths remain classified as missing evidence, environment prerequisites, or separate open-scope work per the handoff; this repair does not claim them fixed.

## Truthful residual disposition

- **Code gap fixed here:** onboarding Settings navigation, hung Activity audit loading, and narrow Today masthead pressure.
- **Code gap deferred:** Sports desktop hero truncation remains a separate lower-severity CSS path in `packages/sports/src/web/styles/sports-1.css`; no shared repair is claimed.
- **Environment prerequisite:** microphone proof requires an authorized secure context and configured transcription; plain-HTTP behavior remains linked to #900/#901.
- **Missing evidence:** News freeform topics/feedback, graceful image failure, destructive export/deletion, email/calendar grants, model switching, and skill upload/invocation remain unproven from the live UAT comment. No closure is inferred from unavailable controls or attempted actions.

## Task 1: Preserve onboarding finish destination

**Files:**

- Modify: `apps/web/src/onboarding/onboarding-wizard.tsx`
- Test: `tests/e2e/onboarding.spec.ts`

- [ ] **Step 1: Add a failing destination assertion.**

Extend the existing mocked founder onboarding flow after the finish screen has loaded. Use the visible `Go to settings` control, then assert the browser URL is `/settings` and the Settings heading is visible. Keep the existing `Open today’s brief` coverage in a separate test or preserve it as-is.

- [ ] **Step 2: Run the focused test and confirm it fails on the current branch.**

```bash
pnpm playwright test tests/e2e/onboarding.spec.ts --grep "settings destination" --workers=1
```

Expected: FAIL because the live UAT path lands on `/today`.

- [ ] **Step 3: Fix the shared completion callback.**

Trace the `finish` mutation through `onSettled`, `navigate`, and `props.onDone`. Preserve the requested destination through completion and ensure the app-shell invalidation callback cannot replace a requested `/settings` navigation with its default `/today` route. Do not change skip behavior or the today destination.

- [ ] **Step 4: Run onboarding checks.**

```bash
pnpm playwright test tests/e2e/onboarding.spec.ts --workers=1
```

Expected: all onboarding tests pass, including both `/today` and `/settings` finish destinations.

- [ ] **Step 5: Commit the task.**

```bash
git add apps/web/src/onboarding/onboarding-wizard.tsx tests/e2e/onboarding.spec.ts
git commit -m "fix(onboarding): preserve requested finish destination"
```

## Task 2: Bound Activity loading and show recovery

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/settings/settings-activity-pane.tsx`
- Test: `tests/unit/api-timezone-request.test.ts`
- Test: `tests/unit/settings-activity-pane.test.tsx`

- [ ] **Step 1: Add failing API timeout coverage.**

Stub `fetch` with a request that never resolves, call `listActionAuditLog()`, advance fake timers past the Activity timeout, and assert the promise rejects with an abort-shaped error and that the request receives an `AbortSignal`. Use the existing `vi`/fetch stubbing style in `tests/unit/api-timezone-request.test.ts`.

- [ ] **Step 2: Run the timeout test and confirm it fails.**

```bash
pnpm vitest run tests/unit/api-timezone-request.test.ts -t "bounds action audit requests"
```

Expected: FAIL because `listActionAuditLog` currently passes no timeout signal.

- [ ] **Step 3: Add the smallest endpoint-specific timeout.**

In `listActionAuditLog`, create an `AbortController`, abort after 3000 ms, pass `signal` to `requestJson`, and clear the timer in `finally`. Keep `requestJson` generic; do not change timeout behavior for unrelated endpoints.

- [ ] **Step 4: Add failing Activity error/recovery rendering coverage.**

Render `ActivityPane` with a QueryClient whose audit query is in an error state and assert it does not render `Loading…` or the empty-state claim. Assert it renders a bounded failure message and a `Try again` button wired to the query refetch path. Match existing SSR/provider test patterns.

- [ ] **Step 5: Run the pane test and confirm it fails.**

```bash
pnpm vitest run tests/unit/settings-activity-pane.test.tsx
```

Expected: FAIL because the current pane has no `isError` branch and treats every non-loading empty result as successful emptiness.

- [ ] **Step 6: Render truthful recovery state.**

Read `isError` and `refetch` from the existing query. Render `Activity unavailable. Try again.` with a button when the request fails; keep loading, successful empty, successful populated, date filters, and family filters unchanged. Do not add a second data source or polling loop.

- [ ] **Step 7: Run focused Activity checks.**

```bash
pnpm vitest run tests/unit/api-timezone-request.test.ts tests/unit/settings-activity-pane.test.tsx
```

Expected: PASS, with no indefinite loading path left after the 3-second bound.

- [ ] **Step 8: Commit the task.**

```bash
git add apps/web/src/api/client.ts apps/web/src/settings/settings-activity-pane.tsx tests/unit/api-timezone-request.test.ts tests/unit/settings-activity-pane.test.tsx
git commit -m "fix(settings): make Activity loading bounded and truthful"
```

## Task 3: Stack Today masthead on narrow viewports

**Files:**

- Modify: `apps/web/src/styles/kit-today.css`

- [ ] **Step 1: Add the narrow masthead rule.**

At the existing `max-width: 720px` breakpoint, make `.cmd-masthead__row` a column, remove the desktop horizontal pressure, and keep the aside’s dateline aligned with the main content. Preserve the existing hidden narrow clock behavior. Use existing spacing tokens; do not change headline copy or introduce JavaScript viewport logic.

- [ ] **Step 2: Verify the CSS repair with the existing design checks and a narrow browser pass.**

```bash
pnpm check:design-tokens
pnpm playwright test tests/e2e/onboarding.spec.ts --workers=1
```

For live evidence, capture Today at `390×844` and assert the lead copy occupies normal readable lines without horizontal overflow. Do not claim Sports title behavior from this check.

- [ ] **Step 3: Commit the task.**

```bash
git add apps/web/src/styles/kit-today.css
git commit -m "fix(today): stack masthead on narrow screens"
```

## Exit and handoff

- [ ] Remove the intentionally untracked handoff file before any product-code push:
  `docs/superpowers/handoffs/2026-07-16-pr-1117-live-uat-red-repair.md`.
- [ ] Run only focused checks requested by the handoff; do not manually rerun GitHub CI/jobs or broad local gates.
- [ ] Re-capture live UAT evidence for onboarding Settings, Activity after 3.1 seconds, and Today at `390×844`.
- [ ] Report Sports truncation as deferred separate residual unless the coordinator explicitly expands scope.
- [ ] Invoke `coordinated-wrap-up` after approved implementation and focused checks; coordinator owns QA, merge, board, and issue state.
