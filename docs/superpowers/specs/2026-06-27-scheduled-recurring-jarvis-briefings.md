# Scheduled recurring Jarvis briefings (#536)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #536
**Depends on:** existing Briefings module, #526 unified priority model, #531 restrained proactive
monitoring, #534 explicit action permission tiers, #535 long-running Jarvis goals, #250 quiet-hours
notification deferral.
**Related follow-ups:** #537 automatic commitment extraction, #540 safe automation audit log, #541
data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-07-m-a4-vault-grounded-briefings-design.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-20-briefings-prompt-injection-hardening.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-25-evening-review-and-interview.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-priority-model.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-22-quiet-hours-notification-deferral.md`,
`~/Jarv1s/packages/shared/src/briefings-api.ts`, `~/Jarv1s/packages/briefings/src/routes.ts`,
`~/Jarv1s/packages/briefings/src/schedule.ts`, `~/Jarv1s/packages/briefings/src/jobs.ts`,
`~/Jarv1s/packages/briefings/src/repository.ts`,
`~/Jarv1s/packages/briefings/sql/0015_briefings_module.sql`.

## 1. Problem

Jarvis can generate briefing runs and already has a schedule backbone, but the product contract is
still too implicit for the dogfood gap:

- "morning plan", "evening review", and "weekly open loops" should be explicit schedules the user
  can inspect and edit;
- schedule enablement can be confused with source permissions or proactive monitoring;
- recurring briefings need clear timezone, quiet-hours, source-selection, and delivery semantics;
- scheduled runs may suggest actions, but must not become hidden background chat turns or direct
  automation.

The missing capability is not another scheduler. It is a clear recurring-briefing contract over the
existing Briefings definition/run machinery.

## 2. Decision

Add **scheduled recurring Jarvis briefings V1** as an explicit user-configured schedule model on top
of `app.briefing_definitions`.

The user-facing term is **briefing schedule**. The canonical record remains the existing briefing
definition:

- `app.briefing_definitions` stores schedule configuration;
- `app.briefing_runs` stores generated runs;
- pg-boss native per-definition cron remains the scheduler;
- the worker continues to generate runs under `DataContextDb`.

No new workflow engine, background chat-turn runner, proactive-card feed, push/mobile notification
surface, or second schedule table.

## 3. Current Architecture Anchor

Already present:

- `BriefingDefinitionDto` has `briefingType`, `cadence`, `scheduleMetadata`, `enabled`,
  `selectedToolNames`, and `lastRunAt`.
- `BriefingRunDto` has `runKind`, `briefingType`, `summaryText`, and `sourceMetadata`.
- `schedule.ts` reconciles a pg-boss schedule per definition id and asserts scheduled payloads are
  metadata-only.
- `jobs.ts` normalizes scheduled payloads, mints missing run ids, and creates in-app notifications
  for scheduled morning/evening runs.
- `repository.ts` enforces same-local-day idempotency for scheduled runs under an advisory lock.
- Briefings already use the prompt-injection hardening trust boundary for synthesized content.

#536 should tighten and extend this shape, not fork it.

## 4. Briefing Schedule Model

A briefing schedule is one `BriefingDefinition`.

```ts
type BriefingCadence = "manual" | "daily" | "weekly";
type BriefingType = "morning" | "evening" | "weekly_review";

interface BriefingScheduleMetadataV1 {
  readonly version: 1;
  readonly targetTime: string; // HH:mm local time
  readonly timezone: string; // IANA timezone
  readonly dayOfWeek?: 0 | 1 | 2 | 3 | 4 | 5 | 6; // weekly only, Sunday=0
  readonly quietHoursBehavior: "defer_notification";
}
```

Rules:

- `manual` schedules never register pg-boss cron rows.
- `daily` schedules use `targetTime` and `timezone`.
- `weekly` schedules use `targetTime`, `timezone`, and `dayOfWeek`.
- No arbitrary cron strings in V1.
- No one-shot schedules in V1.
- `timezone` must be validated with `Intl.DateTimeFormat` or equivalent IANA validation.
- If the user has a saved locale timezone, new schedules default to that timezone. Otherwise use the
  instance default, then UTC.
- Do not infer timezone from free-form chat text.
- `quietHoursBehavior` has one V1 value: scheduled runs may generate at their target time, but
  ready notifications are deferred by the notifications module when quiet hours are active.

Migration:

- Add `weekly_review` to the briefing type enum and shared contract.
- Existing `morning` and `evening` definitions keep their current semantics.
- Existing `schedule_metadata` rows without `version` are interpreted as V0 and normalized on the
  next edit to `version: 1`.

## 5. Supported Briefing Types

V1 locks three user-visible types:

| Type            | Default cadence | Default time | Purpose                                                                                         |
| --------------- | --------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `morning`       | `daily`         | `07:00`      | Plan the day from tasks, calendar, email, notes, goals, and priorities.                         |
| `evening`       | `daily`         | `19:00`      | Review the day, identify slipped/open work, and optionally launch prep-for-tomorrow chat.       |
| `weekly_review` | `weekly`        | `09:00`      | Summarize open loops, upcoming deadlines, goal progress, and priority shifts for the next week. |

Briefing type selects the prompt, default source set, default cadence, and notification copy. It
does not grant source access.

## 6. Source Selection

The existing `selectedToolNames` remains the schedule's source-selection field.

Rules:

- A schedule may select only registered `risk: "read"` assistant tools or briefings-owned internal
  read sections.
- Unknown tools are rejected.
- Non-read tools block the run as they do today.
- Source selection is not permission. If a module, connector, account grant, or source behavior
  setting disallows a source at run time, the run records a source gap and continues.
- Enabling a briefing schedule does not enable Gmail, calendar, notes, goals, proactive monitoring,
  or any connector sync.
- Source behavior settings remain source-owned. For example, an email source disabled for
  briefings is not read merely because a schedule selected email.
- Goals from #535 are included only through a bounded `goals.listActive` read tool or a
  briefings-owned goal section once that tool exists. If unavailable, record a gap.

Default source sets:

- `morning`: tasks, calendar, email, notes/vault, memory, goals, priority signals.
- `evening`: tasks, calendar, email, notes/vault, chats, goals.
- `weekly_review`: tasks, calendar lookahead, email follow-ups, notes/vault, goals, memory, priority
  signals.

Defaults are seeds for schedule creation. Users can remove sources.

## 7. Schedule Reconciliation

Keep native per-definition pg-boss schedules.

Rules:

- Schedule key: briefing definition id.
- Queue: existing `BRIEFINGS_RUN_QUEUE`.
- Scheduled payload stays metadata-only:

```ts
interface ScheduledBriefingCronPayload {
  readonly actorUserId: string;
  readonly definitionId: string;
  readonly runKind: "scheduled";
  readonly briefingType: BriefingType;
}
```

- The worker mints `briefingRunId` and computes period idempotency at fire time.
- `daily` cron: `<minute> <hour> * * *`.
- `weekly` cron: `<minute> <hour> * * <dayOfWeek>`.
- `manual`, disabled, or invalid schedules unschedule the definition.
- Create/update/disable/delete reconcile after the DB mutation commits. Reconcile failure is logged
  metadata-only and does not fail the user's mutation.
- Existing owner-scoped self-heal may reconcile schedules for definitions owned by the actor only.
  It must not schedule definitions shared from another user.

The jobs package metadata-only validator already allows the existing scheduled briefing keys. If a
future implementation adds payload fields, it must update the validator before enqueueing.

## 8. Run Idempotency And Missed Runs

Each scheduled run has one local period:

- daily period: local calendar date in the schedule timezone;
- weekly period: local ISO week plus `dayOfWeek` in the schedule timezone.

Rules:

- A definition can create at most one scheduled run per local period.
- Idempotency is enforced in the database under a transaction-scoped advisory lock derived from
  `definitionId + localPeriod`.
- Manual runs do not consume the scheduled period slot.
- If pg-boss fires twice for the same period, the worker returns the existing run and sends no second
  notification.
- No catch-up storm. If the system is down through multiple scheduled periods, it may create at most
  one current-period run when scheduling resumes. Older missed periods are not backfilled
  automatically.
- The user can always run a briefing manually.

## 9. Quiet Hours And Delivery

Scheduled briefings use existing delivery surfaces only.

Delivery surfaces:

- the Briefings runs list;
- the relevant Today/Briefings surface;
- existing in-app notifications, when the notifications module is available.

Rules:

- A scheduled run may generate during quiet hours.
- The run is visible in the Briefings list once generated.
- The ready notification is `normal` urgency and flows through #250 quiet-hours deferral.
- During quiet hours, the notification is deferred until quiet-hours end.
- If the notifications module is unavailable, the run still persists and is visible in the Briefings
  list. Do not add push, mobile, email, SMS, browser push, or a new delivery product surface in #536.
- Notification metadata contains only IDs: definition id and run id.
- Notification body must not contain the briefing summary or source content.

## 10. Listing And UI

Add a clear Schedules view to the existing Briefings surface.

Schedule list shows:

- title;
- briefing type;
- enabled state;
- cadence;
- local target time and timezone;
- selected source labels;
- last run status/time;
- next scheduled run time when derivable;
- quiet-hours note when the target time falls inside active quiet hours.

Run list shows:

- briefing type;
- run kind;
- scheduled period;
- generated time;
- status;
- degraded/gap indicators;
- source labels.

Controls:

- create schedule;
- edit schedule;
- enable/disable schedule;
- run now;
- view runs.

Do not present scheduled briefings as proactive cards. A proactive card may deep-link to a briefing
later, but #531 owns that surface.

## 11. Action Suggestions

Briefings may suggest actions. They may not execute actions.

Rules:

- Suggested actions in summary text are text only.
- No scheduled job payload, schedule metadata, or source metadata stores executable tool inputs.
- A "Do it" control, if added later, must start the normal assistant proposal/tool flow and #534
  decides whether the action confirms or auto-runs.
- Destructive and external communication actions keep their #534 always-confirm floor.
- #540 owns the future audit-log UX for automatic or user-approved actions. #536 records only
  briefing run metadata.

## 12. Privacy, Safety, And Auditability

- Briefing definitions and runs remain owner-scoped under FORCE RLS.
- No admin private-data bypass.
- Runtime app and worker roles do not get `BYPASSRLS`.
- Scheduled payloads carry actor id, definition id, run kind, briefing type, and command metadata
  only.
- Source content, prompts, summaries, connector payloads, credentials, tokens, and action inputs
  never enter pg-boss payloads.
- Logs include metadata only: actor id, definition id, run id, briefing type, cadence, source
  counts, gap count, duration, and error class. Never log summary text, prompt text, source content,
  secrets, connector payloads, or raw tool output.
- External source text in briefing prompts remains wrapped by the #316 trust boundary.
- Source freshness is recorded only as available source timestamps and source gaps in
  `source_metadata`. #541 owns user-facing freshness labels and stale-data warning UX.

## 13. Error Handling

- Invalid timezone: reject schedule create/update with 400.
- Invalid `targetTime`: reject with 400.
- `weekly` without `dayOfWeek`: reject with 400.
- `daily` with `dayOfWeek`: ignore or drop it during normalization.
- Unknown briefing type/cadence/source: reject with 400.
- Source unavailable at run time: record a gap and continue.
- Notification create failure: log metadata only; run remains successful.
- Schedule reconcile failure: log metadata only; definition mutation remains successful.
- Worker sees missing/deleted definition: complete job as a successful no-op.
- Non-read selected tool: run is `blocked`, preserving existing behavior.

## 14. Out Of Scope

- Arbitrary cron expressions.
- One-shot reminders.
- Push, mobile, SMS, email, or browser-push delivery.
- Proactive cards (#531).
- Automatic commitment extraction (#537).
- Safe automation audit-log UX (#540).
- User-facing data freshness labels (#541).
- Executing actions directly from scheduled jobs.
- Background chat turns.
- Cross-user/shared briefing schedules.

## 15. Acceptance Criteria

- [ ] A user can create, edit, enable, disable, list, and manually run explicit briefing schedules.
- [ ] Schedules support `daily` and `weekly` recurrence with IANA timezone and local target time.
- [ ] Morning, evening, and weekly-review briefing types have distinct defaults and prompts.
- [ ] Schedule enablement is separate from source permissions, source behavior settings, connector
      sync, and proactive monitoring.
- [ ] Scheduled pg-boss payloads remain metadata-only and contain no content, prompts, secrets, or
      action inputs.
- [ ] Scheduled runs are owner-scoped under `DataContextDb` and create at most one run per local
      period.
- [ ] Quiet-hours defers ready notifications but does not prevent the run from being listed.
- [ ] Existing in-app notifications are the only delivery notification surface in V1.
- [ ] Briefing suggestions never execute actions directly and route future execution through #534.
- [ ] User A cannot read, edit, schedule, run, or receive notifications for user B's briefing
      schedules.

## 16. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:briefings
pnpm test:notifications
pnpm test:api
pnpm test:web
```

Targeted tests:

- create daily morning schedule with default timezone/time;
- create weekly review with `dayOfWeek`;
- invalid timezone/time/day combinations reject;
- update cadence/time/timezone reconciles pg-boss schedule key by definition id;
- disable schedule unschedules;
- schedule payload passes metadata-only validation;
- duplicate scheduled fires in one local period create one run and one notification;
- manual run does not consume scheduled period idempotency;
- quiet-hours active defers normal ready notification;
- notifications unavailable still leaves run visible in runs list;
- source disabled by behavior setting records a gap instead of reading source data;
- non-read selected tool creates blocked run;
- weekly schedule computes next local period correctly across timezone boundaries;
- RLS isolation for definitions, runs, schedules, and notifications.

## 17. External Review

AGY reviewed this spec with `--model "Gemini 3.5 Pro"` on 2026-06-27. Final review passes exited
cleanly with no blocker/medium findings reported.
