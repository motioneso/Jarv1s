# Live-First Source Context for Email, Calendar, Tasks, and Briefings

**Status:** approved by Ben for Fable review/build decision
**Date:** 2026-07-04
**Owner:** Ben + Codex
**GitHub:** #729
**Grounded on:** `origin/main` @ `bcbbdf60`

---

## Release Notes Summary

Users connect email and calendar to Jarvis so Jarvis can live-read and proactively monitor their
sources for briefings, chat, Today, tasks, and planning. Jarvis triages email into actionable work
versus noise using full message context internally, but only exposes bounded structured conclusions.
Actionable emails can create task suggestions or automatic tasks based on user configuration.
Scheduled sync remains only as fallback/cache maintenance, not the primary product source of truth.

---

## 1. Product Decision

Jarv1s should stop treating cached email/calendar sync as the product source of truth.

Briefings are a chief-of-staff update, not an email reader. Jarvis should live-read the user's
sources, triage the information, and tell the user what actually needs attention. It should not
read all emails back to the user, and it should not let a stale or partial cache decide what the
user sees.

The old behavior exposed the wrong model:

- A Google account could show "Last sync completed with errors" after a successful run that merely
  hit Jarv1s's hidden 50-message cap.
- "Sync now" implied the user could make the source current, but a new run could hit the same cap
  and leave the same warning.
- The cap was an internal worker guard (`JARVIS_EMAIL_SYNC_CAP`), not a real product setting.
- Briefings and tools read cached email/calendar rows directly, so the user had no clear way to
  know whether Jarvis was current.

New model:

- Live source reads are primary.
- Jarvis proactively monitors connected sources on a schedule; it does not wait for a user page
  visit or a manual sync button.
- Cached sync remains as a background fallback/resilience layer.
- One provider-neutral source context service owns email/calendar reading, triage, cache fallback,
  and source status.
- Briefings, Today, Tasks, and assistant tools consume that service instead of each inventing their
  own email/calendar read path.

---

## 2. Scope

This is an epic-grade implementation target. Fable may choose execution strategy, but the accepted
feature is not useful if only a narrow "show better cap text" patch ships.

### In Scope

- Add a connector-owned, provider-neutral source context service.
- Live-first email context for all supported email-capable providers, not Google-only.
- Live-first calendar context through the same source context abstraction.
- Scheduled proactive email/calendar monitoring using the same source context/triage path.
- Full-body internal email triage, returning only bounded structured results.
- Email-derived task suggestion/creation, user-configurable.
- Suggested tasks appear in Tasks and Today.
- Accept/reject feedback from email-derived task suggestions improves future triage per user.
- Morning/evening briefings consume source context rather than direct cached reads.
- Remove manual "Sync now" controls from both user and admin settings.
- Keep scheduled/background sync as fallback cache maintenance.
- Preserve private-by-default, RLS, DataContextDb, metadata-only job payloads, and secret handling
  invariants.

### Out Of Scope

- Email reply flow rewrite (`email.draftReply`, `email.sendReply`, reply-by-cache-id can remain).
- Removing cached email/calendar tables or sync jobs.
- Multi-account UX redesign. Existing active/granted account behavior can stay; source context
  should not make future multi-account support harder.
- Cross-user or global learning.
- Reading full email bodies into briefing prompts.

---

## 3. Existing Code Grounding

Relevant current surfaces:

- `packages/connectors/src/live-tools.ts`
  - Has Google live Gmail search/get and Google live calendar event tools.
  - Currently Google-specific.
- `packages/connectors/src/email-read-provider.ts`
  - Defines provider-neutral `EmailReadProvider`.
  - Has `GoogleEmailReadProvider`.
- `packages/connectors/src/imap-email-read-provider.ts`
  - Implements `EmailReadProvider<ImapConnectionSecret>`.
- `packages/connectors/src/sync-jobs.ts`
  - Google cached sync, currently capped by `JARVIS_EMAIL_SYNC_CAP` default `50`.
- `packages/connectors/src/imap-sync-jobs.ts`
  - IMAP cached sync, same cap concept.
- `packages/email/src/tools.ts`
  - `email.listVisibleMessages` reads cached email rows directly.
- `packages/calendar/src/tools.ts`
  - `calendar.listVisibleEvents` reads cached calendar rows directly.
- `packages/briefings/src/compose.ts`
  - Morning briefing gathers `calendar.listVisibleEvents` and `email.listVisibleMessages`.
- `packages/briefings/src/compose-evening.ts`
  - Evening briefing gathers the same cached calendar/email tools.
- `packages/connectors/src/email-extract.ts`
  - Reads full body internally, sends bounded body to triage LLM, persists bounded summary/signals.
- `packages/tasks/src/repository.ts`
  - Tasks support `source`, `sourceRef`, and `externalKey`, which should be used for idempotent
    email-derived tasks.

Current problem: the right primitives exist, but the product flow is fragmented. Briefings and
tools use cached module reads while live provider reads live in connectors. The new source context
service must become the single read boundary.

---

## 4. Architecture

### 4.1 Source Context Service

Add a connector-owned service, exposed structurally through `ToolServices`, for example:

```ts
interface SourceContextService {
  listEmailContext(scopedDb: DataContextDb, input: EmailContextInput): Promise<EmailContextResult>;
  listCalendarContext(
    scopedDb: DataContextDb,
    input: CalendarContextInput
  ): Promise<CalendarContextResult>;
}
```

The exact names are flexible. The invariant is not:

- Connectors own provider credentials, live readers, sync/cache fallback, and feature-grant checks.
- Email/calendar/briefings do not import connector internals directly.
- Tools and briefing composition receive source context via structural service injection.
- If the service is absent, read tools fail closed or record a clear gap; they must not silently
  fall back to stale direct cache reads.

### 4.2 Provider-Neutral Email Reads

Email context must use the existing `EmailReadProvider` seam so Google and IMAP are not separate
product paths.

Provider-specific credential resolution stays inside connectors:

- Google: resolve/refresh access token through `GoogleConnectionService`.
- IMAP: decrypt `ImapConnectionSecret` through existing connector secret handling.
- Future providers implement the same `EmailReadProvider` contract.

The service should read from every active/granted email-capable account it supports. If an account
or provider cannot live-read, return a degraded source result for that account rather than hiding it.

### 4.3 Calendar Reads

Calendar should route through the same source context service. Today there is only a live Google
calendar implementation, but briefing/calendar code should not grow Google-specific branches.

Calendar context should return future events in the requested window, not historical cache snapshots.
It does not need LLM triage initially.

### 4.4 Cache Fallback

Cache is fallback, not primary.

Use live reads first. Use cached email/calendar rows only when the live read fails for a transient
provider/system reason, such as network, provider outage, temporary rate limit, or internal live-read
failure.

Do not silently use cache when:

- Auth is missing/broken.
- The connector is revoked.
- The feature grant is disabled.
- The provider/source is unsupported.

In those cases, return a real gap/actionable status.

Every result item should carry source status metadata:

- `source: "live" | "cache"`
- optional `degradedReason`
- account/source metadata that is safe to expose

Briefings should record stale/degraded source metadata when fallback is used.

### 4.5 Proactive Monitoring Cadence

Jarvis must proactively check connected email and calendar sources in the background. This is not a
user-facing manual sync flow.

Default cadence:

- Email: every 15 minutes per active/granted email-capable account.
- Calendar: every 30 minutes per active/granted calendar-capable account, plus a near-term refresh
  before scheduled morning/evening briefings.

Use the source context service for monitoring so live reads, triage, task suggestion, feedback, and
cache fallback behave the same whether context was requested by chat, briefing composition, Today,
or the scheduled monitor.

The monitor should persist only durable outcomes that the product needs:

- idempotent email-derived task suggestions/created tasks,
- per-user task feedback signals,
- bounded source status/cache health,
- fallback cache updates already owned by scheduled sync.

Do not persist raw email bodies from the monitor. Do not create a separate monitor-only triage path.
If provider push/webhook support exists later, it may reduce polling latency, but this spec should
ship with scheduled polling because it works across providers.

---

## 5. Email Triage

### 5.1 Product Role

Jarvis should triage email like a chief of staff:

- Read enough message body internally to decide whether the email matters.
- Suppress marketing/noise.
- Surface only things that need the user.
- Avoid dumping raw bodies into briefings.

Briefings should answer: "What am I missing that needs me?"

### 5.2 Body Handling

The source context service may fetch and analyze full message bodies internally, bounded by existing
body limits such as `MAX_BODY_CHARS`.

Full bodies must not be:

- placed into briefing prompts,
- persisted as task descriptions,
- stored in job payloads,
- written to logs,
- included in source metadata,
- sent to user-visible cards except explicit message-read/reply flows that already require it.

The briefing-facing output is bounded structured triage.

### 5.3 Triage Taxonomy

Email triage should classify each relevant message into one of:

- `needs_reply`: a real person asks Ben a question, requests a decision, or expects a response.
- `needs_action`: Ben needs to do something outside replying, such as pay, review, approve, sign,
  upload, renew, schedule.
- `time_sensitive_info`: no direct action/reply, but materially affects today/tomorrow/near-term
  plans.
- `waiting_on_someone`: relates to an existing task/commitment and someone else owes Ben.
- `fyi`: relevant, but no action.
- `noise`: marketing, newsletters, routine notifications, receipts, promos, automated alerts unless
  they contain a concrete action/deadline.
- `unknown`: insufficient confidence.

Briefings include:

- `needs_reply`
- `needs_action`
- `time_sensitive_info`
- high-value `waiting_on_someone`

Briefings exclude:

- `noise`
- routine `fyi`
- marketing/newsletters unless there is a clear action/deadline Ben cares about

### 5.4 Suggested Email Context Shape

Exact DTO names are flexible; required information is not.

Email context records should include:

- stable source message key
- connector/account reference
- provider label/type
- sender
- recipients when safe/useful
- subject
- receivedAt
- thread id if available
- bounded snippet
- bounded summary
- actionability category
- importance
- confidence
- short reason
- extracted due date/deadline if any
- `suggestedTasks[]`
- `source: "live" | "cache"`
- optional degraded reason

Do not include full body.

---

## 6. Email-Derived Tasks

### 6.1 User-Configurable Behavior

Add user-configurable email task behavior under Settings -> Data sources -> Email.

This setting controls task creation/suggestion only. It does not turn off email use in briefings,
chat, or source context. Jarvis still needs to triage connected email so it can suppress noise and
surface things the user might otherwise miss.

Modes:

- `off`: never suggest or create tasks from email.
- `suggest`: create reviewable suggestions only.
- `auto_safe`: automatically create high-confidence low-risk tasks, stage the rest.
- `auto`: create all actionable email tasks above the configured threshold.

Recommended default: `suggest`.

This setting must be connected when shown. Do not ship a placeholder toggle.

### 6.2 Task Creation Rules

Email-derived tasks should be created/suggested from high-confidence triage:

Auto-create candidates in `auto_safe`:

- bill due / payment due
- hard deadline
- explicit request with clear action and due date
- high-confidence `needs_action`

Stage for review:

- `needs_reply`
- ambiguous action
- lower-confidence task candidates
- anything with unclear due date/priority

Never create/stage from:

- marketing
- newsletters
- receipt-only messages
- routine notifications
- low-confidence noise

### 6.3 Task Data

Created/staged tasks must use existing task source fields:

- `source = "email"`
- `sourceRef` points to the stable message/source reference
- `externalKey` is deterministic from connector account + message id + normalized action signature
- description is bounded summary/reason, not full body
- due date from extracted deadline/due date when available
- priority from actionability, importance, deadline, and user feedback

Duplicate protection is mandatory. Re-running live reads or fallback cache must not create duplicate
tasks for the same email action.

### 6.4 Suggested Task Review

Suggested email tasks should appear in:

- Tasks review flow
- Today

If the current Tasks model cannot represent review-needed suggestions, add the smallest explicit
review state/queue in the Tasks module. Do not create a separate Email suggestions page unless Tasks
cannot support this cleanly.

Briefings may say "I found 3 possible tasks from email" only if those tasks are staged or created in
the task system. Do not leave email actions as untracked prose.

### 6.5 Learning From Accept/Reject

Accept/reject of suggested email tasks should persist per-user feedback and influence future triage.

Feedback records should capture:

- source: email
- actionability category
- sender/domain
- subject pattern/features
- extracted action type
- confidence/model version if available
- accepted/rejected
- optional explicit user reason when available

Rejected suggestions are especially important. Future triage should use them to reduce false
positives such as:

- marketing sender
- receipt only
- never create tasks from this sender/domain
- low-importance automated notification

Learning is per-user only. No cross-user learning.

Feedback should bias decisions, not blindly block everything, unless the user explicitly chooses a
"never from this sender/domain" style control.

---

## 7. Calendar Context

Calendar does not need LLM triage first. It needs accurate live context and deterministic framing.

Calendar context should include:

- events going forward in the requested briefing window
- today remaining events
- tomorrow events
- conflicts/overlaps
- early/late events
- location-bearing events
- attendee-bearing events that may require prep
- free blocks only when relevant to planning

Calendar context should exclude:

- old events outside the requested window
- routine all-day noise unless important
- large raw descriptions

Briefings should use calendar events to frame priorities/tasks. Email-derived tasks and calendar
events should be able to reinforce each other: if an email implies prep for an event, the briefing
should surface that as an action, not as disconnected trivia.

---

## 8. Briefing Integration

Morning and evening briefings must route through source context for email/calendar.

Replace direct dependence on:

- `email.listVisibleMessages` as cache-primary
- `calendar.listVisibleEvents` as cache-primary

with live-first source context calls.

Briefing behavior:

- Include only actionable email triage, not a feed of messages.
- Use calendar events going forward to frame the day/tomorrow.
- Record gaps/degraded statuses in source metadata.
- If live source fails transiently and cache fallback succeeds, clearly mark stale/degraded source.
- If auth/feature grant is broken, show actionable gap rather than cache pretending to be current.

Evening-specific behavior:

- Email arrived today should be triaged for actual user action, not subject/snippet heuristics.
- Marketing emails must not become "needs reply" simply because a subject/snippet looks imperative.

---

## 9. Settings UX

Remove manual "Sync now" from:

- user Connected accounts
- admin connector oversight

Reason: users should not need manual sync for product freshness. Jarvis reads live when needed, and
scheduled/background sync maintains fallback cache.

If manual sync is ever needed operationally, the user can ask Jarvis or an admin/dev can use an
internal tool. Do not keep a prominent button that implies manual sync is normal user workflow.

Settings should distinguish:

- live connection health
- fallback cache health

Cache partial/stale status should not scare the user when live reads are healthy. It becomes relevant
only when live reads fail and fallback quality matters.

Email task behavior setting belongs under Settings -> Data sources -> Email.

---

## 10. Security And Privacy Invariants

Do not weaken these:

- Runtime DB access through `DataContextDb`.
- RLS applies to all actors.
- Cross-user source context is forbidden.
- Connector secrets never leave encrypted storage except inside connector-owned credential
  resolution.
- Job payloads are metadata-only.
- Full email bodies do not go into briefing prompts, task descriptions, source metadata, job
  payloads, logs, or persisted learning records.
- Triage summaries/signals are bounded and body-echo guarded.
- Provider-specific failures are secret-free and bounded.
- Feature grants gate email/calendar access.
- Admins do not get private-data bypass.

Task creation from email must be idempotent and owner-scoped.

---

## 11. Acceptance Criteria

- A connector-owned provider-neutral source context service exists.
- Email context supports all currently supported live email providers through `EmailReadProvider`,
  including Google and IMAP.
- Calendar context routes through the same source context boundary; briefing code does not hardcode
  Google-specific source reads.
- Source context is live-first and cache-fallback.
- A scheduled monitor proactively checks active/granted email and calendar sources without user
  page visits or manual sync.
- The scheduled monitor uses the same source context/triage path as briefings, chat/tools, Today,
  and Tasks.
- Cache fallback is used only for transient live failures, not auth/feature-grant/revoked/unsupported
  failures.
- Email triage reads enough body internally to distinguish actionable mail from marketing/noise.
- Briefing-facing email context is bounded structured triage, not full body.
- Morning and evening briefings use source context for email/calendar.
- Briefings include only actionable email items and future calendar framing.
- Email-derived task behavior is user-configurable with modes `off`, `suggest`, `auto_safe`, `auto`.
- Suggested email tasks appear in Tasks and Today.
- Accepted/rejected email task suggestions create per-user feedback.
- Triage uses prior per-user feedback to reduce future false positives.
- Manual "Sync now" is removed from user and admin settings.
- Scheduled/background sync remains as fallback cache maintenance.
- Cached sync/storage remains in place; deletion/removal is not part of this spec.
- Email reply flow remains functional and is not rewritten unless unavoidable.

---

## 12. Verification Requirements

Minimum tests:

- Unit tests for source context live-first/fallback decisions.
- Unit tests for provider-neutral email context using Google and IMAP fake providers.
- Unit tests for email triage taxonomy:
  - real request -> `needs_reply`
  - bill due -> task candidate
  - marketing/newsletter -> `noise`
  - receipt-only -> no task
- Unit tests for no full body in briefing-facing output.
- Integration tests for briefing composition consuming source context.
- Tests for scheduled monitoring invoking source context for email/calendar.
- Tests for cache fallback only on transient live failure.
- Tests that auth/feature-grant-disabled does not silently use cache.
- Tests for email-derived task idempotency through `externalKey`.
- Tests for configurable task behavior modes.
- Tests that accepted/rejected suggestions affect future triage.
- Frontend tests that manual sync controls are gone from user and admin settings.
- Existing full local gate should pass: `pnpm verify:foundation`.

Useful manual dogfood:

- Connect Google account with more than 50 recent messages.
- Run morning/evening briefing.
- Confirm briefing reports actionable items, not a random first-50 cache sample.
- Confirm marketing emails do not create reply/action noise.
- Confirm a bill-like email creates/stages a task according to the user's configured mode.
- Reject a bad suggestion and confirm future triage downranks similar messages.

---

## 13. Non-Goals And Follow-Ups

Not this spec:

- Rewrite email reply tools to live-message ids.
- Delete cached email/calendar rows.
- Full multi-account management UX.
- Cross-provider calendar beyond what current connectors support.
- New global model-training system.

Likely follow-ups:

- Decide whether cached sync should eventually become TTL-only.
- Decide whether email reply tools should move from cache ids to source context message handles.
- Rich multi-account controls for which accounts feed briefings/tasks.
- Admin/internal source-context diagnostics.
