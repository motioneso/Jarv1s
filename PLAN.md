# Plan: Wellness design pass + emotion taxonomy migration + Insights & Therapy-notes backend

_Locked via grill — by Claude on behalf of Ben (delegated; decisions captured in `docs/superpowers/specs/2026-06-14-p5-wellness-design-taxonomy-insights.md`)_

## Goal

The Wellness module (`packages/wellness/`) is built and merged (migrations `0082`–`0084`: check-ins,
medications, medication_logs; repository/routes/tools/focus-signal/recall; minimal tabbed web). Ben
mocked a full, high-fidelity Wellness screen in Claude Design and wants it built for real, **including
the backend it implies**: adopt the design's emotion taxonomy as the persisted model, and add
**Insights** and **Therapy-notes** backends. **Explicit blast radius** (Codex R1 #3 — named so scope is
not self-contradictory; these are the established wellness integration points):
`packages/wellness/*`, `packages/shared/src/wellness-api.ts`, `packages/db/src/types.ts`,
`apps/web/src/wellness/*`, **`apps/web/src/api/client.ts`** (wellness fns beside the existing ones),
**`apps/web/src/api/query-keys.ts`** (`queryKeys.wellness.*`), one new **`apps/web/src/styles/wellness.css`**
plus its `@import` in **`apps/web/src/styles/index.css`**. **Cross-cutting test/mock files that reference the
old taxonomy or migration count are ALSO in scope** (Codex R1 #5/#6/#7): `tests/integration/foundation.test.ts`
(global migration-order assertion), `tests/integration/wellness.test.ts`, `tests/integration/wellness-medications.test.ts`,
`tests/e2e/wellness.spec.ts`. **Taxonomy cleanup gate:** `rg "wellness_feeling_core|WELLNESS_FEELING_CORES|FEELINGS_WHEEL|\b(mad|scared|joyful|powerful|peaceful)\b"`
over live source + tests + mocks must return zero stale hits before commit. No other module/package changes.

## Approach

1. **Shared contract** (`packages/shared/src/wellness-api.ts`, Vite-bundled — NO `node:*`):
   - Replace `WELLNESS_FEELING_CORES` (`mad/sad/scared/joyful/powerful/peaceful`) →
     `WELLNESS_EMOTION_CORES` = `happy, sad, fear, anger, disgust, surprise`. Update the enum JSON-schema fragment.
   - Replace `FEELINGS_WHEEL` → `EMOTIONS` (`{ core, polarity, blurb, feelings:{label,sensations[]}[] }[]`).
     Add `EMOTION_POLARITY` (`happy +1.0, sad −1.0, fear −0.8, anger −0.7, disgust −0.7, surprise +0.2`),
     `moodIndex(core,intensity)= round(polarity*intensity,1)` (−5..+5), `moodBand(x)`.
   - Rewrite `isValidFeelingPath` to 2-level: valid core + optional valid secondary; **tertiary must be null**.
   - `WHEEL_VERSION` → `"jarvis-emotion-v1"`. Keep `BODY_SENSATIONS` as a fallback list.
   - Add DTOs+schemas: `WellnessInsightDto`/`WellnessInsightsResponse`; `TherapyNoteDto` +
     create/list/delete requests/responses; `MedicationLogsResponse` (range list). Add their route schemas.
2. **Migrations** (`packages/wellness/sql/`, next free GLOBAL numbers ≥ `0088`, re-checked at commit;
   never edit the applied `0082`). **No data to migrate** — Wellness isn't enabled for any user yet
   (Ben confirmed), so the enum swap is a CLEAN swap with **no row remap** (a zero-row `ALTER … TYPE`
   never evaluates the `USING` cast). Still written as a migration (schema source of truth) and kept
   re-run-safe (Codex R1 #1):
   - `00NN_wellness_emotion_taxonomy.sql`: idempotent `DO $$ … EXCEPTION WHEN duplicate_object` to
     `CREATE TYPE app.wellness_emotion_core AS ENUM ('happy','sad','fear','anger','disgust','surprise')`;
     set `wheel_version` default to `'jarvis-emotion-v1'`. Then a PL/pgSQL `DO` block (Codex R2 #1/#2): - Capture `old_oid := to_regtype('app.wellness_feeling_core')` into a variable — do **NOT** write a
     bare `'app.wellness_feeling_core'::regtype` cast anywhere (it RAISEs once the type is dropped, on
     re-run; `to_regtype` returns NULL safely). Only proceed when `old_oid IS NOT NULL` **and** the
     `feeling_core` column's `atttypid = old_oid` (still the old type). - **Assert the table is empty first** (Codex R2 #2 — the no-remap path is only valid with zero rows):
     `IF EXISTS (SELECT 1 FROM app.wellness_checkins) THEN RAISE EXCEPTION 'wellness_checkins is
non-empty; the zero-row taxonomy swap is unsafe — author a remap migration instead'; END IF;` so a
     stray dev row fails loudly BEFORE any `ALTER`, never mid-migration. - Then `ALTER TABLE app.wellness_checkins ALTER COLUMN feeling_core TYPE app.wellness_emotion_core
USING (feeling_core::text::app.wellness_emotion_core)` (zero rows ⇒ the `USING` never evaluates). - After the block, `DROP TYPE IF EXISTS app.wellness_feeling_core`. Whole file is re-run-safe.
   - `00NN_wellness_therapy_notes.sql`: `app.wellness_therapy_notes(id, owner_user_id FK users ON DELETE
CASCADE, body text NOT NULL CHECK(btrim<>''), linked_checkin_id uuid NULL REFERENCES
app.wellness_checkins(id) ON DELETE SET NULL, linked_emotion app.wellness_emotion_core NULL,
created_at, updated_at)`; index `(owner_user_id, created_at DESC)` AND a partial index
     `(linked_checkin_id) WHERE linked_checkin_id IS NOT NULL` (Codex R1 #9 — `ON DELETE SET NULL` would
     otherwise scan the notes table on every check-in delete); ENABLE+FORCE RLS + owner-only
     SELECT/INSERT/UPDATE/DELETE policies + grants, mirroring `0082_wellness_checkins.sql`.
   - **Owner-invariant trigger** (Codex R1 #2 — FK ≠ ownership): a `SECURITY INVOKER` BEFORE INSERT/UPDATE
     trigger mirroring `app.enforce_medication_log_owner` (`0084_wellness_medication_logs.sql:34-65`) that,
     when `linked_checkin_id IS NOT NULL`, `SELECT`s the parent check-in under the invoker's RLS and
     `RAISE`s if it's invisible/missing (i.e. owned by another user). Prevents a note from linking to
     someone else's check-in despite owner-only RLS on the notes table.
   - Update `packages/db/src/types.ts`: new enum type, `WellnessTherapyNote` table interface + `Selectable`.
3. **Wellness package** (`packages/wellness/src/`):
   - `repository.ts`: write `feeling_tertiary` always null; add `createTherapyNote/listTherapyNotes/
deleteTherapyNote`; add `listLogsRange({sinceDays})` that buckets/filters by **`scheduled_for`** for
     scheduled logs (NOT `logged_at` — Codex R1 #8; matches `listLogsForDate`, `repository.ts:250-263`),
     with explicit handling of PRN logs (`scheduled_for IS NULL`); add insights reads.
   - `insights.ts` (new): pure derivation `computeInsights(checkins, logs, meds, now)` → insight items
     (most-logged emotion; hardest/strongest weekday with ≥2 check-ins and ≥80% one-sided; check-in streak;
     count of sad/anger check-ins carrying a note; 30-day adherence%). Mirrors the design's `computeInsights`.
   - `routes.ts`: add `GET /api/wellness/insights`, `GET/POST/DELETE /api/wellness/therapy-notes`,
     `GET /api/wellness/medications/logs?sinceDays=`. Body parsers mirror existing (HttpError 400s).
   - `serialize.ts`: add `serializeTherapyNote`. `serializeCheckin` shape unchanged (tertiary null).
   - `recall-context.ts` / `focus-signal.ts`: UNCHANGED — both still read `energy` (orthogonal to the
     mood index). Confirm the `feeling_core` select still type-checks against the new enum.
   - `tools.ts`: `wellnessRecentCheckInsExecute` additionally surfaces derived `moodIndex` per item.
   - `manifest.ts` (Codex R1 #4): add the two new SQL files to `database.migrations[]`; add
     `app.wellness_therapy_notes` to `database.ownedTables[]`; add the new routes to `routes[]` (Phase-2
     route-coverage assertion — every declared route needs a registered handler & vice-versa); add a
     `wellness.delete` permission (for `DELETE /therapy-notes`) since the current manifest only declares
     view/create/update. Map: insights/logs/therapy-notes GET → `wellness.view`, therapy-notes POST →
     `wellness.create`, therapy-notes DELETE → `wellness.delete`.
4. **Web** (`apps/web/src/wellness/*` + `apps/web/src/styles/wellness.css` imported from `styles/index.css`):
   port `Wellness.jsx`/`WellnessCheckin.jsx`/`WellnessCharts.jsx`/`wellness.css` into TS/React, decomposed
   to stay <1000 lines/file: scroll page + hero stats; today meds (schedule slots + log) + today check-in;
   insights panel; trends (range control + combined mood-line/adherence-strip SVG, client-computed from
   `listCheckins(sinceDays)` + `listMedicationLogs(sinceDays)` + meds); expandable history; therapy-notes
   pad; check-in modal (Guided default + Palette; Radial optional) → `createWellnessCheckin`
   (`feelingCore`=emotion, `feelingSecondary`=feeling, sensations, intensity, optional energy, note,
   `identifiedVia:'wheel'`); manage-meds modal. Add client fns + query keys:
   `getWellnessInsights/listTherapyNotes/createTherapyNote/deleteTherapyNote/listMedicationLogs`.
   Emotion→oklch color ramp lives frontend-only (`emotion-taxonomy.ts`).
5. **Tests** — beyond `tests/integration/wellness.test.ts` (`pnpm test:wellness`), fix every cross-cutting
   suite that references the old taxonomy/migration count (Codex R1 #5/#6/#7):
   - `tests/integration/foundation.test.ts` — bump the hard-coded global migration-order/count assertion
     (currently through `0087`) to include `0088`/`0089` after re-checking the high-water mark.
   - `tests/integration/wellness.test.ts` + `tests/integration/wellness-medications.test.ts` — update all
     fixtures/assertions to the new cores; the energy-trend **privacy assertion** must assert the NEW raw
     emotion words stay out of the abstracted fact (production energy logic stays unchanged).
   - `tests/e2e/wellness.spec.ts` — update mocks/selectors for the new screen + taxonomy.
   - New coverage: taxonomy persist/reject; `moodIndex`/`moodBand` units; `db:migrate` idempotent (run
     twice); insights owner-only; therapy-notes CRUD owner-only RLS + **cross-owner link rejected by the
     trigger** + link-null-on-checkin-delete; `listLogsRange` buckets by `scheduled_for`; Playwright smoke.
   - **Cleanup gate:** the `rg` for old enum names/values returns zero stale hits. Full
     `pnpm verify:foundation` + `audit:release-hardening` green; no file >1000 lines.

## Key decisions & tradeoffs

- **Adopt the design taxonomy in the DB (vs frontend-only restyle).** Ben's explicit call. The mood index
  (polarity×intensity) is the central concept and needs a real emotion set. Cost: an enum swap — but with
  a **verified-empty** `wellness_checkins` table (Wellness not yet installed for any user), so no remap.
- **`energy` is KEPT and stays orthogonal** to the new mood index. `energy` is the SOLE input to
  `wellnessFocusSignal` (readiness) and `refreshEnergyTrendFact` (Codex R1 explicitly forbade conflating
  emotion intensity with energy). intensity→mood index; energy→readiness. The modal keeps an optional,
  secondary energy control so those signals keep working — the one deliberate addition beyond the mockup.
- **Polarity is derived, never stored.** Static `EMOTION_POLARITY` map in shared; no new column.
- **2-level taxonomy.** Keep `feeling_tertiary` column (always null) to avoid a column drop; rewrite
  `isValidFeelingPath`.
- **Enum swap strategy (no data):** Ben confirmed Wellness isn't installed for any user, so there are
  ZERO check-in rows — the swap is clean (no `CASE` remap; zero-row `ALTER … TYPE … USING` never casts a
  value). New type + type-guarded `ALTER COLUMN` + `DROP TYPE IF EXISTS`, in one new migration (never
  editing `0082`), re-run-safe via a `to_regtype`/`atttypid` guard.
- **Therapy-note owner invariant via trigger, not FK.** The `linked_checkin_id` FK guarantees existence,
  not ownership; a `SECURITY INVOKER` trigger (mirroring `enforce_medication_log_owner`) rejects a link to
  a check-in the actor can't see under RLS — closing the cross-owner-link hole.
- **Insights server-derived** (testable, reusable by AI/briefings later) rather than client-only.
- **Trends client-computed** from a new logs-range endpoint + existing checkins list, matching the design.
- **Therapy notes = new owner-only table** mirroring check-ins' RLS; no sharing.
- **Pickers:** Guided (default, required) + Palette; Radial optional/stretch. Tweaks not wired (fixed defaults).
- **Medications backend unchanged**; the design's simple Morning/Evening regimen expressed via existing
  `once_daily`/`as_needed` + `schedule_times`; card wires to existing `/schedule` + `/:id/logs`.

## Risks / open questions

- Enum swap: no rows exist, so no remap/abort risk; the only failure mode is re-run (handled by the
  `to_regtype`/`atttypid` guard + `DROP TYPE IF EXISTS`). Test `pnpm db:migrate` twice (idempotent).
- Scope is large (taxonomy + 2 backends + full web port). MVP exit criteria bound it; Radial / insights AI
  tool / mood-index recall fact / Tweaks are explicit stretch. Build is phased: contract+migrations+backend
  first, then web.
- Global migration-number contention — re-check high-water mark (`0087`) immediately before commit.
- Two 1–5 scales (intensity vs energy) in one modal could confuse — intensity primary (drives the visible
  mood band), energy clearly-labeled secondary.

## Out of scope

- Active medication reminders (Phase-3 scheduler); schedule editing of an existing med.
- Tweaks-panel wiring; new briefing-section copy; caregiver/sharing of wellness data.
- AI/briefings re-tuning beyond keeping existing tools correct.
