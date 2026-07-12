# Relay 4 — skill-integration-chat (#760)

**Spec:** `docs/superpowers/specs/2026-07-05-skill-integration-chat.md`
**Plan:** `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` (approved, do NOT
re-request approval).
**Branch/worktree:** `760-skill-integration-chat`, this worktree.
**Coordinator:** label `Coordinator` (resolve pane fresh by label via `herdr pane list`, never a
baked `…-N`). Notify it of this relay.
**Tier:** `security` — Opus adversarial QA + Ben merge sign-off required before merge.

## Status

Task 2 (repository + shared DTOs) is **committed**: `62b0077e`. Full `pnpm test:integration` is
green (120 files, 1382 passed / 2 skipped).

Resume at **Task 3 (routes + upload import)**. No Task 3 files written yet — this relay is pure
research handoff; nothing to commit before you start. Read Task 3's 4 steps directly from the plan
file (routes.ts, frontmatter.ts, manifest.ts).

## Research already done for Task 3 (don't re-derive)

- **Route pattern to copy:** `packages/chat/src/routes.ts` — see `getChatSettingsRouteSchema` /
  `putChatSettingsRouteSchema` usage (~line 368) for the `server.get/put(path, {schema}, handler)`
  shape: `resolveAccessContext` → `dataContext.withDataContext` → repo call → `handleRouteError`
  catch. `registerChatRoutes` is exported and called from
  `packages/module-registry/src/index.ts:1012` — **don't need to touch that call site**; just add
  an optional `skillsRepository` field to `ChatRoutesDependencies` and call a new
  `registerChatSkillsRoutes(server, {...})` from inside `registerChatRoutes` (same pattern as how
  `registerMcpTransportRoute`/`registerChatLiveRoutes` are called inline).
- **routes.ts is already 946 lines** (near the 1000-line file-size gate) — this is exactly why the
  plan wants a new sibling file `packages/chat/src/skills/routes.ts`, not growth of routes.ts.
- **Error handling:** import `HttpError, handleRouteError` from `@jarv1s/module-sdk` (confirmed
  exported from its barrel). Throw `new HttpError(400, "message")` for malformed
  frontmatter/oversized body; the shared `handleRouteError(error, reply, { invalidRequestMessage })`
  wrapper handles the rest (401 on auth-message errors, 500 scrubbed otherwise). Pattern to copy
  almost verbatim: `packages/ai/src/transcription-routes.ts` (raw-body upload via
  `server.addContentTypeParser(...)`, explicit byte cap via route-level `bodyLimit`, `HttpError`
  throws, local `handleRouteError` wrapper calling the shared one with an
  `invalidRequestMessage`).
- **Upload transport decision:** follow `transcription-routes.ts` exactly — register a
  `server.addContentTypeParser` for the skill-file content type (e.g. `text/markdown` or
  `text/plain`, `parseAs: "string"`) rather than adding `@fastify/multipart` as a new dependency.
  Single blob upload, no other form fields needed. Cap at 256 KB via route `bodyLimit` (plan's
  suggested cap).
- **Permission ids:** reuse the existing manifest ids `chat.view` (GET routes) and `chat.message`
  (POST/PATCH/DELETE routes) — same precedent as `/api/chat/memory/facts` in
  `packages/chat/src/manifest.ts`. No new permission ids needed.
- **⚠️ Route-coverage boot assertion (easy to miss, will hard-fail server boot/tests):**
  `packages/module-registry/src/route-guard.ts` → `assertRouteCoverage` throws at boot if ANY
  registered Fastify route (method+pattern) has no matching `chatModuleManifest.routes[]` entry,
  **and** throws if a manifest route entry has no matching registered route (drift both ways). Every
  new route added in `skills/routes.ts` MUST get an exact-matching entry added to
  `packages/chat/src/manifest.ts`'s `routes: [...]` array (method + exact path incl. `:id` params),
  or every integration test that boots the full API server (via `createApiServer`) will fail at
  `server.ready()`, not just the new test file.
- **Test harness for route tests:** use the full-server pattern from
  `tests/integration/chat-settings.test.ts` — `createApiServer({ appDb, logger: false })`,
  `server.ready()`, sign up via `POST /api/auth/sign-up/email`, capture the `set-cookie` header
  (helper `cookieHeader` in that file), then `server.inject({ method, url, headers: { cookie },
  payload })`. Put the new test at `tests/integration/chat-skills-routes.test.ts` (sibling to the
  Task 2 repository test `tests/integration/chat-skills.test.ts` — keep them separate; the
  repository test exercises `ChatSkillsRepository` directly, the routes test exercises HTTP).
- **Frontmatter format decided:** minimal parser (per plan preference — no new dep unless nested
  YAML is genuinely needed). Standard shape:
  ```
  ---
  name: Foo
  description: Bar
  ---
  Body markdown text here.
  ```
  Split on `\r?\n`, require line 0 to be exactly `---`, find the next `---` line as the closing
  delimiter (`HttpError(400, ...)` if either delimiter is missing), parse the lines between as
  `key: value` pairs (skip blank lines; a non-blank line with no `:` is a parse error → `HttpError
  400`), and reconstruct the body as `lines.slice(closingIndex + 1).join("\n")` — **do NOT trim or
  strip leading/trailing content from the body** (the plan's byte-identical-body acceptance test
  will construct a raw string and expect the parsed body to match exactly what follows the closing
  delimiter line, no rewriting). `name` is required in the parsed frontmatter (used as the skill's
  `name` column on import) — missing `name` is a 400, not a silent default.
- **Endpoint list to implement** (all under `/api/chat/skills`, all owner-scoped through
  `DataContextDb`/`resolveAccessContext` exactly like existing routes):
  - `GET /api/chat/skills` → list (`chat.view`)
  - `GET /api/chat/skills/:id` → get one, 404 if missing/not-owned (`chat.view`)
  - `POST /api/chat/skills` → create, `source: "authored"` (`chat.message`)
  - `PATCH /api/chat/skills/:id` → partial update (`chat.message`)
  - `PATCH /api/chat/skills/:id/enabled` → `setEnabled` (`chat.message`)
  - `DELETE /api/chat/skills/:id` → delete, 204 (`chat.message`)
  - `POST /api/chat/skills/import` → raw skill-file upload, `source: "uploaded"` (`chat.message`)
  - All the Fastify route schemas for these already exist in
    `packages/shared/src/chat-skills-api.ts` (built in Task 2, ahead of need) — **import them, do
    not redesign**: `listChatSkillsRouteSchema`, `getChatSkillRouteSchema`,
    `createChatSkillRouteSchema`, `updateChatSkillRouteSchema`, `setChatSkillEnabledRouteSchema`,
    `deleteChatSkillRouteSchema`. There is no route schema yet for the `import` endpoint (raw-body
    upload, not JSON) — write that new one if a schema is desired, or skip a Fastify body schema
    for it (raw string body) the same way `transcription-routes.ts` skips one.
  - Serialize `ChatSkill` (repository row: snake_case + `Selectable<ChatSkillsTable>`) → `ChatSkillDto`
    (camelCase) — write a small `serializeSkill()` helper in `skills/routes.ts` (id, ownerUserId,
    name, description, frontmatter, body, enabled, source, createdAt/updatedAt as ISO strings — see
    `toIsoString()` helper already in `routes.ts` for the Date/string coercion pattern).

## Next steps for you

1. **Step 1 (test first):** write `tests/integration/chat-skills-routes.test.ts` per the plan's
   Task 3 Step 1 acceptance list (CRUD+toggle round-trip; upload creates `source:'uploaded'` byte-
   identical body; malformed frontmatter → 4xx no partial row; oversized body → 4xx with explicit
   cap stated).
2. **Step 2:** implement `packages/chat/src/skills/frontmatter.ts` (parser as designed above).
3. Implement `packages/chat/src/skills/routes.ts` (`registerChatSkillsRoutes`), wire it into
   `registerChatRoutes` in `packages/chat/src/routes.ts` (add optional `skillsRepository` to
   `ChatRoutesDependencies`, call the new function inline).
4. **Step 3:** add the 7 route entries to `packages/chat/src/manifest.ts`'s `routes: [...]` (see
   list above) — required or `assertRouteCoverage` fails server boot.
5. **Step 4:** verify — focused `pnpm test:integration tests/integration/chat-skills-routes.test.ts`
   (remember: this repo's integration tests MUST run via `pnpm test:integration <path>`, never raw
   `vitest run` — see Task 2's relay notes / `assertIsolatedTestDatabase` guard) + `pnpm typecheck`.
6. Commit Task 3 — explicit paths only, never `git add -A`:
   `git add packages/chat/src/skills/routes.ts packages/chat/src/skills/frontmatter.ts packages/chat/src/routes.ts packages/chat/src/manifest.ts packages/shared/src/chat-skills-api.ts tests/integration/chat-skills-routes.test.ts`
   (only include `chat-skills-api.ts` if you add the import-route schema to it).
7. Then Task 4 (settings pane), Task 5 (autocomplete + invocation), Task 6 (gateway boundary
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
