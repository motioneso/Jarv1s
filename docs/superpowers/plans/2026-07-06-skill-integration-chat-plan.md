# Skill Integration for Chat (#760) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Coordinated-build approval gate applies: do not start code until Coordinator approves this plan.

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md` (authoritative; storage
model Fable-reviewed 2026-07-05).

**Goal:** Personal skill library inside `packages/chat`: DB-canonical skill records (owner-only
RLS), in-app authoring/editing, file-upload import of standard frontmatter+markdown skill files,
per-skill enable toggle, `/` slash autocomplete in chat inputs (including evening interview), and
invocation that injects the skill body into that single turn.

**Architecture:** New `app.chat_skills` table owned by the chat module (SQL in
`packages/chat/sql/`), repository + routes behind `DataContextDb`, shared DTOs in
`packages/shared`, settings-pane library UI, composer autocomplete, body-injection at the existing
turn submit path. No persona-file rewrite (prompt-cache discipline). No skill runtime capabilities
beyond prompt injection.

**Tech Stack:** Kysely migration + repository, Fastify routes + manifest permissions, zod DTOs,
React settings pane + composer autocomplete.

## Settled decision (Ben, 2026-07-05) — nothing below is gated

**Watched-directory import is dropped from v1** — file upload covers the import requirement. There
is no watched-directory task in this plan, the migration's `source` check constraint is
`('authored','uploaded')` only, and no code path may promote a file on disk to a skill record. Any
future watched-directory feature is new scope requiring its own spec and threat model.

## File Map

| File                                                           | Change                                               |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/chat/sql/<NNNN>_chat_skills.sql`                     | New migration: table + RLS (owner-only) + FORCE RLS  |
| `packages/chat/src/skills/repository.ts` (new)                 | CRUD + toggle, `DataContextDb` only                  |
| `packages/chat/src/skills/routes.ts` (new)                     | REST CRUD + upload-import endpoint                   |
| `packages/chat/src/skills/frontmatter.ts` (new)                | Parse/serialize standard frontmatter + markdown body |
| `packages/chat/src/manifest.ts`                                | Register routes/permissions                          |
| `packages/shared/src/chat-api.ts` (or sibling `*-api.ts`)      | Skill DTO schemas                                    |
| `apps/web/src/settings/settings-skills-pane.tsx` (new)         | Library UI: list/create/edit/toggle/import           |
| `apps/web/src/settings/settings-navigation.ts`                 | Add pane entry                                       |
| `apps/web/src/chat/skill-autocomplete.tsx` (new)               | `/` autocomplete popover                             |
| `apps/web/src/chat/chat-drawer.tsx`                            | Composer integration + injection on send             |
| `apps/web/src/today/evening-mode.tsx`                          | Same autocomplete on the interview input             |
| `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts` | Client fns + `skills` query keys                     |
| tests (integration + web)                                      | Per acceptance criteria                              |

## Decisions (from spec — do not relitigate)

- DB-canonical storage; skills are chat-module-owned, owner-only RLS. No URL import. No
  marketplace/sharing.
- Skill shape: standard Claude Code-style frontmatter + markdown body. No bespoke format. Duplicate
  names allowed; autocomplete selects a concrete record id; typed bare-name fallback resolves
  deterministically (enabled first, then source, then updated time).
- Skill body = trusted instruction content. No sanitizer, no quarantine framing, no skill-specific
  approval mode. Safety boundary stays the existing `AssistantToolGateway` risk-tier/confirm path.
- Invocation mechanism (pinned in spec): inject the body into that single turn's submitted text.
  Never rewrite the persona file. Body flows into stored `chat_messages`/extract-facts like user
  text — accepted.
- Disabled skills never appear in autocomplete and never affect a turn.

## Task 1 — Migration + table

**Files:** `packages/chat/sql/<NNNN>_chat_skills.sql`, `tests/integration/foundation.test.ts`.

- [ ] **Step 0:** Determine the next migration number at build time — numbers are **global by
      landing order** across all module `sql/` dirs (`ls packages/*/sql/*.sql | sort | tail`; ≥0145
      as of plan writing). Never edit an applied migration.
- [ ] **Step 1 (test first):** Extend `foundation.test.ts`'s FULL migration-list assertion with the
      new row (it uses `toEqual` — miss it and the suite fails latently; run the full
      `pnpm test:integration`, not just the module suite). Add an RLS test: user B cannot select,
      update, toggle, or delete user A's skill rows.
- [ ] **Step 2:** Migration: `app.chat_skills` (id uuid pk, owner_user_id, name, description,
      frontmatter jsonb (or text), body text, enabled boolean not null default true, source text
      check in ('authored','uploaded'), created_at/updated_at). ENABLE + FORCE RLS, owner-only policies for `app_runtime`, no
      BYPASSRLS anywhere. Enabled state is a column on the record (simplest shape consistent with
      the spec's implementation-detail #1; a #735-style pref row is only needed if sharing ever
      arrives).
- [ ] **Step 3:** Verify: `pnpm test:integration` (full — foundation asserts the whole list).

## Task 2 — Repository + shared DTOs

**Files:** `packages/chat/src/skills/repository.ts`, `packages/shared/src/*-api.ts`.

- [ ] **Step 1 (test first):** Integration tests: create/list/get/update/delete/toggle, owner
      scoping via `DataContextDb`, duplicate names allowed, deterministic list ordering (enabled
      first, then updated_at desc) for the bare-name fallback.
- [ ] **Step 2:** Implement repository (accepts only the branded `DataContextDb`). DTO schemas in
      `packages/shared` — no `node:*` imports there (Vite-bundled).
- [ ] **Step 3:** Verify: typecheck + focused integration suite.

## Task 3 — Routes + upload import

**Files:** `packages/chat/src/skills/routes.ts`, `packages/chat/src/skills/frontmatter.ts`,
`packages/chat/src/manifest.ts`.

- [ ] **Step 1 (test first):** Route tests: CRUD + toggle round-trip; upload import of a valid
      standard skill file creates a record with `source: 'uploaded'` and preserves frontmatter +
      body byte content; malformed frontmatter → 4xx with a clear error, no partial row; oversized
      body rejected with an explicit cap (pick a generous cap, e.g. 256 KB, and state it in the
      error). Import performs no body sanitization or rewriting (assert byte-identical body).
- [ ] **Step 2:** Frontmatter parser: no existing frontmatter dep in the repo — implement a minimal
      `---` block parser (split + YAML-subset key/value) in `frontmatter.ts`, or add `gray-matter`
      if nested YAML is genuinely needed; prefer the minimal parser first.
- [ ] **Step 3:** Register routes + permissions in the manifest (follow existing chat route
      permission ids).
- [ ] **Step 4:** Verify: `pnpm test:integration -- <skills routes test>` + typecheck.

## Task 4 — Settings library pane

**Files:** `apps/web/src/settings/settings-skills-pane.tsx`, `settings-navigation.ts`,
`api/client.ts`, `api/query-keys.ts`.

- [ ] **Step 1 (test first):** Pane tests: list renders; create/edit form preserves
      frontmatter+body shape; toggle updates optimistically; upload flow surfaces parse errors;
      delete confirms (mutation in event handler, never in a state updater — StrictMode
      double-fire trap).
- [ ] **Step 2:** Implement with existing authored patterns (`jds-*`, existing empty/loading
      states). Keep files under the 1000-line gate — split form/list components if needed.
- [ ] **Step 3:** Verify: web tests + `pnpm check:file-size` + typecheck.

## Task 5 — Slash autocomplete + invocation

**Files:** `apps/web/src/chat/skill-autocomplete.tsx`, `chat-drawer.tsx`,
`apps/web/src/today/evening-mode.tsx`.

- [ ] **Step 1 (test first):** Tests: typing `/` at input start opens filtered autocomplete of
      **enabled** skills only; selection binds a concrete record id; disabled skills never listed;
      bare-name text fallback resolves by the deterministic ordering; escape/no-match degrades to
      plain text (a literal `/` message must still be sendable).
- [ ] **Step 2:** Implement the autocomplete popover; integrate into the chat composer and the
      evening interview input (shared component, two mount points).
- [ ] **Step 3:** Invocation: on send with a bound skill, prepend the skill body to the submitted
      turn text (client-side composition through the existing send path — no new turn parameter, no
      `packages/chat` route changes for invocation). The user's typed text follows the body.
- [ ] **Step 4:** Verify: web tests + typecheck.

## Task 6 — Gateway boundary regression tests

**Files:** integration tests only (no gateway code changes expected).

- [ ] **Step 1:** Test per acceptance: a skill whose body instructs a write/destructive-risk tool
      call still produces a pending action-request row for a confirm-gated user — never silent
      execution. (Memory trap: `action_requests` INSERT policy — check the recalled test setup.)
- [ ] **Step 2:** Test: yolo-mode user → skill-triggered tool call executes exactly like an
      ordinary chat-triggered call (inherited posture, no special path).
- [ ] **Step 3:** Test: persona file bytes identical before/after a skill invocation
      (prompt-cache discipline).

## Task 7 — Final slice verification

- [ ] Acceptance sweep against the spec's criteria list, including: no watched-directory import
      path exists — file upload is the only file import path.
- [ ] `pnpm verify:foundation` (real exit code) + full `pnpm test:integration` (foundation
      migration list).
- [ ] Commit in small slices with **explicit paths only — never `git add -A`** (shared tree).

## Self-Review

- [ ] Any path where a non-deliberate act (file drop, sync) promotes content to instructions? (Must
      be no — watched-directory import was dropped from v1.)
- [ ] Does invocation touch the persona file? (Must be no.)
- [ ] Are skill bodies excluded from any pg-boss payload? (Metadata-only invariant.)
- [ ] Does any module other than chat read `app.chat_skills`? (Module isolation — must be no.)
