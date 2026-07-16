# Spec — #1082: UAT-seed prod backdoor guard (DB-state check)

Lane A1 (hotfix, ships first). Status: APPROVED (Fable, delegated auth 2026-07-16). Build = Codex `gpt-5.6-sol`, QA = Opus (security).

## Decision (locked)

The env token `JARVIS_UAT_SEED_CONFIRM=1` is **necessary-not-sufficient**. Add a **target-DB state check** as the real guard: the seed entrypoint refuses to run if the target database already contains a bootstrap owner or any real (non-seed) user. The seed fixtures use fixed ids (`UAT_ADMIN_ID`, `UAT_SECOND_OWNER_ID`, `UAT_*_EMAIL` in `tests/uat/seed/admin.ts`), so "real user" = any `app.users` row whose id/email is not one of the known seed ids. Fail **closed** (throw, exit non-zero) on any real user present.

Current exposure is nil (Wave-0 confirmed: no seed-shaped rows on prod, token unset, deployed prod compose defines no seed service). This is defense-in-depth, not incident response — but still ships ahead of all other lanes.

## Files

- `tests/uat/seed/cli.ts` — in `main()`, after the existing token check (lines 13–21), before `seedLevel`, add an `assertTargetIsEphemeral(db)` call. Refuse (throw) if the target holds a bootstrap owner or any non-seed user.
- New helper: `tests/uat/seed/guard.ts` (`assertTargetIsEphemeral`) — query `app.users` for (a) any `is_bootstrap_owner = true` row, and (b) any row whose `id NOT IN (UAT seed ids)` / `email NOT IN (UAT seed emails)`. Import the seed-id constants from `admin.ts` so the allowlist can't drift. Throw a clear `[uat-seed] refusing: target DB already has real/bootstrap users` on any hit.
- `infra/docker-compose.prod.yml` — confirm the seed service exists only under the `ops` profile; the DB check is now the authoritative guard so no compose change is required for correctness, but add a comment on the seed service pointing at `guard.ts` as the real gate. (Deployed prod compose has no seed service — leave that as-is.)
- Verify PR #1041's `.dockerignore` rewrite fully un-excludes `tests/` for the seed image (the DOA-masking finding); note result in the PR body.

## Tests

- `tests/uat/seed/guard.test.ts` — (1) empty DB → passes; (2) DB seeded with a bootstrap owner → throws; (3) DB with one non-seed real user → throws; (4) DB containing only the known UAT seed rows (re-seed case) → passes. Use the migration DB harness like `admin.test.ts`.

## Exit criterion

Run the seed entrypoint against a DB that already has a real bootstrap-owner row → it refuses (non-zero exit) even with `JARVIS_UAT_SEED_CONFIRM=1` set. Green `verify:foundation`. Opus security sign-off. Merge alone, first.
