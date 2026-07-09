# Relay 7 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, don't
re-request).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve fresh via `herdr pane list`). Already notified of
this relay.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status: Task 3 pushed (`2971c3a4`), Task 4 research done, zero Task 4 code written

Branch is rebased on `origin/main` and pushed clean — pre-push trio (format/lint/typecheck) was
green. HEAD is `f56a0f9b`. Do not re-run Task 1–3 work.

## Task 4 — Settings library pane (start here)

Plan doc's file-map says `settings-navigation.ts` — that's WRONG, it's just a tiny
`coerceSettingsSectionId()` helper. The real pane-registration point is
`apps/web/src/settings/settings-page.tsx`'s `PERSONAL_SECTIONS` const array (add a `"skills"`
entry to the `PersonalSectionId` union + array, `lazyPane()`-wrapped, `lucide-react` icon).

Patterns to follow (already read, don't re-derive):
- **CRUD pane reference:** `apps/web/src/settings/settings-people-pane.tsx` — list/create/edit/
  archive-delete via `useQuery`/`useMutation`/`useQueryClient`, `Group`/`Row`/`Badge`/`Note`/
  `PaneHead`/`Switch` from `@jarv1s/settings-ui` (re-exported via
  `apps/web/src/settings/settings-ui.tsx`).
- **Delete-with-confirm pattern:** `apps/web/src/settings/settings-web-search-key-group.tsx` —
  `useFeedback().confirm({title, description, confirmLabel, danger, onConfirm})` called directly
  in the `onClick` handler. The provider (`settings-feedback.tsx`) already fires `onConfirm`
  outside the `setState` updater — StrictMode-safe, don't touch it, just call `confirm()` the same
  way.
- **File upload UI:** `apps/web/src/settings/settings-google-connect.tsx` (~line 200) — label-
  wrapped `<input type="file">`, icon/title/subtitle, `accept` attr, `onChange`.
- **`PaneProps`/`readError`:** `apps/web/src/settings/settings-types.ts`.
- **Test convention:** `tests/unit/settings-people-pane.test.tsx` — SSR `renderToString` +
  `QueryClientProvider`+`FeedbackProvider` wrap, seed via `client.setQueryData(queryKeys...)`,
  assert `expect(html).toContain(...)` incl. HTML-entity-escaped text / raw attrs like
  `checked=""`. Write the new test FIRST (TDD): `tests/unit/settings-skills-pane.test.tsx`.

Backend DTOs/routes already exist (`packages/shared/src/chat-skills-api.ts`,
`packages/chat/src/skills/routes.ts` — 7 endpoints: list/get/create/update/enable-toggle/delete/
import). New frontend work only:
- `apps/web/src/api/client.ts` — add `listChatSkills()`, `getChatSkill(id)`, `createChatSkill(body)`,
  `updateChatSkill(id, body)`, `setChatSkillEnabled(id, enabled)`, `deleteChatSkill(id)` via the
  existing `requestJson<T>` helper (~line 1035); add `importChatSkill(file: File)` via raw `fetch`
  like `transcribeAudio()` (~line 824) since it's a file body, not JSON.
- `apps/web/src/api/query-keys.ts` — add a `skills` key under the existing `chat: {...}` namespace.
- `apps/web/src/settings/settings-skills-pane.tsx` — new pane (list/create/edit/toggle/import/
  delete). Note repo semantics: `update()` only touches `frontmatter` column if the input includes
  it — the simple edit form can omit raw frontmatter entirely and existing frontmatter survives
  untouched.
- Wire into `settings-page.tsx` per above.

Verify: `pnpm test:unit` (or targeted vitest run), `pnpm check:file-size`, `pnpm typecheck`.

## Then, read fresh from the plan doc (don't rely on memory)

- **Task 5** — slash autocomplete + invocation (`apps/web/src/chat/skill-autocomplete.tsx`,
  wire into `chat-drawer.tsx` + `apps/web/src/today/evening-mode.tsx`). Client-side only: bind a
  skill record id, prepend skill body to submitted turn text, no `packages/chat` route changes.
- **Task 6** — gateway boundary regression tests only (no gateway code changes expected): confirm-
  gated skill-triggered tool call still creates a pending `action_requests` row (check the INSERT
  policy — known trap); yolo-mode skill-triggered call executes like ordinary chat; persona file
  bytes identical before/after skill invocation (prompt-cache discipline).
- **Task 7** — final acceptance sweep vs spec, `pnpm verify:foundation` (real exit code) + full
  `pnpm test:integration`, self-review checklist in the plan doc (no non-deliberate
  file→instruction promotion, invocation never touches persona file, skill bodies excluded from
  pg-boss payloads, no module other than chat reads `app.chat_skills`).

## Close out

`coordinated-wrap-up` when Exit Criteria are met — PR + report to Coordinator only, never merge/
board. Flag `security` tier for Opus adversarial QA + Ben sign-off.

## Reminders (still binding)

- Never `git add -A`; explicit paths only (shared tree).
- Never touch `docs/coordination/`.
- Pre-push trio (`format:check && lint && typecheck` + fetch/rebase origin/main) before every push.
- Relay again immediately on the next context-meter 70% warning or a seen compaction summary.
- The `Build-760d` Herdr pane label is THIS session (session id `fe81c34d-...`) — not a second
  concurrent agent. No collision. Don't re-investigate.
