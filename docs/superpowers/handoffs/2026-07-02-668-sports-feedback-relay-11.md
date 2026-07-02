# #668 sports feedback — relay 11

Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` (Task 7 = final task, starts line 2073)
Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator` — **resolve fresh via `herdr pane list` before messaging, do not trust a baked pane number.**

You are sole writer on this branch/worktree. 20 commits ahead of `origin/coord/668-sports-feedback-build` (never pushed this run).

## Done this relay (commits)

- `0db5f339` — Task 7 Step 1: added seam-7 (CSP image hosts) + team-tag data-flow paragraph to `packages/sports/README.md`. Exact plan-mandated text, already committed, nothing left to do here.
- `8296e672` — **out-of-plan gate fix**, not a plan step: `check:no-ambient-dates` failed on first full-gate run, catching leftover bugs from Tasks 5/6 (bare `Intl.DateTimeFormat` in `apps/web/src/sports/sports-page.tsx` and `sports-news.tsx`). Fixed by routing both through `apps/web/src/locale/locale-format.ts` (`formatDate`/`formatTime`/`useUserLocale`), matching the existing codebase pattern (see `task-list-view.tsx` precedent). Flag this to the coordinator as an unplanned fix folded into Task 7 — it was mechanical (display-layer date formatting only), not a design fork, but it touched Task 5/6 files.

## Full gate: GREEN (exit 0)

Ran `pnpm verify:foundation` twice — first run failed at `check:no-ambient-dates` (the bug above), second run after the fix passed clean end to end:
- lint / format:check / check:file-size / check:design-tokens / check:no-ambient-dates: clean
- typecheck: clean (root + `@jarv1s/web`)
- test:unit: 224 files / 1497 passed / 2 skipped
- db:migrate: no-op, 124 migrations already current
- test:integration: 104 files / 1268 passed / 2 skipped (478.68s)

Do not need to re-run the full gate unless you touch more code — only re-run the pre-push trio before pushing (see Task 5 below).

## What's left — Task 7 Step 3: manual LAN verification (spec §8)

**Not started.** Investigative groundwork only, done this relay:
- Dev Postgres (`jarv1s` @ localhost:55433) has exactly 3 fixture users: `user-a@example.test`, `user-b@example.test`, `admin@example.test` (ids `...001`/`...002`/`...003`). **Zero rows in `app.sports_follows`** — no seeded follow data exists.
- Outbound network to the live ESPN API works from this sandbox.
- No dev auto-login/bypass-auth mechanism found in this repo.
- Project precedent (`gh pr view 666`): "manual acceptance" here has historically meant every checklist item backed by a green test + a lightweight runtime smoke ("Vite dev boots; page/CSS assets transform HTTP 200, zero console errors") — not necessarily a full authenticated live-browser session.
- `apps/web/package.json` already has `"dev": "vite --host 0.0.0.0"` and `"preview": "vite preview --host 0.0.0.0"` — the "--host" requirement is already satisfied, no change needed there.
- `tests/e2e/` uses a mocked-REST pattern (`mock-api.ts`), no sports-specific e2e mock exists yet.

**Next concrete steps for you:**
1. Start `pnpm dev:api` and `pnpm dev:web` (or reuse the HTTP-200 smoke pattern from precedent if a real authenticated session proves impractical headless).
2. If pursuing real data: seed at least one `app.sports_follows` row for `user-a@example.test` covering one NFL team and one soccer team (pick one with a known abbreviation collision, e.g. a team whose short code collides across leagues) to exercise the "You" marker logic properly. Check for an existing seed script before hand-writing SQL.
3. Walk the plan's Task 7 Step 3 checklist (7 bullets, plan lines ~2073+) and record pass/fail per bullet:
   - crests render, no CSP violations (crest `<img>` from `a.espncdn.com` must paint under both API-served CSP and `infra/nginx/jarv1s-web.conf` — spec §8 calls this out explicitly)
   - story hero photo + linked title opens in new tab; same for rail/grid stories
   - "You" markers correct, including the abbreviation-collision case
   - next-match format renders "vs/at \<name\> · \<date\> · \<time\>" in the user's locale
   - standings shapes correct per competition type (points table / labeled groups / conference W-L-Pct with **no `#` column** on record leagues)
   - top stories capped at 6
   - league news grid groups by competition, rendered below Scores
4. Record results in the eventual PR description.

## What's left — Task 5: confirm-then-wrap-up (not started)

Per the original instruction (still standing): **confirm with the Coordinator before pushing** — this branch has never been pushed this run and is now 20 commits ahead of `origin/coord/668-sports-feedback-build`. Do not push unilaterally.

Once confirmed: invoke `coordinated-wrap-up` —
1. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`
2. `git fetch origin main && git rebase origin/main`
3. Push, open PR, report the PR URL + verification evidence (full-gate results above + Task 7 Step 3 checklist results) to the Coordinator.

## Scope question to raise with the Coordinator (do NOT silently fold in or silently skip)

These #668 feedback extras have been carried across multiple relays, confirmed still unaddressed by any commit in this branch's history. Task 7 does not gate on them — raise as an explicit scope question, let the Coordinator decide in/out for this PR vs. a follow-up issue:
- Header wording in `PageHeader` (`sports-page.tsx`)
- Redundant "Sports" label — `sp-kicker` renders `<LiveDot /> Sports` (redundant with page context)
- The word "Cached" in `sp-preview__lbl` (shows `{degraded ? "Cached" : "Live"}`) — wording feedback
- The `Manage` link in `FollowedSection` (`<a className="sp-managebtn" href={SETTINGS_HREF}>`, `SETTINGS_HREF = "/settings/modules/sports"`) — functionality unverified
- Sports nav icon — feedback outstanding, no current code location captured

## Working tree state

Clean except untracked `.claude/context-meter.log` — **do not stage this file, ever** (context-meter tooling, not part of this feature).

## Guardrails carried forward

- Never `git add -A` — stage explicit paths only.
- Sole writer on this branch/worktree (prior `Build-668-sports-feedback-12` confirmed reaped via `pane_not_found`).
- `coordinated-build` skill governs: escalate blockers/forks to Coordinator, never merge/close/board yourself, relay again at ~80-100k tokens or immediately on seeing a compaction summary.
