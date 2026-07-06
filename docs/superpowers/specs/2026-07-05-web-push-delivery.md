# Web Push notification delivery (#743)

**Status:** Proposed — awaiting Ben's approval
**Date:** 2026-07-05
**Tier:** routine (delivery mechanism; no new private-data surface if payloads stay minimal)
**Builds on:** #14, #735, docs/superpowers/specs/2026-07-04-module-notification-preferences.md, docs/superpowers/specs/2026-07-04-quiet-hours-settings-persistence.md

## Problem

Jarv1s notifications are in-app only (V1, locked by
`2026-06-19-notifications-actor-scoped-hardening.md`): a row in `app.notifications`, read
through the topbar bell and `GET /api/notifications`. There is no delivery path that reaches a
user who does not have a Jarv1s tab open. The Settings > Notifications panel already renders a
`Push` row as `Coming soon` / "Tracked in #743" (`apps/web/src/settings/settings-module-subviews.tsx`
around the Channels group), per #735's decision that Push stays a non-toggle until this spec is
built. #743 asks us to specify (not yet build) real Web Push delivery as a second channel
alongside in-app, sitting on top of the module-preference and quiet-hours plumbing #735 and #733
already established.

## Grounding: what exists today

- **No delivery worker for notifications at all.** `NotificationsRepository.create`
  (`packages/notifications/src/repository.ts`) is called synchronously, inside the caller's own
  `DataContextRunner` scope — e.g. the briefings worker calls it directly inside its own pg-boss
  job (`packages/briefings/src/jobs.ts`). There is no `notifications` pg-boss queue, no fan-out
  step, nothing that currently reacts to "a notification was created." Web Push is not a new leg
  bolted onto an existing delivery worker — it requires the first one.
- **Quiet-hours deferral is in-repository, not queue-based.** `create()` computes `deferred_until`
  synchronously via `computeDeferredUntil` against the actor's quiet-hours settings
  (`QuietHoursPort`), and deferred rows are simply excluded from `listVisible`/`countUnread`
  reads until `now() >= deferred_until`. There is no scheduled job that "wakes up" and delivers
  deferred notifications later — nothing currently polls for rows whose `deferred_until` has
  just passed. In-app doesn't need one (the client just re-fetches), but a push channel does,
  since nothing pushes the client without a job trigger.
- **Module gating is `NotificationPreferencePort.isModuleEnabled`.** `create()` returns `null`
  outright (no row written) when the owning module's per-user notification preference is off.
  Any Web Push send is downstream of a row existing, so it inherits this gate for free — a
  disabled module never reaches Push either.
- **No push/device infrastructure exists yet.** `apps/web/public/service-worker.js` is a bare
  app-shell cache (install/activate/fetch only — no `push` or `notificationclick` listener).
  `apps/web/public/manifest.webmanifest` has no `gcm_sender_id`. There is no `web-push` dependency
  anywhere in the workspace, no VAPID key material, and no device/subscription table. Nothing to
  reuse; this is greenfield except for the queue/job conventions below.
- **pg-boss conventions to inherit** (`packages/jobs/src/pg-boss.ts`,
  `packages/module-registry/src/index.ts`): queues are declared as `QueueDefinition`s with
  `retryLimit`/`deleteAfterSeconds`/`retentionSeconds`; payload keys are enumerated in
  `ALLOWED_PAYLOAD_KEYS` and enforced by `assertMetadataOnlyPayload` — any new job kind must add
  its keys there, and the keys must be IDs only (the calendar-sync precedent
  `docs/superpowers/specs/2026-07-05-calendar-recurring-sync.md` uses `connectorAccountId` only).
  Recurring schedules use `boss.schedule(queueName, cron, data, { key })`, per-entity keyed, as in
  `buildReconcileProactiveSchedule`.
- **No device/session identity concept exists yet.** Nothing in `packages/auth` or `packages/db`
  currently models "this browser instance" as an addressable entity. Per-device Push
  enable/disable (required by the issue's acceptance list) needs a new concept: a push
  subscription row _is_ the device identity for this purpose — there is no existing session/device
  table to hang it off.

## Scope

- A new `push_subscriptions` table (owning module: `notifications`, per the "module SQL lives in
  the owning module's `sql/` directory" invariant) storing, per user per browser subscription:
  subscription endpoint, keys (`p256dh`, `auth`), user agent label (for the per-device list UI),
  created/last-seen timestamps, and enabled/disabled state. Owner-only RLS, consistent with the
  rest of `app.notifications`.
- Browser-side: a `push` and `notificationclick` handler added to `service-worker.js`; a
  subscribe/unsubscribe flow that requests `Notification.requestPermission()`, calls
  `PushManager.subscribe()` with the server's VAPID public key, and POSTs the resulting
  `PushSubscription` to a new notifications-module route.
- Server-side: VAPID key pair (generated once, stored as connector/AI-style encrypted secret per
  the "secrets never escape" + "AES-256-GCM at rest" invariant — this is credential material even
  though it's not a third-party connector), a `web-push`-equivalent send call, and a new pg-boss
  queue (e.g. `notifications.push-delivery`) that is the **first** consumer of "a notification was
  created" — meaning this spec also has to introduce the fan-out step itself (see Open questions).
- A deferred-notification wake job: since Push is the first channel that needs to _act_ when
  `deferred_until` passes (in-app just re-polls), a recurring or delayed job to deliver
  quiet-hours-deferred notifications once their window ends.
- Settings UI: replace the `Push` `Coming soon` row with a real per-device list (enable this
  browser, see other enrolled devices, revoke any of them), once the above lands. Until then the
  row stays `Coming soon` per #735 — this spec does not touch that row's current state.
- Payload: the pg-boss job and the actual push message both carry **notification ID + module ID
  only** — title/body text is fetched (if at all) at delivery time, not carried in the queue
  payload, and the browser-visible push payload itself is minimal (see Non-goals/Guardrails).

## Non-goals / Guardrails

- **No private content in the push payload.** Per CLAUDE.md's "Secrets never escape" and
  "Metadata-only job payloads" invariants: the pg-boss job payload for the delivery queue carries
  only IDs (`notificationId`, and whatever actor-scoping key the job runner needs) — never
  `title`/`body`/`metadata`. The actual browser-delivered push message (the thing shown in the OS
  notification tray) should default to a generic string ("You have a new notification — tap to
  view") unless a future spec explicitly opts a module into richer payload content with its own
  redaction review. This is stricter than the issue's "unless explicitly allowed by spec" —
  default closed, not default open.
- **No system/broadcast delivery path.** Web Push rides on top of the V1 actor-scoped
  `NotificationsRepository.create` — it does not introduce a NULL-`actor_user_id` or
  cross-recipient producer path. If a future spec adds a system emitter, Push delivery inherits it
  unchanged; this spec does not open that door.
- **No new category/urgency model.** Quiet hours and per-module preferences are exactly the #735 /
  #733 systems — this spec does not add push-specific overrides (e.g. "push always fires
  regardless of quiet hours"). Urgent-vs-normal semantics stay as `NotificationsRepository`
  already defines them.
- **No native mobile push (APNs/FCM app push).** This is Web Push (the browser
  `PushManager`/Service-worker API) only. Native app push is out of scope entirely — Jarv1s has no
  native app.
- **Do not flip the Settings Push row to a real toggle as part of this spec.** Writing the spec is
  not building the feature; #735's acceptance ("Push does not look enabled unless implemented")
  stays true until a build PR actually lands and passes its own QA.
- **VAPID key material is a secret**, subject to the same "never reach frontend responses, logs,
  pg-boss job payloads, user exports" rule as connector/AI credentials, even though it is
  Jarv1s-generated rather than a third-party token.

## Open questions (for Ben)

1. **iOS installed-PWA push constraints.** iOS Safari only supports Web Push for a PWA that has
   been _added to the home screen_ (standalone `display: "standalone"` — already set in
   `manifest.webmanifest` — is necessary but not sufficient); push does not work in a regular
   Safari tab, and the permission prompt has different timing/UX rules than desktop Chrome/Firefox
   or Android. Do we scope V1 to desktop + Android only and treat iOS as best-effort/unsupported
   with an honest UI message, or is iOS installed-PWA a hard requirement for launch? This changes
   the permission-UX copy and possibly the "how to enable" onboarding flow materially.
2. **VAPID key + subscription storage schema specifics.** Real open question, not yet decided:
   where does the VAPID private key live (encrypted secret in a new table vs. reusing an existing
   connector-credential-style encrypted-secret mechanism), who can rotate it, and does subscription
   storage need a foreign key to anything in `packages/auth` (there is currently no device/session
   entity to link to — see Grounding) or does the subscription row stand alone as the device
   identity? This needs a schema decision before any migration is written.
3. **Permission denial/retry behavior.** If the browser permission is denied (not just
   dismissed), browsers do not allow re-prompting programmatically — the user must change it in
   browser chrome. Do we detect denied-vs-default state and show a "how to re-enable in your
   browser settings" message, or just show a static disabled row?
4. **Subscription rotation/expiry handling.** Push subscriptions can silently expire or rotate
   (browser-driven); a `410 Gone`/`404` from the push service on send is the normal signal to
   delete the stored subscription. Should this spec's delivery worker handle that inline (delete on 410) as baseline hygiene, or is that a follow-up? (Recommend: baseline, it's cheap and prevents
   permanently-dead rows accumulating.)
5. **Quiet-hours wake mechanism.** In-app notifications rely on the client re-polling after
   `deferred_until` passes — nobody has to "deliver" anything. Push does need an active trigger.
   Is a lightweight recurring sweep (e.g. every few minutes, find `deferred_until <= now()` rows
   not yet pushed) acceptable, or does this need per-notification scheduled jobs
   (`boss.schedule`-per-row, higher cardinality)? Recommend the sweep approach for V1 given current
   notification volume, but flagging since it's a new pattern (nothing today polls for "time has
   passed" on notification rows).
6. **Per-device UI surface.** Where does "see and revoke your enrolled push devices" live —
   inside the existing Notifications settings subview (`settings-module-subviews.tsx`), or a
   different Security/Devices settings surface? #735 put detailed per-module controls inside each
   module's own settings surface; is a device list a "module control" or does it belong somewhere
   else (e.g. near account/session settings)?

## Acceptance criteria (for the future build PR — not this spec)

- Push is **not** shown as an active toggle in Settings until a build PR implementing this spec
  merges and passes independent QA — mirrors #735's existing acceptance line; this spec alone does
  not flip it.
- Users can enable Web Push for the current browser/device, see a list of their enrolled devices,
  and revoke any one of them (including devices other than the current one).
- A module's notifications reach Web Push only when that module's per-user notification
  preference is on (same `NotificationPreferencePort` gate `create()` already enforces) — Push
  never bypasses a muted module.
- Delivery respects quiet hours: a notification created during quiet hours is not pushed until
  the deferral window ends (using the mechanism resolved in Open Question 5), matching in-app's
  existing deferred-until semantics exactly.
- The pg-boss delivery job payload contains only IDs (notification ID, and any minimal actor/
  subscription reference) — no title, body, or metadata field ever appears in a job payload,
  verified by a payload-shape test analogous to the existing `assertMetadataOnlyPayload` checks.
- The browser-visible push message defaults to generic, non-identifying text unless a specific,
  separately-reviewed module opts into richer content — verified by a redaction/gating test.
- Expired/rotated subscriptions (410/404 from the push endpoint) are pruned automatically rather
  than retried forever.
- Tests cover: preference gating (module off → no push), quiet-hours gating (deferred → no push
  until window ends), and payload redaction (no content keys reach the queue or the wire).
