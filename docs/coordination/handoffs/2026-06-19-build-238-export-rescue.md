# #238 Data Export Rescue Handoff

You are replacing the blocked AGY builder for #238.

## State

- Run: `2026-06-18-deploy-readiness`
- Lane: #238 personal data export archive
- Tier: `sensitive`
- PR: #335
- Worktree: `/home/ben/Jarv1s/.claude/worktrees/data-export-238`
- Branch: `data-export-238`
- Current local HEAD: `5df5b14`
- Base has moved: `origin/main` includes #334 and #336.
- AGY is quota-blocked for about 2 hours; do not wait for it.

## Current Diff

The branch must stay scoped to these files:

- `packages/settings/src/data-export-routes.ts`
- `packages/settings/src/data-export.ts`
- `scripts/export-user-data.ts`
- `tests/integration/data-export.test.ts`

Do not change `apps/api/src/server.ts`, `packages/module-registry/src/index.ts`,
`packages/settings/src/routes.ts`, `packages/settings/src/index.ts`, `packages/settings/src/manifest.ts`,
`package.json`, gate scripts, or repo config.

## Known History

- Initial PR head `6555d09` had self-reported green gate, but independent checks found typecheck and
  test problems.
- AGY fixed the typecheck and narrowed the route-time `authDb` creation to avoid integration-test
  connection-pool pressure.
- AGY made local commit `5df5b14`, but did not push or update `/tmp/build-238-status.txt`.

## Start

1. Run `pnpm install` if dependencies are missing.
2. Confirm `git status --short --branch` is clean at local HEAD `5df5b14`.
3. Rebase `data-export-238` onto current `origin/main`. If conflicts are non-trivial, stop and report.
4. Run:
   - `pnpm typecheck`
   - `JARVIS_PGDATABASE=jarvis_build_238 pnpm verify:foundation`
   - `pnpm audit:release-hardening`
5. If all are green, force-push with lease to `origin/data-export-238`.
6. Write `/tmp/build-238-status.txt` with `BUILD_DONE`, `PR_URL`, `BRANCH`, `HEAD`, `VF_EXIT`,
   `AUDIT_EXIT`, and a short note.
7. Report back to the `Coordinator` label.

No broad refactor. No extra files. Keep the shortest working diff.
