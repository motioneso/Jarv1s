# Build And Deploy JarvisProd Handoff

**Date:** 2026-06-25  
**Source repo:** `~/Jarv1s`  
**Production checkout:** `~/JarvisProd`  
**Base commit:** `d5604c3` (`main`, pushed to `origin/main`)

## Goal

Build and deploy the current `origin/main` to JarvisProd, then verify the running production
instance is updated.

## Context

The notes write tools work is merged and pushed to `main`:

- `notes.create` and `notes.edit` are auto-run write tools.
- `notes.delete` is destructive and uses the existing approval flow.
- Note writes are restricted to relative `.md` paths under the actor's linked notes source and
  `JARVIS_NOTES_ROOTS`.
- Sync enqueue uses metadata-only payloads.

The two-container deploy consolidation is also merged and pushed to `main` in `d5604c3`:

- Production Compose now runs one `postgres` container and one `jarv1s` container.
- The `jarv1s` image includes API, worker, cli-runner, migrations, and built web assets.
- The API serves the Vite build on the same public origin as `/api`.
- The default public Jarv1s port is `1533`.
- CI/publish/smoke paths now target one `ghcr.io/motioneso/jarv1s` image.

Verified before handoff:

- Deploy wrap-up for `d5604c3`:
  - `pnpm exec vitest run tests/unit/api-static-web.test.ts tests/unit/start-jarv1s-plan.test.ts tests/unit/prod-compose-plan.test.ts tests/unit/prod-deploy-config.test.ts tests/unit/setup-prod-trusted-origins.test.ts tests/unit/cli-runner-catalog-path.test.ts` passed: 6 files, 34 tests.
  - `pnpm test:release-hardening` passed: 1 file, 19 tests.
  - `pnpm typecheck` passed.
  - `JARVIS_IMAGE_TAG=smoke pnpm smoke:compose:prod` passed at `http://localhost:1533/health/ready`; the smoke stack was cleaned up.
- `pnpm vitest run tests/integration/notes-write-tools.test.ts tests/integration/mcp-gateway.test.ts`
  passed: 2 files, 29 tests.
- `pnpm typecheck` passed.
- `pnpm test:unit` passed: 111 files, 843 passed, 2 skipped.
- Touched-file Prettier checks passed.
- GLM and AGY final reviews were GREEN.

Known shared-tree note: `~/Jarv1s` has unrelated uncommitted folder-picker work from other
sessions. Do not use that working tree for deploy edits or broad git operations. Work from your own
isolated worktree or from `~/JarvisProd` as appropriate.

## Deployment Result

Codex JarvisProd deploy pane `w1:p18` reported the production update complete:

- Deployed `origin/main` at `d5604c3` to `~/JarvisProd`.
- Production is running the single `jarv1s` container on public port `1533`.
- Only operator deploy files under `~/JarvisProd` and `/tmp/update-jarvis-nginx-1533.sh` were
  changed by the deploy pane.
- The deploy pane did not modify or stage anything in the shared `~/Jarv1s` tree.

Follow-up: the committed notes overlay/install path is still stale for the split-service-era
Compose names. The production deploy directory has a local notes override adjusted for the deployed
single-container stack, but `~/Jarv1s/install.sh` and the committed operations docs still need a
separate cleanup pass. Tracked in GitHub issue #471.

## Guardrails

- Do not overwrite or stash another session's uncommitted work in `~/Jarv1s`.
- Do not use `git add -A`, `git checkout`, `git reset`, or `git stash` in the shared `~/Jarv1s`
  tree.
- If you need source edits before deploy, make them in your isolated worktree on a new branch.
- Never print or commit secrets, tokens, environment files with private values, or production logs
  containing secrets.
- If the deployment process is unclear, inspect committed docs and scripts first instead of guessing.

## Start

1. Run `pnpm install` in your fresh worktree if dependencies are missing.
2. Confirm your base is current:

   ```bash
   git fetch origin main
   git status -sb
   git rev-parse HEAD origin/main
   ```

3. Inspect the committed deployment docs and scripts:

   ```bash
   rg -n "JarvisProd|deploy|production|docker|compose|publish|setup-prod" README.md docs scripts infra
   ```

4. Determine the correct build/deploy path from committed docs and scripts.
5. Build from `origin/main`/`d5604c3` or newer if `main` advanced after this handoff.
6. Update `~/JarvisProd` using the documented process.
7. Verify production is healthy. At minimum, check the app health endpoint and confirm the deployed
   revision/tag matches the source commit you intended to deploy.
8. Report:
   - source commit deployed
   - exact build/deploy commands run
   - health checks and results
   - any production changes made
   - any blockers or follow-up issues

## Notes Write Manual Smoke

If production has a writable notes source configured under `JARVIS_NOTES_ROOTS`, optionally smoke the
new behavior:

```text
Create a note called demo-write-tools.md with the text "hello from Jarvis"
```

```text
In demo-write-tools.md replace "hello" with "goodbye"
```

```text
Delete demo-write-tools.md
```

Expected: create and edit run without approval; delete shows an approval request before removal.
