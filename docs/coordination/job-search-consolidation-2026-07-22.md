# Job-Search Work Consolidation — 2026-07-22

**Single source of truth for every scattered job-search pile.** Written so nothing is
lost and every branch/backup is discoverable from one place. Read this before touching
any job-search branch.

## Decision: consolidated base = `build/job-search-broad-discovery`

- Tip `f6338bf6`, **0 behind / 16 ahead of `origin/main`** (`86b6bc2d`). It already contains
  all of main plus the 16 verified broad-discovery commits.
- Clean working tree.
- **Verified green (2026-07-22):** `check:external-modules` tsc exit 0; job-search unit
  suite **636/636 across 41 files** (`vitest run tests/unit/external-module-job-search
  tests/unit/job-search`).
- Deferred (needs PG / a quiet box): full `pnpm verify:foundation` — includes `db:migrate`
  / `test:uat-seed` / `test:integration`, which hit the shared dev Postgres the live dev
  instance + worker depend on. Run when the box is idle or against an isolated gate DB.

This branch **is** the good starting point. Broad discovery (freehire.dev, keyless, Path B′)
is the authoritative feature and the spine everything else layers against.

## The load-bearing fork — a human must pick before further merging

There are **two structurally incompatible directions for the web layer.** They cannot both
live on one branch:

- **Track A — extend the `onboarding/` subdirectory.** What `origin/main` ships and what the
  authoritative broad-discovery build (this branch) extends: `web/screens/onboarding/{controls,
  index,model,profile-buffer}` + `web/screens/{matches,monitors,overview,profile}.tsx`.
- **Track B — flatten & restructure screens.** The uncommitted `fix/1203` work **deletes** the
  `onboarding/` subdir and `matches.tsx`/`kit.tsx`, adding flat `web/screens/{onboarding,
  opportunities,opportunity-detail}.tsx` + `web/starter-drafts.ts`.

`onboarding/{controls,index}.tsx` are **edited by Track A and deleted by Track B** — a direct
edit-vs-delete collision. The consolidated base is **Track A** (verified, approved, shipped-ready).
Whether Track B's richer Opportunities/Detail surface becomes phase 1's UI is a scope decision
for Ben — see `job-search-phase1-plan-2026-07-22.md`.

## Every pile — location, state, disposition

| # | Branch / worktree | State | Disposition |
|---|---|---|---|
| 1 | `build/job-search-broad-discovery` (…discovery-build) | committed clean, `f6338bf6`, 0/16 vs main | **CONSOLIDATED BASE.** |
| 2 | `fix/1203-job-opportunities-read` (fix-1203…) | **uncommitted** ~9.4k-line restructure (Track B) | **Preserved** (branch + backup). Track B — candidate phase-1 UI, not the base. Do not sweep in. |
| 3 | `fix/dev-chat-pdf-regressions` (job-search-recovery) | **uncommitted** dev-HITL onboarding edits; **live worker runs here — do not disturb** | **Preserved** (branch + backup). Job-search bits (`onboarding/{controls,index}`, `styles.ts`, `resume.ts`) are candidate phase-1 folds; chat/PDF churn out of scope. |
| 4 | `feat/1197-job-search-screens` (lane-d-1197) | committed, residual drift | Foundation already in main. Residual = superseded. No action. |
| 5 | `feat/1198-onboarding-ui` (lane-e-1198) | committed, residual drift | Foundation already in main (onboarding subdir present in `origin/main`). Residual = superseded. No action. |
| 6 | `spec/913-intelligent-job-search` (/tmp/jarv1s-913-spec) | docs-only, 200 behind main | Superseded spec scope. Optional archive; no code. |
| 7 | `spec/job-search-broad-discovery` (…discovery-spec) | docs-only | **Redundant** — all 6 commits are already in #1. Drop. |

Verified: `origin/main` contains the full `onboarding/` subdir → lanes D/E (#1197/#1198)
foundation landed; their branch residuals are drift, correctly left alone.

## Backups (non-destructive, nothing was git-mutated to make them)

`~/job-search-work-backup-20260722/` — one dir per pile, each with `CONTEXT.txt`
(branch+HEAD), `tracked-changes.patch` (`git diff HEAD`), `untracked-files.tar`:

- `fix-1203-opportunities` — 9418-line patch (Track B restructure)
- `job-search-recovery` — 3423-line patch + 66 untracked (dev-HITL onboarding/resume)
- `main-spec964` — 1381-line patch + untracked docs
- `lane-e-1198` — 26-line residual
- `broad-spec` — 14-line residual

Nothing is lost. The two uncommitted piles (#2, #3) survive as their branch working trees
**and** as replayable patches. Their worktrees were read-only throughout.

## What NOT to do

- Do not `git add -A` on the shared tree, or checkout/stash/reset any worktree another
  session is live on (the `job-search-recovery` worker is running).
- Do not blind-merge #2 into the base — it deletes the base's onboarding foundation.
- Do not re-merge #4/#5 residuals — their content is already in main.
