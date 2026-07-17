# UAT Handoff — PR #1118 exact-head live-path UAT

**Status: context tripwire hit, work paused before browser iteration. No verdict yet.**

## Target

- Exact HEAD under test: `00c43878c6ffada902f3955962f3f9101dc6e14b` (PR #1112's merge
  commit on `main`, includes PR #1117's integration — see `gitStatus` in session header:
  branch `HEAD`, top commit `00c43878 fix(today): greeting and date on one masthead line (#1112)`).
- Worktree: `/home/ben/Jarv1s/.claude/worktrees/uat-1118-final-00c43878`
- Reference spec (READ-ONLY, never execute): `tests/uat/specs/1112-today-masthead-oneline.uat.spec.ts`
- Task: real owner-signup flow (not seeded login) on a fresh bare #1000-harness instance,
  through Today, verifying #1112 one-line masthead @1280x1800 and #1117 stacked/no-overflow
  masthead @390x844, plus a final desktop sanity pass. Full CP list in
  `artifacts/webwright/pr-1118-00c43878-final/plan.md`.

## Completed so far

- `plan.md` — CP1–CP6 checklist, written, unchanged.
- Bare instance provisioned and **confirmed live** as of `2026-07-17T04:34:45Z`:
  - `baseURL=http://127.0.0.1:20001`
  - docker-compose project `uat-3606498_6cf89549`
  - `curl http://127.0.0.1:20001/health/ready` → `200`
  - `docker ps`: `uat-3606498_6cf89549-jarv1s-1` and `-postgres-1` both `Up 6 minutes (healthy)`
  - holder processes alive: pid 3606449 (pnpm), 3606482/3606498 (tsx running
    `artifacts/webwright/pr-1118-00c43878-final/orchestrate.ts`)
  - `instance.json` in this dir has `provisionedAt: 2026-07-17T04:28:16.776Z`;
    `orchestrate.ts` holds for `WEBWRIGHT_HOLD_MS` (default 20 min) →
    **auto-teardown ~2026-07-17T04:48:16Z** unless a `TEARDOWN_NOW` sentinel file is
    dropped in this same directory first (don't drop it — let the successor use the window,
    or let it lapse and reprovision).
  - Provisioned with `UAT_DOCKER_SUBNET=10.255.0.0/24` (chosen to avoid an unrelated
    session's UAT instance on the default `10.254.0.0/24` — recheck `docker network ls`
    before reprovisioning).
- `explore/01_landing.png` — landing page screenshot, confirms signup form renders.
- Signup form selectors **confirmed live** (not just source-read): `form.auth-form`,
  exactly 3 `<label>`s in order "Name"/"Email"/"Password", exactly one `<button>` on the
  page, text "Create account" (no scoping ambiguity needed, unlike the reference spec's
  "Sign in" button which needs form-scoping to disambiguate from a tab control).
- `final_runs/run_1/final_script.py` — **written, NOT yet executed.** Full instrumented
  Playwright script: signup (sanitized fake data, email
  `uat-1118-<unix-ts>@example.test`) → onboarding "Skip setup" → "Skip anyway" confirm →
  AppShell (`.jds-usermenu__trigger`) → Today masthead visible (CP3) → CP4 desktop
  1280x1800 one-line bounding-box check (`.cmd-eyebrow` vs `.cmd-dateline`, `|dy|<=2`) →
  CP5 narrow 390x844 stacked/no-overflow check (`flex-direction:column`,
  `scrollWidth<=390`, dateline below greeting) → CP6 final desktop 1280x1800 re-check.
  Logs to `final_runs/run_1/final_script_log.txt`, screenshots to
  `final_runs/run_1/screenshots/final_execution_<n>_<name>.png`. The
  `final_runs/run_1/screenshots/` directory already exists (empty — script not run yet).
  Onboarding-skip selectors (`"Skip setup"` → `"Skip anyway"`) are sourced from prior
  project memory (`uat-spec-gotchas.md`), **not yet exercised live against this exact
  instance** — first live run doubles as verification of that assumption.

## Not yet done

1. Execute `final_runs/run_1/final_script.py` against `http://127.0.0.1:20001`
   (`python3 artifacts/webwright/pr-1118-00c43878-final/final_runs/run_1/final_script.py`
   from the worktree root, or set `JARVIS_UAT_BASE_URL` env var if the instance was
   reprovisioned on a different port).
2. Self-verify: `Read` every screenshot in `final_runs/run_1/screenshots/`, tick each CP
   in `plan.md` only with concrete cited evidence (per webwright skill self-verify step).
   If any CP fails, diagnose, fix the script, re-run in `final_runs/run_2/`.
3. On GREEN: push evidence-only branch `uat/1118-final-00c43878` (script + logs +
   screenshots + `plan.md`, **no feature-code changes**) and comment on PR #1118 with
   durable links to the pushed branch's files (blob URLs), citing the exact commit
   `00c43878c6ffada902f3955962f3f9101dc6e14b`. On RED: post a compact list of genuinely
   failing CPs on PR #1118, no product fix attempted.
4. **Relay final verdict** to the UX Coordinator's Herdr pane — label "UX Coordinator",
   codex session `019f6dc5-45d7-7f23-b404-d4fef1bf587f`. **Re-resolve `pane_id` fresh via
   `herdr pane list` immediately before sending** (ephemeral, do not reuse a cached id).
   An early-status relay was already sent earlier this run (queued successfully) — this
   final relay is a separate, still-outstanding obligation.

## One next command

```bash
cd /home/ben/Jarv1s/.claude/worktrees/uat-1118-final-00c43878 && \
python3 artifacts/webwright/pr-1118-00c43878-final/final_runs/run_1/final_script.py
```
Then read `final_runs/run_1/final_script_log.txt` and every PNG under
`final_runs/run_1/screenshots/`, and proceed per "Not yet done" steps 2–4 above.

If the instance has torn down by the time this is picked up (past ~04:48Z), reprovision
first:
```bash
UAT_DOCKER_SUBNET=10.255.0.0/24 pnpm exec tsx artifacts/webwright/pr-1118-00c43878-final/orchestrate.ts &
```
then wait for `[orchestrate] ready baseURL=...` in its output before re-running the script.

## Hard constraints (unchanged, task-scoped)

No feature-code edits. No `docs/coordination`. No other worktrees/lanes. No CI rerun. No
broad gates (`pnpm verify:foundation`). Sanitized signup data only (no real PII). Push
**only** the evidence branch `uat/1118-final-00c43878`, nothing else.
