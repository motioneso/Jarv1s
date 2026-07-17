# UAT Handoff — PR #1117 exact-head live UAT (6ca14fca)

Written at the context-threshold tripwire, per explicit instruction ("do not start
another iteration in this session"). State is **nonterminal — no run has been
executed yet**. A fresh session should resume from here.

## Exact head under test

`6ca14fcad8bec023c98e699000a2384657232843` ("fix(settings): memoize Activity since
to stabilize query key"). Working tree confirmed clean at this tripwire:
`git status --short` shows only `?? artifacts/` (this workspace, untracked/
gitignored). No feature-code edits made. Verify with `git status` / `git rev-parse
HEAD` before resuming — both confirmed matching moments before writing this doc.

This commit directly targets the prior session's root-caused CP5 RED at
`4d2d17ba418b9140a7ea307398fe9e447bd06446`: `sinceForRange()` recomputed an
unmemoized `Date.now()`-based `since` on every render for non-"today" ranges,
minting a new TanStack query key on every render (including the abort-triggered
re-render), so "Activity unavailable." could never be observed
(self-sustaining abort->remount->refetch loop). This head wraps `since` in
`useMemo(() => sinceForRange(range), [range])`
(`apps/web/src/settings/settings-activity-pane.tsx`) plus a regression test
proving the query key is stable across re-renders as `Date.now()` advances. Full
diff reviewed and confirmed on-topic this session (see "Diff reviewed" below).

## Mission (verbatim constraints, unchanged)

- Build a fresh local live dev instance (UAT harness, `bare` seed) and exercise the
  real UI end-to-end: owner signup -> onboarding -> Settings/module paths, covering
  all CP1-CP8 (signup, onboarding Settings destination, Settings nav, Activity fast
  load, 3s-abort truthful error, retry recovery, narrow Today masthead, desktop
  Today sanity).
- Sanitized data only. Artifacts under
  `artifacts/webwright/pr-1117-6ca14fca-final/`.
- Do NOT edit feature code / docs/coordination / other worktrees / parked lanes.
- Do NOT rerun CI or any broad gate (`pnpm verify:foundation` etc. — this is UAT
  only).
- GREEN -> push evidence branch `uat/1117-final-6ca14fca` (artifacts only, `git add
  -f` since `artifacts/` is gitignored) + PR #1117 comment with exact SHA and
  durable blob-URL links.
- RED -> compact blocker comment on PR #1117 naming the exact SHA and failing
  CP(s); do not fix feature code.
- Either way: report ONLY a compact GREEN/RED verdict + PR-comment URL + evidence
  branch/commit to UX Coordinator session `019f6dc5-45d7-7f23-b404-d4fef1bf587f`
  via herdr-pane-message.

## Status: NONTERMINAL — no run attempted yet, held for a docker-subnet collision

**Nothing has been executed.** This session got as far as workspace setup and then
hit an external coordination hold before the first provisioning attempt. No
`final_runs/run_*` execution exists.

### What happened this session

1. Verified current worktree HEAD == exact target `6ca14fca...` (clean, matches).
2. Read prior worktree's read-only reference
   (`~/Jarv1s/.claude/worktrees/uat-1117-final-4d2d17ba/artifacts/webwright/pr-1117-4d2d17ba-final/`)
   — `plan.md` and `UAT_HANDOFF.md` (v3, RED at CP5, root cause detailed above).
   Did not edit that worktree.
3. Copied the prior session's most-advanced harness (`run_2/final_script.py` +
   `run_2/run_uat.ts` — the version with the service-worker-block fix and the
   reload+storage-clear CP5 trigger strategy, the 4th and best attempt from that
   session) into this workspace as
   `artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/`. Updated only the
   cosmetic default-scriptPath fallback string inside `run_uat.ts` to point at this
   workspace's path (line 4) — no logic changes.
4. Wrote this workspace's own `plan.md` (8 CPs, same substance as prior, updated to
   reference this exact head and the memoization fix).
5. **Diff reviewed** (`git show 6ca14fca`): confirms the fix is exactly on-topic for
   CP5 — `useMemo` added around `sinceForRange(range)` in
   `apps/web/src/settings/settings-activity-pane.tsx`, keyed on `range`, plus a
   `tests/unit/settings-activity-pane.test.tsx` regression test that mocks
   `Date.now()` advancing 50s between renders and asserts the `useQuery` `queryKey`
   stays identical. This is a real, targeted fix for the root cause the prior
   session found live in the browser, not a guess.
6. Confirmed non-docker facts still hold at this head (all via `grep`, no edits):
   - `.cmd-masthead__row` still present (`apps/web/src/today/today-page.tsx:266`,
     `apps/web/src/styles/kit-today.css:438,504`) — CP7 selector unchanged.
   - `/api/ai/action-audit` route path unchanged
     (`apps/web/src/api/client.ts:1115-1129`, `listActionAuditLog`) — CP5 route
     intercept target unchanged.
   - Playwright Firefox browsers already installed locally
     (`~/.cache/ms-playwright/firefox-1509`, `-1522`) — no `playwright install`
     needed.
7. **Mid-setup, received an external coordination message**: label
   `Coord-1109-1110-g3` (session in worktree `coord-2026-06-30-rfa-fleet`) asked to
   hold all `pnpm test:uat` / docker provisioning for ~10 min because the `#1110`
   app-map build lane was about to run `pnpm test:uat -- app-map-grounding` on the
   **same default `10.254.0.0/24` UAT subnet** (`tests/uat/provisioner.ts:31`,
   `UAT_DOCKER_SUBNET` env-overridable, no overlap guard per `#1108`). Acknowledged
   the hold via `herdr-pane-message` (pane `w1:pS5`, label `Coord-1109-1110-g3`).
   Coordinator replied confirming a two-way agreement: "I ping 'clear' the moment
   the build's UAT finishes" — **not** a fixed 10-minute wait; this session is
   waiting on that explicit clear signal (or its own 10-minute fallback timer,
   whichever comes first, as a backstop in case the ping is missed).
8. Verified docker state stays clean during the hold (read-only checks only, no
   commands that touch docker state): no `uat-*` app containers running; only the
   pre-existing, unrelated `jarv1s-ux986-uat-postgres` (confirmed pre-existing/
   unrelated in the prior session's handoff too) and normal host containers.
   `docker network ls` / `inspect` shows no `10.254.0.0/24` or `10.255.0.0/24`
   network currently allocated — the subnet is free right now, but the collision
   risk is about *timing* (both harnesses reserving+releasing during their run
   windows), not current allocation, so the hold is still warranted.
9. Started a background fallback timer (`sleep 600`) as a backstop in case the
   coordinator's "clear" ping doesn't arrive; it had not fired as of this tripwire.
10. Hit the **context threshold** before receiving the coordinator's "clear" ping
    or starting the first provisioning attempt. Per explicit instruction, stopping
    here rather than starting an iteration (a live provisioning run) that could be
    orphaned mid-run by a context cutover.

## Live processes / ports

**None from this task.** Confirmed via `docker ps` (only pre-existing, unrelated
containers — see above) at the moment this doc was written. The background
`sleep 600` shell job showed no output/exit yet (`jobs -l` empty in a fresh Bash
invocation, which does not carry job state across tool calls in this harness —
treat it as informational only, not a live handle a resumed session can reattach
to). A fresh session should re-check `docker ps` and can safely re-provision
immediately; nothing needs to be torn down.

## Artifact paths (current tree state)

- `artifacts/webwright/pr-1117-6ca14fca-final/plan.md` — 8 CPs written, all
  unchecked (no run yet).
- `artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/final_script.py` —
  full 8-CP script, copied verbatim from the prior session's best attempt
  (service-worker-block context option + reload/storage-clear CP5 trigger). Not
  yet executed against this head. No script edits needed or made — the fix being
  tested is in product code, not harness code.
- `artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/run_uat.ts` — copied
  verbatim except the cosmetic default-scriptPath fallback string (line 4) updated
  to this workspace's path.
- `artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/screenshots/` —
  empty directory, created but unpopulated (no run yet).
- No `final_script_log.txt` yet.

## Blockers

1. **Primary (external, temporary):** holding for `Coord-1109-1110-g3`'s "clear"
   ping (docker-subnet collision avoidance with the `#1110` build lane's
   `pnpm test:uat -- app-map-grounding` run on the same default `10.254.0.0/24`
   subnet). Not a product/harness defect — purely a scheduling hold. Re-check
   `herdr pane read w1:pS5 --source recent --lines 15` (label
   `Coord-1109-1110-g3` — re-resolve the `pane_id` fresh via `herdr pane list`
   first, since pane IDs are ephemeral) for a "clear" message before provisioning.
   If no clear message and it's been well over 10 minutes, it is reasonable to
   proceed with provisioning anyway (the original ask was "~10 min"), but do a
   fresh `docker network ls` check for an active `10.254.0.0/24` allocation
   immediately beforehand and abort/back off if one exists.
2. No other blockers. No feature-code, docs/coordination, or other-worktree edits
   were made this session.

## Single next command

1. Check for the coordinator's clear signal (re-resolve pane by label first):
   ```bash
   herdr pane list   # find current pane_id for label "Coord-1109-1110-g3"
   herdr pane read <pane_id> --source recent --lines 15
   ```
2. Once clear (or backstop time elapsed + subnet confirmed free via
   `docker network ls`), provision and run:
   ```bash
   cd /home/ben/Jarv1s/.claude/worktrees/uat-1117-final-6ca14fca
   npx tsx artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/run_uat.ts \
     artifacts/webwright/pr-1117-6ca14fca-final/final_runs/run_1/final_script.py bare \
     > /tmp/uat-1117-6ca14fca-run1.log 2>&1 &
   ```
   Monitor with `Read`/`tail` on that log; it will print `step N action: ...` lines
   live (script flushes after each `log()` call) and exit non-zero on any failed
   `assert`.
3. **Self-verify per the webwright contract** — do not trust the script's exit
   code alone: `Read` every screenshot cited in `final_script_log.txt` under
   `final_runs/run_1/screenshots/` and confirm each CP's evidence is unambiguous,
   with particular scrutiny on:
   - **CP5** (the fix under test): confirm "Activity unavailable." appears within
     the asserted `elapsed < 6.0s` window in the log AND the screenshot
     (`final_execution_08_activity_delayed_error.png`) visibly shows the error
     state with a "Try again" button — not a lingering "Loading…" that happened to
     also satisfy a loose text match.
   - **CP6** (retry recovery): confirm the post-retry screenshot
     (`final_execution_09_activity_recovered.png`) shows real activity content or
     an empty-state, not a hidden/occluded error still underneath.
   - If the script instead reproduces the prior session's identical CP5 timeout
     symptom on this head, that would mean the fix did NOT resolve the live
     defect — treat that as a genuine, surprising finding worth double-checking
     (e.g. is the built/served app actually running this head's code, not a stale
     Docker image layer?) before concluding RED, since the diff review in this doc
     is strong evidence the fix is on-topic.
4. If a CP fails after fixing only script bugs (not the app fix), bump to
   `run_2`, etc., per contract. Do not touch app/feature code from this workspace.
5. **GREEN:** push evidence branch `uat/1117-final-6ca14fca` with `git add -f
   artifacts/webwright/pr-1117-6ca14fca-final` (and nothing else), commit, push,
   then `gh pr comment 1117` with the exact SHA, durable blob-URL links to key
   screenshots, and the CP-by-CP pass summary.
   **RED:** `gh pr comment 1117` with the exact SHA and a compact list of exactly
   which CP(s) failed and why (cite the log line / screenshot); do not fix
   feature code from this lane.
6. Either way, relay a compact GREEN/RED verdict + PR-comment URL + evidence
   branch/commit (or failing CPs) to UX Coordinator session
   `019f6dc5-45d7-7f23-b404-d4fef1bf587f` via `herdr-pane-message`.
