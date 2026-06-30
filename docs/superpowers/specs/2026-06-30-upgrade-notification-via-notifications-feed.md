# Upgrade Notification → Notifications Feed (#614 §3)

**Status:** approved
**Issue:** #614 (follow-up to #543 / #609) — build task: #615 (Part of #614)
**Author:** Stanley (spec agent), paired with Ben — 2026-06-30
**Supersedes the alert surface of:** `docs/superpowers/specs/2026-06-29-upgrade-notification.md` (detection/caching unchanged; only the surface + delivery change)

## 1. Problem

The shipped upgrade alert (#609) surfaces "a new version is available" as a **standalone dismissible banner on the Today page** (`apps/web/src/settings/system-upgrade-banner.tsx`, mounted `apps/web/src/today/today-page.tsx:185`). Three defects:

1. **Noisy.** Dismiss writes only local `useState` — not persisted. The banner reappears on every page load / navigation until the instance is actually upgraded. You cannot meaningfully dismiss it.
2. **Admin-gating is accidental.** No explicit role check. Non-admins are "protected" only because `getHostDiagnostics` 403s → `useQuery({retry:false})` leaves `diag` undefined → banner renders `null`. Any caching/SSR change leaks it.
3. **Wrong surface.** It is a bespoke banner, parallel to the app's real per-user Notifications feed.

## 2. Goals

- Move the upgrade alert **into the existing per-user Notifications feed** (`packages/notifications`, `apps/web/src/notifications/notifications-page.tsx`) and **remove the standalone Today banner**.
- Deliver the alert to the **instance owner only** (`users.is_bootstrap_owner = true`) — Ben's decision 2026-06-30. Non-owners never receive it.
- **Persisted dismissal for free:** marking the notification read is the dismissal; it persists via `notifications.read_at`. A _newer_ version produces a _new_ unread notification.
- **Idempotent:** at most one notification per `(owner, version)`, robust to the daily cron and pg-boss retries.
- Fold in the two #614 hygiene items: rate-limit-safe fetch, and a single shared semver comparator (kill the triplication).

## 3. Non-Goals (seam preserved)

- **All-admins fan-out.** V1 is owner-only. The delivery worker is keyed on a recipient user id, so broadening to "every admin-role user" later is a query change + a loop, not a redesign.
- **External push / email / SMS.** Notifications V1 is in-app only (per `2026-06-19-notifications-actor-scoped-hardening.md`); unchanged.
- **Rich in-feed markdown release notes.** The notification links to the existing Settings → Diagnostics release-notes view; we do not build a new markdown renderer in the feed this slice (but we do fix the existing raw-string render — see §5.4).

## 4. Resolved Decisions

- **D1 — Recipient = bootstrap owner.** `users.is_bootstrap_owner = true`. (Ben, 2026-06-30.) A non-owner admin cannot pull the image, so the owner is the only actionable recipient.
- **D2 — RLS-safe delivery is mandatory, dictated by the model.** `NotificationsRepository.create` hard-codes `recipient_user_id = actor_user_id = app.current_actor_user_id()`; RLS is recipient-only `WITH CHECK` (migration 0071). There is **no** cross-user/system-broadcast path and we will not add one (honors "No admin private-data bypass" / no `BYPASSRLS`). Therefore the notification must be created **inside the owner's own `DataContextRunner` scope**, exactly as the briefings job does (`packages/briefings/src/jobs.ts`).
- **D3 — Split detection (global) from delivery (owner-scoped).** Detection stays the existing global job writing `app.instance_settings.latest_release`. A **new owner-scoped delivery job** does the `notifications.create`.
- **D4 — Idempotency via pg-boss singleton key + worker guard.** Enqueue the delivery job with singleton key `upgrade-notify:${ownerUserId}:${version}` so a given `(owner, version)` is enqueued at most once. The worker additionally skips if the owner already has a notification with `metadata.kind === "upgrade_available" && metadata.version === version` (defense under retry / key reset).

## 5. Architecture

### 5.1 Detection (existing, `packages/jobs/src/upgrade-check.ts`) — keep, then extend

After caching `latest_release` (unchanged), the job:

1. Reads the owner id with the raw `workerDb`: `select id from users where is_bootstrap_owner = true` (single row; if none, log + return — pre-bootstrap instance).
2. Enqueues the delivery job (§5.2) with metadata-only payload `{ kind: "upgrade-notify", actorUserId: ownerUserId, version }` and pg-boss options `{ singletonKey: \`upgrade-notify:${ownerUserId}:${version}\` }`.

Payload is actor/resource IDs + version string only → honors "metadata-only job payloads".

### 5.2 Delivery (new owner-scoped worker) — `packages/jobs/src/upgrade-notify.ts` (new)

Registered with `registerDataContextWorker<UpgradeNotifyPayload>(...)` (briefings precedent) so the handler receives `(job, scopedDb)` already scoped to `job.data.actorUserId` (the owner). Handler:

1. Guard: list the owner's recent notifications; if one already has `metadata.kind === "upgrade_available"` and `metadata.version === job.data.version`, return (idempotent).
2. `await notificationsRepository.create(scopedDb, { title: \`Jarvis ${version} is available\`, body: "A newer version of Jarvis is available. View the release notes and upgrade.", urgency: "normal", metadata: { kind: "upgrade_available", version } })`.
3. Best-effort + logged on failure (mirror briefings' `*_notification_failed` pattern); never throw past pg-boss in a way that storms retries for a non-critical alert.

Worker registration wired in `apps/worker` alongside the existing upgrade-check registration.

### 5.3 Frontend — remove the banner, surface via the feed

- **Delete** the standalone banner mount at `apps/web/src/today/today-page.tsx:185` and the `SystemUpgradeBanner` component (`apps/web/src/settings/system-upgrade-banner.tsx`).
- The alert now appears as an ordinary row in `apps/web/src/notifications/notifications-page.tsx` (already renders `title`/`body`, unread state, mark-read). No new gate needed: only the owner is ever a recipient, so visibility is enforced at delivery, not render.
- **"View changes":** the notification body/CTA deep-links to **Settings → Diagnostics**, which already renders `releaseNotes` from `host-diagnostics`. (Keep release-notes display in the admin-scoped Settings pane where it belongs.)

### 5.4 Hygiene (the original #614 §1/§2) — done in this slice

- **Rate-limit safety:** in `upgrade-check.ts`, treat GitHub `403`/`429` (and `5xx`) as a **soft skip** (log + return, no throw) so a rate-limited response can't trigger a pg-boss retry storm against the 60 req/hr unauthenticated limit.
- **One semver comparator:** extract a single shared comparator (home: `packages/module-sdk/src/core-version.ts` already owns major.minor.patch comparison per ADR 0009 §5, or a new `packages/shared` util) and use it in **all three** current call sites (`upgrade-check.ts`, `settings-admin-panes.tsx`, and delete the now-unused `system-upgrade-banner.tsx` copy). Reuse #613's proper comparator (currently `settings-admin-panes.tsx:68`). Add unit tests: `v`-prefix, unequal-length, pre-release ordering (`1.0.0-rc.1` < `1.0.0`).
- The Settings → Diagnostics "Update Available" badge stays (already admin-route-scoped) but switches to the shared comparator.

## 6. Security & Invariants Honored (CLAUDE.md)

- **No admin private-data bypass / RLS applies to all:** delivery runs in the owner's own DataContext scope; no `BYPASSRLS`, no `SECURITY DEFINER` broadcast, no recipient override.
- **Metadata-only job payloads:** both jobs carry only `{kind, actorUserId, version}` — no private content/secrets. Release-notes markdown stays in `instance_settings`, never in a job payload.
- **Secrets never escape:** unchanged; the GitHub call is unauthenticated, no token.
- **Module isolation:** `jobs` consumes `notifications` via the already-injected `NotificationsRepository` public API (briefings precedent), not internals.

## 7. Testing Strategy

- Unit: shared semver comparator (cases above).
- Unit: `upgrade-check` soft-skip on 403/429/5xx (no throw); owner lookup + enqueue with correct singleton key on new version; no enqueue when not newer.
- Integration: delivery worker creates exactly one notification for the owner; second run for the same version is a no-op (singleton + guard); a newer version creates a new unread row; **a non-owner user never sees the notification** (RLS).
- Integration: marking the notification read persists across a re-fetch.

## 8. Acceptance Criteria

- [ ] Standalone `SystemUpgradeBanner` removed from Today; component deleted.
- [ ] On a newer detected version, an upgrade notification appears in the **owner's** Notifications feed; non-owners never receive it (enforced by RLS recipient scope, verified by test).
- [ ] Exactly one notification per `(owner, version)`; daily cron + pg-boss retries do not duplicate.
- [ ] Marking it read persists across reloads/sessions; a subsequent newer version yields a new unread notification.
- [ ] Notification offers a "View changes" path to the cached release notes (Settings → Diagnostics).
- [ ] GitHub `403`/`429`/`5xx` are soft-skipped (no retry storm).
- [ ] A single shared semver comparator is used at all sites; the duplicates are gone; comparator has unit tests incl. pre-release ordering.
- [ ] Delivery honors RLS/no-bypass (no `BYPASSRLS`, no recipient override, no raw `fs`/root-Kysely for the notification write).

## 9. Files In Play

- `~/Jarv1s/packages/jobs/src/upgrade-check.ts` (owner lookup + enqueue; soft-skip; shared comparator)
- `~/Jarv1s/packages/jobs/src/upgrade-notify.ts` (**new** owner-scoped delivery worker)
- `~/Jarv1s/apps/worker/*` (register the new worker)
- `~/Jarv1s/packages/notifications` (consumed via `NotificationsRepository.create` — no change expected; add a list-by-metadata read only if the guard needs it)
- `~/Jarv1s/apps/web/src/today/today-page.tsx` (remove banner mount)
- `~/Jarv1s/apps/web/src/settings/system-upgrade-banner.tsx` (**delete**)
- `~/Jarv1s/apps/web/src/settings/settings-admin-panes.tsx` (use shared comparator; keep badge)
- shared semver util home: `~/Jarv1s/packages/module-sdk/src/core-version.ts` or a new `packages/shared` util

## 10. Open Risks

- **Owner lookup race / no owner yet.** If `is_bootstrap_owner` is unset (pre-bootstrap), the job must no-op gracefully, not throw.
- **Build needs a GitHub `task` issue (Part of #614)** before coding — process gate per CLAUDE.md; this spec satisfies the spec gate only.
- **Singleton-key persistence:** confirm pg-boss singleton semantics dedupe across days as intended; the worker-side metadata guard is the backstop if not.

## 11. Slices (handoff-ready)

- **Slice 1 — Hygiene + shared comparator** (§5.4): soft-skip + extract/reuse semver comparator + tests + retire duplicates. Small, independently shippable, closes #614 §1/§2.
- **Slice 2 — Owner-scoped delivery** (§5.1–5.2): owner lookup, new delivery worker, worker registration, idempotency, tests.
- **Slice 3 — Frontend surface** (§5.3): remove banner/component, wire the "View changes" deep-link, fix the Settings release-notes render (markdown, not raw string).
