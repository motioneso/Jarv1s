# Notification email digest delivery (#742)

**Status:** Approved (2026-07-07, Ben)
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

This spec grounds the design in the _actual_ current system: the module-based notification
preference model from #735, the quiet-hours persistence work from #733, the recurring-schedule
pattern already used by proactive scanning and briefings, and the _only_ outbound-email code that
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
  _same_ preference surface, not a second preference system.
- Digest and in-app are **additive, not exclusive**: a notification still appears in-app immediately
  (unchanged); the digest email is a periodic recap of what accumulated, not a replacement channel.
  This matches "which notification categories appear in digest versus live in-app" from the issue —
  the answer is "the same ones the module preference already gates," not a new split.
- No urgent/system bypass in digest either, consistent with #735 §2 ("no urgent/system bypass in
  Notifications").

### 3. Sending path — RESOLVED: (a), via the user's own connected account

Searched the repo for any existing outbound-email capability (`sendMail`, `nodemailer`, SMTP, SES,
Resend, Postmark). What exists:

- `packages/email` + `packages/connectors` (`GoogleEmailWriteProvider`, `ImapEmailWriteProvider`)
  implement `EmailWriteService.sendReply` / `draftReply` — used **only** by the chat email-reply
  tool. This is **not** general-purpose send-any-email infrastructure:
  - It requires an existing cached `EmailMessage` and a non-null `threadId` — `GoogleEmailWriteProvider.run()`
    returns `{ ok: false }` immediately if `threadId` is falsy. It composes a MIME **reply** to that
    thread (`buildReplyMime`), not a fresh message.
  - It sends through the **user's own connected** Google OAuth token or IMAP/SMTP app-password
    credentials (`getFreshAccessToken`, `getActiveImapAccountSecret`) — i.e. it sends _as the user_,
    to _the message's sender_, from inside a synchronous chat-tool call. There is no system-initiated,
    scheduled-job send path anywhere in the codebase today.
  - Reusing it for a digest would mean either addressing a "reply" at nothing (no real thread to
    reply to — a digest is Jarvis-to-user, not user-to-someone-else) or extending both providers
    with a genuinely new "compose a fresh message" mode. That's a real code change to shared
    infrastructure other tools depend on, not a free reuse.
- Nodemailer is already a dependency (via `ImapEmailWriteProvider`), so the _library_ is available,
  but there is no configured system-level sending identity (no verified "notifications@" sender, no
  SES/Resend/Postmark account, no SMTP relay credential store for Jarvis-as-sender rather than
  user-as-sender).

**Decided (Ben, 2026-07-06): (a), send via the user's own connected account.** Extend
`EmailWriteProvider` with a `sendNew`-style method (no `threadId`), address the message to the
user's own on-file email address, and send it through whichever provider (Google/IMAP) the user
already has connected for reading/writing email. Reasoning: no new secret type, no new vendor, stays
inside the existing "credentials never escape" boundary that's already audited for this module. A
user with zero email connectors configured simply cannot receive digest — per Ben, "if they don't
have an email connected they won't need it." This is a deliberate scope narrowing, not an oversight:
digest availability is gated on connector presence, not treated as a gap to fill.

**(b) (new system-level outbound sender) is rejected for v1** — not pursued. If a future need for
digest independent of connector state emerges, it would need its own spec (new secret class, vendor
decision, `DigestEmailSender`-style adapter).

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

- **Decided (Ben, 2026-07-06): quiet hours does not affect digest.** Quiet hours (#733) governs
  _in-app_ notification deferral only; digest is a batched, user-scheduled send. The user's chosen
  `targetTime` is respected as-is regardless of whether it falls inside their quiet-hours window —
  quiet hours is not a general delivery-timing concept, it's specifically an in-app-interruption
  control.
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
- Sending path is decided as (a) — see §3. A future system-level sender (b) is out of scope for this
  spec entirely and would need its own spec if ever pursued.
- No rich HTML template engine or per-module custom email layouts in v1 — a single plain
  text/minimal-HTML digest template is sufficient for the acceptance bar below.
- No in-job retry on send failure (see §6 duplicate suppression / decisions below) — a failed send is
  not retried within the same job; the watermark is simply not advanced, so the next scheduled digest
  naturally includes whatever was missed.

## Decisions (Ben, 2026-07-06)

All open questions from the prior draft are resolved:

1. **Sending path: (a)**, via the user's own connected Google/IMAP account — see §3. Also resolves
   the "no connector configured" case: the digest toggle simply stays unavailable for that user, by
   design, not as an error state — "if they don't have an email connected they won't need it."
2. _(vendor choice for option (b))_ — moot, dropped, since (b) was not chosen.
3. **Cadence granularity: `daily`/`weekly` only** for v1; the user picks which. Finer-grained
   scheduling (arbitrary N-day intervals) is a later enhancement if ever requested.
4. **Quiet hours does not affect digest timing** — see §6. Quiet hours is an in-app-interruption
   control, not a general delivery-timing concept; the user's chosen `targetTime` is exempt by
   definition.
5. **Empty-digest handling: skip.** Zero eligible notifications since the last successful send means
   no email is sent — avoids mailbox noise from a "nothing new" message.
6. **No verified/connected email → toggle unavailable.** Same resolution as #1 — this is not a
   distinct failure mode to handle, it's the same "no connector, no digest" gate.
7. **Unsubscribe/one-click-disable: yes.** The digest email includes a direct link back to the
   digest setting in Notifications settings.
8. **Retry/backoff: none.** No in-job retry on send failure. The watermark is only advanced on a
   confirmed successful send, so a failed digest is silently absorbed — the next scheduled digest
   picks up anything missed automatically. Simpler than building real retry/backoff into a periodic
   job, and avoids duplicate-send edge cases from a partial failure.

No open questions remain from the prior draft. Any further questions (exact email template wording,
subject-line copy) are implementation details for the build PR, not spec-blocking.

## Acceptance criteria

- Email digest is **not** shown as an active toggle in Notifications settings until this is actually
  built (the #735 `Coming soon` row stays as-is until then).
- Users can enable/disable digest and configure cadence (`daily`/`weekly`) and send time/timezone.
- The digest toggle is unavailable (not merely non-functional) for a user with no connected
  Google/IMAP email connector — verified by a test asserting the disabled/unavailable state, not a
  silent send failure.
- Digest sends through the user's own connected email connector (Google/IMAP), addressed to their
  own on-file address, via a new `sendNew`-style `EmailWriteProvider` method — verified by a test
  that a digest send does not require or reference any `threadId`.
- A digest send is skipped entirely (no email sent) when zero eligible notifications have
  accumulated since the last successful send.
- The digest send fires at the user's chosen `targetTime`/timezone regardless of whether that time
  falls inside their quiet-hours window — a test asserts digest delivery is unaffected by quiet-hours
  configuration.
- The digest email includes a working link back to the digest setting in Notifications settings.
- A failed digest send does not retry within the job and does not advance the watermark — a test
  simulating a failed send followed by a successful next-cycle send asserts the missed notifications
  are included in that next digest, not dropped.
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
