# Wave 1 / Lane B — Wellness Fixes Implementation Plan

**Goal:** Ship three wellness dogfood fixes in one PR — PRN multi-dose logging (#387), an
at-a-glance "meds today" home glance + soft reminder (#385), and a legible mobile trend chart
(#386).

**Architecture:** All three are presentation/existing-API work. The only backend change is a
**non-breaking additive field** on the existing schedule endpoint's slot DTO (`prnCount`), derived
from logs the endpoint already fetches via `listLogsForDate` — no new endpoint, no migration, no
notification mechanism. The frontend consumes the existing wellness `api/client` only.

**Tech Stack:** React + TanStack Query (web), Fastify routes + Kysely repo (wellness module),
shared TS contracts + JSON Schema (`@jarv1s/shared`), Vitest integration tests, plain CSS/SVG.

## Global Constraints

- **No migration, no new endpoint, no notification mechanism.** PRN persistence is already
  supported by the backend; the count comes from extending the existing schedule slot.
- **Module isolation:** web goes through `api/client` only; never queries wellness tables.
- **No raw dose/prnReason leak** beyond what existing routes already expose (mirror
  `routes.ts` behaviour — the adherence summary deliberately omits dose/prnReason).
- **File-size cap 1000 lines** incl. CSS. `wellness-1.css` is 894 / `wellness-2.css` is 913 —
  thin headroom; mobile-chart CSS goes in a **new `wellness-3.css`** imported last to preserve
  order and stay under cap.
- Owner-scoped via existing `DataContextDb` / route auth; do not widen access.
- Commits use the `Co-Authored-By: Claude Sonnet 4.6` trailer; `git add` only the task's paths.

## Key decisions (flagged to Coordinator before build)

1. **#387 PRN count source.** Existing endpoints expose NO per-day PRN count — `computeSchedule`
   emits a single `asNeeded` slot with `status:"pending"` regardless of PRN logs, and the adherence
   summary collapses PRN the same way. To show "N taken today" reliably (survives reload) we add a
   `prnCount: number` field to `ScheduleSlotDto`, computed from the day's logs already in scope.
   Additive + backward-compatible. **This is the one backend touch; confirm it's in scope vs. a
   pure-frontend optimistic counter (rejected: resets on reload, can't show real count).**
2. **#387 prnReason UX (revised per GLM/Coordinator).** DB CHECK requires non-empty `prn_reason`
   when `status:"prn"`. We do **not** auto-submit a hardcoded placeholder — that would write
   fabricated clinical data into a health audit trail — and never send blank. Instead we capture a
   **user-acknowledged** reason: quick-pick chips of common reasons + free text, with the Log
   button disabled until non-empty. What the user enters is exactly what is stored.
3. **#386 mobile chart.** Functional default = wrap the SVG plot in a horizontally-scrollable
   container with a `min-width` at phone widths so the 760-unit viewBox renders at a legible scale
   (text no longer crushed), plus a small axis-text bump. Verified ~375–430px; Ben verifies look
   against his screenshot.

## Execution order (Coordinator directive)

The `prnCount` **shared-contract change lands LAST, as its own most-isolated commit** (a GLM
adversarial plan review is scrutinizing this contract change; coordinator relays findings before
QA). So commit order is: **#386 CSS → #385 glance → #387 PRN logging action → (LAST) prnCount
contract + schedule compute + count display + integration test.** The field is **optional /
backward-compat** (`prnCount?: number`, NOT in JSON-schema `required`); older payloads without it
still validate and the frontend defaults to `?? 0`. Earlier commits must not reference `prnCount`
(keeps each commit green and the contract change cleanly revertible).

## File structure

- `packages/shared/src/wellness-api.ts` — add `prnCount` to `ScheduleSlotDto` + `scheduleSlotDtoSchema`.
- `packages/wellness/src/schedule.ts` — `computeSchedule` sets `prnCount` (PRN logs/day for the med).
- `tests/integration/wellness-medications.test.ts` — PRN multi-log + count assertions.
- `apps/web/src/wellness/wellness-today.tsx` — PRN repeatable "log a dose" + today count (#387).
- `apps/web/src/today/today-page.tsx` — aside "Wellness" glance state + soft reminder (#385).
- `apps/web/src/styles/wellness-3.css` (new) — mobile chart legibility (#386); imported last.
- `apps/web/src/wellness/wellness-trends.tsx` / `today-page.tsx` — import `wellness-3.css`.

---

### Task 1: Backend — `prnCount` on the schedule slot (#387 data)

**Files:**

- Modify: `packages/shared/src/wellness-api.ts` (`ScheduleSlotDto` interface ~L150; `scheduleSlotDtoSchema` ~L551)
- Modify: `packages/wellness/src/schedule.ts` (`computeSchedule`)
- Test: `tests/integration/wellness-medications.test.ts`

**Interfaces:**

- Produces: `ScheduleSlotDto.prnCount: number` — for `asNeeded` slots, count of the day's PRN logs
  (`scheduled_for IS NULL && status === "prn"`) for that med; `0` for scheduled slots.

- [ ] **Step 1: Failing integration test.** Add to `wellness-medications.test.ts`: create an
      `as_needed` med, POST two `{status:"prn", prnReason:"As needed"}` logs, GET schedule for today;
      assert both POSTs return 201, the med's `asNeeded` slot exists, and `slot.prnCount === 2`.
- [ ] **Step 2: Run — expect FAIL** (`prnCount` undefined / not 2):
      `JARVIS_PGDATABASE=jarvis_build_wellness vitest run tests/integration/wellness-medications.test.ts -t "PRN"`
- [ ] **Step 3: Implement.** Add `readonly prnCount?: number` (OPTIONAL — backward-compat) to
      `ScheduleSlotDto` and `prnCount:{type:"number"}` to `scheduleSlotDtoSchema` properties (NOT in
      `required`). In `computeSchedule`, for the `as_needed` branch set `prnCount` = count of `logs`
      where `medication_id === med.id && !log.scheduled_for && log.status === "prn"`. Also extend
      `repository.listLogsForDate` to include same-day PRN logs (anchored by `logged_at`, since PRN
      rows have `scheduled_for IS NULL`) so the schedule endpoint actually sees them.
- [ ] **Step 4: Run — expect PASS** (same command).
- [ ] **Step 5: Commit** (`git add packages/shared/src/wellness-api.ts packages/wellness/src/schedule.ts tests/integration/wellness-medications.test.ts`).

### Task 2: Frontend #387 — repeatable PRN dose action + count

**Files:**

- Modify: `apps/web/src/wellness/wellness-today.tsx` (`MedToday`)

**Interfaces:**

- Consumes: `ScheduleSlotDto.prnCount` (Task 1); existing `logMedicationDose(medId, {status, prnReason, scheduledFor})`.

- [ ] **Step 1: Implement.** Extend `logMutation` to accept `status: "taken" | "skipped" | "prn"`
      and `prnReason: string | null`. For `asNeeded` slots, render a "+ Log a dose" button (not the
      taken/skipped toggle) that calls `logMutation.mutate({medicationId, status:"prn", scheduledFor:null, prnReason:"As needed"})`,
      and show `slot.prnCount` as "N taken today" (0 → "Log when you take one"). Keep the existing
      `onSuccess` invalidations (schedule/adherence/insights) so the count refreshes.
- [ ] **Step 2: Typecheck** `pnpm typecheck` — expect PASS.
- [ ] **Step 3: Build** `pnpm build:web` — expect PASS.
- [ ] **Step 4: Commit** (`git add apps/web/src/wellness/wellness-today.tsx`).

### Task 3: Frontend #385 — home glance + soft reminder

**Files:**

- Modify: `apps/web/src/today/today-page.tsx` (the `wellnessEnabled` aside `well` block)

**Interfaces:**

- Consumes: `getMedicationSchedule(todayIso)` via a `useQuery` (existing endpoint).

- [ ] **Step 1: Implement.** Add a schedule `useQuery` (key `queryKeys.wellness.schedule(today)`).
      Derive: scheduled slots only; `takenCount`/`total`. Glance line: no scheduled meds → neutral/none;
      `taken === total` → "✓ All meds taken"; else `"{taken} of {total} taken"`; none logged → "None logged yet today".
      When an outstanding scheduled dose exists, show a **dismissible** soft amber prompt (local `useState`
      dismissed flag) — not a modal/push. PRN-only (no scheduled slots) → no reminder. Respect existing
      `wellnessEnabled` gate.
- [ ] **Step 2: Typecheck** `pnpm typecheck` — expect PASS.
- [ ] **Step 3: Build** `pnpm build:web` — expect PASS.
- [ ] **Step 4: Commit** (`git add apps/web/src/today/today-page.tsx`).

### Task 4: #386 — mobile chart legibility

**Files:**

- Create: `apps/web/src/styles/wellness-3.css`
- Modify: import in `apps/web/src/wellness/wellness-trends.tsx` (and `today-page.tsx` if it renders the chart) AFTER wellness-1/-2.

- [ ] **Step 1: Implement.** In `wellness-3.css`, at `@media (max-width: 560px)`: give
      `.wl-chart__plot { overflow-x:auto; -webkit-overflow-scrolling:touch }` and
      `.wl-chart__plot svg { min-width: 600px; width:600px }` so the chart keeps a legible scale and
      scrolls horizontally; bump `.wl-axislbl { font-size: 13px }`. Keep it small (<60 lines).
- [ ] **Step 2: Import** `wellness-3.css` after the existing wellness imports in `wellness-trends.tsx`.
- [ ] **Step 3: Verify size + build** `pnpm check:file-size && pnpm build:web` — expect PASS.
- [ ] **Step 4: Commit** (`git add apps/web/src/styles/wellness-3.css apps/web/src/wellness/wellness-trends.tsx`).

### Task 5: Full local gate

- [ ] `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck` — capture `$?`.
- [ ] `JARVIS_PGDATABASE=jarvis_build_wellness pnpm test:integration` (or wellness suites + new tests) — capture `$?`.
- [ ] `pnpm build:web` — capture `$?`.
- [ ] Hand off to `coordinated-wrap-up`.

## Self-review

- **Spec coverage:** #387 → Tasks 1–2; #385 → Task 3; #386 → Task 4. ✓
- **Guardrail check:** one additive backend field (flagged for approval), no new endpoint/migration/
  notification, module isolation preserved, no dose/prnReason leak (count only). ✓
- **Type consistency:** `prnCount` defined in Task 1, consumed in Task 2; `logMutation` signature
  widened to include `"prn"`. ✓
