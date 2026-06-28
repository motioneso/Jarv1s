# Plan: Scheduled recurring Jarvis briefings V1

1. **SQL Migration**:
   - Create `packages/briefings/sql/XXXX_scheduled_recurring_briefings.sql`
   - Run `ALTER TYPE app.briefing_type ADD VALUE IF NOT EXISTS 'weekly_review';`

2. **API & Types** (`packages/shared/src/briefings-api.ts`):
   - Update `BriefingType` type and `briefingTypeSchema` to include `weekly_review`.
   - Add `BriefingScheduleMetadataV1` interface and corresponding schema.
   - Validate `timezone` string with IANA checks, `targetTime` in `HH:mm` format, and `dayOfWeek`.

3. **Schedule Reconciliation** (`packages/briefings/src/schedule.ts`):
   - Update logic to construct pg-boss cron strings based on cadence (`daily`, `weekly`) and schedule metadata.
   - Deschedule if cadence is `manual`, schedule is disabled, or metadata is invalid.
   - Enqueue jobs with `ScheduledBriefingCronPayload` (metadata only).

4. **Run Engine & Idempotency** (`packages/briefings/src/jobs.ts`, `packages/briefings/src/repository.ts`):
   - At fire time, compute the current local period for the timezone.
   - Enforce 1-run-per-period idempotency using an advisory lock derived from `definitionId + localPeriod`.
   - Return existing run if period slot is already filled.

5. **Notifications & Delivery** (`packages/briefings/src/jobs.ts`):
   - Generate ready notifications with `normal` urgency to flow through quiet-hours deferral.
   - Ensure notification metadata contains only IDs and no run summary text.

6. **Source Selection & Defaults** (`packages/briefings/src/routes.ts`, `packages/briefings/src/compose.ts`):
   - Provide default source sets for `morning`, `evening`, and `weekly_review`.
   - Since `goals.listActive` is not present on branch, implement source gap recording for it.
   - Block runs that select non-read tools if not already covered.
