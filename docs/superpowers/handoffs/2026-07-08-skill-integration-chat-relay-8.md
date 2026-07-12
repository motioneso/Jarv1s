# Relay 8 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, don't
re-request).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve fresh via `herdr pane list`). Already notified of
this relay (session id `7dbdd81d-fe53-43ba-aac2-1a9bb989efc1` as of relay-8 — re-resolve, don't
trust this value).
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status: Task 4 half-done, HEAD `81696e10`

Do not re-run Task 1–3 work (pushed at `f56a0f9b`/`2971c3a4`). Task 4 client plumbing + TDD test
committed locally this relay at `81696e10` — **not yet pushed** (still needs the pane impl +
wiring + full verify before the pre-push trio).

Committed in `81696e10`:
- `apps/web/src/api/client.ts` — `listChatSkills`, `getChatSkill`, `createChatSkill`,
  `updateChatSkill`, `setChatSkillEnabled`, `deleteChatSkill` via `requestJson<T>`; `importChatSkill(file: File)`
  via raw `fetch` (mirrors `transcribeAudio()`) — POSTs `await file.text()` with
  `content-type: text/markdown` to `/api/chat/skills/import` (backend expects a raw text body, not
  multipart — confirmed by reading `packages/chat/src/skills/routes.ts`).
- `apps/web/src/api/query-keys.ts` — added `skills: ["chat", "skills"] as const` under `chat: {...}`.
- `tests/unit/settings-skills-pane.test.tsx` — new TDD-red test file. Imports
  `SettingsSkillsPane` from `../../apps/web/src/settings/settings-skills-pane.js`, which **does not
  exist yet** — this is intentional (TDD). Asserts (read the file for exact wording before writing
  the component, don't guess):
  - heading "Skills"
  - empty state "No skills yet"
  - a skill row shows name + description text
  - enabled skill: "Enabled" badge text + `checked=""` present in HTML
  - disabled skill: "Disabled" badge text + `checked=""` absent
  - create form has "Skill name" field, "Body" field, "Create skill" button
  - upload control has text "Upload a skill file" and a `type="file"` input
  - two skills with the same `name` both render (duplicate names allowed, separate rows)

## Task 4 remaining steps (do these next, in order)

1. **Write `apps/web/src/settings/settings-skills-pane.tsx`** to satisfy the test above. Patterns
   already researched — don't re-derive:
   - **CRUD pane reference:** `apps/web/src/settings/settings-people-pane.tsx` — list/create/edit/
     delete via `useQuery`/`useMutation`/`useQueryClient`, `Group`/`Row`/`Badge`/`Note`/`PaneHead`/
     `Switch` from `@jarv1s/settings-ui` (re-exported via `apps/web/src/settings/settings-ui.tsx`).
   - **Delete-with-confirm pattern (StrictMode-safe):** `apps/web/src/settings/settings-web-search-key-group.tsx`
     — call `useFeedback().confirm({title, description, confirmLabel, danger, onConfirm})` directly
     in the `onClick` handler, never inside a `setState` updater.
   - **File upload UI:** `apps/web/src/settings/settings-google-connect.tsx` (~line 200) —
     label-wrapped `<input type="file">`. Client-side file read: `apps/web/src/connectors/google-credentials.ts`
     uses `file.text()` — same pattern feeds `importChatSkill(file)`.
   - **Textarea-in-Field pattern:** `apps/web/src/settings/settings-ai-pane.tsx` (lines ~120-190),
     `jds-textarea` class, for the "Body" create-form field.
   - **`PaneProps`/`readError`:** `apps/web/src/settings/settings-types.ts`.
   - **Repo update semantics:** `packages/chat/src/skills/repository.ts` — `update()` only touches
     the `frontmatter` column if the input includes it; the simple edit form can omit raw
     frontmatter entirely and existing frontmatter survives untouched.
   - No `jds-file-upload` class exists yet in the codebase (only an ad hoc `onb-json-upload` class
     in onboarding files) — use a plain `<label>` wrapping `<input type="file">` with minimal/no
     dedicated styling, don't invent a new shared class for this.
2. **Wire into `apps/web/src/settings/settings-page.tsx`** (confirmed correct file — the plan doc's
   `settings-navigation.ts` reference is wrong, that file only holds `coerceSettingsSectionId()`):
   - Add `"skills"` to the `PersonalSectionId` union.
   - Add a `lazyPane()`-wrapped import: `const SkillsPane = lazyPane(() => import("./settings-skills-pane").then((module) => ({ default: module.SettingsSkillsPane })));`
   - Add a `lucide-react` icon import.
   - Add an entry to `PERSONAL_SECTIONS`: `{ id: "skills", icon: <IconName />, label: "Skills", Pane: SkillsPane }`.
3. **Verify:** targeted `pnpm test:unit` run (or full), `pnpm check:file-size`, `pnpm typecheck`.
   Fix red before moving on.
4. **Commit** with explicit paths only (never `git add -A`; `.claude/context-meter.log` is expected
   to show modified — leave it unstaged, it's not part of this deliverable).
5. **Pre-push trio + rebase** before pushing: `pnpm format:check && pnpm lint && pnpm typecheck`,
   then `git fetch origin main && git rebase origin/main`. Push only after both are clean.

## Then, read fresh from the plan doc (don't rely on memory)

- **Task 5** — slash autocomplete + invocation (`apps/web/src/chat/skill-autocomplete.tsx`, wire
  into `chat-drawer.tsx` + `apps/web/src/today/evening-mode.tsx`). Client-side only: bind a skill
  record id, prepend skill body to submitted turn text, no `packages/chat` route changes.
- **Task 6** — gateway boundary regression tests only (no gateway code changes expected): confirm-
  gated skill-triggered tool call still creates a pending `action_requests` row (check the INSERT
  policy — known trap, see project memory `test-traps`); yolo-mode skill-triggered call executes
  like ordinary chat; persona file bytes identical before/after skill invocation (prompt-cache
  discipline).
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
- Identify Herdr panes by **label + `agent_session.value`**, never a bare `w…-N` pane id from a
  doc — pane numbers reflow. Re-resolve via `herdr pane list` at read time.
- This relay's predecessor session correctly identified itself as `Build-760e` (pane `w1:pBD`,
  session `ea9b4fbc-6574-484f-b043-b8c96ac3f89a`) — the earlier relay-7 doc's mention of a
  `Build-760d` label was about this same lineage, not a second concurrent agent. No collision.
