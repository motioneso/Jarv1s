# Build And Deploy JarvisProd Handoff

**Date:** 2026-06-25  
**Source repo:** `~/Jarv1s`  
**Production checkout:** `~/JarvisProd`  
**Base commit:** `220010f` (`main`, pushed to `origin/main`)

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

Verified before handoff:

- `pnpm vitest run tests/integration/notes-write-tools.test.ts tests/integration/mcp-gateway.test.ts`
  passed: 2 files, 29 tests.
- `pnpm typecheck` passed.
- `pnpm test:unit` passed: 111 files, 843 passed, 2 skipped.
- Touched-file Prettier checks passed.
- GLM and AGY final reviews were GREEN.

Known shared-tree note: `~/Jarv1s` has unrelated uncommitted deploy/folder-picker work from other
sessions. Do not use that working tree for deploy edits or broad git operations. Work from your own
isolated worktree or from `~/JarvisProd` as appropriate.

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
5. Build from `origin/main`/`220010f` or newer if `main` advanced after this handoff.
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
