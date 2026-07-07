# Wellness Module — Adversarial Review

- **Date:** 2026-07-04
- **Grounded on:** `6a79777d5866f5104e3019e9041e0988f94d4ff4` (origin/main, detached read-only worktree per grounding discipline; local main was 53 commits behind, `pnpm audit:preflight` exited 1, shared tree untouched)
- **Scope:** `packages/wellness/**` (SQL, repository, routes, tools, ai-consent, recall-context, focus-signal, schedule, insights, export pipeline, export renderer, manifest), registration in `packages/module-registry`, route-enablement guard in `apps/api/src/server.ts`, settings full-archive export coverage, shared schemas in `packages/shared/src/wellness-api.ts`, consent spec `docs/superpowers/specs/2026-06-25-wellness-ai-consent.md`.
- **Not reviewed:** web frontend (`apps/web/src/wellness/*`, ~2.9k lines), account-delete purge path, runtime enforcement of manifest `permissionId` (see Observations).

## Verdict

**Sound backend security posture; one consent-integrity defect and three medium data-integrity defects.** All four tables carry `ENABLE` + `FORCE ROW LEVEL SECURITY` with owner-only policies; cross-table ownership is enforced by SECURITY INVOKER triggers; every repository method takes a branded `DataContextDb`; both job queues are metadata-only with the worker re-reading params from the job row; the export HTML renderer escapes every user-derived interpolation (backed by a static test). No RLS bypass, no secret leakage, no module-isolation breach, no cross-user access path found.

The headline finding: the **AI-consent toggle does not govern all AI-facing surfaces**. The energy-trend chat-memory fact is written with no consent check, so a user who explicitly set consent to *false* still has wellness-derived data injected into AI prompts.

---

## HIGH

### H1 — Energy-trend chat-memory fact bypasses the wellness AI-consent control

`packages/wellness/src/recall-context.ts:45` (`WellnessRecallContributor.refreshEnergyTrendFact`) inserts a `[wellness:energy-trend] Energy has trended …` profile fact into chat memory via `ChatMemoryFactsRepository` — an AI-prompt surface — with **no consent check anywhere on the path**. It fires on every check-in create (`packages/wellness/src/routes.ts:133`) and every energy update (`routes.ts:175`), including when the user has explicitly set `wellness.ai_consent_granted = false`.

The two assistant tools (`packages/wellness/src/tools.ts:20,56`) correctly gate on `resolveEffectiveWellnessConsent`, so the consent machinery exists and works — this surface was simply never wired to it. The approved consent spec (`docs/superpowers/specs/2026-06-25-wellness-ai-consent.md`) contains zero mentions of the recall contributor, energy trend, or chat-memory facts, so this is a spec-coverage gap, not a sanctioned exception.

**Impact:** the settings toggle says AI use of wellness data is off, but wellness-derived content keeps flowing into chat prompts. Mitigating: the fact is deliberately abstracted (energy level only, no feeling words — `recall-context.ts:14-18`), so the leaked content is low-sensitivity. The defect is consent-integrity, not raw data exposure: a privacy control that silently doesn't cover a surface is worse than no control, because the user relies on it.

**Fix shape (not applied):** check effective consent before `refreshEnergyTrendFact`, and on consent revocation supersede any active `[wellness:energy-trend]` fact. `focus-signal.ts` is fine as-is (UI surface, not an AI prompt).

## MEDIUM

### M1 — #326 timezone remediation is schema-only: `local_date` / `timezone_offset` never written, never read

Migration `packages/wellness/sql/0107_wellness_checkins_local_date.sql` (comment: "Adversarial remediation (#326)") added `local_date text` and `timezone_offset smallint DEFAULT 0` to `wellness_checkins`. Neither column is populated by `createCheckin` (`packages/wellness/src/repository.ts` insert list omits both) and a repo-wide grep finds no TS read or write of either column. Every row has NULL `local_date` since the migration landed. Whatever #326 was meant to fix (day-boundary attribution for check-ins) is still unfixed — the remediation exists only in the schema, which is worse than absent because it reads as done.

### M2 — Exported adherence percentage is inflated relative to the app UI

`packages/wellness/src/export-job.ts:242` calls `computeInsights(windowCheckins, windowLogs, windowMeds, new Date())` **without** the `totalExpectedSlots` argument. Without it, the adherence denominator falls back to logged rows only (`packages/wellness/src/insights.ts:183`) — missed doses (no log row) are not counted. The app's own insights endpoint computes expected slots across the window and passes them (`packages/wellness/src/routes.ts:314-321`) precisely so missed doses count.

**Impact:** the export — a document explicitly intended to be handed to a doctor or therapist (footer text, `export-render.ts:299`) — reports a higher adherence percentage than the app shows for the same window. A patient who misses doses without logging them exports "100% adherence".

### M3 — PRN log with `scheduledFor` can overwrite a real scheduled-dose record

`parseLogDoseBody` (`packages/wellness/src/routes.ts`) requires `scheduledFor` for `taken`/`skipped` but does **not reject** `scheduledFor` on `status: "prn"`. The repository upserts on the partial unique index `(medication_id, scheduled_for) WHERE scheduled_for IS NOT NULL` with `doUpdateSet({status, dose, prn_reason, logged_at})`. A PRN log submitted with a `scheduledFor` matching an existing slot therefore **overwrites** a prior `taken`/`skipped` record for that slot, and the slot regresses to "pending" in the schedule view (`schedule.ts:145-162` only recognizes `taken`/`skipped`). Adherence history is silently corrupted by one malformed client request. The shared request schema does not forbid the combination either. Fix shape: reject `scheduledFor` when `status === "prn"` at parse time.

## Observations / LOW

- **Consent default-ON is the approved design, not a defect** — the spec explicitly says "Consent defaults ON for Wellness-enabled users" with effective consent inherited from module-active, and wellness is `defaultEnabled: true`. Recorded here as a deliberate opt-out privacy posture for health data: `wellness.recentCheckIns` feeds raw check-in note text to the AI for any user who never visits the toggle. Worth a conscious product re-confirmation, but it is what was specced.
- **Manifest `database.migrations` is stale dead metadata** — lists 7 of the 13 files in `packages/wellness/sql/` (omits 0104, 0107, 0135, 0136, 0138, 0139). No consumer of that array was found; `migrationDirectories` is the operative mechanism. Confusion risk only — either maintain the list or drop it (other manifests, e.g. sports, carry only `migrationDirectories`).
- **`permissionId` appears declarative-only** — no runtime consumer found in `apps/api/src`. Access control actually rests on RLS + the route-enablement guard (`apps/api/src/server.ts:317-390`), which held up under review. Also: `PUT /api/wellness/ai-consent` is gated `wellness.view` (a write behind a view permission), and the `wellness.update` description says "medications" but also gates `PATCH /api/wellness/checkins/:id`. Cosmetic today; real bugs the day permissions become enforced.
- **Adherence insight copy fabricates specificity** — `insights.ts:193` appends "a few evening doses slipped" whenever adherence < 85%, regardless of whether evening doses (or any identifiable pattern) are involved. In an export handed to a clinician (insights are an export category), invented detail is a credibility defect.
- **Weekday insights use `getUTCDay`** (`insights.ts:86`) — hardest/strongest-day attribution shifts for users far from UTC (an 11 pm Tuesday check-in in UTC-8 counts as Wednesday). Consistent with the documented naive-civil timezone model, and M1 is the root cause; noted so it's not mistaken for an independent bug.
- **Export request validation is sound** — categories are enum-validated by the shared JSON schema (`packages/shared/src/wellness-api.ts:362-375`), range capped at 366 days, one active HTML job per owner. Minor: a second export request while one is pending returns the existing job with the *old* params; the new selection is silently ignored.
- **0136 worker INSERT-only on `admin_audit_events`** with no SELECT policy — documented as intentional (write-only audit surface); verified no read path.

## Verified strengths

- **RLS:** all 4 tables (`wellness_checkins`, `medications`, `medication_logs`, `wellness_therapy_notes`) `ENABLE` + `FORCE`, owner-only CRUD for `jarvis_app_runtime`, additive owner-scoped SELECT for `jarvis_worker_runtime` (0139). Classification: **owner-only** across the module.
- **Cross-table ownership:** SECURITY INVOKER triggers on `medication_logs → medications` (0084) and `therapy_notes → checkins` (0089); route maps both trigger P0001 and FK 23503 to a uniform 404 — no ownership oracle.
- **Export pipeline:** metadata-only pg-boss payload `{actorUserId, jobId, kind}`; worker re-reads params from the job row via actor-scoped SECURITY DEFINER `worker_get_data_export_job` (0138); owner-scoped vault write; 24h expiry; metadata-only audit event.
- **Renderer:** every user-derived value passes `escapeHtml` (`export-render.ts`), enforced by a static unit test.
- **v0.1.0 audit gap closed:** the settings full-archive export now includes all four wellness tables (`packages/settings/src/data-export.ts:120-123`).
- **Input validation:** manual parsers mirror DB CHECK discriminators; bounded `limit` (1–500) and `sinceDays` (1–90).
