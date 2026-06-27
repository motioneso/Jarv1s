# Restrained Proactive Monitoring V1 — Plan

**Goal:** Owner-scoped proactive cards on Today surface; modules register providers; central scanner ranks signals via #526 priority scorer; #527 handles dismiss feedback side effects.

**Architecture:** New `packages/proactive-monitoring` owns scanner, repositories, routes, target verifier. Source providers live in owning module packages. Settings pref `proactive.monitoring.v1` in existing generic `app.preferences` KV. Two new tables: `app.proactive_monitor_state` + `app.proactive_cards` (both FORCE RLS, no admin bypass).

**Tech Stack:** Fastify, Kysely, pg-boss, @jarv1s/priority, @jarv1s/jobs, @jarv1s/module-sdk.

---

## Tasks

- **T1 — Shared API types** `packages/shared/src/proactive-monitoring-api.ts`
  - `ProactiveCardDto`, `ProactiveCardsResponse`, `ProactiveMonitoringSettingsDto`, `ProactiveSource`, `ProactiveSourcePreference`, `ProactiveMonitoringPreferenceV1`
  - Export from `packages/shared/src/index.ts`

- **T2 — Module SDK extension** `packages/module-sdk/src/index.ts`
  - Export `ProactiveMonitorProvider`, `ProactiveMonitorInput`, `ProactiveMonitorResult`, `ProactiveMonitorSignal`, `ProactiveMonitorPriorityAnchor`
  - Add `readonly proactiveMonitor?: ProactiveMonitorProvider` to `JarvisModuleManifest`

- **T3 — Package skeleton + domain types** `packages/proactive-monitoring/`
  - `package.json`, `tsconfig.json`, `src/types.ts` (internal domain types), `src/index.ts`
  - Deps: `@jarv1s/db`, `@jarv1s/module-sdk`, `@jarv1s/shared`, `@jarv1s/priority`, `@jarv1s/jobs`, fastify, kysely

- **T4 — DB migration + types** ⚠️ BLOCKED: migration slot 0122 requires coordinator assignment
  - SQL file placeholder at `packages/proactive-monitoring/src/sql/0122_proactive_monitoring.sql` (do not apply until slot confirmed)
  - Add `ProactiveMonitorStateTable`, `ProactiveCardsTable` to `packages/db/src/types.ts`
  - Add `Selectable` exports `ProactiveMonitorState`, `ProactiveCard`

- **T5 — Preferences repository** `packages/proactive-monitoring/src/preferences-repository.ts`
  - `ProactiveMonitoringPreferencesRepository.get(scopedDb, key)` → defaults when missing/malformed
  - `upsert(scopedDb, key, value)` with unknown-field rejection + server-side validation

- **T6 — Monitor state + card repositories** `src/monitor-state-repository.ts`, `src/card-repository.ts`
  - `MonitorStateRepository`: get/upsert by (owner, source); advance cursor on success; increment failure_count on error
  - `CardRepository`: upsert-by-stable-key, listActive (status=active, deferred_until<=now, limit 5), markDismissed/reactivate

- **T7 — Anti-spam policy** `src/anti-spam.ts`
  - `AntiSpamPolicy.check(scopedDb, ownerUserId, source, stableKey, activationTs)` → allow/suppress/defer
  - Caps: 8/owner/day, 3/source/owner/day, 1/source/owner/hour (use `deferred_until` as activation timestamp)
  - Suppression: dismissed stable key 30 days, `not_useful` ×2/14d suppresses 30d, `too_much` ×2/14d reduces source cap to 1 for 7d

- **T8 — Signal mapper** `src/signal-mapper.ts`
  - Map provider signal types → `PriorityCandidate.signalType` per spec §8 table
  - Source allowlists per spec §8

- **T9 — Scanner core** `src/scanner.ts`
  - `ProactiveScanner.scan(scopedDb, ownerUserId, source, provider, reason)`
  - Steps: load prefs/anchors/tz → cooldown check (15 min unless source-sync) → provider.collectSignals → map → rank via `rankPriorityCandidates` → anti-spam → upsert cards → advance cursor

- **T10 — Jobs** `src/jobs.ts`
  - `ProactiveScanSourceJobPayload extends ActorScopedJobPayload { source, reason, idempotencyKey }`
  - `PROACTIVE_SCAN_SOURCE_QUEUE: QueueDefinition`
  - Worker: build AccessContext → withDataContext → ProactiveScanner.scan; failure keeps cursor, logs metadata only

- **T11 — API routes** `src/routes.ts`
  - `GET /api/me/proactive-cards?status=active&limit=N`
  - `POST /api/me/proactive-cards/refresh` → enqueue eligible scan jobs → 202

- **T12 — Proactive card target verifier** `src/target-verifier.ts`
  - `makeProactiveCardVerifier(cardRepository)` → `FeedbackTargetVerifier`
  - Verifies card exists, owned by actor; returns sourceKind=source, priorityBand, `canRemember=true` when summary is bounded, `rememberExcerpt = title + " — " + summary` (max 300 chars)

- **T13 — UF dismiss side effects** modify `packages/usefulness-feedback/`
  - `src/repository.ts`: add `undoDismissCard?: (cardId) => Promise<void>` to `undo()` options; call when `effect_kind === "proactive_card_dismissed"`
  - `src/routes.ts`: in create flow, after `remember_this` block add `dismiss` block: `effectKind = "proactive_card_dismissed"`, `effectRef = targetRef`; call `cardSideEffects.applyDismiss(scopedDb, actorUserId, targetRef)`; in undo flow, pass `undoDismissCard` callback
  - `src/routes.ts` deps: add `cardSideEffects?: { applyDismiss, undoDismissCard }` to `UsefulnessFeedbackRoutesDependencies`
  - Register `proactive_card` verifier in `packages/module-registry/src/index.ts` (usefulnessFeedback block)

- **T14 — Settings routes** `packages/settings/src/proactive-monitoring-routes.ts`
  - `GET/PATCH /api/me/proactive-monitoring-settings`; reject unknown fields; validate scheduler params (dailyCardCap floor 1, max 20; per-source floor 1, max 5); on PATCH reconcile per-source pg-boss recurring jobs
  - Export from `packages/settings/src/index.ts`; register in `packages/settings/src/routes.ts`

- **T15 — Source providers** (one file per module, update manifest)
  - `packages/tasks/src/monitor-provider.ts` + manifest.ts
  - `packages/calendar/src/monitor-provider.ts` + manifest.ts
  - `packages/email/src/monitor-provider.ts` + manifest.ts
  - `packages/notes/src/monitor-provider.ts` + manifest.ts (anchor-filtered only, per spec §5)
  - Each: `collectSignals(scopedDb, input): Promise<ProactiveMonitorResult>`; queries own tables only; respects `maxSignals`; returns `nextCursor`

- **T16 — Module registry integration** `packages/module-registry/src/index.ts`
  - Add `proactiveMonitorProvidersFor(manifests)` mirroring `focusSignalProvidersFor` pattern
  - Register proactive-monitoring module in `BUILT_IN_MODULES` (routes + workers + sql)
  - ⚠️ coordinate with #525 before editing this file

- **T17 — Integration tests + foundation** 
  - `tests/integration/foundation.test.ts`: add `{ version: "0122", name: "0122_proactive_monitoring.sql" }` row
  - `tests/integration/proactive-monitoring.test.ts`: anti-spam caps, quiet-hours deferral, dismiss/undo side effects, RLS isolation, cursor advance on empty scan, `normal` band creates no card, provider failure preserves cursor

- **T18 — Frontend** `apps/web/src/today/`
  - `proactive-cards.tsx`: card list, source label, title, summary, priority band, Dismiss button (calls UF feedback API)
  - `today-page.tsx`: import and render `<ProactiveCards />` after normal Today content
  - `apps/web/src/api/query-keys.ts`: add `proactiveCards`, `proactiveMonitoringSettings` keys
  - `apps/web/src/api/client.ts`: add `getProactiveCards()`, `refreshProactiveCards()`, `getProactiveMonitoringSettings()`, `updateProactiveMonitoringSettings()`

---

## Pre-push gate

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:tasks && pnpm test:calendar-email && pnpm test:notes && pnpm test:notifications && pnpm test:api
JARVIS_PGDATABASE=jarvis_build_rfa_531_proactive pnpm test:integration
```
