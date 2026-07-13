# Relay — #1025 UAT seed levels (Task 3 done, Task 4 research done — not yet coded)

Build agent, tier **sensitive**. Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report PR number there. Worktree:
`.claude/worktrees/uat-seed-1025` (branch `uat-seed-1025`). `[ -d node_modules ] || pnpm install`.

## Authoritative build reference

**`docs/superpowers/plans/2026-07-13-uat-seed-levels.md`** (committed, corrected — read it,
not any older doc). All architecture forks are **APPROVED, build now**. Read it **by section**
for the task you're on only.

## Done (committed)

- `522a91a6` — Task 2 (connections/timestamps/types).
- `0173b42a` — Task 3 (`tests/uat/seed/admin.{ts,test.ts}`), green. Two real bugs found+fixed
  vs the plan's literal draft code, both now baked into the committed implementation:
  1. `SET LOCAL ROLE` has no effect outside an explicit transaction — the auth_accounts insert
     (and any read-back of it) must run inside `db.transaction().execute(async trx => {...})`,
     not as loose `.execute(migrationDb)` calls.
  2. `auth_accounts`' real unique constraint is `(provider_id, account_id)`, not `id` — the
     `onConflict` target must be `oc.columns(["provider_id", "account_id"])` or reseeding the
     fixed UAT admin userId throws a duplicate-key error instead of idempotently no-op'ing.
  Also re-exported `hashPassword` from `@jarv1s/auth` (`packages/auth/src/index.ts`) so
  root-level `tests/uat/seed/*` can hash a credential without a new root devDependency
  (pnpm's strict node_modules blocks `better-auth/crypto` resolution outside `packages/auth`).

## In progress — Task 4, NOT yet coded (research only, no files written)

Plan §Task 4 (line 339) drafts `chunks/ai.ts`, `chunks/news.ts`, `chunks/sports.ts`. Its inline
code snippets are **known-wrong in multiple places** — confirmed by reading
`packages/ai/src/repository.ts` and `packages/ai/src/index.ts` directly this session (not yet
applied to any file):

1. **No `app.ai_service_bindings` table exists.** `grep "CREATE TABLE.*service" packages/ai/sql/*.sql`
   returns nothing. Service bindings are a JSON blob in `app.instance_settings` under key
   `ai.service_bindings` (`AI_SERVICE_BINDINGS_SETTING_KEY`, `repository.ts:256`), read/written
   only through `AiRepository` methods — never query the setting row directly. The plan's
   `ai.test.ts` draft (`.selectFrom("app.ai_service_bindings" as never)`) must be rewritten to call
   `repo.getModuleServiceBinding(scopedDb, "module.news")` instead (method at `repository.ts:772`,
   returns `Promise<AiServiceBinding | null>`) — read that method plus `listModuleServiceBindings`
   (`:762`) before writing the test.
2. **`CreateAiProviderInput` field names differ from the plan draft** (`repository.ts:130`):
   `providerKind` (not `providerKey`), `displayName`, `baseUrl?`, `status?`, `authMethod?`,
   `executionMode?`, `encryptedCredential`. No `providerKey` field exists at all. Need to check
   what `AiProviderKind` enum values are valid (grep the type) and whether a `purpose` field is
   required anywhere — `listProviders` filters `.where("purpose", "=", "assistant")` (`:299`), so
   confirm how `purpose` gets set on create (default vs required param) before finalizing.
3. **`CreateAiModelInput` field names differ** (`repository.ts:150`): `providerConfigId` (not
   `providerId`), `providerModelId` (not `modelKey`), `displayName`,
   `capabilities: readonly AiModelCapability[]`, `status?`, `tier?`, `allowUserOverride?`. Confirm
   real `AiModelCapability` enum values before using `"json"` (grep the type definition — not
   verified yet this session).
4. `setServiceBinding` signature at `repository.ts:721` looks like it matches the plan's draft
   call shape (`scopedDb, service, binding: AiServiceBinding, actorUserId`) but the
   `AiServiceBinding` type's `kind: "model" | "mode"` shape needs one more read to confirm the
   exact field names for the `"model"` variant (`modelId` + what else) before calling it.
5. Not yet checked: `createAiSecretCipher` export path/signature (plan says
   `@jarv1s/ai/crypto`, `encryptJson` method) — `packages/ai/src/crypto.js` is barrel-exported from
   `index.ts` (`export * from "./crypto.js"`), so `import { createAiSecretCipher } from "@jarv1s/ai"`
   should work (no separate `/crypto` subpath needed) — confirm the exact function name in
   `packages/ai/src/crypto.ts` before using it.

**Do not copy the plan's `ai.ts`/`ai.test.ts` code blocks verbatim** — use them only as a shape
guide; every identifier above must be re-verified against the real files first.

News/sports chunks (plan lines 444-578) are unstarted; both have their own flagged
placeholder fields (news pref field name; sports competition/team keys) — plan already says
where to grep, unchanged from original plan text.

## Next steps (in order)

1. Finish Task 4 research: confirm `AiProviderKind`/`AiModelCapability` enum values, `purpose`
   handling on `createProvider`, `AiServiceBinding` model-variant shape, `createAiSecretCipher`
   signature (all in `packages/ai/src/repository.ts` and `packages/ai/src/crypto.ts`).
2. Write `tests/uat/seed/chunks/ai.test.ts` (TDD — fails first), then `chunks/ai.ts` with corrected
   field names, get green.
3. Write news chunk test+impl (plan line ~444), confirm real `NewsPrefsRepository` create-input
   field name against `packages/news/src/repository.ts` first — plan's `value` field is a flagged
   guess.
4. Write sports chunk test+impl (plan line ~514), confirm real competition/team keys against
   `packages/sports/src` before finalizing — plan's `nfl-sf-49ers` etc. are flagged guesses.
5. Commit Task 4: `git add tests/uat/seed/chunks/ai.ts tests/uat/seed/chunks/ai.test.ts tests/uat/seed/chunks/news.ts tests/uat/seed/chunks/news.test.ts tests/uat/seed/chunks/sports.ts tests/uat/seed/chunks/sports.test.ts` (exact paths only).
6. Task 5 (plan line ~588): tasks/calendar/notes/job-search chunks. Notes chunk MUST use
   `withVaultContext` from `packages/vault/src/context.ts` (confirm exact export name/signature
   when you get there) — never raw `fs`, never a DB-proxy substitute. Job-search chunk's `throw`
   requires reading `packages/settings/src/repository-external-modules.ts` for the real
   `app.external_modules` row shape first.
7. Task 6 (line ~801): level composition + CLI entrypoint, incl. `JARVIS_UAT_SEED_CONFIRM` guard
   (already drafted in plan) and `multi-user` throw referencing #1030.
8. Task 7 (line ~979): wire into `tests/uat/provisioner.ts` seed hook (hook wiring only) + new
   `seed` one-shot service in `infra/docker-compose.prod.yml` (profile `ops`,
   `JARVIS_UAT_SEED_CONFIRM` `:?`-required guard — already drafted in plan).
9. Task 8 (line ~1087): `pnpm verify:foundation` green, pre-push trio + rebase, PR
   (`Part of #1000`, `Closes #1025`, base `main`), report PR number to Coordinator, **do not
   merge**.

## Verified environment notes (don't re-derive)

- Dev Postgres is `jarv1s-postgres` container, host port 55433 — matches `packages/db/src/urls.ts`
  defaults with no env overrides needed. Confirmed healthy and used for Task 3's live test.
- Run single test files with `npx vitest run <path>` (not `pnpm --filter @jarv1s/root exec
  vitest` — that filter matches no project in this worktree).

## Guardrails (unchanged)

No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format` — only
`prettier --write` files you authored. Don't edit `tests/uat/provisioner.ts` beyond the Task 7
hook wiring. No new migration. Full CLAUDE.md Hard Invariants apply (no BYPASSRLS on runtime
roles is the one most load-bearing here).

Read the plan **by section** for the task you're on — don't front-load the whole 1100-line file.
