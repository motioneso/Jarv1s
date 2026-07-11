# Relay — #916 host-starter-action (build agent)

**Trigger:** context-meter 70% warning. No plan written, no code written yet — pure research phase
complete, relaying before degrading.

**Worktree/branch:** this worktree, `feat/916-host-starter-action` (off `origin/main` @ `2f4a0fe3`).
**Handoff doc (untracked, DO NOT commit):** `docs/coordination/2026-07-10-916-host-starter-action-handoff.md`
**Spec:** `docs/superpowers/specs/2026-07-10-job-search-module-host-starter-action.md`
**Coordinator:** label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` — re-resolve
pane fresh via `herdr pane list`, never reuse a cached pane number. Already notified of this relay.

## Status

Step 0 (orient) and step ½ (verify spec vs branch) of `coordinated-build` are **done** — no drift
found, every file/premise the spec cites still matches current branch state. **Next step is
`superpowers:writing-plans`**, then message the coordinator with the plan path and **STOP for
approval before any code**. Zero files edited so far in this build.

## Architecture already worked out (don't re-derive — just plan it)

1. **`apps/web/src/external-modules/loader.ts`** — extend `ExternalWebContribution.Root`'s prop
   type to accept `hostActions: ExternalModuleHostActionsV1`. Add the interface here (or export
   from a small new module). Do NOT put host actions on the shared frozen
   `window.__JARVIS_MODULE_RUNTIME__` global (installed once at boot — can't bind per-module id).

2. **`apps/web/src/app.tsx`** — the `externalModuleRoutes` `useMemo` (search for that name) is the
   per-contribution injection point: `m.id` is in scope right where `loadExternalModuleContribution`
   is called. Build a `moduleId`-bound `hostActions` object there (factory fn, e.g.
   `createModuleHostActions(moduleId, openAssistantWithDraft)`) and pass as a prop to
   `<route.Component hostActions={...} />`. Because `openAssistant`'s input type is
   `{ starterPrompt: string }` — no `moduleId` field — a module structurally cannot spoof another
   module's id; the binding is pure closure at this host-controlled call site.

3. **`apps/web/src/shell/app-shell.tsx`** — mirror the existing `askJarvisStarter` state +
   `consumeAskJarvis()` effect pattern (search for those names) for a new "open assistant with
   module-authored draft" callback: new state var, set together with `setChatOpen(true)` inside a
   `useEffect` (NOT inside a setState updater — StrictMode double-fire trap), threaded to
   `<ChatDrawer initialText={...} />`. **Never use `openChatWith`** (~line 86-89, auto-sends via
   `sendChatTurn`). Route this callback down through `app.tsx` into the host-action factory from
   step 2, so `openAssistant` validates/caps the prompt then calls it — never auto-submits.

4. **Validation/capping precedent:** `apps/web/src/chat/page-context.ts` has a `truncate(value,
   maxLength)` helper + named `MAX_*_LENGTH` constants — read this file's actual values before
   planning the cap number; wasn't fully read yet this run.

5. **Fail-closed for disabled/drifted modules is ALREADY DONE by existing infra** —
   `apps/api/src/external-module-web-route.ts`'s `GET /api/modules/:moduleId/web/*` 404s before
   serving any bytes if the module isn't in the actor's active/reconciled list. A disabled module's
   `Root` (and any hostActions passed to it) never loads. Most of the spec's "disabled/inactive/
   drifted module can't invoke the action" verification requirement is satisfied by this — don't
   duplicate it as new app-layer gating.

## Test infra gap to resolve in the plan

- No existing unit test touches the browser `loader.ts` (the file named `external-loader.test.ts`
  actually tests server-side `@jarv1s/module-registry/node` discovery, unrelated — don't confuse
  the two, and pick a different filename for new loader/host-action tests).
- No existing e2e mock serves `/api/modules/:id/web/*` with real JS or has an `external:true` +
  `web` fixture entry (`tests/e2e/mock-modules.ts` covers only the admin toggle UI via
  `/api/admin/external-modules`). Building real e2e coverage of button-click → draft-opens →
  no-auto-submit needs new fixture infra (fake module list entry + `page.route` serving real JS for
  the bundle URL) — decide scope for this in the plan; may be reasonable to keep e2e coverage
  narrower and lean on unit tests for the pure validation/id-binding logic instead.

## Plan must cover

(a) loader.ts prop-type + interface + host-action factory w/ validation/capping, (b) app.tsx wiring
at `externalModuleRoutes`, (c) app-shell.tsx new state + open-with-draft callback, (d) unit tests
for the pure validation/capping/id-binding logic (new file), (e) e2e or narrower verification
coverage decision for the actual UI flow, (f) a11y (keyboard activation + focus transfer), (g)
confirm existing risk/confirmation/audit/tool-allowlist behavior unchanged post-submission (likely
just an assertion, not new test surface — nothing in this design touches those systems).

## Reminders

- `git add` by explicit path only, never `-A`.
- Never commit `docs/coordination/2026-07-10-916-host-starter-action-handoff.md`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` +
  `git fetch origin main && git rebase origin/main`.
- Close out via `coordinated-wrap-up` only — never merge/board/close yourself.
