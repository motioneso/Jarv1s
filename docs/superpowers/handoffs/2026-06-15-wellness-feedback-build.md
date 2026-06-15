# Build-agent handoff — Wellness feedback pass

**You are a BUILD AGENT** under the Wellness dev coordinator (label **`Wellness-Coordinator`**,
session `ea8e89af`). Invoke **`coordinated-build`**. Implement the 8 Wellness feedback items from
Ben's agentation testing. **Do NOT push/PR/merge or touch `docs/coordination/`.** Stage only changed
paths (no broad `pnpm format` + `git add -A`).

## Worktree / branch

- CWD: `/home/ben/Jarv1s/.claude/worktrees/wellness-feedback`, branch `wellness-feedback-pass` off
  `origin/main` `a061766`. **Run `pnpm install` once** (fresh worktree — `[ -d node_modules ] || pnpm install`).

## What to build

**Read the spec IN FULL:** `docs/superpowers/specs/2026-06-15-wellness-feedback-pass.md`. It has all 8
items + the approach + invariants. Summary:

- **B1 (#3)** PRN "As needed" add is broken → make it add a valid `as_needed` med (+test).
- **B2 (#4)** today's check-in missing from history → frontend query/range/invalidation bug (+test).
- **Q1 (#1)** insights low-data empty state (no missed-med insight on near-zero data).
- **Q2 (#5)** Today "Meds" widget → inline log modal (no nav to /wellness).
- **Q3 (#6)** Today "Check in" widget → inline check-in modal.
- **F2 (#2)** med frequency model: separate frequency (once/times_per_day/PRN) from time-of-day.
- **F3 (#7)** multiple check-ins/day — UI only (backend already supports it; NO migration). Fixes B2 too.
- **D3 (#8)** radial feeling-wheel picker in CheckinModal, gated by the "radial" tweak. Design ref:
  `WellnessCheckin.jsx` in the design bundle (path in the spec).

## Process (no CI — local gate is the gate)

1. `pnpm install` if needed. Read spec. Invoke `coordinated-build`: post a brief plan (per-item: files
   - approach; flag any genuine fork — esp. F3 "today" card behavior and D3 radial source) to the
     coordinator (`Wellness-Coordinator`, resolve fresh by label via `herdr pane list`; two-call send:
     `send-text` then `send-keys Enter`). Wait for approval.
2. Build, ideally committing **per item** (green per commit) so progress survives a relay. Add tests
   for B1, B2, F2, F3.
3. **`pnpm verify:foundation` — REAL exit code** (no `| tail` mask). DB is up (`jarv1s` on :55433).
   ⚠️ Tests reseed `jarv1s` — that's fine for tests, but Ben's live dev app runs on a SEPARATE DB
   `jarv1s_dev`, so your test runs won't disturb his session.
4. Report SHA + REAL exit + per-item status to the coordinator. Coordinator runs Codex review + merges.

## Critical

- **Self-monitor context. RELAY (do NOT `/compact`) at ~80k tokens** — write a continuation handoff,
  `herdr-handoff` a successor in THIS worktree, tell the coordinator "relayed, safe to reap." (An
  agent died at its context limit last run by taking new work while already low — don't repeat it.)
- No edits to applied migrations; no new migration expected (if F3 surprises you with a uniqueness
  constraint, STOP + escalate `[DESIGN-FORK]`, don't edit `0082`).
- Don't regress the partial-update PATCH semantics (fetch-first, omitted=preserve).
- 1000-line file limit; decompose. Owner-only RLS; no secrets in responses/logs.
