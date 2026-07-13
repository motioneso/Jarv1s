# Relay — #1025 UAT seed levels (Task 2 done, Task 3 mid-flight)

Build agent, tier **sensitive**. Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report PR number there. Worktree:
`.claude/worktrees/uat-seed-1025` (branch `uat-seed-1025`). `[ -d node_modules ] || pnpm install`.

## Authoritative build reference

**`docs/superpowers/plans/2026-07-13-uat-seed-levels.md`** (committed, corrected — read it,
not any older doc). All architecture forks are **APPROVED, build now** (dual-connection RLS
design, new `ops`-profile compose `seed` service, determinism scope, notes-via-VaultContext,
multi-user deferred to **#1030**). No further escalation needed for anything already in that
plan. This same relay-doc file's git history mentions an older "Option A" ruling — that is
superseded; ignore it if you see it, this content is the current state.

## Done (committed)

- `522a91a6` — Task 2: `tests/uat/seed/{connections,timestamps,types}.ts` +
  `timestamps.test.ts`. Verified: `getJarvisDatabaseUrls()` returns
  `{bootstrap,migration,app,auth,worker}` (matches plan); `DataContextRunner` constructor takes
  `Kysely<JarvisDatabase>`, `.withDataContext({actorUserId, requestId?}, work)` (matches plan
  exactly — no drift). `npx vitest run tests/uat/seed/timestamps.test.ts` passes.

## In progress — NOT committed, fix first

`tests/uat/seed/admin.ts` is written on disk (Task 3, matches plan §Task 3 Step 3, plus added
explicit `image: null` to satisfy `UsersTable`'s non-`Generated<>` nullable column and full
explicit nullable fields on `auth_accounts` insert — both required, confirmed via
`packages/db/src/types.ts:37-48` `UsersTable` / `:79-93` `AuthAccountsTable`).

**Blocker found, not yet fixed:** `import { hashPassword } from "better-auth/crypto"` fails
`tsc --noEmit -p .`: `Cannot find module 'better-auth/crypto'`. Root cause: `better-auth` is a
dependency of `packages/auth` only (`packages/auth/package.json:16`), not of the repo root —
pnpm's strict `node_modules` means a root-level file (`tests/uat/seed/`) can't resolve it, even
though `packages/auth/src/index.ts:7` imports the same thing fine (it's isolated to that
package's own node_modules).

**Two fix options, not yet decided — pick one and proceed, no need to re-escalate:**
1. Re-export `hashPassword` from `@jarv1s/auth` (it currently only exports `verifyPassword`,
   `packages/auth/src/index.ts:7,177`) and import from `@jarv1s/auth` instead — reuses existing
   machinery, adds zero new root dependencies. **Preferred** — check `packages/auth/src/index.ts`
   in full first; there may be a reason `hashPassword` wasn't already re-exported (e.g. it's meant
   to stay a login-time-only concern) — if so, adding a thin export there is still the smallest
   change.
2. Add `better-auth` as an explicit root `devDependency` in the top-level `package.json` — heavier
   (new root dep, `check:package-deps` gate might flag it as redundant with `packages/auth`'s own
   dependency) — only do this if option 1 turns out to be architecturally wrong.

Once fixed: write `tests/uat/seed/admin.test.ts` (plan §Task 3 Step 1, exact code given in plan)
BEFORE re-verifying `admin.ts` — Task 3 was started out of strict TDD order (implementation
drafted before the test file existed, reusing an earlier fork's draft); correct that by writing
the test now, confirming it fails for the right reason, then implementing/fixing until green, per
normal TDD. Needs a **live dev Postgres** (`JARVIS_MIGRATION_DATABASE_URL` /
`packages/db/src/urls.ts` defaults) — the standard dev compose stack, not the ephemeral UAT one.

## Next steps (in order)

1. Fix the `hashPassword` import (option 1 above), write `admin.test.ts`, get Task 3 green, commit
   (`git add tests/uat/seed/admin.ts tests/uat/seed/admin.test.ts` — exact paths only).
2. Task 4 (`docs/superpowers/plans/2026-07-13-uat-seed-levels.md` line ~339): news/sports/AI
   provider chunks. Plan flags two "confirm exact field/table name before finalizing" spots
   (AI service-binding table name; news pref field name) — grep the real files first, the plan
   says which.
3. Task 5 (line ~588): tasks/calendar/notes/job-search chunks. Notes chunk MUST use
   `withVaultContext` from `packages/vault/src/context.ts` (confirm exact export name/signature
   when you get there — not yet verified) — never raw `fs`, never a DB-proxy substitute. Job-search
   chunk's `throw` requires reading `packages/settings/src/repository-external-modules.ts` for the
   real `app.external_modules` row shape first.
4. Task 6 (line ~801): level composition + CLI entrypoint, incl. the `JARVIS_UAT_SEED_CONFIRM`
   guard (already drafted in the plan) and the `multi-user` throw referencing #1030.
5. Task 7 (line ~979): wire into `tests/uat/provisioner.ts` seed hook (only the hook wiring — plan
   says exactly what) + new `seed` one-shot service in `infra/docker-compose.prod.yml` (profile
   `ops`, `JARVIS_UAT_SEED_CONFIRM` `:?`-required guard — already drafted in the plan).
6. Task 8 (line ~1087): `pnpm verify:foundation` green, pre-push trio + rebase, PR (`Part of #1000`,
   `Closes #1025`, base `main`), report PR number to Coordinator pane, **do not merge**.

## Guardrails (unchanged)

No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format` — only
`prettier --write` files you authored. Don't edit `tests/uat/provisioner.ts` beyond the Task 7
hook wiring. No new migration. Full CLAUDE.md Hard Invariants apply (no BYPASSRLS on runtime
roles is the one most load-bearing here — the dual-connection design in the plan is how it's
satisfied).

Read the plan **by section** for the task you're on — don't front-load the whole 1100-line file.
