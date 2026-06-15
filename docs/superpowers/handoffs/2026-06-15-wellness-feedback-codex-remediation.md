# Build-agent handoff — Wellness feedback pass: Codex remediation (4 blockers)

**You are a BUILD AGENT** under the Wellness dev coordinator (label `Wellness-Coordinator`, session
`ea8e89af`). Invoke **`coordinated-build`**. Fix the 4 HIGH Codex findings below + a nit, on the
existing branch. **Do NOT push/PR/merge or touch `docs/coordination/`.** Stage only changed paths.

## Worktree / branch
- CWD: `/home/ben/Jarv1s/.claude/worktrees/wellness-feedback`, branch `wellness-feedback-pass`, HEAD
  `0c4218d`. `node_modules` present — do NOT `pnpm install`.
- Context: the 8-item feedback pass is built + locally gate-green, but Codex review = DO-NOT-MERGE on
  these regressions. Fix them, re-gate, report. (No CI — local `pnpm verify:foundation` is the gate.)

## Findings to fix (all HIGH unless noted)

**R1 — Today inline wellness actions bypass the SPA module gate.** `/wellness` is module-gated
(`apps/web/src/app.tsx:195`, `ModuleGatedRoute`), but Today now exposes check-in creation + medication
schedule/logging from the always-rendered Today route (`apps/web/src/today/today-page.tsx:60` and
`:291`). Disabled-Wellness users get health controls + broken modal flows instead of the gated
behavior. FIX: gate the Today "Meds" / "Check in" widgets + their modals on the **wellness module
being enabled** (reuse the same module-enabled check `ModuleGatedRoute`/app.tsx uses). When wellness
is disabled, don't render those widgets (or render them disabled), matching the rest of the app.

**R2 — Today inline modals don't load the Wellness CSS.** `today-page.tsx:35` imports only Today
styles; `wl-modal`, `wl-card`, `wl-medrow`, and the radial styles are imported only by
`wellness-page.tsx:1`. A direct `/today` load renders the new modal markup unstyled. FIX: ensure the
wellness modal/card/radial styles are loaded wherever the Today inline modals render (import the
relevant wellness CSS into the Today modal components, or hoist the shared modal/card/radial styles
into a stylesheet imported by both). Verify a cold `/today` load is styled.

**R3 — radial pref is stale for the mounted modal.** `useWellnessPrefs()` (`wellness-prefs.ts:29`) is
isolated component state with no same-window subscription. Toggling "Feeling wheel" writes
localStorage but the mounted `CheckinModal` keeps its old `prefs.radial` until remount/reload, so D3
doesn't work from the visible toggle. FIX: make `useWellnessPrefs` reactive — subscribe to the
`storage` event AND a same-window custom event (dispatch on write), or use a shared store/context, so
all consumers (`wellness-page.tsx:72`, `checkin-modal.tsx:91`) update live without remount.

**R4 — `times_per_day` can submit invalid payloads.** In `manage-meds-modal.tsx`: selecting
`times_per_day` (`:71`) resets `scheduleTimes` to two entries but NOT `timesPerDay`; if a user raised
it to 4, switches away, then back, `:90` sends `timesPerDay: 4` with only 2 times → route rejects
(`packages/wellness/src/routes.ts:545`). Also the editable time inputs can be cleared → `scheduleTimes:
[""]` (route only checks non-empty array/string, not clock format). FIX: keep `timesPerDay` and
`scheduleTimes.length` in sync on every frequency/N change; validate each time is a real `HH:MM`
(disable Add / block submit on empty/invalid); never send mismatched counts. Add tests covering
switch-back and cleared-time cases.

**Nit — trailing whitespace** in `docs/superpowers/handoffs/2026-06-15-wellness-feedback-relay.md`
(`git diff --check` flags it). Strip it.

## Process
1. Read this + the spec (`docs/superpowers/specs/2026-06-15-wellness-feedback-pass.md`). Invoke
   `coordinated-build`; post a brief plan to `Wellness-Coordinator` (resolve fresh by label; two-call
   `send-text` then `send-keys Enter`); on approval, build. (Decisions are locked above — confirm, not
   re-plan.)
2. Fix all 5. Add/extend tests for R3 (reactive pref) and R4 (payload validity).
3. `pnpm verify:foundation` — REAL exit code (no `| tail`). Commit green, stage only changed paths,
   trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
4. Report SHA + REAL exit + per-finding status to `Wellness-Coordinator`. Coordinator re-runs Codex +
   merges.

## Critical
- **RELAY (don't `/compact`) before ~80k tokens** — two agents died at the context limit this run by
  not relaying in time. Commit per-finding so progress survives.
- Don't regress the partial-update PATCH semantics. No applied-migration edits. 1000-line file limit.
- Don't break the 8 already-working items while fixing these.
