# Handoff — #1040: log generated owner/admin credentials at UAT seed time

**Issue:** #1040 (Part of epic #1000 — the epic's LAST child; closing this closes #1000).
**Spec (approved):** `docs/superpowers/specs/2026-07-12-dev-uat-harness.md` — the #1000 dev-UAT
harness spec owns the programmatic account creation. This change lives entirely inside its tiered
seed. No new spec needed; you are implementing an explicit acceptance detail of that spec + Ben's
direct dev-auth ask.
**Worktree / branch:** `.claude/worktrees/uat-seed-log-creds-1040` / `uat-seed-log-creds-1040`
(branched off `origin/main` @ `8f9da394`).
**Tier:** **security** (credential handling + logging). Expect Opus adversarial QA that hunts for
any way this logging path reaches prod or logs a real user's secret. Build to survive that.
**Coordinator:** label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f`. Escalate
plan-ready / any `[SECURITY]`/`[BLOCKER]` to that label via `herdr pane run`.

## Problem

Dev/UAT setups create the owner/admin account **programmatically** (UAT seed, `tests/uat/seed/`).
The generated password / one-time token is never surfaced, so a human operator can't authenticate
as owner to run **owner-auth-only** ops in a dev instance (e.g. deleting the quarantined #989 test
account). Ben will not hold owner-auth for dev setups — so the seed must **print the creds**.

## Insertion point (confirmed)

- `tests/uat/seed/admin.ts` — the seed that provisions the admin/owner user. Commit `ab609234`
  already *exports* the seeded admin creds for Playwright login; your job is to also **log them to
  setup stdout** so a human operator can grab them. Grep the file for exactly where the
  password/token is generated and where the admin user is inserted; log at that point.
- Check `tests/uat/seed/cli.ts` / the seed entrypoint for the right stdout sink (the setup console
  the operator actually sees), and confirm whether a dev bootstrap path outside `tests/uat/seed/`
  also creates an owner — if so, cover it too. If only the UAT seed creates the owner, that is the
  sole site.

## HARD FENCE — do not violate `secrets-never-escape` (CLAUDE.md invariant)

1. **Dev/UAT only.** Env-guard the log line so it is **impossible** to reach in a production image
   or bootstrap — gate on `NODE_ENV !== 'production'` **and/or** an explicit dev/UAT flag the
   harness already sets. A prod bootstrap must never hit this branch. Prove the guard.
2. **Seed fixtures only.** The logged values are the **deterministic throwaway seeded owner login**
   (email + generated seed password / one-time token). NEVER log a real user's connector/AI
   credential, real auth token, password hash, or session token. Only the seeded owner login.
3. **stdout only.** Log to setup/console stdout only. Do **not** log to any sink that ships to prod
   aggregation, pg-boss payloads, exports, or AI prompts.

If you cannot cleanly satisfy all three (e.g. the guard is ambiguous, or the same code path is
shared with a prod bootstrap), STOP and escalate `[SECURITY]` to the Coordinator rather than
guessing.

## Exit criteria

- Seed prints the seeded owner/admin email + generated password/token to setup stdout, dev/UAT-guarded.
- A test asserts (a) the creds are logged in dev/UAT mode and (b) the log line is **absent** under a
  production-mode guard (prove the fence, don't just assert the happy path).
- Full local gate green: `pnpm verify:foundation` (record exit code). Lint/format/typecheck/file-size clean.
- No change outside the seed + its tests + this handoff. In particular do NOT touch any real-user
  auth/session/credential code, `apps/web`, or `docs/coordination/`.

## Guardrails (encoded per coordinator policy)

- **`docs/coordination/` is coordinator-only — never edit it.**
- **No repo-wide `pnpm format` / `git add -A` / `git add .`** — stage explicit paths only (shared tree).
- Follow the **coordinated-build** skill: plan → coordinator approval → build → PR → coordinated-wrap-up.
- Generous why-comments citing #1040 + the hard-fence rationale on the guarded log line.
- Open the PR with a release-note-language summary; do **not** self-merge (Coordinator owns merge
  after Opus QA + Ben security sign-off).
