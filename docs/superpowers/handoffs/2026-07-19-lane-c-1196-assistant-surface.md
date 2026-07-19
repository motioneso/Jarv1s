# Lane C handoff — host AssistantSurface + module contract v1.1 + drawer suppression

**Issue:** task #1196 (Part of feature #1193) · **Spec (source of truth):**
`docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md` — read IN FULL, especially
§AssistantSurface contract (the v1.1 TypeScript interfaces are normative). Read `AGENTS.md` and the
issue body first.

## Mission

Core-owned embeddable assistant surface so module screens can host a real Jarvis conversation:

1. **`apps/web/src/chat/assistant-surface/`** (new) — reuses `MarkdownMessage`,
   `ActionRequestCard`, the attachment client, and the shell-lifted chat record stream
   (`apps/web/src/app-shell.tsx:117` `useChatStream`). View props per spec: `localRows` merged in
   order, `activeControl` as last row, `recordKinds` filter, optional composer with
   `onSubmitText` intercept, `typing` indicator.
2. **Contract v1.1 (additive)** — new optional `assistantSurface` member on
   `ExternalWebContributionProps` (`apps/web/src/external-modules/loader.ts`), host-bound to the
   module id at `ExternalModuleMount` exactly like `hostActions`. Host binds it
   **unconditionally**; typing stays optional only for older-host degradation. Per-module gating
   happens server-side (seed route 404), not by withholding the handle. Frozen
   `__JARVIS_MODULE_RUNTIME__` untouched.
3. **Shell presence context / drawer suppression** — while a Surface is mounted: topbar chat
   toggle disabled, `openAssistantWithDraft` reroutes to the embedded composer, an open drawer
   force-closes; unmount restores everything.
4. **`client.ts`** — seed call for `POST /api/chat/module-onboarding` (Lane A builds the route;
   develop against a mock until it merges).
5. **Host CSS primitives** — `jds-bubble` (4px/12px radii), chip-toggle states, typing-dot
   keyframes. Raw colors in `apps/web/src/styles/tokens.css` ONLY; extend `jds-*` idiom.

## Exit criteria (from issue #1196)

Unit tests + mocked Playwright e2e with a fixture module (drawer suppression, record rendering,
composer routing) — follow the `tests/e2e` mock-modules / mock-chat-api patterns. Full gate green.
Size L, 2–3 PRs, base `main`.

## Process

- Work ONLY in your assigned worktree/branch; never touch the shared checkout `~/Jarv1s`; stage
  explicit paths only — never `git add -A`.
- First step: `pnpm install` (fresh worktree).
- Parallel with Lane A via mocks — do not block on, or implement, the server route beyond the
  `client.ts` call.
- Preserve the authored design system (serif headings, `jds-*`, tokens.css); no new raw colors
  outside tokens.css. Generous why-comments citing issue #1196/#1193. Each PR body: user-facing
  summary + "Part of #1193".
- `pnpm verify:foundation` green (real exit code) before each PR. Frontend e2e: this dev box is
  NOT headless — bind Vite to 0.0.0.0 if you run a live instance.
- **Do NOT merge your PRs** — push, open PR, report done; coordinator runs independent QA and
  merges.

## Start

1. `pnpm install`
2. Read spec §AssistantSurface + issue #1196 + `loader.ts`, `app-shell.tsx`, existing drawer code.
3. Plan the PR split (surface component → contract wiring → suppression), then implement
   test-first.
