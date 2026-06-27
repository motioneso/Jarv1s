# Restrained proactive monitoring across sources (#531)

**Status:** Draft
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #531
**Depends on:** #526 unified priority model, #527 usefulness feedback signals, existing module
manifests and source read repositories.
**Related follow-ups:** #534 action permission tiers, #536 scheduled recurring briefings, #539
source-backed answers/provenance, #540 safe automation audit log, #541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-priority-model.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-cross-tool-reasoning.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-25-agency-action-loop.md`,
`~/Jarv1s/packages/module-sdk/src/index.ts`, `~/Jarv1s/packages/notifications/src/repository.ts`,
`~/Jarv1s/packages/tasks/src/repository.ts`, `~/Jarv1s/packages/calendar/src/repository.ts`,
`~/Jarv1s/packages/email/src/repository.ts`, `~/Jarv1s/packages/notes/src/tools.ts`.

## 1. Problem

Jarvis can answer questions when asked, but dogfood shows a separate gap: important changes can
happen in tasks, calendar, Gmail, and notes while the user is not asking.

Examples:

- a high-priority task becomes overdue;
- a meeting moves and creates prep risk;
- a visible email likely needs a reply before an upcoming event;
- a synced note changes a project decision that affects today's work.

The danger is noise. A proactive Jarvis that surfaces every source change becomes another inbox.
V1 needs to find only high-signal items, cap volume hard, and give the user obvious controls.

## 2. Decision

Add **restrained proactive monitoring V1**.

V1 creates owner-scoped proactive cards for the Today/proactive surface. Each card is a suggestion
or heads-up. It does not execute actions, send push notifications, schedule recurring briefings, or
turn source changes into background chat turns.

The monitoring service is source-neutral, but source reads stay module-owned:

1. modules register monitor providers;
2. the service asks each enabled provider for bounded change signals under `DataContextDb`;
3. signals are ranked through #526's priority scorer;
4. anti-spam policy decides whether a card may be created or resurfaced;
5. #527 records feedback and dismissals for `proactive_card` targets.

This gives Jarvis proactive behavior without building a general automation engine.

## 3. Current Architecture Anchor

Existing seams to reuse:

- modules already own their tables and expose manifests/tools;
- source data access already goes through `DataContextDb`;
- #526 defines deterministic `PriorityCandidate` scoring and priority bands;
- #527 defines `proactive_card` as a feedback target kind;
- notifications already have quiet-hours concepts, but their lifecycle is read/mark-read
  notification delivery, not persistent proactive cards.

#531 should add a small proactive-card surface instead of overloading notifications or querying
module tables directly.

## 4. User Controls

Store one owner-scoped preference:

```text
proactive.monitoring.v1
```

Shape:

```ts
interface ProactiveMonitoringPreferenceV1 {
  readonly version: 1;
  readonly enabled: boolean;
  readonly sources: Record<ProactiveSource, ProactiveSourcePreference>;
  readonly dailyCardCap: number;
  readonly quietHours: {
    readonly enabled: boolean;
    readonly startLocalTime: string;
    readonly endLocalTime: string;
  };
  readonly updatedAt: string;
}

type ProactiveSource = "tasks" | "calendar" | "email" | "notes";

interface ProactiveSourcePreference {
  readonly enabled: boolean;
  readonly dailyCardCap: number;
}
```

Defaults:

- global `enabled: false`;
- every source `enabled: false`;
- `dailyCardCap: 8`;
- per-source `dailyCardCap: 3`;
- quiet hours enabled with the existing instance/user quiet-hours default when available.

Rules:

- A source is monitorable only when global monitoring, that source toggle, the module, and the
  source connection/permission are all enabled.
- Settings are owner-only. Admins cannot view or change a user's source-monitoring preferences.
- Source toggles affect proactive monitoring only. They do not grant module permissions, enable
  connector sync, or affect user-initiated chat/tool reads.
- Push/browser/mobile notifications are out of scope even if notification settings exist.

## 5. Provider Registry

Add a proactive-monitor provider registry owned by the composition root.

```ts
interface ProactiveMonitorProvider {
  readonly source: ProactiveSource;
  readonly moduleId: string;
  collectSignals(scopedDb: unknown, input: ProactiveMonitorInput): Promise<ProactiveMonitorResult>;
}

interface ProactiveMonitorInput {
  readonly ownerUserId: string;
  readonly sinceCursor: unknown;
  readonly now: string;
  readonly timeZone: string;
  readonly maxSignals: number;
  readonly priorityAnchors: readonly ProactiveMonitorPriorityAnchor[];
}

interface ProactiveMonitorPriorityAnchor {
  readonly label: string;
  readonly aliases: readonly string[];
}

interface ProactiveMonitorResult {
  readonly signals: readonly ProactiveMonitorSignal[];
  readonly nextCursor: unknown;
}

interface ProactiveMonitorSignal {
  readonly source: ProactiveSource;
  readonly stableKey: string;
  readonly sourceRefHash: string;
  readonly signalType: string;
  readonly title: string;
  readonly summary: string;
  readonly occurredAt?: string;
  readonly targetAt?: string;
  readonly priorityCandidate: PriorityCandidate;
  readonly expiresAt?: string;
}
```

Rules:

- Providers are implemented in the owning source module.
- Providers may query only their own module data. The SDK type stays `unknown`, matching existing
  tool/provider seams; module implementations narrow with `assertDataContextDb`.
- The central service never imports source repositories or queries source-owned tables.
- Extend `JarvisModuleManifest` with `readonly proactiveMonitor?: ProactiveMonitorProvider`.
- Add a `proactiveMonitorProvidersFor(manifests)` helper in `packages/module-registry`, mirroring
  the existing focus-signal provider aggregation pattern.
- `stableKey` is deterministic for the material source event and contains no raw private ids.
- `sourceRefHash` may be a hash of source-local ids, never the raw id.
- `title` and `summary` are bounded user-visible card text. They may include private owner data,
  but they must not include secrets, credentials, full email bodies, raw note excerpts beyond the
  concise card summary, or hidden connector metadata.
- Providers return at most `maxSignals`, ordered newest/soonest first after local source filtering.
- Providers return `nextCursor` even when `signals` is empty, so successful empty scans can advance
  monitor state and avoid rereading the same window forever.
- The central service loads #526 priority anchors and passes only labels/aliases into provider
  input. Providers do not read `app.preferences` directly.

V1 providers:

| Source   | V1 signals                                                                 |
| -------- | -------------------------------------------------------------------------- |
| Tasks    | newly overdue, due soon with high priority, at-risk focus items            |
| Calendar | changed/cancelled upcoming events, dense schedule risk, prep-needed events |
| Email    | recent visible messages likely needing reply or time-sensitive follow-up   |
| Notes    | changed indexed notes matching priority anchors, decisions, or open loops  |

Notes V1 is intentionally narrow. It monitors indexed note changes after vault ingestion, not every
filesystem edit in real time. The Notes provider must filter note changes using the `priorityAnchors`
passed in the `ProactiveMonitorInput` (by case-insensitively checking if any anchor label or alias
occurs as a whole word or tag in the note's title, headers, or content). It generates a
`priority_anchor_changed` signal only for notes matching at least one active priority anchor, ensuring
note monitoring is anchored strictly on user priorities.

## 6. Monitor State And Cards

Add `app.proactive_monitor_state`.

Fields:

- `owner_user_id uuid not null`
- `source text not null`
- `cursor_json jsonb not null default '{}'::jsonb`
- `last_checked_at timestamptz null`
- `failure_count integer not null default 0`
- `last_error_class text null`
- `updated_at timestamptz not null default now()`

Primary key: `(owner_user_id, source)`.

Add `app.proactive_cards`.

Fields:

- `id uuid primary key`
- `owner_user_id uuid not null`
- `source text not null`
- `stable_key text not null`
- `source_ref_hash text not null`
- `title text not null`
- `summary text not null`
- `signal_type text not null`
- `priority_band text not null`
- `priority_reasons jsonb not null default '[]'::jsonb`
- `status text not null default 'active'`
- `occurred_at timestamptz null`
- `target_at timestamptz null`
- `first_seen_at timestamptz not null default now()`
- `last_seen_at timestamptz not null default now()`
- `deferred_until timestamptz null`
- `expires_at timestamptz null`
- `dismissed_at timestamptz null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Allowed status values:

```ts
type ProactiveCardStatus = "active" | "dismissed" | "expired" | "suppressed";
```

Rules:

- RLS is owner-only with FORCE RLS. Runtime app and worker roles do not bypass RLS.
- Unique active material key: `(owner_user_id, source, stable_key)`.
- Re-seeing the same active material card updates `last_seen_at`, priority fields, and text, but
  does not create a second card.
- Dismissal marks `status = "dismissed"` and `dismissed_at`; rows are not deleted.
- Expired cards are hidden from normal Today/proactive lists.
- `metadata_json` is metadata only: provider version, source label, card kind, and small booleans.
  Do not store raw source payloads, prompt text, email bodies, note excerpts, secrets, tokens, or
  connector credentials there.

## 7. Scan Flow

Use metadata-only pg-boss jobs:

```ts
interface ProactiveScanSourceJobPayload extends ActorScopedJobPayload {
  readonly source: ProactiveSource;
  readonly reason: "source-sync" | "manual-refresh" | "scheduled-check";
  readonly idempotencyKey: string;
}
```

Triggers:

- source sync completion may enqueue that source for the owner;
- Today/proactive surface refresh may enqueue a manual refresh if the source has not scanned
  recently;
- when a user saves monitoring preferences, reconcile per-user/per-source pg-boss recurring jobs for
  enabled sources, no more frequent than every 30 minutes.

This is not #536 recurring briefings. It creates individual cards only when a source reports a
high-signal change.

Scan steps:

1. build `AccessContext` with actor id and generated request id;
2. load monitoring preference, #526 priority anchors, and user timezone under `DataContextDb`;
3. skip if global/source monitoring is disabled or source module is unavailable;
4. apply source cooldown: do not scan the same source more than once every 15 minutes unless the
   trigger is source-sync;
5. call the module provider with the stored cursor and `maxSignals = 20`;
6. map provider signal types into #526-recognized `PriorityCandidate.signalType` values;
7. rank returned signals through #526;
8. sort all ranked signals by priority score descending before applying volume caps;
9. create/update only cards that pass the high-signal threshold and anti-spam policy;
10. store `nextCursor` only after provider collection succeeds, including successful empty scans;
11. on failure, keep the previous cursor and log metadata only.

Failures never block source sync, Today, chat, or module routes.

Scheduled checks must not use a global cron that scans `app.preferences` for enabled users. Under
owner-only FORCE RLS that job would see no user preference rows without an actor context. Recurring
scan jobs are reconciled from inside the user's own settings save flow, then each scan job runs with
that job's actor-scoped payload.

Timezone comes from the existing locale/preferences path used by task drift/focus logic. Do not add
a timezone field to `proactive.monitoring.v1`.

## 8. High-Signal Threshold

A signal may create or resurface a card only when all are true:

- priority band is `critical` or `high`;
- source-specific signal type is on that provider's V1 allowlist;
- the card is not a duplicate, dismissed, suppressed, or expired under the rules below;
- the owner and source are under volume caps.

`normal` priority signals are dropped in V1. If dogfood needs "normal but useful" proactive cards,
add a new source-specific rule later instead of lowering the global threshold.

Source allowlists:

| Source   | Signal types                                                                  |
| -------- | ----------------------------------------------------------------------------- |
| Tasks    | `overdue_high_priority`, `due_soon_high_priority`, `at_risk_focus`            |
| Calendar | `event_changed_soon`, `event_cancelled_soon`, `prep_needed`, `dense_schedule` |
| Email    | `needs_reply_soon`, `time_sensitive_follow_up`, `priority_sender_waiting`     |
| Notes    | `decision_changed`, `priority_anchor_changed`, `open_loop_added`              |

Before scoring, map those provider signal types to #526 pressure signal types:

| Proactive signal                                                   | Priority candidate `signalType` |
| ------------------------------------------------------------------ | ------------------------------- |
| `overdue_high_priority`, `due_soon_high_priority`, `at_risk_focus` | task fields + `time_sensitive`  |
| `event_changed_soon`, `event_cancelled_soon`                       | `time_sensitive`                |
| `prep_needed`                                                      | `prep_needed`                   |
| `dense_schedule`                                                   | `schedule_density_overload`     |
| `needs_reply_soon`, `priority_sender_waiting`                      | `needs_reply`                   |
| `time_sensitive_follow_up`                                         | `time_sensitive`                |
| `decision_changed`, `priority_anchor_changed`, `open_loop_added`   | `planning_impact`               |

The card stores the provider's original `signal_type`; the mapped scorer type is transient input to
#526.

## 9. Anti-Spam Policy

Hard caps:

- max 8 new active cards per owner per local day;
- max 3 new active cards per source per owner per local day;
- max 1 new active card per source per owner per hour;
- max 5 visible active cards on Today/proactive by default.

Suppression:

- duplicate `stableKey`: update the existing active card instead of creating another;
- dismissed stable key: suppress the same source/stable key for 30 days;
- 2 or more active `too_much` feedback signals on the same source within 14 days: reduce that
  source daily cap to 1 for 7 days;
- 2 or more active `not_useful` feedback signals on the same stable key within 14 days: suppress
  for 30 days;
- expired source events stay expired unless the provider reports a materially new `stableKey`.

Quiet hours:

- if a card would be created during quiet hours, store it with `deferred_until` set to quiet-hours
  end and hide it from normal proactive lists until then;
- cards with `deferred_until` in the future do not consume hourly or daily new-active card caps
  while they are hidden;
- a card's activation timestamp is defined as its `deferred_until` time (when it actually becomes
  active/visible to the user) if it was deferred, or its database creation timestamp (`created_at`)
  otherwise. Hourly and daily caps must be computed using this activation timestamp rather than the
  raw database creation timestamp. This ensures quiet-hours deferred cards consume caps only when they
  are actually released to the user, not when they are created in the database during quiet hours;
- when quiet hours end, the Today/proactive query releases deferred cards by priority rank and
  still shows at most 5 visible active cards by default;
- no V1 source bypasses quiet hours, including critical cards;
- opening the underlying source directly still shows the source data because source permissions are
  separate from proactive delivery.

## 10. API And Surface

Add shared contract types under `packages/shared`.

Routes:

- `GET /api/me/proactive-cards?status=active&limit=...`
- `POST /api/me/proactive-cards/refresh`
- `GET /api/me/proactive-monitoring-settings`
- `PATCH /api/me/proactive-monitoring-settings`

`POST /api/me/proactive-cards/refresh` is asynchronous. It enqueues eligible scan jobs and returns
`202 Accepted`; it does not call external providers inline.

UI:

- Today/proactive surface shows active cards after normal Today content, capped to 5.
- Each card has source label, concise title, summary, priority band/reasons, source timestamp when
  present, Dismiss, and #527 feedback actions.
- Cards may deep-link to the owning source route when that route exists.
- Cards do not execute tools. A future action can start normal chat/proposal flow, but V1 cards
  themselves are read/suggest only.
- Dismiss uses #527's `POST /api/me/usefulness-feedback` with `kind = "dismiss"`; do not add a
  second card-specific dismissal API.

#527 integration:

- `proactive_card` verifier reads only `app.proactive_cards` under `DataContextDb`;
- it returns source label, priority band, metadata, and `canRemember` only when the card summary is
  memory-safe;
- when `canRemember` is true, it returns `rememberExcerpt` from bounded `title + summary`;
- `dismiss` feedback marks the card `dismissed` as the feedback side effect;
- undo reactivates the card if it has not expired by reverting its status to `active` and clearing
  `dismissed_at`. This reactivation must bypass all hourly and daily volume caps entirely, succeeding
  regardless of the current cap state, and the reactivated card must not count as a new creation;
- if the card side effect cannot be applied, the whole feedback/undo operation fails and leaves the
  feedback row and card row unchanged;
- feedback target ref is the proactive card id, not a raw source id.

## 11. Privacy, Safety, And Auditability

- Owner-only RLS on monitor state and cards.
- No admin private-data bypass.
- Monitoring jobs carry metadata only. No source text, prompts, secrets, or connector payloads.
- Providers run under `DataContextDb`; the central service does not use root Kysely or source-owned
  SQL.
- Logs include metadata only: actor id, source, reason, card count, signal count, duration, error
  class, and query/source hash where needed. Never log card summaries or source content.
- Provider summaries must discard credentials, tokens, passwords, OAuth data, and financial account
  numbers.
- Proactive cards are not prompts. If a later feature injects them into a model turn, it must apply
  the same external-content delimiter neutralization used by #525/#530.
- Monitoring preferences and cards are included in user export/delete.

## 12. Error Handling

- Missing preference: use disabled defaults.
- Malformed preference: disable monitoring, log metadata only, and require the user to save a valid
  preference before scanning.
- Provider missing/unavailable: skip that source.
- Provider failure: keep cursor, increment `failure_count`, log metadata only.
- Priority scorer failure: drop that scan batch; do not create unranked cards.
- Card insert conflict: update existing active material card.
- Feedback route unavailable: card still renders, but feedback actions including Dismiss are hidden.

## 13. Out Of Scope

- Push/browser/mobile notifications.
- Autonomous tool execution or action approval rules (#534).
- Scheduled recurring briefings or digests (#536).
- Audit-log UX for automation (#540).
- User-visible source provenance cards beyond source label and deep link (#539).
- Data freshness/staleness badges (#541).
- Model-based proactive planning.
- Monitoring sources not listed in V1.

## 14. Acceptance Criteria

- [ ] A user can enable/disable proactive monitoring globally and per source.
- [ ] Monitoring is disabled by default and owner-scoped.
- [ ] Tasks, calendar, email, and notes can register module-owned monitor providers.
- [ ] The central monitoring service never queries module-owned source tables directly.
- [ ] Source scans run under `DataContextDb` with metadata-only job payloads.
- [ ] Only `critical`/`high` allowed signal types can create proactive cards.
- [ ] Per-source caps, daily caps, hourly cooldowns, quiet hours, duplicate suppression, dismissal,
      and feedback suppression are enforced.
- [ ] Today/proactive surface shows owner-scoped proactive cards and supports Dismiss.
- [ ] Dismiss flows through #527 feedback and marks the card dismissed as the feedback side effect.
- [ ] #527 can verify and record feedback for `proactive_card` targets, including `remember_this`
      only with a bounded `rememberExcerpt`.
- [ ] Proactive cards never execute actions or send notifications in V1.
- [ ] Card rows and monitor state are owner-only under RLS.
- [ ] User A cannot read, create, update, dismiss, or suppress user B's cards.

## 15. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:tasks
pnpm test:calendar-email
pnpm test:notes
pnpm test:notifications
pnpm test:api
```

Targeted tests:

- default monitoring preference disables all scans;
- source toggle off skips that provider even when the module is connected;
- provider registry calls only the owning provider for each source;
- providers receive priority anchor labels/aliases without reading global preferences;
- scan job payload contains only actor/source/reason/idempotency metadata;
- scorer `normal` result creates no card;
- `critical`/`high` allowlisted signal creates or updates one card;
- duplicate stable key updates an existing active card;
- dismissed stable key suppresses recreation for 30 days;
- daily, per-source, and hourly caps suppress extra cards;
- quiet-hours cards are deferred and hidden until `deferred_until` without consuming new-active
  creation caps while hidden;
- repeated `too_much` feedback lowers source cap temporarily only after 2 active signals in 14 days;
- undo of dismiss reactivates an unexpired card without consuming a new-card cap;
- failed dismiss/undo side effects leave feedback and card rows unchanged;
- `proactive_card` verifier rejects cards not owned by the actor;
- RLS isolation for monitor state and cards;
- source provider failure preserves the previous cursor and does not block source sync or Today.
