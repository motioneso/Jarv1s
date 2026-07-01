# #648 Wellness Timezone Server Codex Plan

> **For agentic workers:** Coordinated-build lane only. Do not implement until Coordinator approves this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the server-side #648 slice: validated `X-Timezone` request signal plus wellness medication day bucketing in the resolved user timezone.

**Architecture:** Reuse existing `@jarv1s/shared` time utilities and add only missing resolver/plumbing. Keep `AccessContext` unchanged. Wellness routes resolve timezone explicitly from header first, stored locale only when needed, then pass it to repo/day-window logic.

**Tech Stack:** TypeScript, Fastify, Vitest, `Intl.DateTimeFormat`, `DataContextRunner`, `PreferencesRepository`.

---

## Premises Verified

- `packages/shared/src/time.ts` has `localDay`, `formatInZone`, `isValidTimeZone`; `resolveTimeZone` is absent.
- `apps/web/src/api/client.ts` central `requestJson` does not send `X-Timezone`.
- `apps/api/src/server.ts` has no Fastify request timezone hook/declaration.
- `packages/wellness/src/repository.ts` `listLogsForDate` uses UTC day boundaries.
- `packages/wellness/src/routes.ts` insights/adherence loops use UTC day iteration and ISO slicing.
- `AccessContext` stays `{ actorUserId, requestId }`; no plan step changes it.
- `docs/coordination/` is not touched.

## Task 1: Shared Resolver

**Files:**

- Modify: `packages/shared/src/time.ts`
- Test: `tests/unit/shared-time.test.ts`

- [ ] Add `resolveTimeZone(headerTz?: string | null, storedTz?: string | null): string`.
- [ ] Trim inputs, accept valid header first, then valid stored timezone, else `"UTC"`.
- [ ] Reuse `isValidTimeZone`; no new date library.
- [ ] Add Vitest cases for header precedence, invalid header fallback, blanks -> UTC, trimming.
- [ ] Run `pnpm test:unit -- tests/unit/shared-time.test.ts`.
- [ ] Commit only these files.

## Task 2: Request Header + Fastify Signal

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/api/src/server.ts`
- Test: add `tests/unit/api-timezone-request.test.ts`

- [ ] Web `requestJson` sets `X-Timezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone` when present and caller did not already set it.
- [ ] Server adds Fastify request augmentation plus `onRequest` hook validating `x-timezone` with `isValidTimeZone`.
- [ ] Missing/invalid headers leave `request.timeZone` undefined; no throw.
- [ ] Tests cover client header, caller header preservation, server valid/invalid behavior.
- [ ] Run `pnpm test:unit -- tests/unit/api-timezone-request.test.ts`.
- [ ] Commit only these files.

## Task 3: Wellness Resolved Timezone + Day Windows

**Files:**

- Modify: `packages/wellness/src/repository.ts`
- Modify: `packages/wellness/src/routes.ts`
- Test: extend `tests/integration/wellness-medications.test.ts`

- [ ] Add minimal timezone-aware UTC boundary helper for a local `YYYY-MM-DD` day using `Intl` offsets. Use it in `listLogsForDate(scopedDb, date, timeZone = "UTC")`.
- [ ] Extend `WellnessRoutesDependencies` with optional `resolveRequestTimeZone?: (request, accessContext) => Promise<string>`.
- [ ] In wellness schedule/insights/adherence routes, resolve timezone explicitly after `resolveAccessContext`; do not add timezone to `AccessContext`.
- [ ] Replace adherence/insights UTC day loops with local-day keys and timezone-aware boundaries.
- [ ] Add integration regression: a US late-evening instant buckets to the US local day, not the UTC day, for `/api/wellness/medications/logs`.
- [ ] Run `pnpm test:integration -- tests/integration/wellness-medications.test.ts`.
- [ ] Commit only these files.

## Task 4: Composition Wiring

**Files:**

- Modify: `apps/api/src/server.ts`
- Modify: `packages/module-registry/src/index.ts` only if needed to pass the new optional wellness dependency
- Test: extend `tests/unit/api-timezone-request.test.ts` or nearest module-registry unit test

- [ ] Wire wellness route dependency to resolve `resolveTimeZone(request.timeZone, storedLocaleTimezone)`.
- [ ] Read stored `locale.timezone` only when `request.timeZone` is absent.
- [ ] Use existing `PreferencesRepository`/`DataContextRunner`; preserve `DataContextDb only`.
- [ ] Add test proving valid header avoids stored fallback and invalid/missing falls back.
- [ ] Run focused unit test plus `pnpm typecheck`.
- [ ] Commit only touched files.

## Task 5: Audit + Gate

**Files:**

- Modify only files required by failing audit.

- [ ] Run targeted audit:

```bash
rg -n "\.slice\(0, ?10\)" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n "Date\.UTC\(" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n "getUTC(Date|FullYear|Month)\(" apps packages --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
```

- [ ] Classify remaining wellness hits as deliberate naive civil scheduling or fix them.
- [ ] Run `pnpm check:no-ambient-dates`.
- [ ] Run pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`.
- [ ] Run final `pnpm verify:foundation` before coordinated wrap-up.
