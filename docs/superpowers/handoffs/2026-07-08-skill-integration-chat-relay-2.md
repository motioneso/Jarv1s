# Relay 2 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, do NOT
re-request approval).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator`, session id `58cd692d-ac30-4f76-9e47-a810041e358d` (resolve
pane fresh by label, never a baked `…-N`). Already notified of this relay.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status

Resume via `coordinated-build` step 2 (Build), Task 2. Plan/approval already done — skip those
steps. See prior relay doc `2026-07-08-skill-integration-chat-relay.md` for Task 1's research
(now superseded/done, kept for history).

## Done (committed)

- **Task 1 (migration + table): DONE, commit `1b521023`.** `packages/chat/sql/0147_chat_skills.sql`
  — `app.chat_skills` owner-only RLS (ENABLE+FORCE, 4 policies, GRANT to `jarvis_app_runtime`, no
  BYPASSRLS), modeled on `packages/wellness/sql/0082_wellness_checkins.sql`. Kysely types added in
  `packages/db/src/types.ts` (`ChatSkillsTable`, `ChatSkill`, `ChatSkillSource = "authored"|"uploaded"`,
  registered in the `JarvisDatabase` table map). Cross-user RLS test added to
  `tests/integration/multi-user-isolation.test.ts` (select/update/delete all blocked for non-owner).
  `foundation.test.ts` migration list extended with the 0147 row. **Full `pnpm test:integration`
  green (119/119 files, 1372 passed/2 skipped)** — confirmed AFTER the migration/types landed (ran
  it test-first too: failed for the right reason — missing table + list mismatch — before writing
  the migration). `pnpm typecheck` clean.

## In progress — Task 2 (repository + shared DTOs), NOT yet committed

No code written yet for Task 2 — only pattern research (below). Start here.

**Files:** `packages/chat/src/skills/repository.ts` (new), `packages/shared/src/*-api.ts`.

**Repository API to implement** (plan Task 2 Step 1/2 — TDD, test first):
```ts
export class ChatSkillsRepository {
  async create(scopedDb: DataContextDb, input: CreateSkillInput): Promise<ChatSkill>
  async list(scopedDb: DataContextDb): Promise<ChatSkill[]>       // ORDER BY enabled DESC, updated_at DESC
  async get(scopedDb: DataContextDb, id: string): Promise<ChatSkill | undefined>
  async update(scopedDb: DataContextDb, id: string, input: UpdateSkillInput): Promise<ChatSkill | undefined>
  async setEnabled(scopedDb: DataContextDb, id: string, enabled: boolean): Promise<ChatSkill | undefined>
  async delete(scopedDb: DataContextDb, id: string): Promise<boolean>
}
```
- `CreateSkillInput`: `{ name: string; description?: string | null; frontmatter?: Record<string, unknown>; body: string; source: "authored"|"uploaded" }`.
- `UpdateSkillInput`: partial `{ name?; description?; frontmatter?; body? }` (mirror
  `WellnessRepository.updateMedication`'s pattern of only setting provided fields + `updated_at: new Date()`).
- Every method: `assertDataContextDb(scopedDb)` first line (import from `@jarv1s/db`), matching
  `packages/wellness/src/repository.ts` exactly (read that file for the exact idiom — insert with
  `owner_user_id: sql<string>\`app.current_actor_user_id()\``, `.returningAll().executeTakeFirstOrThrow()`
  for create, `.where("id","=",id).returningAll().executeTakeFirst()` for update, boolean coercion
  `(result.numDeletedRows ?? 0n) > 0n` for delete).
- `list()` ordering must be deterministic for the bare-name-fallback resolution the spec requires:
  `.orderBy("enabled", "desc").orderBy("updated_at", "desc")`.
- Duplicate `name` values are explicitly ALLOWED (no unique constraint) — don't add one.
- `frontmatter` column is `jsonb NOT NULL DEFAULT '{}'::jsonb`, typed `JsonColumn` in
  `packages/db/src/types.ts` (already added). Check how another repo inserts into a `JsonColumn`
  (e.g. grep `model_metadata` or `tool_metadata` usage in `packages/chat/src/repository.ts`) for
  the exact serialization idiom (stringify vs pass-through) before writing `create`/`update`.

**Test file:** follow `tests/integration/wellness.test.ts` pattern — top-level `beforeAll` seeds two
users via raw bootstrap client (`userId`/`otherUserId` consts), `DataContextRunner` +
`dataContext.withDataContext(ctx(userId), (scopedDb) => repo.xxx(scopedDb, ...))`. Put the new test
in `tests/integration/` (chat tests live OUTSIDE `packages/chat/`, per repo convention) — suggest
`tests/integration/chat-skills.test.ts` (new file; the RLS-only cross-user test already lives in
`multi-user-isolation.test.ts` from Task 1, don't duplicate it, but DO add a repo-level
owner-scoping test here per plan Task 2 Step 1 — "owner scoping via DataContextDb" is listed
separately from the raw-SQL RLS test).

**Shared DTOs:** plan says `packages/shared/src/chat-api.ts` (411L, room) or a sibling `*-api.ts`.
Check current file size first (`wc -l packages/shared/src/chat-api.ts`) — if adding skill DTOs would
approach the 1000-line cap alongside other planned growth, prefer a sibling file
(e.g. `packages/shared/src/chat-skills-api.ts`). No `node:*` imports in `packages/shared` (Vite-bundled).

**After implementing:** `pnpm typecheck` + focused integration suite for the new test file, per
plan Task 2 Step 3. Commit explicit paths only (never `git add -A` — shared tree).

## Then continue to Task 3+ per the plan file

`docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` — Task 3 (routes + upload
import), Task 4 (settings pane), Task 5 (autocomplete + invocation), Task 6 (gateway boundary
regression tests), Task 7 (final verification). Read each task's Steps directly from the plan file
when you get there — don't re-derive.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Close out via `coordinated-wrap-up` — PR + report only, no merge/board (coordinator's job).
- Security tier: flag clearly in wrap-up report for Opus adversarial QA + Ben sign-off.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary —
  don't wait for a "natural" stopping point.
