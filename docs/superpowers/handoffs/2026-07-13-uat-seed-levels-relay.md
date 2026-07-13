# Relay — #1025 UAT seed levels (Task 5 partial — job-search chunk next)

Build agent, tier **sensitive**. Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report PR number there. Worktree:
`.claude/worktrees/uat-seed-1025` (branch `uat-seed-1025`). `[ -d node_modules ] || pnpm install`.

## Authoritative build reference

**`docs/superpowers/plans/2026-07-13-uat-seed-levels.md`** (committed, corrected — read it, not
any older doc). All architecture forks are **APPROVED, build now**. Read it **by section** for
the task you're on only — Task 5's remaining step (job-search) is at plan line ~758-789.

## Done (committed)

- `522a91a6` Task 2, `0173b42a` Task 3, `c6be9420` Task 4 (see prior relay history in git log for
  detail — do not re-derive, settled).
- `0a082a33` — Task 5, 3 of 4 chunks (`tests/uat/seed/chunks/{tasks,calendar,notes}.{ts,test.ts}`),
  all green. Corrected two more plan-draft field errors — **do not re-derive**:
  - `TasksRepository.create`'s `status` is `"todo" | "suggested" | "done" | "archived"`
    (`packages/db/src/types.ts`), NOT `"open" | "done"` as the plan drafted. Used `"todo"`.
  - `calendar_events_insert` RLS (`packages/calendar/sql/0066_calendar_worker_grants_and_google_insert.sql`)
    requires connector scope **exactly** `"https://www.googleapis.com/auth/calendar"` for a
    `provider_type='google'` account — the plan's drafted `"calendar.read"` fails the WITH CHECK.
  - `CalendarRepository`/`ConnectorsRepository` import correctly from `@jarv1s/calendar` /
    `@jarv1s/connectors` (already-aliased in `vitest.config.ts`) — the plan's drafted
    `@jarv1s/connectors/crypto` subpath does NOT exist as an alias; `createConnectorSecretCipher`
    is re-exported from the top-level `@jarv1s/connectors` package (mirrors `ai.ts`'s pattern for
    `createAiSecretCipher`).
  - `seedNotesChunk` signature is `(runner: DataContextRunner, actorUserId) => Promise<void>` —
    `runner` is unused (notes have no `app.*` rows) but kept for Task 6's uniform chunk-array
    composition; ESLint's `no-unused-vars` has `args: "none"` so this is not a lint error.
  - Notes chunk uses `new VaultContextRunner(getVaultBaseDir())` + `writeVaultFile` from
    `@jarv1s/vault` (mirrors `packages/wellness/src/export-job.ts`'s production call-site
    pattern) — writes 5 real `.md` files (incl. a `meeting-notes/` subdir) under the per-user
    vault root. The notes.test.ts sets `process.env.JARVIS_VAULT_ROOT` to a `mkdtemp` temp dir in
    `beforeAll`/restores in `afterAll` — same pattern as
    `tests/integration/wellness-export-job.test.ts` — because the real default
    (`getVaultBaseDir()` → `/data/vaults`) doesn't exist on this dev host outside Docker.
  - No new package re-exports or vitest aliases were needed this round — `@jarv1s/tasks`,
    `@jarv1s/calendar`, `@jarv1s/connectors`, `@jarv1s/vault` were all already fully wired.

## Next steps (in order)

1. **Finish Task 5** (plan line ~758-789): `chunks/job-search.ts` + `.test.ts`. The plan's drafted
   stub deliberately `throw`s pending research — **before writing the real implementation, read**
   `packages/settings/src/repository-external-modules.ts` **and**
   `packages/settings/sql/0152_external_modules.sql` **first** to get the exact `app.external_modules`
   row shape (do not guess column names — same discipline as tasks/calendar above, which both had
   plan-draft field-name bugs). Spec intent (§4.4, restated in the plan): `admin+data`'s DEFAULT
   is job-search **NOT installed** (proves the UI's absent-module path); this seed function only
   runs when the level composition explicitly wants the installed-module path proven instead.
   "Installed" = the `app.external_modules` / module-registry row shows installed-enabled — NOT
   running the full privileged module-reconcile download flow.
   Then: `git add` the 2 new files + run
   `npx vitest run tests/uat/seed/chunks/job-search.test.ts`, then commit
   `feat(uat-seed): job-search seed chunk (#1025)`.
2. Task 6 (plan line ~801): level composition + CLI entrypoint, incl. `JARVIS_UAT_SEED_CONFIRM`
   guard (already drafted in plan) and `multi-user` throw referencing #1030. Composes all 7 chunks
   from Tasks 4+5 — every chunk's signature is `(runner: DataContextRunner, actorUserId: string) =>
   Promise<void>` so the composition array is uniform.
3. Task 7 (plan line ~979): wire into `tests/uat/provisioner.ts` seed hook (hook wiring only) + new
   `seed` one-shot service in `infra/docker-compose.prod.yml` (profile `ops`,
   `JARVIS_UAT_SEED_CONFIRM` `:?`-required guard — already drafted in plan). Note:
   `expectedUatVolumeNames` in `provisioner.ts` already lists `jarv1s-vault-data` — the seed
   container will need that volume mounted at the same path the `jarv1s` service uses, so
   `getVaultBaseDir()`'s default (`/data/vaults`) resolves correctly inside the container (no env
   override needed there, unlike the local host test run).
4. Task 8 (plan line ~1087): `pnpm verify:foundation` green, pre-push trio + rebase, PR
   (`Part of #1000`, `Closes #1025`, base `main`), report PR number to Coordinator, **do not
   merge**.

## Verified environment notes (don't re-derive)

- Dev Postgres is `jarv1s-postgres` container, host port 55433 — matches `packages/db/src/urls.ts`
  defaults with no env overrides needed.
- Run single test files with `npx vitest run <path>` (not `pnpm --filter @jarv1s/root exec
  vitest` — that filter matches no project in this worktree).
- `/data/vaults` (the real `getVaultBaseDir()` default) does not exist on this dev host outside
  Docker — any local test touching `VaultContext` must override `JARVIS_VAULT_ROOT` to a
  `mkdtemp` dir (see `notes.test.ts` for the pattern).

## Guardrails (unchanged)

No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format` — only
`prettier --write` files you authored. Don't edit `tests/uat/provisioner.ts` beyond the Task 7
hook wiring. No new migration. Full CLAUDE.md Hard Invariants apply (no BYPASSRLS on runtime
roles is the one most load-bearing here). New package re-exports / vitest aliases are fine — same
pattern as Task 4 — but keep them minimal (one class, one alias line); none were needed in this
round.

Read the plan **by section** for the task you're on — don't front-load the whole 1100-line file.
