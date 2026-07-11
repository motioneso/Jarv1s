# #916 host-starter-action — relay #3 continuation

**Plan (approved, follow exactly, do NOT re-plan):**
docs/superpowers/plans/2026-07-10-916-host-starter-action.md
**Original handoff:** docs/coordination/2026-07-10-916-host-starter-action-handoff.md
(untracked — coordinator-only, do NOT commit)
**Worktree/branch:** this worktree, `feat/916-host-starter-action`
**Coordinator label:** `Coordinator` — resolve fresh by `herdr pane list`, session id
`58a78927-385c-4b1d-8fa0-94db20255d6f` is authority. Relay heads-up already sent.
**Risk tier:** `security` — Opus adversarial QA + panel sign-off at wrap-up.

## Done (this session, relay #3)

- Task 1 committed `8d398688`: `apps/web/src/external-modules/host-actions.ts` +
  `tests/unit/external-host-actions.test.ts` — 12/12 unit tests green.
- Task 2 committed `f5aa8a27`: `apps/web/src/external-modules/loader.ts` —
  `ExternalWebContributionProps`, `Root`/`Missing`/`loadExternalModuleContribution` all
  retyped to carry `hostActions`.
- **Known transient typecheck failure (EXPECTED, not a bug):** `pnpm --filter @jarv1s/web
  typecheck` now fails at `app.tsx:276` — the existing external-route consumer renders
  `<Component />` with no `hostActions` prop. This is the same transient-failure pattern
  the plan documents for Tasks 3-5 (Self-Review "Task ordering note"); it just surfaced one
  task early because app.tsx already had a bare consumer. **Task 4 fixes this** by wrapping
  the route in `ExternalModuleMount`. Do not "fix" it early or deviate from the plan — follow
  Tasks 3→4→5 in order and it resolves itself, same as the plan's documented sequence.

## Next (resume at Task 3)

Read the plan **by section, not in full** — Task 3 is `## Task 3:` through `## Task 7:`.

1. **Task 3** — `apps/web/src/shell/chat-controls-context.ts`: add `openAssistantWithDraft` to
   `ChatControls`. Commit (typecheck will still fail — expected, closed by Task 5).
2. **Task 4** — `apps/web/src/app.tsx`: add `ExternalModuleMount` wrapper, use in external
   routes. This is what resolves the transient app.tsx failure noted above.
3. **Task 5** — `apps/web/src/shell/app-shell.tsx`: `moduleDraft` state + callback, wire into
   `ChatControlsProvider` + `ChatDrawer`. Typecheck should go fully green here.
4. **Task 6** — `apps/web/src/chat/composer.tsx` focus-on-seed effect + `tests/e2e/mock-modules.ts`
   `mockExternalWebModule` helper + `tests/e2e/external-modules.spec.ts` new e2e test. Read
   `tests/e2e/mock-api.ts` first per the plan's own instruction (confirm route globs/shapes
   before mirroring).
5. **Task 7** — full gate (typecheck/lint/format/unit/e2e), spec-verification checklist,
   pre-push trio (`format:check && lint && typecheck`) + `git fetch origin main && git rebase
   origin/main`, then **`coordinated-wrap-up`** (PR + report to coordinator — do NOT merge/
   board/close directly).

## Key facts (don't re-derive)

- Module tests live in top-level `tests/` (NOT `apps/web/src`).
- 3 security guardrails already implemented in Task 1, keep them intact through remaining
  tasks: (1) moduleId host-bound via closure only, (2) fail-closed = silent no-op, never
  throw/auto-submit, cap=1000 no truncation, (3) e2e must assert zero `/api/chat/turn` POST.
- `git add` explicit paths only. Never `git add -A`. Never commit
  `docs/coordination/2026-07-10-916-host-starter-action-handoff.md`.
- Run the pre-push trio before every push, not just at the end.

## Handoff-doc note

Two prior relays (relay, relay-2) apparently spent their sessions only writing handoff docs
with zero code committed (per coordinator memory: "lanes that spent hours emitting only
handoff docs, no code"). This relay #3 broke that pattern — 2 tasks built and committed
before relaying. **Successor: do the same — build first, relay only after real progress.**
