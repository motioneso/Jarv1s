# Plan — Wellness Codex remediation (4 blockers + nit)

**Branch:** `wellness-feedback-pass`
**Handoff:** `docs/superpowers/handoffs/2026-06-15-wellness-feedback-codex-remediation.md`
**Gate:** `pnpm verify:foundation` real exit 0

---

## Tasks (commit per finding)

### Nit — trailing whitespace

- Strip trailing whitespace from `docs/superpowers/handoffs/2026-06-15-wellness-feedback-relay.md`
- Commit: `chore: strip trailing whitespace from relay handoff`

### R2 — CSS missing on cold /today load

- Add `import "../styles/wellness-1.css"` and `import "../styles/wellness-2.css"` to `apps/web/src/today/today-page.tsx` (before existing style imports)
- Commit: `fix(today): import wellness CSS so modal styles load on cold /today`

### R1 — wellness widgets bypass module gate

- Pass `wellnessEnabled: boolean` prop to `TodayPage` in `apps/web/src/app.tsx` (derive from `wellnessGate === "enabled"`)
- In `apps/web/src/today/today-page.tsx`: accept the prop, gate the wellness `<aside>` widget and all 3 modals/states on `wellnessEnabled`; when false, don't render those controls
- Commit: `fix(today): gate wellness widgets behind module-enabled check (R1)`

### R3 — stale radial pref in mounted modal

- In `apps/web/src/wellness/wellness-prefs.ts`: on `writePrefs`, dispatch `new CustomEvent("jarvis:wellness-prefs")` on `window`
- In `useWellnessPrefs`: subscribe to both `"storage"` (cross-tab) and `"jarvis:wellness-prefs"` (same-window) events, calling `setPrefs(readPrefs())` on each
- Add Vitest unit test: toggle write then read in another hook instance → sees new value live (no remount)
- Commit: `fix(wellness): reactive wellness prefs via storage + custom-event (R3)`

### R4 — `times_per_day` mismatched payload + invalid times

- In `apps/web/src/wellness/manage-meds-modal.tsx`:
  - `handleFreqChange`: when switching to `times_per_day`, also reset `setTimesPerDay(2)`
  - Add `isValidTime(t: string)` helper: `/^\d{2}:\d{2}$/.test(t) && t >= "00:00" && t <= "23:59"`
  - Compute `timesInvalid = scheduleTimes.some(t => !isValidTime(t))` (only when `freqType !== "as_needed"`)
  - Disable Add button also when `timesInvalid`; show inline hint under invalid inputs
  - Add integration tests (`manage-meds-modal` Vitest): switch-back scenario, cleared-time blocks submit
- Commit: `fix(wellness): sync timesPerDay with scheduleTimes, validate HH:MM (R4)`

---

## Gate

`pnpm verify:foundation` (real exit) — run after all commits; report exit code + SHA.
