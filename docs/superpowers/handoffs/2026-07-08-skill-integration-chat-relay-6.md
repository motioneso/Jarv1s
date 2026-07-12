# Relay 6 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, don't
re-request).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve fresh via `herdr pane list`). Notify of this relay.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status: Task 3 DONE and committed (`f0f649e4`)

Routes + upload import for chat skills are complete: 7 endpoints (list/get/create/update/
enable-toggle/delete/import), full integration test coverage green, format/lint/typecheck all
clean. Commit `f0f649e4` on this branch, NOT pushed yet.

The blocking bug from prior relays (frontmatter silently serialized to `{}` on every response) is
**fixed and resolved** — root cause was `packages/shared/src/chat-skills-api.ts`'s
`chatSkillSchema.frontmatter` missing `additionalProperties: true`, which made fast-json-stringify
drop all keys on serialize. Also fixed a pre-existing unused-var lint bug in
`tests/integration/chat-skills.test.ts` left over from Task 2. Both fixes are in `f0f649e4`. Do
NOT re-investigate this — it's done. (Prior relay-5 doc describing this as unresolved has been
deleted; disregard anything in earlier session history that references JSONB/AJV hypotheses.)

## Next steps

1. Pre-push trio (not yet run this exact commit, do it before pushing):
   ```
   pnpm format:check && pnpm lint && pnpm typecheck
   git fetch origin main && git rebase origin/main
   ```
2. Push branch.
3. Proceed to **Task 4** (settings pane), **Task 5** (autocomplete + invocation), **Task 6**
   (gateway boundary regression tests), **Task 7** (final verification) — read each fresh from the
   plan doc above, don't rely on memory of what they contain.
4. Close out via **`coordinated-wrap-up`** when the spec's Exit Criteria are met — PR + report to
   coordinator only, never merge/board directly. Flag `security` tier clearly for Opus adversarial
   QA + Ben sign-off.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio before every push.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
