# Relay — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (verified no drift vs
branch on 2026-07-08 — see coordinator escalation log; approved).
**Branch/worktree:** `760-skill-integration-chat`, this worktree. No commits yet — pure research.
**Coordinator:** label `Coordinator`, session id `58cd692d-ac30-4f76-9e47-a810041e358d` (resolve
pane fresh by label, never a baked `…-N`). Plan already approved — do NOT re-request approval.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge, per handoff.

## Status

Plan approved. Zero code written. Currently mid-research for **Task 1 (migration)**. Resume via
`coordinated-build` step 2 (Build) directly — skip plan/approval steps, they're done.

## Research findings so far (don't re-derive)

- **Migration number confirmed 0147** (checked twice, 2026-07-08): highest across all
  `packages/*/sql/*.sql` is `0146` (`packages/chat/sql/0146_private_chat_cleanup.sql`). Re-verify
  once more immediately before writing the file per plan Step 0 (other lanes may land).
- **foundation.test.ts** migration-list assertion: `tests/integration/foundation.test.ts` around
  line 94-320, uses `toEqual` on the full list, last row currently
  `{ version: "0146", name: "0146_private_chat_cleanup.sql" }` (line 319). Add the 0147 row here.
  Run full `pnpm test:integration`, not a focused suite — this suite fails latently otherwise.
- **RLS pattern to model chat_skills on:** `packages/wellness/sql/0082_wellness_checkins.sql` —
  clean owner-only CRUD RLS (ENABLE + FORCE ROW LEVEL SECURITY, 4 policies keyed on
  `owner_user_id = app.current_actor_user_id()`, explicit GRANT to `jarvis_app_runtime`). Use this
  as the template, not the more complex `packages/chat/sql/0014_chat_module.sql` (has
  share/workspace triggers chat_skills doesn't need — chat_skills is owner-only, no sharing).
- **updated_at trigger pattern (if wanted):** `packages/goals/sql/0123_long_running_goals.sql`
  lines ~41-53 — conditional trigger only firing `WHEN (...)` specific columns changed. Optional;
  wellness_checkins has no auto-updated_at trigger at all (updated_at set explicitly by
  repository). Prefer the simpler wellness_checkins style (repository sets updated_at) unless a
  test demands a DB-level trigger.
- **No existing skill code anywhere** — grepped `chat_skills|skill-autocomplete|SkillLibrary`
  repo-wide, zero hits. Spec/plan premises are still fully current, no drift.
- **Chat module tests live OUTSIDE `packages/chat/`** — all in top-level `tests/integration/` and
  `tests/unit/` with `chat-*.test.ts` / `*-chat-*.test.ts` naming (e.g.
  `tests/integration/chat-live-api.test.ts`, `tests/integration/multi-user-isolation.test.ts`).
  New skills tests should follow this convention, e.g. `tests/integration/chat-skills.test.ts` —
  do NOT put test files inside `packages/chat/`.
- **File sizes near the 1000-line cap** (check before editing, plan for splits):
  `packages/chat/src/routes.ts` 946L, `packages/chat/src/live/cli-chat-engine.ts` 982L,
  `apps/web/src/chat/chat-drawer.tsx` 973L. New skills routes go in a **new**
  `packages/chat/src/skills/routes.ts` file (per plan), not appended to `routes.ts`. Composer
  integration into `chat-drawer.tsx` (973L) must stay minimal — put the popover logic in the new
  `skill-autocomplete.tsx`, only wire a few lines into chat-drawer.tsx, or it'll bust the cap.
  `packages/chat/src/manifest.ts` is only 153L (room to extend). `packages/shared/src/chat-api.ts`
  411L (room for skill DTOs, or use a sibling `*-api.ts` file per plan).
- **`multi-user-isolation.test.ts`** exists already (`tests/integration/multi-user-isolation.test.ts`)
  — check it first, the cross-user RLS test for chat_skills may fit as an addition there instead of
  a new file, following its existing per-table pattern.

## Next concrete steps (Task 1, per the plan)

1. Re-confirm migration number is still 0147 (`ls packages/*/sql/*.sql | sort | tail`).
2. **Test first:** add RLS cross-user test (check `multi-user-isolation.test.ts` pattern first) +
   extend `foundation.test.ts`'s migration list with the 0147 row. Run `pnpm test:integration`,
   confirm it fails for the right reason (migration file / table doesn't exist yet).
3. Write `packages/chat/sql/0147_chat_skills.sql` modeled on `0082_wellness_checkins.sql`:
   `id uuid pk default gen_random_uuid()`, `owner_user_id uuid not null references app.users(id)
   on delete cascade`, `name text`, `description text`, `frontmatter jsonb`, `body text`,
   `enabled boolean not null default true`, `source text check in ('authored','uploaded')`,
   `created_at`/`updated_at timestamptz`. ENABLE + FORCE RLS, 4 owner-only policies, GRANT to
   `jarvis_app_runtime`. No BYPASSRLS anywhere.
4. Verify green, commit (explicit paths only, never `git add -A`).
5. Continue to Task 2 (repository + shared DTOs) per the plan file.

## Reminders (from handoff/CLAUDE.md, still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Close out via `coordinated-wrap-up` — PR + report only, no merge/board (coordinator's job).
- Security tier: flag clearly in wrap-up report for Opus adversarial QA + Ben sign-off.
