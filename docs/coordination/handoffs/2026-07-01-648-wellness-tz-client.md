# Handoff — #648 Wellness Timezone Client Slice

**Run:** 2026-06-30-rfa-fleet continuation
**Issue:** #648 — wellness UTC day-boundary bugs
**Branch:** `coord/648-wellness-tz-client`
**Worktree:** `~/Jarv1s/.claude/worktrees/648-wellness-tz-client`
**Coordinator:** `Coordinator`
**Risk tier:** `routine` for this slice

## Scope

Fix only the client-side wellness day-bucketing bugs called out in #648:

- `apps/web/src/wellness/wellness-page.tsx`
- `apps/web/src/wellness/wellness-trends.tsx`

Replace unsafe `(checkedInAt ?? createdAt ?? "").slice(0, 10)` day derivation with the existing
shared `localDay(..., localTimezone/timeZone)` pattern already used in `wellness-today.tsx`.

## Out Of Scope

- Do not implement server-side `X-Timezone` plumbing in this lane.
- Do not change `AccessContext`.
- Do not touch migrations, RLS, connector/email code, or unrelated timezone surfaces.
- Do not edit `docs/coordination/`; coordinator-only.
- Do not run repo-wide format or broad `git add .` / `git add -A`.

## Required Checks

- Add or update one focused regression check proving a non-UTC instant buckets by user timezone.
- Run the narrow wellness/unit check you add or update.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`.
- If cheap enough, run `pnpm verify:foundation`; otherwise report the exact narrower green gates.

## Wrap-Up

Open a PR against `main`, link #648, and report:

- PR URL
- commit SHA
- exact commands and exit codes
- files changed
