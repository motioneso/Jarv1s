# Phase 5: Wellness — design pass + emotion taxonomy + insights & therapy notes

**Status:** Draft (awaiting Ben's approval)
**Date:** 2026-06-14
**Owner:** Ben
**GitHub:** Epic #50 (Phase 5 · Wellness, milestone #14). Follows and partially **supersedes**
`docs/superpowers/specs/2026-06-13-p5-wellness-first-optional-module.md` (the original module, now
built: migrations `0082`–`0084`, repository/routes/tools/focus-signal/recall, minimal web).
**Grounded on:** local `main` == `origin/main` at session start (clean; global migration high-water
mark `0087`). Re-run `pnpm audit:preflight` (exit 0) and record the verified commit at build time.

**Design source:** Claude Design handoff bundle "Jarvis Design System", primary file
`ui_kits/jarvis-app/Wellness.jsx` (+ `WellnessCheckin.jsx`, `WellnessCharts.jsx`, `wellness.css`,
`wellness-data.js`). The bundle's emotion taxonomy is adapted from a Braman-style
emotion–sensation wheel (Ekman-family cores + polarity), distinct from the Willcox wheel the module
shipped with. Chat transcripts confirm the **mood index (polarity × intensity)** is the deliberate,
central concept and the connective tissue to the rest of Jarvis; tone is **warm, editorial,
anti-shame** ("privacy through restraint, never lock/fear language; missed days never red").

---

## Context

The Wellness module exists and works, but its web surface is a minimal tabbed Feelings/Medications
placeholder. Ben mocked a full, high-fidelity Wellness screen in Claude Design and wants it built for
real, including the backend changes it implies. Two of the design's concepts have **no backend today**
and one **conflicts** with what's persisted:

1. **Emotion taxonomy conflict.** The DB persists Willcox-1982 cores
   (`mad/sad/scared/joyful/powerful/peaceful`, 3-level path) with a separate `energy` field. The
   design uses Ekman-family cores (`happy/sad/fear/anger/disgust/surprise`, 2-level) each carrying a
   **polarity**, from which a **mood index** (−5…+5 = polarity × intensity) is derived and plotted.
2. **Insights** — a monthly "what this month is telling you" panel (most-logged emotion, hardest /
   strongest weekday, check-in streak, notes worth reviewing, adherence). No backend.
3. **Therapy notes** — a private "for your next session" pad; notes optionally linked to a feeling.
   No backend.

**Ben's decisions (this session):** (1) **Adopt the design's emotion taxonomy as the real persisted
model** — change the shared contract + migrate the DB. (2) **Build the Insights and Therapy-notes
backend too**, gated behind this spec.

---

## Goals

1. Replace the Wellness web surface with a faithful port of the design: hero stats, today's
   medication + check-in cards, monthly **Insights**, the combined **Trends** chart (mood line +
   daily medication-adherence strip), expandable **check-in history**, and the **therapy-notes** pad —
   wired to real data via React Query.
2. **Migrate the persisted emotion taxonomy** from Willcox to the design's 6 emotions, with a static
   **polarity** map and a derived **mood index** — without losing the orthogonal `energy` signal that
   focus/recall depend on.
3. Add **Insights** and **Therapy-notes** backend (tables/derivation + REST + shared contract +
   owner-only RLS), reusing the module's established patterns.
4. Keep everything inside the Wellness blast radius: `packages/wellness/*`, `packages/shared/src/
wellness-api.ts`, `packages/db/src/types.ts` (table/enum types), `apps/web/src/wellness/*`, and one
   new `apps/web/src/styles/wellness.css` (+ its `index.css` import). No other module changes.

## Non-Goals (deferred)

- **Active medication reminders** (still gated on the Phase-3 scheduler, per the original spec).
- **Schedule editing** of an existing med (still delete+recreate, per `wellness-api.ts` note).
- **Tweaks wiring** (the design's `checkinStyle/emotionTint/wellDensity/medStrip` props). Ship
  sensible fixed defaults (Guided, tinted, comfortable, dots); a Tweaks panel is later.
- **AI/briefings re-tuning** for the new taxonomy beyond keeping the existing tools correct — no new
  briefing section copy this slice.
- **Caregiver sharing** of wellness data — owner-only stays.

---

## Resolved Decisions

1. **Emotion set + polarity (static reference data, not a table).** Replace `WELLNESS_FEELING_CORES`
   and `FEELINGS_WHEEL` in `packages/shared/src/wellness-api.ts` with the design's taxonomy:
   `happy(+1.0) · sad(−1.0) · fear(−0.8) · anger(−0.7) · disgust(−0.7) · surprise(+0.2)`, each with a
   list of **feelings** (the secondary), each feeling carrying suggested **sensations**. Add a
   `EMOTION_POLARITY` map and `moodIndex(emotion, intensity)` / `moodBand(x)` helpers. Polarity is
   **derived, never stored** — a check-in stores `feeling_core` + `intensity`; the mood index is
   computed wherever needed (browser-safe, no `node:*`).
2. **Depth = 2 levels.** `feeling_secondary` holds the chosen feeling; `feeling_tertiary` is retained
   in the schema but **always null** in the new flow (avoids a column drop). `isValidFeelingPath`
   becomes "valid core + optional valid secondary; tertiary must be null". `wheel_version` default
   becomes `"jarvis-emotion-v1"`.
3. **`energy` is kept and stays orthogonal.** intensity → **mood index** (emotional valence trend);
   `energy` → **readiness** (focus-signal + recall energy-trend). These are NOT merged (honoring the
   Codex R1 "do not conflate emotion with energy" finding). The check-in modal keeps an **optional,
   secondary** energy control in the details step so `wellnessFocusSignal` / `refreshEnergyTrendFact`
   keep producing a signal. This is the one deliberate addition beyond the mockup; clearly subordinate
   visually, easy for Ben to cut in a later design pass.
4. **Taxonomy migration (new migration, never edit applied).** Create enum `app.wellness_emotion_core`
   with the 6 new values; swap `wellness_checkins.feeling_core` to it via
   `ALTER COLUMN ... TYPE ... USING (CASE …)` mapping existing dev rows
   (`mad→anger, scared→fear, joyful→happy, powerful→happy, peaceful→happy, sad→sad`), **null out**
   `feeling_secondary`/`feeling_tertiary` on migrated rows (old Willcox words are invalid under the new
   taxonomy), set `wheel_version='jarvis-emotion-v1'`, then drop the old `app.wellness_feeling_core`
   type. Idempotent guards throughout. Update `packages/db/src/types.ts` accordingly.
5. **Insights = server-derived endpoint.** `GET /api/wellness/insights` computes over the actor's
   check-ins + med logs (last 30 days) and returns structured items (most-logged emotion, hardest /
   strongest weekday, check-in streak, notes-worth-reviewing count, adherence %), mirroring the
   design's `computeInsights`. Server-side so it's testable and reusable by AI/briefings later. No new
   table.
6. **Trends chart = client-computed from real series.** Add `GET /api/wellness/medications/logs?
sinceDays=<n>` (range list of dose logs; thin wrapper over the existing `listRecentLogs`). The web
   chart computes the mood line from `listCheckins(sinceDays)` and the per-day adherence strip from the
   logs range + the meds list (denominator = scheduled meds), matching `WellnessCharts.jsx`.
7. **Therapy notes = new owner-only table.** `app.wellness_therapy_notes` (body, optional
   `linked_checkin_id`, optional `linked_emotion`), REST `GET/POST/DELETE
/api/wellness/therapy-notes`, shared DTOs/schemas, serialize, RLS mirroring `wellness_checkins`.
8. **Check-in pickers.** **Guided** (stepped) is the default and the required, polished picker.
   **Palette** (accordion) is included (cheap). **Radial** dial is **optional/stretch** (Ben noted it
   felt "too bop-it"). Style is a fixed default this slice (no Tweaks wiring).
9. **Medications wiring uses existing endpoints unchanged.** The design's "Today's medication" card
   maps to `GET /schedule` slots + `POST /:id/logs`; the Manage-meds modal maps to
   `GET/POST /medications` (+ `PATCH` active). The design's simple Morning/Evening regimen is expressed
   as `once_daily`/`as_needed` meds with `schedule_times`. No medication backend change.

---

## Architecture (deltas only)

### A. Shared contract (`packages/shared/src/wellness-api.ts`)

- Replace `WELLNESS_FEELING_CORES` → `WELLNESS_EMOTION_CORES = [happy,sad,fear,anger,disgust,surprise]`
  (keep a clear type alias path; update the `enum` JSON-schema fragment). Replace `FEELINGS_WHEEL` →
  `EMOTIONS` (`{ core, polarity, blurb, feelings: { label, sensations }[] }[]`). Add
  `EMOTION_POLARITY`, `moodIndex`, `moodBand`, and `EMOTION_BLURBS`. Rewrite `isValidFeelingPath`
  (core + optional secondary; tertiary null). Keep `BODY_SENSATIONS` as an extra fallback list.
- Add **Insights** DTOs + schemas (`WellnessInsightDto`, `WellnessInsightsResponse`) and the
  `wellnessInsightsRouteSchema`.
- Add **Therapy-note** DTOs + schemas (`TherapyNoteDto`, `Create/ListTherapyNotes*`,
  route schemas).
- Add `MedicationLogsResponse` (range list) + its route schema.
- Browser-safe: **no `node:*` imports** (this file is Vite-bundled — see the Shared Browser Bundle
  memory).

### B. SQL migrations (`packages/wellness/sql/`, next free GLOBAL numbers ≥ `0088`)

- `00NN_wellness_emotion_taxonomy.sql` — new enum, column swap + row remap (Decision 4), drop old enum,
  update `wheel_version` default.
- `00NN_wellness_therapy_notes.sql` — `app.wellness_therapy_notes` (owner-only, ENABLE+FORCE RLS,
  owner policies + grants mirroring `0082`), index on `(owner_user_id, created_at DESC)`,
  `linked_checkin_id` FK `ON DELETE SET NULL`, `linked_emotion app.wellness_emotion_core NULL`.
- Re-check the global high-water mark immediately before commit (numbers are global by landing order).

### C. Wellness package (`packages/wellness/src/`)

- `repository.ts` — drop `feeling_tertiary` writes to always-null; add therapy-note methods
  (`createTherapyNote`, `listTherapyNotes`, `deleteTherapyNote`); add `listLogsRange(sinceDays)`;
  add `computeInsights(scopedDb, …)` (or a pure `insights.ts` fed by repo reads).
- `routes.ts` — add `GET /insights`, `GET/POST/DELETE /therapy-notes`,
  `GET /medications/logs`. Body parsers mirror the existing ones (HttpError 400s).
- `serialize.ts` — add `serializeTherapyNote`; `serializeCheckin` unchanged (shape stable; tertiary
  null).
- `recall-context.ts` / `focus-signal.ts` — **unchanged** (still read `energy`). Confirm the
  `feeling_core` select still type-checks against the new enum.
- `tools.ts` — `wellnessRecentCheckInsExecute` may additionally surface `moodIndex` (derived) per item;
  no provider/model hardcoding.
- `manifest.ts` — add the new routes to `routes[]` (Phase-2 coverage assertion); optionally declare a
  `wellness.insights` read tool (stretch).

### D. Web (`apps/web/src/wellness/` + styles)

Port `Wellness.jsx` into TS/React, decomposed to stay <1000 lines/file:

- `wellness-page.tsx` — the scroll shell + hero stats + section composition (replaces the tabbed
  placeholder).
- `wellness-today.tsx` — `MedToday` (schedule slots + log) + `CheckinToday` (today's check-in summary
  / emostrip prompt).
- `wellness-insights.tsx` — Insights panel (from `GET /insights`).
- `wellness-trends.tsx` + `wellness-chart.tsx` — range control + combined mood/adherence SVG chart
  (port of `WellnessCharts.jsx`), client-computed from checkins + logs + meds.
- `wellness-history.tsx` — expandable check-in history (+ "review notes" filter).
- `wellness-therapy-notes.tsx` — the notes pad (`GET/POST/DELETE /therapy-notes`).
- `checkin-modal.tsx` (+ `checkin-detail-fields.tsx`) — Guided (default) + Palette pickers, optional
  Radial; sensations + intensity + optional energy + note → `POST /checkins` (`createWellnessCheckin`,
  `feelingCore=emotion`, `feelingSecondary=feeling`, `identifiedVia='wheel'`).
- `manage-meds-modal.tsx` — list + add/remove (maps to `POST/PATCH /medications`).
- `emotion-taxonomy.ts` — thin re-export/typing over the shared `EMOTIONS` + a theme-aware oklch color
  ramp (`emoColor`/`medColor`, ported from `wellness-data.js`); colors live frontend-only.
- `apps/web/src/styles/wellness.css` — port of the design `wellness.css` (~325 lines), imported from
  `apps/web/src/styles/index.css`. Uses existing DS tokens already present in the web app.
- `apps/web/src/api/client.ts` + `query-keys.ts` — add `getWellnessInsights`, `listTherapyNotes`,
  `createTherapyNote`, `deleteTherapyNote`, `listMedicationLogs`, and their query keys.

The design JSX references DS primitives via `window.JarvisDesignSystem_82a225` (`Button`,
`SegmentedControl`, `ProgressLine`, `Dialog`, `Input`, `Select`, `Checkbox`). The web app renders the
DS via CSS classes (the settings pass established this), so the port uses the existing className-based
primitives / small local components, not a `window` bundle.

---

## Testing strategy

Extend `tests/integration/wellness.test.ts` (`pnpm test:wellness`):

- **Taxonomy:** a check-in with a new core (e.g. `anger`) persists; an old core (`mad`) is rejected;
  `isValidFeelingPath` accepts core+valid-secondary and rejects a tertiary; `moodIndex`/`moodBand`
  unit-tested (polarity × intensity, banding). Migration idempotent; `db:migrate` clean; remapped rows
  carry a valid new core and null secondary.
- **`energy` preserved:** `wellnessFocusSignal` + `refreshEnergyTrendFact` still derive from `energy`
  (unchanged behavior); a check-in without energy yields a null focus signal.
- **Insights:** `GET /insights` returns the expected items over a seeded 30-day owner set; owner-only
  (actor B sees only their own); empty history → empty/ですsensible payload.
- **Therapy notes:** create/list/delete owner-only (RLS — actor B cannot read/delete A's); optional
  `linked_checkin_id`/`linked_emotion` validated; deleting a linked check-in sets the link null.
- **Logs range:** `GET /medications/logs?sinceDays=30` returns owner's logs in range.
- **Web (Playwright smoke):** `/wellness` renders the new scroll; logging a med toggles a slot; the
  check-in modal (Guided) saves and the summary appears; a therapy note adds/removes.
- **Gate:** `pnpm verify:foundation` + `pnpm audit:release-hardening` green; no source file >1000
  lines.

---

## Exit Criteria

1. Shared contract uses the design's 6 emotions + polarity/mood-index helpers; `isValidFeelingPath`
   is 2-level; browser-safe. `packages/db/src/types.ts` reflects the new enum.
2. Migrations (global-numbered, in `packages/wellness/sql/`, never editing applied files) swap the
   check-in core enum with a row remap and add `app.wellness_therapy_notes` (owner-only ENABLE+FORCE
   RLS + grants); `pnpm db:migrate` idempotent.
3. `energy` retained and orthogonal; focus-signal + recall energy-trend behavior unchanged.
4. REST: `GET /insights`, `GET/POST/DELETE /therapy-notes`, `GET /medications/logs` live, owner-scoped
   under `withDataContext`, declared in `manifest.routes`.
5. Web Wellness screen matches the design: hero stats, today meds+check-in, insights, combined
   trends chart, expandable history, therapy notes; check-in modal (Guided default, Palette included)
   writes real check-ins; meds card logs real doses; all React-Query wired. New `wellness.css`
   imported.
6. Tone/privacy held: owner-only throughout; no raw feelings/meds in logs, pg-boss payloads, or AI
   prompts beyond the user's own data; missed days never red; no lock/fear language.
7. Gate + release-hardening green; no file >1000 lines.

**Stretch (not blocking):** Radial picker; `wellness.insights` AI tool; a mood-index recall fact
(abstracted, privacy-safe); Tweaks wiring.

---

## Hard Invariants Honored (from CLAUDE.md)

- **Private by default / owner-only:** therapy notes table is owner-only RLS (ENABLE+FORCE, no share,
  no admin read), mirroring `wellness_checkins`. No new shareable resources.
- **DataContextDb only:** every new repo method takes `scopedDb: DataContextDb`,
  `assertDataContextDb` first; all access under `withDataContext`.
- **Never edit applied migrations:** new files only, global-ordered, in the module's `sql/`.
- **Secrets/health content never escape:** no feelings/meds/notes in logs, job payloads, or AI
  prompts beyond the user's own data; insights/focus summaries stay derived/abstracted.
- **Module isolation:** all changes inside `packages/wellness` + `shared` + `db` types + `apps/web`;
  no other module imported; no other module's tables queried.
- **Provider-agnostic AI:** no hardcoded provider/model in any new code.
- **Spec before build:** this document is that gate.

---

## Open Risks

1. **Enum swap on non-empty data.** `ALTER COLUMN … TYPE … USING` must map every existing value; an
   unmapped row aborts the migration. Mitigation: exhaustive `CASE` over all 6 old values + a default;
   test against seeded old rows; dev-only data lowers blast radius.
2. **Lossy remap.** `powerful`/`peaceful` collapse to `happy`. Acceptable (dev data, anti-shame intent
   preserved); documented in the migration comment.
3. **Scope size.** This is a large slice (taxonomy + 2 surfaces + full port). Mitigation: MVP exit
   criteria above; Radial/insights-tool/recall-fact are explicit stretch; build can be phased
   (backend+contract first, then web).
4. **Migration-number contention.** Global numbers; re-check the high-water mark immediately before
   commit (currently `0087`).
5. **Mood-index vs energy confusion.** Two 1–5-ish scales in one modal could confuse. Mitigation:
   intensity is primary (drives the visible mood band preview); energy is an optional, clearly-labeled
   secondary control, easy to cut.
