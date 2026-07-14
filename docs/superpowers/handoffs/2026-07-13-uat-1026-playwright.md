# Handoff — #1026: UAT harness Phase 3 (Playwright + job-search-install spec)

You are a **build agent**. Model: **Sonnet**. Tier: **routine** (test-harness code — no shared
migration, no runtime-role change). Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report the PR number there.

Worktree: `.claude/worktrees/uat-play-1026` (branch `uat-play-1026`, off `origin/main` @ `ea0660c1`
— this ALREADY contains P1's `tests/uat/provisioner.ts` AND P2's `tests/uat/seed/*`). STEP 1:
`pnpm install`.

## Read first (in full — decision-dense, grounded in real code)
- The APPROVED spec: `docs/superpowers/specs/2026-07-12-dev-uat-harness.md`. Read the **Status
  block** (Ben's locked decisions) then **§8.3** — Phase 3 is §8.3. Also skim **§4** (the seed
  levels you'll `provision()`).
- **P1's `tests/uat/provisioner.ts`** IN FULL — you call its `provision(level)` /  teardown API to
  stand up an ephemeral prod-shaped instance, then Playwright drives the real browser, then it
  `down -v`. Do not re-architect it.
- **P2's `tests/uat/seed/levels.ts`** — the levels you seed against (`solo-admin`, `admin+data`,
  the **job-search absence/presence toggle** lives there).
- `gh issue view 1026 --repo motioneso/Jarv1s` (this phase) and `gh issue view 1000` (epic/why).

## Scope — Phase 3 ONLY (do NOT wire the coordinate gate — that's P4 #1027)
Per spec §8.3:
1. A Playwright harness that: `provision(<level>)` → resolve the instance base URL → run specs →
   guaranteed `down -v` teardown even on failure (try/finally).
2. **`tests/uat/job-search-install.uat.spec.ts`** — the flagship spec. It must prove the
   **job-search module install fail-closed behavior** end-to-end against the real running UI on the
   `admin+data` seed with job-search TOGGLED ABSENT: attempt the install path through the real UI,
   assert it **fails closed** (no partial/un-purgeable state) per the #868 capture-fail ruling
   ("868 hard fail. If we can't do a private session then we don't." → launch fails closed).

## HARD RULE — real-nav discovery (Ben, non-negotiable)
The test MUST **discover and click the real navigation item** to reach any surface.
**`page.goto('/m/<module>')` or ANY hardcoded in-app route is FORBIDDEN.** Navigate the way a user
does: find the nav element by its visible label/role and click it. A test that deep-links a route
does not prove the real runtime path and will be rejected in QA. (This is why unit tests passed
while the real #999 install path broke — see the #1000 UAT rationale.)

## Determinism
The seed is deterministic (fixed epoch). Do not add wall-clock/random assertions. Prefer
role/label-based Playwright locators over brittle nth-child selectors. If you must wait, wait on a
real UI signal (element visible / network idle), never a fixed sleep.

## Comment density
Generous why-comments citing **#1026 / #1000** at each non-obvious step — especially the
fail-closed assertion (cite the #868 ruling) and the real-nav-discovery clicks (cite the HARD RULE).

## Gate + PR
- `pnpm verify:foundation` green; record exit codes in the PR body. If the Playwright spec needs a
  browser install, use the repo's existing Playwright setup (grep `tests/e2e` for how e2e installs
  chromium) — do NOT add a new heavyweight CI dependency without messaging the Coordinator first.
- PR: `Part of #1000` + `Closes #1026`, base `main`, short "What's new" (dev-tooling — say plainly
  it's not user-visible: "Internal: adds the Playwright UAT spec that drives the real UI to prove
  job-search install fails closed.").
- Report the PR number to the `Coordinator` pane. Tier **routine** → standard QA (CI + code-review +
  exit-criteria) → auto-merge on green. **You do not merge.**

## Guardrails (hard)
- **No `git add -A` / `git add .`** — stage explicit paths only (shared working tree).
- **Do NOT touch `docs/coordination/`** (coordinator-only) and **do NOT run repo-wide `pnpm
  format`** — format only files you changed; `prettier --write` any `.md` you author before commit.
- **No new migration**; do not touch `tests/uat/provisioner.ts` or `tests/uat/seed/*` beyond what
  the Playwright harness legitimately needs to CALL — if you think they need a change, message the
  `Coordinator` pane first.
- If you hit a blocker or a decision the spec didn't settle, message the `Coordinator` pane — do
  not improvise across the spec's locked decisions.
