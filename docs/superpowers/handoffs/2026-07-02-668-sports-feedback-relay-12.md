# #668 sports feedback — relay 12

Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` (Task 7 = final task, line 2073)
Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator` — resolve fresh via `herdr pane list`, never trust a baked number.

Sole writer on this branch. 21 commits ahead of `origin/coord/668-sports-feedback-build` (never pushed this run).

## Done this relay

Commit `3860741c` — **real bug found and fixed** during Task 7 Step 3 manual LAN verification:
`GET /api/sports/overview` 500'd live (`hero` `oneOf` schema rejected leaked `sourceTeamIds` on
`hero.headline`). Root cause + fix detail in the commit message and `memory_recall` for
`"sports overview 500 oneOf"`. Verified fix live (curl → 200) + `tests/unit/sports-service.test.ts`,
`sports-routes.test.ts`, `sports-page.test.tsx` green (28/28) + `packages/sports` `tsc --noEmit` exit 0.

**Not yet re-run: full `pnpm verify:foundation`** — must run before anything else next session
(this fix touched sports-service.ts after the Task 7 gate run from relay 11 / `af5b619a`).

## Dev stack state (still running, background bash tasks in this session — may be dead in a new session, restart if so)

- `pnpm dev:api` on :3000, `pnpm dev:web` on :5173 (`--host 0.0.0.0`), both booted clean.
- Postgres seed: `app.sports_follows` rows for user `00000000-0000-4000-8000-000000000001`
  (`user-a@example.test`): `(nfl, min)` + `(usa.1, min)` — the abbreviation-collision pair
  (Minnesota Vikings NFL vs Minnesota United MLS, both ESPN abbreviation `MIN`).
- Auth: legacy bearer-session works — `Authorization: Bearer <uuid>` checked against
  `app.auth_sessions` before better-auth cookie (`packages/auth/src/headers.ts:26-43`). Mint via:
  ```sql
  INSERT INTO app.auth_sessions (id, user_id, expires_at)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', now() + interval '1 day')
  RETURNING id;
  ```
  A working token was minted this relay (`606c8201-...`) — may have expired/DB may have restarted;
  mint fresh if `curl -H "Authorization: Bearer <id>" localhost:3000/api/sports/overview` doesn't 200.

## Next: finish Task 7 Step 3 (manual LAN verification) — NOT DONE YET

Only got as far as confirming the endpoint no longer 500s. Still need to actually walk the
checklist (plan line ~2073, spec §8) with real response data / a browser (Playwright available,
`pnpm exec playwright ...`, or curl + read JSON for non-visual bullets):

1. Crests render, no CSP violations (crest `<img>` from `a.espncdn.com`).
2. Story hero photo + linked title opens in new tab; same for rail/grid stories.
3. "You" markers correct **including the abbreviation-collision case already seeded** (`min` in
   `nfl` vs `min` in `usa.1` — confirm only the followed league's rows highlight).
4. Next-match format: `vs/at <full name> · <local date> · <local time>`.
5. Standings shapes per competition (points table / labeled groups / W-L-Pct no `#` column).
6. Top stories capped at 6; league news grid groups by competition, below Scores.

Record pass/fail per bullet — goes in the PR description.

## Then: coordinated-wrap-up (push authorized — user explicitly instructed push + PR this run)

1. Re-run full `pnpm verify:foundation` (gate re-run needed post-fix) — record exit code.
2. Pre-push trio + rebase: `pnpm format:check && pnpm lint && pnpm typecheck`,
   `git fetch origin main && git rebase origin/main`.
3. Push `coord/668-sports-feedback-build`, open PR for #668 (title convention: see PR #666 —
   `fix(sports): ... (#668)` or similar; body needs spec link + gate evidence + Step 3 checklist
   pass/fail + note about the `3860741c` unplanned bug fix).
4. Report PR URL + evidence to Coordinator via `herdr-pane-message`, then stop — don't merge/close
   board yourself.

## Outstanding #668 feedback extras (still unaddressed, carried across many relays)

Header wording, redundant "Sports" `sp-kicker` label, the word "Cached", Manage-link
verification, sports nav icon — **raise as an explicit scope question to Coordinator before
wrap-up**, do not silently fold in or drop. Full detail in relay-11 (`af5b619a`, superseded by
this file) if needed, but don't re-read it — this file is authoritative.

## Guardrails

- Never `git add -A` — stage explicit paths only.
- `.claude/context-meter.log` stays untracked, never staged.
- Escalate forks/blockers to `Coordinator` via `herdr-pane-message`.
- Relay again at ~80–100k tokens or on a compaction summary.
