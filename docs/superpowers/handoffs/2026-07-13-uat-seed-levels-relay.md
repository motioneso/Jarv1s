# Relay — #1025 UAT seed levels (Task 4 done — Task 5 next)

Build agent, tier **sensitive**. Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report PR number there. Worktree:
`.claude/worktrees/uat-seed-1025` (branch `uat-seed-1025`). `[ -d node_modules ] || pnpm install`.

## Authoritative build reference

**`docs/superpowers/plans/2026-07-13-uat-seed-levels.md`** (committed, corrected — read it, not
any older doc). All architecture forks are **APPROVED, build now**. Read it **by section** for
the task you're on only — Task 5 starts around line ~588.

## Done (committed)

- `522a91a6` — Task 2 (connections/timestamps/types).
- `0173b42a` — Task 3 (`tests/uat/seed/admin.{ts,test.ts}`), green.
- `c6be9420` — Task 4 (`tests/uat/seed/chunks/{ai,news,sports}.{ts,test.ts}`), all green
  (`npx vitest run tests/uat/seed/chunks/` — 3 files, 3 tests pass). Corrected multiple
  guessed field names from the plan draft — **do not re-derive, this is settled**:
  - `AiRepository.createProvider`: `providerKind` (not `providerKey`); valid values are
    `"openai-compatible" | "anthropic" | "google" | "ollama" | "custom"` — used `"custom"`.
    `purpose` is NOT a field — DB defaults it to `"assistant"`.
  - `AiRepository.createModel`: `providerConfigId`/`providerModelId` (not `providerId`/`modelKey`).
    `capabilities: AiModelCapability[]` — used `["json"]` (valid enum).
  - `AiRepository.setServiceBinding(scopedDb, service, binding, actorUserId)` — `binding` is
    `{ kind: "model", modelId }` (NOT `{ providerId, modelId }` as the plan drafted).
  - `createAiSecretCipher()` called bare (no args) — `resolveKeyring` falls back to a dev default
    when `NODE_ENV` is unset/`development`/`test`, confirmed by reading `packages/db/src/keyring.ts`.
    No test env var needed.
  - Test for the AI chunk queries via `repo.getModuleServiceBinding(scopedDb, "module.news")`,
    NOT a raw `app.ai_service_bindings` table (doesn't exist — it's a JSON blob in
    `app.instance_settings`).
  - `NewsPrefsRepository.create` input field is `key` (not `value`) — `{ kind: "topic", key: topic }`.
  - Sports: **no static team-key catalog exists** (`packages/sports/src/source/catalog.ts` only
    has competitions; team keys come from live ESPN fetches at runtime). Seeded 3
    whole-competition follows (`teamKey: null`) for `nfl`/`nba`/`eng.1` instead of guessing team
    keys — this is a deliberate, correct choice, not a shortcut; don't second-guess it.
  - **Two new package re-exports** (same precedent as `@jarv1s/auth`'s `hashPassword`):
    `NewsPrefsRepository` from `packages/news/src/index.ts`, `SportsFollowsRepository` from
    `packages/sports/src/index.ts` — neither was exported before, root-level seed code couldn't
    reach them otherwise.
  - **New vitest alias**: `@jarv1s/news` was entirely missing from `vitest.config.ts`'s alias map
    (every other module package had one, `@jarv1s/sports` already existed) — added it.

## Next steps (in order)

1. **Task 5** (plan line ~588): tasks/calendar/notes/job-search chunks. Read that plan section
   fresh — not yet researched this session. Notes chunk MUST use `withVaultContext` from
   `packages/vault/src/context.ts` (confirm exact export name/signature when you get there) —
   never raw `fs`, never a DB-proxy substitute. Job-search chunk's `throw` requires reading
   `packages/settings/src/repository-external-modules.ts` for the real `app.external_modules` row
   shape first. **Before writing any repository call verbatim from the plan, grep the real
   repository file first** — the plan's Task 4 draft had ~6 wrong field names; assume Task 5's
   draft has similar drift and verify every field name against source, same discipline as above.
   Check whether `tasks`/`calendar`/`job-search` packages need the same index.ts re-export +
   vitest alias treatment Task 4 needed (grep each package's `src/index.ts` and
   `vitest.config.ts` for the class/alias before assuming it's already wired).
2. Task 6 (line ~801): level composition + CLI entrypoint, incl. `JARVIS_UAT_SEED_CONFIRM` guard
   (already drafted in plan) and `multi-user` throw referencing #1030.
3. Task 7 (line ~979): wire into `tests/uat/provisioner.ts` seed hook (hook wiring only) + new
   `seed` one-shot service in `infra/docker-compose.prod.yml` (profile `ops`,
   `JARVIS_UAT_SEED_CONFIRM` `:?`-required guard — already drafted in plan).
4. Task 8 (line ~1087): `pnpm verify:foundation` green, pre-push trio + rebase, PR
   (`Part of #1000`, `Closes #1025`, base `main`), report PR number to Coordinator, **do not
   merge**.

## Verified environment notes (don't re-derive)

- Dev Postgres is `jarv1s-postgres` container, host port 55433 — matches `packages/db/src/urls.ts`
  defaults with no env overrides needed.
- Run single test files with `npx vitest run <path>` (not `pnpm --filter @jarv1s/root exec
  vitest` — that filter matches no project in this worktree).

## Guardrails (unchanged)

No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format` — only
`prettier --write` files you authored. Don't edit `tests/uat/provisioner.ts` beyond the Task 7
hook wiring. No new migration. Full CLAUDE.md Hard Invariants apply (no BYPASSRLS on runtime
roles is the one most load-bearing here). New package re-exports / vitest aliases (like Task 4's)
are fine — same pattern, not scope creep — but keep them minimal (one class, one alias line).

Read the plan **by section** for the task you're on — don't front-load the whole 1100-line file.
