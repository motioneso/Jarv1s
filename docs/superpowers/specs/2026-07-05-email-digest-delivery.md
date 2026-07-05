# Notification email digest delivery (#742)

**Status:** Proposed — awaiting Ben's approval
**Date:** 2026-07-05
**Tier:** routine (delivery mechanism, content-redaction discipline required)
**Builds on:** #14, #735, docs/superpowers/specs/2026-07-04-module-notification-preferences.md, docs/superpowers/specs/2026-07-04-quiet-hours-settings-persistence.md

## Problem

`packages/notifications` is in-app-only (V1, locked by
`2026-06-19-notifications-actor-scoped-hardening.md`): "no external push / email / SMS delivery."
The Notifications settings panel (#735, approved) shows "Email digest" only as a `Coming soon` /
unavailable row pointing at this issue — it is not a working toggle. #742 asks us to actually design
(and later build) periodic email delivery of a user's accumulated module notifications, so someone
who doesn't have the app open still hears about what happened.

This spec grounds the design in the *actual* current system: the module-based notification
preference model from #735, the quiet-hours persistence work from #733, the recurring-schedule
pattern already used by proactive scanning and briefings, and the *only* outbound-email code that
exists in the repo today (which turns out not to be a general-purpose "send a new email" capability
— see §3 below, the single biggest open item).

## Scope

### 1. Digest preference and cadence

- A new per-user digest preference, keyed the same way other simple per-user settings are today
  (a `PreferencesRepository`-style generic key/value row, per the pattern already used for
  `notifications:${moduleId}` in #735 and for priority/persona settings) — not a new bespoke table
  unless the cadence/watermark fields genuinely don't fit a JSON blob.
- Fields: `enabled: boolean`, `cadence: "daily" | "weekly"`, and schedule metadata shaped like
  briefings' `schedule_metadata` (`targetTime: "HH:MM"`, `timezone`, `dayOfWeek` for weekly) —
  reuse `cronExprFor` / `timezoneFor` from `packages/briefings/src/schedule.ts` verbatim rather than
  re-deriving cron logic. This is the same "cadence and user scheduling controls" the issue asks for,
  and briefings already solved it once.
- Disabled by default. Turning it on requires the user to already have at least one notification
  module enabled (§2); otherwise the toggle is a no-op with an explanatory state (mirrors #735's
  "no working-looking controls that do nothing").

### 2. Which notifications appear in digest

- Digest content is **module-scoped**, exactly like the live in-app model in #735: a notification's
  `module_id` must belong to a module the user currently has enabled in Notifications settings.
  There is no separate "digest categories" list to invent — digest is a delivery channel over the
  *same* preference surface, not a second preference system.
- Digest and in-app are **additive, not exclusive**: a notification still appears in-app immediately
  (unchanged); the digest email is a periodic recap of what accumulated, not a replacement channel.
  This matches "which notification categories appear in digest versus live in-app" from the issue —
  the answer is "the same ones the module preference already gates," not a new split.
- No urgent/system bypass in digest either, consistent with #735 §2 ("no urgent/system bypass in
  Notifications").

### 3. Sending path — the big open item

Searched the repo for any existing outbound-email capability (`sendMail`, `nodemailer`, SMTP, SES,
Resend, Postmark). What exists:

- `packages/email` + `packages/connectors` (`GoogleEmailWriteProvider`, `ImapEmailWriteProvider`)
  implement `EmailWriteService.sendReply` / `draftReply` — used **only** by the chat email-reply
  tool. This is **not** general-purpose send-any-email infrastructure:
  - It requires an existing cached `EmailMessage` and a non-null `threadId` — `GoogleEmailWriteProvider.run()`
    returns `{ ok: false }` immediately if `threadId` is falsy. It composes a MIME **reply** to that
    thread (`buildReplyMime`), not a fresh message.
  - It sends through the **user's own connected** Google OAuth token or IMAP/SMTP app-password
    credentials (`getFreshAccessToken`, `getActiveImapAccountSecret`) — i.e. it sends *as the user*,
    to *the message's sender*, from inside a synchronous chat-tool call. There is no system-initiated,
    scheduled-job send path anywhere in the codebase today.
  - Reusing it for a digest would mean either addressing a "reply" at nothing (no real thread to
    reply to — a digest is Jarvis-to-user, not user-to-someone-else) or extending both providers
    with a genuinely new "compose a fresh message" mode. That's a real code change to shared
    infrastructure other tools depend on, not a free reuse.
- Nodemailer is already a dependency (via `ImapEmailWriteProvider`), so the *library* is available,
  but there is no configured system-level sending identity (no verified "notifications@" sender, no
  SES/Resend/Postmark account, no SMTP relay credential store for Jarvis-as-sender rather than
  user-as-sender).

**Two real options, both legitimate, neither free:**

- **(a) Send via the user's own connected account.** Extend `EmailWriteProvider` with a
  `sendNew`-style method (no `threadId`), address the message to the user's own on-file email
  address, and send it through whichever provider (Google/IMAP) the user already has connected for
  reading/writing email. Pro: no new secret type, no new vendor, stays inside the existing
  "credentials never escape" boundary that's already audited for this module. Con: only works for
  users who have connected Google or IMAP at all; a user with zero email connectors configured
  cannot receive a digest under this option, which may be a meaningful chunk of the user base.
- **(b) New system-level outbound sender.** Add a transactional email provider (SES/Resend/Postmark/
  a bare SMTP relay) as Jarvis's own sending identity, independent of any user's connected accounts.
  Pro: works for every user regardless of connector state. Con: genuinely new outbound infrastructure
  — new secret class to encrypt/store/rotate, new failure modes, a real vendor decision, and (per
  CLAUDE.md's "provider-agnostic" spirit applied to infra, not just AI) ideally sits behind a thin
  `DigestEmailSender` adapter interface (`send(to, subject, text, html)`) so the vendor is swappable
  without leaking a specific SDK into the digest compose/worker logic. This is the more scalable
  answer but is a bigger scope item that arguably deserves sign-off as its own decision, not a detail
  buried inside this spec.

This spec does **not** pick (a) vs (b) — that's the first thing to resolve with Ben before any build
issue is filed (see Open Questions). Whichever is chosen, the adapter boundary (`DigestEmailSender`)
should exist either way so the digest worker never imports a vendor SDK or a connector-provider type
directly — that satisfies the provider-agnostic guardrail without over-building a plugin system for
a single sender.

### 4. Scheduled compose job

- Reuse the established recurring-schedule pattern (`buildReconcileProactiveSchedule` in
  `packages/module-registry/src/index.ts`, using `boss.schedule` / `boss.unschedule` keyed by
  `${actorUserId}:${...}`, and briefings' `cronExprFor`/`timezoneFor`): when a user enables digest or
  changes cadence/time/timezone, reconcile their personal `boss.schedule` entry for a
  `DIGEST_COMPOSE_QUEUE` job keyed `digest:${actorUserId}`.
- **Metadata-only payload** (per CLAUDE.md hard invariant): the enqueued job carries only
  `{ actorUserId, reason: "scheduled-digest", idempotencyKey }` — run `assertMetadataOnlyPayload`
  on it, exactly as `buildReconcileProactiveSchedule` already does for
  `ProactiveScanSourceJobPayload`. No notification titles, bodies, or metadata ride in the pg-boss
  payload.
- The worker, running inside that actor's `DataContextRunner`/`DataContextDb` scope (RLS-scoped,
  never a root Kysely handle), re-fetches the actor's own unread/undelivered notifications at render
  time via `NotificationsRepository`, filters by enabled module (§2), renders the digest, and calls
  the digest sender (§3). This mirrors the briefings compose pipeline shape (`ComposeDeps` builds
  content from live/cached sources at render time, not from a pre-baked payload).

### 5. Content limits (secrets never escape)

- Digest content should reuse the **existing sanitized notification projection**
  (`serializeNotification` in `packages/notifications`), which is already bounded (≤16 metadata keys,
  primitive values, ≤256-char strings, ≤4096 bytes total) and is the same chokepoint the in-app bell
  and the `notifications.listVisible` tool go through. The digest must **not** re-derive content from
  the underlying source record (task body, note body, email body, calendar event details) — only the
  already-produced notification title/summary text is eligible. This gives a concrete, enforceable
  answer to "digest content limits" rather than leaving it as a vague TODO: if it isn't already safe
  enough to show in-app, it isn't safe enough to email.
- No secrets, tokens, credentials, or raw private payload ever enter the digest render path or the
  email body — this is the same boundary already enforced for notifications generally, applied
  transitively.

### 6. Quiet hours and duplicate suppression

- Quiet hours (#733) governs *live* notification deferral timing; digest is inherently a batched,
  user-scheduled send, so the two don't compose the same way live push would. Proposed rule: quiet
  hours does **not** block or shift the digest send time — the user already chose `targetTime`
  deliberately as part of enabling digest, and that choice should be respected as-is. Flagged as an
  open question below in case Ben wants the digest send itself deferred when `targetTime` happens to
  fall inside the user's quiet-hours window.
- Duplicate suppression: each digest run needs a per-user watermark (`lastDigestSentAt` or a
  `lastIncludedNotificationId` high-water mark) so the same notification is never included in two
  digests. Store it alongside the digest preference row and advance it only after a confirmed
  successful send. Already-read notifications (read in-app before the digest fires) should still be
  suppressible from appearing in digest as "new" — read state already exists in
  `app.notification_reads` and should gate inclusion the same way it gates the unread badge.

## Non-goals / Guardrails

- Web Push delivery — separate issue #743, not touched here.
- Any change to the V1 in-app delivery model, `app.notifications` schema, or the
  `notifications.listVisible` tool beyond reading from it.
- A general-purpose "Jarvis can send arbitrary email" capability, an email-marketing/broadcast
  system, or any cross-user send path.
- No urgent/system bypass of module preferences for digest (consistent with #735).
- No new category system — digest rides the existing per-module preference, not a parallel taxonomy.
- Do not resolve the (a)-vs-(b) sending-path decision inside a build PR without Ben's sign-off first —
  it changes secret-handling scope materially either way.
- No rich HTML template engine or per-module custom email layouts in v1 — a single plain
  text/minimal-HTML digest template is sufficient for the acceptance bar below.

## Open questions

1. **Sending path: (a) via the user's own connected Google/IMAP account, or (b) a new system-level
   transactional email provider?** This is the largest undecided scope item — (b) is new outbound
   infrastructure (new secret class, new vendor decision) arguably big enough to want its own
   milestone/spec rather than a section of this one; (a) is narrower but leaves users with no
   connected email connector unable to receive digests at all. Needs Ben's call before a build issue
   is filed.
2. If (b): which vendor (SES / Resend / Postmark / bare SMTP relay), and does Jarvis's deployment
   model (self-hosted, per CLAUDE.md's install/compose story) make a specific one clearly preferable?
3. Cadence granularity: is `daily`/`weekly` enough, or does the issue's "user scheduling controls"
   imply something more flexible (e.g. arbitrary N-day interval)? Recommend starting with
   `daily`/`weekly` only and treating anything finer as a later enhancement.
4. Quiet hours: should the digest send be deferred/shifted if the user's chosen `targetTime` falls
   inside their quiet-hours window, or is a user-chosen send time exempt by definition (this spec's
   default assumption in §6)?
5. Empty-digest handling: skip the send entirely when zero eligible notifications accumulated (likely
   yes — avoid mailbox noise), or send a "nothing new" digest? Recommend skip.
6. What happens if the user has no verified email address on file at all (e.g. account created via a
   flow that never captured one)? Digest toggle should probably stay disabled/unavailable in that
   case rather than silently failing sends.
7. Unsubscribe/one-click-disable: does the digest email itself need a direct link back to the digest
   setting (good practice, low effort) even though this isn't a marketing email subject to CAN-SPAM
   in the traditional sense?
8. Retry/backoff policy on send failure — one attempt with the next scheduled digest picking up
   anything missed (relying on the watermark), or an explicit retry within the same job?

## Acceptance criteria

- Email digest is **not** shown as an active toggle in Notifications settings until this is actually
  built and this spec's chosen sending path is implemented end-to-end (the #735 `Coming soon` row
  stays as-is until then).
- Users can enable/disable digest and configure cadence (`daily`/`weekly`) and send time/timezone.
- Digest content is gated by the same per-module notification preference used for in-app delivery —
  a module disabled in Notifications settings never appears in digest either.
- Digest never includes a notification twice across runs (watermark-based duplicate suppression) and
  never includes already-in-app-read-before-send items as "new."
- The digest-compose pg-boss job payload is metadata-only (`actorUserId` + reason/idempotency key) —
  verified by `assertMetadataOnlyPayload`, with a test asserting the payload shape carries no
  notification content.
- Digest render/content is produced only from the existing sanitized `serializeNotification`
  projection — a test asserts rendered digest output cannot contain secrets, credentials, or raw
  source-record content (task/note/email bodies) even if such content were (incorrectly) present
  upstream, i.e. a defense-in-depth content-safety test, not just a "trust the input" assumption.
- Tests cover: preference gating (module on/off reflected in digest inclusion), cadence-to-cron
  derivation (reusing/paralleling briefings' `cronExprFor`/`timezoneFor` test coverage), and
  watermark advancement only on confirmed successful send.
