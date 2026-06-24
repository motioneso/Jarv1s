# Build plan: Wellness design pass + emotion taxonomy + Insights & Therapy-notes

**Spec:** `docs/superpowers/specs/2026-06-14-p5-wellness-design-taxonomy-insights.md`
**Codex-approved plan:** `PLAN.md` (worktree root) — survived 3 adversarial rounds (`PLAN-REVIEW-LOG.md`).
**Branch/worktree:** `worktree-feat+wellness-design` (this worktree). Design bundle (reference, read-only):
`~/.claude/jobs/914af5c0/tmp/design/jarvis-design-system/project/ui_kits/jarvis-app/` —
`Wellness.jsx`, `WellnessCheckin.jsx`, `WellnessCharts.jsx`, `wellness.css`, `wellness-data.js`.

Build proceeds in 3 phases (TDD; each commits green with `Co-Authored-By: Claude`). Phase 1
is the critical path; Phases 2 and 3 depend on it and run in parallel.

## Phase 1 — Shared foundation (critical path; coordinator does this)

1. `packages/shared/src/wellness-api.ts` — replace `WELLNESS_FEELING_CORES`→`WELLNESS_EMOTION_CORES`
   (`happy,sad,fear,anger,disgust,surprise`); replace `FEELINGS_WHEEL`→`EMOTIONS`
   (`{core,polarity,blurb,feelings:{label,sensations[]}[]}[]`) from `wellness-data.js`; add
   `EMOTION_POLARITY`, `moodIndex(core,intensity)`, `moodBand(x)`; rewrite `isValidFeelingPath` 2-level
   (tertiary must be null); `WHEEL_VERSION="jarvis-emotion-v1"`; keep `BODY_SENSATIONS`. Add DTOs+schemas:
   `WellnessInsightDto`/`WellnessInsightsResponse`, `TherapyNoteDto`+create/list/delete, `MedicationLogsResponse`,
   - route schemas. NO `node:*`.
2. `packages/db/src/types.ts` — new enum, `WellnessTherapyNote` interface + `Selectable` export.
3. `packages/wellness/sql/0088_wellness_emotion_taxonomy.sql` — per PLAN.md: PL/pgSQL `DO` block capturing
   `old_oid := to_regtype('app.wellness_feeling_core')` (NO bare `::regtype` cast), empty-table assertion
   (`RAISE` if `wellness_checkins` non-empty), guarded `ALTER COLUMN … USING (…::text::…)`,
   `DROP TYPE IF EXISTS`. Re-run-safe; idempotent.
4. `packages/wellness/sql/0089_wellness_therapy_notes.sql` — table + 2 indexes (incl. partial on
   `linked_checkin_id`), `SECURITY INVOKER` owner trigger mirroring `enforce_medication_log_owner`
   (`0084:34-65`), ENABLE+FORCE RLS + owner policies + grants.
5. `packages/wellness/src/manifest.ts` — add `0088`/`0089` to `database.migrations`,
   `app.wellness_therapy_notes` to `ownedTables`, new routes to `routes[]`, `wellness.delete` permission.
   **Gate:** `pnpm typecheck`, `pnpm db:migrate` ×2 (idempotent), `pnpm lint`/`format` on changed files. Commit.

## Phase 2 — Backend wiring + tests (agent; this worktree, uses dev DB)

- `packages/wellness/src/repository.ts` — `feeling_tertiary` always null; therapy-note CRUD;
  `listLogsRange({sinceDays})` filtered by **`scheduled_for`** (not `logged_at`); insights reads.
- `packages/wellness/src/insights.ts` (new) — pure `computeInsights(checkins, logs, meds, now)` mirroring
  `wellness-data.js` `computeInsights`.
- `routes.ts` — `GET /insights`, `GET/POST/DELETE /therapy-notes`, `GET /medications/logs?sinceDays=`.
- `serialize.ts` — `serializeTherapyNote`. `tools.ts` — add derived `moodIndex` per check-in.
- Tests: `tests/integration/wellness.test.ts` (new coverage + fixtures→new cores; energy-trend privacy
  assertion uses new words), `tests/integration/wellness-medications.test.ts` (fixtures),
  `tests/integration/foundation.test.ts` (migration count/order → `0089`).
  **Gate:** `pnpm test:wellness` + the touched suites green; cleanup-gate `rg` returns zero stale hits in `packages/`+`tests/`.

## Phase 3 — Web port + wiring (agent; SEPARATE worktree off Phase-1 commit; no DB needed)

- Port the design into `apps/web/src/wellness/*` (decomposed <1000 lines/file): `wellness-page`,
  `wellness-today`, `wellness-insights`, `wellness-trends`+`wellness-chart`, `wellness-history`,
  `wellness-therapy-notes`, `checkin-modal`+`checkin-detail-fields`, `manage-meds-modal`, `emotion-taxonomy.ts`.
- `apps/web/src/styles/wellness.css` (port) + `@import` in `styles/index.css`.
- `apps/web/src/api/client.ts` + `query-keys.ts` — `getWellnessInsights`, `listTherapyNotes`,
  `createTherapyNote`, `deleteTherapyNote`, `listMedicationLogs`.
- Guided check-in default + Palette; Radial optional. Wire all surfaces to React Query.
- `tests/e2e/wellness.spec.ts` — update mocks/selectors for the new screen + taxonomy.
  **Gate:** `pnpm typecheck` (web), `pnpm build:web`, `pnpm lint`/`format`; cleanup-gate `rg` zero in `apps/web/`.

## Phase 4 — Integrate + verify (coordinator)

Merge Phase 3 branch into this worktree; full `pnpm verify:foundation` + `pnpm audit:release-hardening`
green; no file >1000 lines; cleanup-gate `rg` zero repo-wide; commit; update epic #50; save memory.
