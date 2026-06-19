# Build Handoff — #239 account self-deletion

**Issue:** #239
**Spec:** `/home/ben/Jarv1s/docs/superpowers/specs/2026-06-19-account-self-deletion.md`
**Tier:** `security`
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/account-self-deletion-239`
**Branch:** `account-self-deletion-239`
**DB:** `jarvis_build_239`
**Status file:** `/tmp/build-239-status.txt`
**Coordinator:** Herdr label `Coordinator`, session `019ee20b-8254-7273-9df8-9a3434f1e6ea`

## Mission

Implement the approved spec fully. First run `[ -d node_modules ] || pnpm install`, then read the spec in full. Send a short plan to the `Coordinator` label and wait for approval before writing implementation code.

Locked decisions:
- Hard-block bootstrap-owner self-delete.
- Hard delete, no grace period.
- Do not block on data export; #238 is landed but deletion must not fake/export implicitly.
- Audit action is `user.delete.self`.

## Hard Rules

- Do not weaken gates, configs, file-size limits, tests, lint, typecheck, or audit scripts.
- Do not edit applied migrations. Add a forward migration only if the spec exposes a real schema gap.
- Do not touch `docs/coordination/`, project boards, milestones, or merge state.
- Stage explicit files only; no `git add -A` or `git add .`.
- Keep `apps/web/src/api/client.ts` under the 1000-line limit by extracting if needed.

## Gate

Use the isolated DB:

```bash
pnpm db:up
docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarvis_build_239;" 2>/dev/null || true
export JARVIS_PGDATABASE=jarvis_build_239
JARVIS_PGDATABASE=jarvis_build_239 pnpm db:migrate
```

Before PR:

```bash
pnpm check:file-size
JARVIS_PGDATABASE=jarvis_build_239 pnpm verify:foundation > /tmp/build-239-vf.log 2>&1; echo "VF_EXIT=$?"
pnpm audit:release-hardening > /tmp/build-239-audit.log 2>&1; echo "AUDIT_EXIT=$?"
pnpm prettier --check <changed files>
pnpm lint
pnpm typecheck
```

Retry `verify:foundation` once only if it fails with the known `tuple concurrently updated` grant-contention signature.

When ready, push the branch, open a PR, and write:

```text
BUILD_DONE
PR_URL=<url>
HEAD=<git rev-parse HEAD>
VF_EXIT=<n>
AUDIT_EXIT=<n>
FILESIZE_OK=<yes/no>
NOTES=<short notes>
```

to `/tmp/build-239-status.txt`. If blocked, write `BLOCKED` plus the exact question.
