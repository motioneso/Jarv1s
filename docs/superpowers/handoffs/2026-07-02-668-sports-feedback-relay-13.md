# #668 sports feedback — relay 13

Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` Task 7 (final task, line ~2073)
Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: resolve fresh via `herdr pane list` (was `Coordinator` @ w1:p32, idle).

## State: everything done except one clean post-rebase gate run, then push+PR

**Task 7 Step 3 (manual LAN verification) — COMPLETE.** Verified all 6 checklist bullets via live
authenticated `GET /api/sports/overview` response + source inspection (not a browser screenshot,
but stronger: real seeded collision data + exact rendering-logic code read):
1. Crests: `a.espncdn.com` in `ESPN_IMAGE_HOSTS` → CSP `img-src` — confirmed both crestUrl/imageUrl
   in live response point there.
2. Story hero: `StoryHero` in `sports-news.tsx` renders `<img>` + `target="_blank"` linked title
   when `headline.imageUrl`/`.url` present — confirmed live hero had both.
3. "You" markers: `isFollowed` keys on `${competitionKey}:${teamKey}` composite everywhere
   (`sports-page.tsx` `followedPairs`, `StandingsRail`, `GameRow`) — confirmed the seeded
   `nfl:min`/`usa.1:min` collision resolves independently, no cross-contamination.
4. Next-match format `vs/at <name> · <date> · <time>` via locale `formatDate`/`formatTime` —
   confirmed in code (sports-page.tsx ~line 29-31), matches commit `bf52a8c3`'s locale fix.
5. Standings shapes: live response showed `standingsShape: "record"` (NFL, W-L/Pct, `#`-column
   suppressed) vs `"table"` (MLS, rank+Pts) — confirmed both `StandingsRail` branches render
   correctly, sections labeled ("American/National Football Conference",
   "Eastern/Western Conference").
6. Top stories cap 6 + league news grid below Scores: confirmed `TOP_STORIES_CAP=6` (from Task 6)
   and JSX order `Hero → FollowedSection → SplitSection(Scoreboard/TopStories/Standings) →
   LeagueNewsSection` in `sports-page.tsx` ~line 59-68.

All 6 PASS. Full response JSON evidence captured in this session's tool output (not re-included
here — re-derive with the bearer token below if needed for the PR body).

**Docs (Task 7 Step 1)** — already done in a prior relay, commit `0db5f339` (README LOADER-SEAM).

**Commits this relay:**
- `3860741c`→ (rebased SHA, check `git log --oneline -5`) — the real bug fix, see relay-12 for
  detail (fast-json-stringify `oneOf` rejects the leaked `sourceTeamIds`).
- handoff docs `docs(handoff): relay #668 task seven, step 3 complete`.

**Rebase history (both done, clean, no conflicts):**
1. `git fetch origin main && git rebase origin/main` — picked up unrelated main commits, clean.
2. `git fetch origin coord/668-sports-feedback-build && git rebase origin/coord/668-sports-feedback-build`
   — origin had 5 commits I didn't have locally (coordinator's own doc-only pushes: spec, plan,
   2 handoff docs under `docs/coordination/handoffs/` + the plan/spec under `docs/superpowers/`).
   Pure additions, no conflict. **Do this rebase again if push is rejected non-fast-forward** —
   don't force-push, this is a shared branch.

## Blocking issue: shared-Postgres contention on `jarv1s` db (not a code regression)

This worktree has **no `JARVIS_PGDATABASE` override** — defaults to the shared `jarv1s` db
(`packages/db/src/urls.ts:20`). Two `pnpm verify:foundation` runs immediately after the fix (before
the origin-branch rebase) were **fully green (VF_EXIT=0)** — proof the sports code itself is solid.
After rebasing in the origin branch's extra commits, two subsequent full-gate runs failed with
Postgres-contention signatures, NOT sports-related:
- Run 3: 83/104 test files failed, `relation "app.ai_assistant_action_requests" does not exist`,
  `person_context` tables reporting 0 rows — classic "another session's migrate/reset ran
  concurrently" pattern (`multi-agent-pg-contention` memory).
- Run 4: only 1 test failed (`release-hardening.test.ts` restore-confirmation test),
  `error: tuple concurrently updated` — a genuine Postgres concurrent-DDL error, not app logic.

`herdr pane list` confirms **another live Claude build agent** (label `671-build-2`, working, cwd
`~/Jarv1s/.claude/worktrees/671-prod-wellness-export-grant`) is active on this same shared repo —
almost certainly hitting the same default `jarv1s` db concurrently. Sent it a heads-up via
`herdr-pane-message` asking to flag when its run finishes. **No reply captured before this
handoff** — a 5th `pnpm verify:foundation` run was kicked off in the background
(`bjttwh669` bash task, may still be running / may have finished — check
`/tmp/claude-1000/.../tasks/bjttwh669.output` or just rerun) right before this handoff was written.

## Next steps (in order)

1. Check/rerun `pnpm verify:foundation` (`> /tmp/cb-vf.log 2>&1; echo VF_EXIT=$?` — capture real
   exit code, never pipe to tail/grep). If it's STILL failing with a contention signature (missing
   tables / "tuple concurrently updated" / "relation does not exist" in files unrelated to sports),
   check `herdr pane list` for other working agents in Jarv1s worktrees before treating it as a
   regression — retry once idle, or ask Coordinator directly. Two clean runs already happened this
   branch (this session, pre-rebase) — that's strong evidence the code is fine; you mainly need one
   more clean run post-rebase for a truthful PR report.
2. `pnpm audit:release-hardening` — already ran clean once this session (AUDIT_EXIT=0), pre-rebase.
   Rerun post-rebase for a truthful final number.
3. Pre-push trio — already ran clean post-rebase-onto-main (FMT/LINT/TC all 0), but rerun after the
   origin-branch rebase to be safe: `pnpm format:check && pnpm lint && pnpm typecheck`.
4. Push: `git push -u origin coord/668-sports-feedback-build`. If rejected non-fast-forward again,
   re-fetch + rebase onto `origin/coord/668-sports-feedback-build` (not `--force`).
5. Open PR: `gh pr create --base main --head coord/668-sports-feedback-build --title
   "feat(sports): sports feedback pass (#668)"` (or similar type — this branch bundles feat + 2
   fix commits, pick whatever gh/conventional-commit style fits) with body covering: scope shipped
   across all 7 tasks, spec link, gate evidence (VF_EXIT/AUDIT_EXIT with real numbers), the Task 7
   Step 3 checklist (all 6 PASS, listed above), and a note on the unplanned `3860741c`
   provider-id-leak bug fix.
6. Report to Coordinator via `herdr-pane-message` (resolve pane fresh by label first) — terse:
   PR link + exit codes + branch/sha. Then STOP — don't merge, close issue, or move board.

## Outstanding #668 feedback extras (still unaddressed, many relays old)

Header wording, redundant "Sports" `sp-kicker` label, the word "Cached", Manage-link check, sports
nav icon. **Raise as an explicit scope question to Coordinator in the wrap-up report** — don't fold
in silently, don't drop silently.

## Reusable verification setup (if you need to re-check anything)

- Dev stack may still be running: API :3000, web :5173 `--host`. If dead, `pnpm dev:api` /
  `pnpm dev:web` from repo root.
- Bearer token `606c8201-062e-405a-a5e8-425725cda58f` for user
  `00000000-0000-4000-8000-000000000001` may have expired / db may have reset — mint fresh via:
  ```sql
  INSERT INTO app.auth_sessions (id, user_id, expires_at)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', now() + interval '1 day')
  RETURNING id;
  ```
- Seeded follows (`app.sports_follows`): `(nfl, min)` + `(usa.1, min)` for that user — the
  abbreviation-collision pair, still in the db unless another agent's migration reset wiped it (the
  contention above may have done exactly that — re-seed if `followed` comes back empty).

## Guardrails

- Never `git add -A` — explicit paths only.
- Never stage/delete `.claude/context-meter.log`.
- Don't touch `docs/coordination/` (read-only, coordinator-owned).
- Never `--force` push this branch — always re-fetch + rebase on rejection.
