# Relay 3 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, do NOT
re-request approval).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve pane fresh by label via `herdr pane list`, never a
baked `…-N`). Notify it of this relay.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status

Resume via `coordinated-build` step 2 (Build), **Task 3** (routes + upload import). Plan/approval
already done — skip planning steps. Read Task 3's Steps directly from the plan file.

## Done (NOT yet committed — commit these files first, explicit paths only)

**Task 2 (repository + shared DTOs) implemented, tests green, typecheck clean — needs a commit.**

- `packages/chat/src/skills/repository.ts` (new) — `ChatSkillsRepository`: create/list/get/update/
  setEnabled/delete, all `assertDataContextDb` first line, modeled on
  `packages/wellness/src/repository.ts`. `list()` orders `.orderBy("enabled","desc").orderBy("updated_at","desc")`.
- `packages/chat/src/index.ts` — added `export * from "./skills/repository.js";`
- `packages/shared/src/chat-skills-api.ts` (new, sibling to `chat-api.ts` per plan's size-guard
  note) — `ChatSkillDto`, `CreateChatSkillRequest`, `UpdateChatSkillRequest`,
  `SetChatSkillEnabledRequest`, `ListChatSkillsResponse`, `ChatSkillResponse`, plus full Fastify
  JSON-schema route-schema consts (`createChatSkillRouteSchema`, `listChatSkillsRouteSchema`,
  `getChatSkillRouteSchema`, `updateChatSkillRouteSchema`, `setChatSkillEnabledRouteSchema`,
  `deleteChatSkillRouteSchema`) — Task 3's routes.ts can import these directly, no need to design
  new ones. Mirrors `chat-settings-api.ts` pattern exactly (plain JSON schema, not zod — this repo's
  actual convention despite the plan's "zod DTOs" tech-stack line; followed the code, not the plan
  prose).
- `packages/shared/src/index.ts` — added `export * from "./chat-skills-api.js";`
- `tests/integration/chat-skills.test.ts` (new) — 10 tests: create (+frontmatter default `{}`),
  duplicate names allowed, list owner-scoping + enabled-first/updated_at-desc ordering, update
  (partial-field + bumps updated_at), update-missing-id→undefined, setEnabled toggle,
  delete+delete-missing→false, DataContextDb-guard throw.
  **Trap hit + fixed:** the ordering test originally created 3 rows inside ONE `withDataContext`
  call → same transaction → `now()` ties → `updated_at` order was non-deterministic (test flaked
  red). Fixed by giving each create/setEnabled its own `withDataContext` call (own transaction) so
  timestamps actually differ. If you touch this test again, keep that pattern — don't collapse
  multi-row setup back into one transaction when asserting timestamp ordering.

**Verification run (this relay, uncommitted):** `pnpm typecheck` clean (repo + web). Focused
`pnpm test:integration tests/integration/chat-skills.test.ts` was mid-run (background task
`bx21cfl0u`) when this relay was written — **check that task's output first** (or just re-run the
command) before assuming green; it was passing after the ordering-test fix in the last observed
partial output but the run hadn't finished. If red for an unrelated reason, investigate before
building on top.

## Next steps for you

1. **Confirm the focused test is green**, then run the full `pnpm test:integration` (foundation
   asserts the whole migration list — already extended in Task 1, shouldn't need changes, but
   Task 2 added no migrations so this is just the standard full-suite check) before committing.
2. **Commit Task 2** — explicit paths only, never `git add -A`:
   `git add packages/chat/src/skills/repository.ts packages/chat/src/index.ts packages/shared/src/chat-skills-api.ts packages/shared/src/index.ts tests/integration/chat-skills.test.ts`
3. **Proceed to Task 3** (routes + upload import) per
   `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` — Files:
   `packages/chat/src/skills/routes.ts` (new), `packages/chat/src/skills/frontmatter.ts` (new),
   `packages/chat/src/manifest.ts`. Read Task 3's 4 steps directly from the plan; route schemas are
   already built in `chat-skills-api.ts` (see above) — import, don't redesign.
4. Then Task 4 (settings pane), Task 5 (autocomplete + invocation), Task 6 (gateway boundary
   regression tests), Task 7 (final verification) — read each from the plan when you get there.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
  `git fetch origin main && git rebase origin/main`.
- Close out via `coordinated-wrap-up` — PR + report only, no merge/board (coordinator's job).
- Security tier: flag clearly in wrap-up report for Opus adversarial QA + Ben sign-off.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary —
  don't wait for a "natural" stopping point.
