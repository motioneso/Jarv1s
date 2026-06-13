# Phase 2 — Primary-user Onboarding (hybrid Jarvis-guided + skippable)

**Status:** draft (2026-06-12) · pending user review
**Epic:** #47 (Phase 2 · Portable, Deployable & Multi-user) — **exit criterion #6**
**Decisions:** ADR 0007 (house model), **ADR 0008 §2/§3** (portability via onboarding-provisioning;
per-instance path choice at onboarding), ADR 0009 (finish-not-rearchitect)
**Risk tier:** medium (founder-only admin surface; reads CLI presence; writes `instance_settings`).
No secrets, no new tables, no migration.
**Depends on:** the Portable CLI Chat Adapter slice
(`docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md`) and the Deployable
Containerized Stack slice (`docs/superpowers/specs/2026-06-12-p2-deployable-containerized-stack-design.md`).
See **§Open risks** and **§Out of scope** for exactly what each dependency owns vs. what this slice
builds independently.

---

## Goal

After the founder signs up (the bootstrap-owner created by `bootstrapFirstJarvisUser` in
`packages/auth/src/index.ts:367-431`), give them a guided, **fully skippable, resumable** path that
provisions the prerequisites ADR 0008 §2 calls out — multiplexer install, CLI auth, optional
connector setup — and records that onboarding is done. The flow must work **before any AI model is
configured** (a deterministic step wizard is the spine), and it must be able to _light up a Jarvis
chat overlay_ once a CLI path is chosen so the assistant can help fill remaining steps
conversationally. This resolves the chicken-and-egg of ADR 0008: chat needs a configured model, but
onboarding is what configures the model.

This slice is the human-facing front end to the DEPLOY CHECKPOINT (exit criterion #7): "Ben deploys
to the server and self-onboards as a brand-new primary user." The wizard skeleton, the
`/api/onboarding/*` endpoints, and the step components are buildable and testable now against the
already-shipped AI/connector panels; the multiplexer-selection write and the chat overlay's actual
chat path are validated end-to-end at the DEPLOY checkpoint once the two dependency slices land.

---

## Architecture

**Two surfaces, one spine.** The spine is a **deterministic step wizard** — a new
`apps/web/src/onboarding/` route tree that renders ordered, individually-skippable steps and reads
its completion state from a new `GET /api/onboarding/status` endpoint. It is pure REST + React Query,
identical in shape to the existing admin panels, and depends on no AI model. The optional second
surface is a **Jarvis chat overlay** that mounts _inside_ the wizard and is disabled until an AI path
is usable; it reuses the existing live-chat machinery (`apps/web/src/chat/chat-drawer.tsx` +
`use-chat-stream.ts`) so "the assistant guides you" is the same engine the rest of the app uses, not
a parallel one. The overlay never gates progress — every step is completable from the deterministic
controls alone.

**State is hybrid, founder-scoped, zero-migration.** Founder/instance provisioning state lives in
`app.instance_settings` (the existing key/value table, `packages/db/src/types.ts:94-100`), written
through the _already-built_ admin upsert path
(`SettingsRepository.upsertInstanceSetting`, `packages/settings/src/repository.ts:66-100`, which
audits every write). Three keys are introduced/consumed: `onboarding.completed` (bool),
`onboarding.skipped` (bool), and `chat.multiplexer` (`"tmux" | "herdr"` — see §Components →
"chat.multiplexer setting (ownership)"). Per-step completion is _derived_, not separately persisted:
step 2 is "done" when `chat.multiplexer` is set, step 3 is "done" when the chosen provider's CLI is
authed-and-present (best-effort presence probe), step 4 is "done" when a Google connector account
exists. This keeps per-user onboarding state minimal — the whole flow targets the **primary user /
bootstrap owner** this phase, so a single instance-scoped record is sufficient and there is no new
per-user table.

**Trigger is an app.tsx branch that mirrors the existing gated screens.** `apps/web/src/app.tsx`
already branches on `meQuery` results into bootstrap/auth, `account_pending_approval`, and
`account_deactivated` screens (`app.tsx:52-76`). We add one more branch: once `meQuery` resolves to a
user with `isInstanceAdmin && isBootstrapOwner`, fetch `GET /api/onboarding/status`; if
`!completed && !skipped`, render the onboarding route instead of the app shell. We do **not** overload
the unauthenticated `/api/bootstrap/status` probe (`packages/settings/src/routes.ts:63-71`, which by
design leaks no instance metrics, OTNR-P4 #122) — onboarding status is an authenticated, admin-gated
endpoint.

**Server surface is three new routes in `packages/settings`** (the module that already owns
`instance_settings`, `requireAdmin`, and `admin_audit_events`): `GET /api/onboarding/status` (read),
`POST /api/onboarding/complete`, and `POST /api/onboarding/skip`. All three follow the exact
per-method DataContextDb pattern the slice-D refactor established
(`packages/settings/src/routes.ts:145-170`, repository methods take `scopedDb`,
`packages/settings/src/repository.ts:44-100`). Complete/skip are `requireAdmin`-gated and write audit
events; status is admin-gated (the founder is the only actor this phase). The routes register through
the settings module's existing `registerSettingsRoutes`
(`packages/module-registry/src/index.ts:101-107`), so no new module and no new wiring in
`apps/api/src/server.ts`.

---

## Components

### 1. `GET /api/onboarding/status` (settings route + repository method)

- **What it does:** returns the onboarding state the wizard needs to render and the app.tsx branch
  needs to decide routing: `{ completed: boolean, skipped: boolean, steps: { multiplexer: { done,
selected: "tmux"|"herdr"|null, tmuxAvailable, herdrAvailable }, cliAuth: { done, providers:
[{ kind, cliAvailable }] }, connectors: { done } } }`. Step `done` flags are **derived
  server-side** from `instance_settings` + presence probes + connector-account existence, never
  stored.
- **How it's used:** the app.tsx onboarding branch reads `completed`/`skipped` to decide routing; the
  wizard reads `steps` to render per-step status and the re-check/poll buttons. The web client gets a
  `getOnboardingStatus()` function in `apps/web/src/api/client.ts` alongside `getMe`
  (`client.ts:101`).
- **Depends on:** `SettingsRepository` (new `getOnboardingStatus(scopedDb)` method) for the
  `instance_settings` reads; `tmuxAvailable`/`herdrAvailable`/`cliAvailable` from
  `packages/ai/src/cli-availability.ts` (presence-only, no auth probing — see §Components 5); the
  connectors module's account list for the connector-done derivation. The repository method must
  follow the slice-D per-method `DataContextDb` pattern (`assertDataContextDb(scopedDb)` first,
  `repository.ts:47-53`).
- **Auth:** admin-gated via the existing `assertAdminUser` helper (`routes.ts:428-438`). Pending/
  deactivated users never reach it because `resolveAccessContext` throws first
  (`packages/auth/src/index.ts:314-327`).

### 2. `POST /api/onboarding/complete` and `POST /api/onboarding/skip` (settings routes)

- **What they do:** `complete` upserts `onboarding.completed = true`; `skip` upserts
  `onboarding.skipped = true`. Both go through `SettingsRepository.upsertInstanceSetting`
  (`repository.ts:66-100`), which already writes an `admin_audit_events` row per write — so each is
  audited with actor + action + target for free. A dedicated repository method
  (`setOnboardingFlag(scopedDb, { flag, actorUserId, requestId })`) wraps the upsert with a clear
  audit `action` string (`"onboarding.complete"` / `"onboarding.skip"`) rather than the generic
  `instance_setting.upsert`.
- **How they're used:** the wizard's "Finish" button calls complete; the "Skip setup" button (present
  on every step, per the locked decision) calls skip. On success the client invalidates the
  onboarding-status query and the app.tsx branch falls through to the normal app shell.
- **Depends on:** `requireAdmin` (`assertAdminUser`, `routes.ts:428-438`), the per-method
  `withDataContext` route pattern (`routes.ts:381-401` is the template — admin check + repository
  call share one transaction), and `requireRequestId(accessContext)` (`routes.ts:454-460`) for the
  audit `request_id`.
- **Invariant:** `AccessContext` stays `{ actorUserId, requestId }` — these routes read
  `accessContext.actorUserId`/`requestId` only and add nothing to the context (Slice 1f invariant,
  CLAUDE.md "AccessContext shape").

### 3. `chat.multiplexer` setting (ownership) + the multiplexer-selection step write

- **What it is:** the `chat.multiplexer` instance setting (`"tmux" | "herdr"`) that the CLI-adapter
  slice's engine factory reads to choose its backend (that slice, §4.2, selects "config / onboarding"
  but does **not** define a persisted setting or a shared contract — verified by grep against
  `2026-06-12-p2-portable-cli-chat-adapter-design.md`). **This onboarding slice owns the
  `chat.multiplexer` shared contract and the write path** unless the CLI-adapter slice lands it first;
  if it does, onboarding consumes it. Coordinate at build time (see §Open risks).
- **How it's used:** step 2 of the wizard writes it via the generic
  `PATCH /api/admin/settings/:key` route that already exists (`routes.ts:145-170`) with body
  `{ value: { value: "tmux" } }` (the `instance_settings` value convention is `{ value: <x> }`,
  matching `readBooleanSetting` in `auth/src/index.ts:351-365` and `getRegistrationSettings` in
  `repository.ts:171-187`). No new write route is needed; reuse the audited admin upsert.
- **Depends on:** the existing `upsertInstanceSettingRouteSchema` (`platform-api.ts:321-343`) and the
  client's `request()` helper. The CLI-adapter slice's engine factory is the _reader_; this slice is
  the _writer_ and surfaces the selection in step 2.

### 4. Onboarding wizard UI (`apps/web/src/onboarding/`)

A new route tree mounted by the app.tsx branch. Components:

- **`OnboardingWizard`** — the spine. Holds the current step index, renders the step component,
  renders a persistent "Skip setup" affordance (calls `skip`) and a step-level "Skip this step"
  affordance, and a "Finish" on the last step (calls `complete`). Reads `getOnboardingStatus()` to
  mark steps done and to make the flow **resumable** (re-entering jumps to the first not-done step).
  Mounts the optional `OnboardingChatOverlay` (§Components 6).
- **`WelcomeStep`** — step 1: a welcome panel + the prominent skip option. No server interaction.
- **`MultiplexerStep`** — step 2: **instructions-only** (ADR 0008 §2 + the CLI-adapter spec: the API
  runs unprivileged as `ben`, so we never auto-install). Reads `steps.multiplexer.{tmuxAvailable,
herdrAvailable}`; if neither is present, shows copy-paste install commands (e.g. `apt install tmux`
  / the herdr install line) and a **re-check button** that refetches `getOnboardingStatus()`. Once a
  multiplexer is present the founder **selects** tmux or herdr (writes `chat.multiplexer` via the
  audited PATCH, §Components 3). Polling = a manual re-check button (no blocking loops; mirrors the
  multi-user spec's "no live auto-advance" decision and the project anti-pattern against sleep-loops).
- **`CliAuthStep`** — step 3: CLI auth is interactive on the **host shell** (ADR 0008 §2 "guides the
  user to authenticate their own CLI"), so this step is instructions + a presence/auth re-check. It
  lists the providers from `steps.cliAuth.providers` (Claude / Codex / Gemini, the set
  `cli-availability.ts` knows) with each one's `cliAvailable` flag, shows the run-on-host command to
  authenticate the chosen CLI, and a re-check button that re-probes via `getOnboardingStatus()`. This
  step **only ever reports presence** — it never runs the CLI and never reads auth tokens.
- **`ConnectorStep`** — step 4: reuses `ConnectGooglePanel` verbatim
  (`apps/web/src/connectors/connect-google-panel.tsx`), the already-polished 3-step guided OAuth flow.
  No new connector code. Marked done when a connector account exists.

All steps are individually skippable and the whole flow is skippable; the wizard never blocks on a
not-done step. Styling reuses the existing `panel` / `connect-steps` / `primary-button` /
`ghost-button` classes from `apps/web/src/styles.css` (same vocabulary as `ConnectGooglePanel`).

- **Depends on:** `getOnboardingStatus`, `completeOnboarding`, `skipOnboarding`, and
  `upsertInstanceSetting` client functions; `ConnectGooglePanel`; React Router (`react-router`, the
  same dep `app.tsx` already uses). The wizard is mounted _outside_ `BrowserRouter`'s app routes (it
  replaces the app shell, like `PendingApprovalScreen`), or as a dedicated `/onboarding` route inside
  a minimal router — implementer's choice, but it must not require the full `AppShell`.

### 5. `cli-availability.ts` extension — `herdrAvailable`

- **What it does:** add `herdrAvailable(deps?: WhichDeps): Promise<boolean>` alongside the existing
  `tmuxAvailable` (`packages/ai/src/cli-availability.ts:43-47`), using the same `defaultWhich`
  PATH-detect (`command -v herdr`). **Presence-only, no auth probing** — identical posture to the
  existing `cliAvailable`/`tmuxAvailable` (the file's module contract,
  `cli-availability.ts:28-31,39-42`).
- **How it's used:** the status endpoint calls `tmuxAvailable()` and `herdrAvailable()` for the
  multiplexer step and `cliAvailable(kind)` for the CLI-auth step.
- **Depends on:** nothing new — extends the existing `WhichDeps` seam so tests inject a fake `which`.

### 6. `OnboardingChatOverlay` (optional Jarvis chat overlay)

- **What it does:** a slide-in chat surface mounted inside the wizard that reuses the existing live
  chat (`apps/web/src/chat/chat-drawer.tsx` chrome + `apps/web/src/chat/use-chat-stream.ts` stream).
  It is **disabled until an AI path is usable** — concretely, it stays inert until
  `steps.multiplexer.selected` is set AND the chosen provider's `cliAvailable` is true (a CLI chat
  path exists). When enabled, it lets the founder ask the assistant to explain/perform remaining
  steps; it is never required to advance.
- **How it's used:** rendered by `OnboardingWizard` with an "Ask Jarvis" toggle that is greyed out
  with an explanatory tooltip ("Available once you've selected a multiplexer and authenticated a CLI")
  until enabled. The actual chat traffic flows through the existing `POST /api/chat/turn` + SSE stream
  (`sendChatTurn`/`chatStreamUrl`, `client.ts:248,296`) — onboarding adds no new chat endpoint.
- **Depends on:** the existing chat drawer/stream; the CLI-adapter slice for the chat path to actually
  return replies on a deployed host. Until that slice + a live multiplexer exist, the toggle simply
  stays disabled — the deterministic wizard is unaffected. This is the chicken-and-egg resolution: the
  wizard configures the model, then the overlay lights up.

### 7. `app.tsx` onboarding branch + shared contract

- **What it does:** after `meQuery` succeeds, when `meQuery.data.user.isInstanceAdmin &&
meQuery.data.user.isBootstrapOwner`, an enabled `onboardingStatusQuery`
  (`queryKey: queryKeys.onboarding.status`) runs; while it loads, show the existing `LoadingScreen`;
  if `!completed && !skipped`, render `<OnboardingWizard/>` instead of `<BrowserRouter>...`. This
  mirrors the `account_pending`/`deactivated` branch shape (`app.tsx:61-67`) exactly — a single
  early `return` before the app-shell render.
- **How it's used:** non-bootstrap users and already-onboarded founders fall straight through to the
  app shell with no extra fetch blocking them (the status query is `enabled` only for the bootstrap
  owner, so a normal household member never even calls it).
- **Depends on:** new shared contracts in `packages/shared/src/platform-api.ts`:
  `OnboardingStatusResponse` (+ its DTO sub-shapes), `getOnboardingStatusRouteSchema`,
  `onboardingCompleteRouteSchema`, `onboardingSkipRouteSchema`, and (if not landed by the CLI-adapter
  slice) a `ChatMultiplexer = "tmux" | "herdr"` type. Add a `queryKeys.onboarding` namespace in
  `apps/web/src/api/query-keys.ts`. These are exported from `packages/shared/src/index.ts` (the
  barrel, `index.ts:15` already re-exports `platform-api`).

---

## Data flow

1. Founder completes email sign-up → better-auth `after` hook `bootstrapFirstJarvisUser` sets the
   user `active` + `is_instance_admin` + `is_bootstrap_owner`
   (`packages/auth/src/index.ts:402-413`).
2. Web shell calls `GET /api/me` → returns the founder `UserDto` with `isBootstrapOwner: true`
   (`platform-api.ts:3-12`, `routes.ts:483-494`).
3. app.tsx, seeing bootstrap owner, calls `GET /api/onboarding/status`. `resolveAccessContext`
   authenticates (cookie or bearer) and confirms `status = active`
   (`auth/src/index.ts:264-329`); the route's `withDataContext` runs `assertAdminUser` +
   `repository.getOnboardingStatus` in one transaction.
4. `getOnboardingStatus` reads `onboarding.completed` / `onboarding.skipped` / `chat.multiplexer`
   from `instance_settings`, probes `tmuxAvailable`/`herdrAvailable`/`cliAvailable`, checks for an
   existing connector account, and returns the derived `steps` object.
5. If `!completed && !skipped`, app.tsx renders `OnboardingWizard`. The founder works steps:
   - Step 2: picks tmux/herdr → `PATCH /api/admin/settings/chat.multiplexer` (audited upsert) →
     re-check refetches status → step shows done.
   - Step 3: authenticates a CLI on the host shell → re-check refetches → `cliAvailable` flips true.
   - Step 4: `ConnectGooglePanel` OAuth → connector account created → step shows done.
   - Optional: once a CLI path exists, the chat overlay enables and traffic flows over the existing
     `POST /api/chat/turn` + SSE.
6. Founder clicks Finish (or Skip on any step) → `POST /api/onboarding/complete` (or `/skip`) →
   audited upsert → client invalidates `queryKeys.onboarding.status` → app.tsx branch falls through
   → app shell renders.
7. Re-entry: if the founder reloads mid-flow, status is re-derived and the wizard resumes at the
   first not-done step (resumability is a pure function of derived `steps`).

---

## Error handling

- **Status read failure** (DB down, etc.): the status query uses `retry: false` like the other auth
  queries (`app.tsx:25`). On error, fall through to the normal app shell rather than trapping the
  founder in a broken wizard — onboarding is optional, so a status error must never block app access.
  Surface a dismissible inline notice.
- **Non-admin / non-owner hitting the routes:** `assertAdminUser` throws `HttpError(403)`
  (`routes.ts:434-437`), mapped by the module error handler (`routes.ts:523-541`). A household member
  who somehow calls these gets a clean 403; the client treats it as "not for me" and renders the app
  shell.
- **Multiplexer absent on re-check:** the step stays not-done and keeps showing install instructions
  - the re-check button. No auto-install, no retry loop, no error state — "still missing" is a normal
    intermediate state.
- **CLI not authed on re-check:** same — presence/auth probe returns false, step stays not-done with
  the host-shell auth instructions. We never attempt the auth ourselves.
- **`chat.multiplexer` write conflict** (the CLI-adapter slice also wrote it): the upsert is
  idempotent (`onConflict ... doUpdateSet`, `repository.ts:80-86`); last writer wins; the re-check
  reflects the stored value. No corruption possible.
- **Connector OAuth failure:** handled entirely by the reused `ConnectGooglePanel` (its own
  `setError` path, `connect-google-panel.tsx:14,101`). Onboarding adds nothing.
- **Chat overlay before a model exists:** the toggle is disabled, so no failing chat call is made. If
  a CLI path was reported present but the host call fails at the DEPLOY checkpoint, the error surfaces
  in the chat stream's existing error record (`chat-drawer.tsx:187-189`); the wizard is unaffected.

---

## Security & invariants

Cites CLAUDE.md "Hard Invariants" this slice touches:

- **No admin private-data bypass / RLS applies to all actors.** The status/complete/skip routes are
  admin-gated and read only instance-scoped settings + presence flags + the existence (not contents)
  of a connector account. They never read another user's private data. RLS on `instance_settings`
  and the connectors tables is unchanged and still applies to the founder.
- **DataContextDb only.** Every new repository method takes a branded `DataContextDb` and calls
  `assertDataContextDb(scopedDb)` first (the slice-D per-method pattern, `repository.ts:44-53`). No
  raw Kysely instance crosses the repository boundary; no `withDataContext` nesting.
- **AccessContext shape frozen.** The new routes read only `accessContext.actorUserId` and
  `accessContext.requestId`; nothing is added to the context (Slice 1f; `workspaceId` stays removed).
- **Secrets never escape.** The CLI-auth step is **presence-only** — it never reads CLI auth tokens,
  never runs the CLI, and returns only booleans. The multiplexer step writes a non-secret enum. The
  connector step reuses `ConnectGooglePanel`, whose secret handling (encrypted at rest, never
  returned) is already shipped. `getOnboardingStatus` returns no secret-shaped field.
- **Module isolation.** Onboarding lives in `packages/settings` (which owns `instance_settings`,
  `requireAdmin`, `admin_audit_events`). It consumes `cli-availability` from `@jarv1s/ai` and the
  connector-account check through the connectors module's public API/event surface — never by querying
  another module's tables directly. The chat overlay calls the existing chat HTTP routes, not chat
  internals.
- **Never edit applied migrations / module SQL in owning module's `sql/`.** This slice adds **no
  migration** — it reuses the existing `instance_settings` table and the audited upsert. (If a future
  decision needs new schema, it would be a new file in the owning module's `sql/` dir; not needed
  here.)
- **Audit everything admin.** Complete/skip and the `chat.multiplexer` write all flow through the
  upsert path that writes `admin_audit_events` (`repository.ts:90-97`), so the founder's provisioning
  actions are durably recorded.
- **Bootstrap-owner trigger only.** The app.tsx branch fires only for `isBootstrapOwner` users, so a
  newly-approved second household member is _never_ routed into onboarding — they go straight to the
  app shell (onboarding is founder/instance provisioning, not per-member).

---

## Testing strategy

- **`cli-availability.ts`:** unit test `herdrAvailable` with an injected `WhichDeps.which` that
  returns a path / null — mirrors how `tmuxAvailable`/`cliAvailable` are already structured
  (`cli-availability.ts:32-47`). Assert presence-only (no exec of the binary).
- **`getOnboardingStatus` (settings integration suite):** with a real bootstrap owner, assert the
  derived `steps`: all not-done initially; multiplexer done after a `chat.multiplexer` upsert; cliAuth
  reflects an injected presence probe; connectors done after a connector account exists; `completed`/
  `skipped` reflect their settings. Run in the existing `settings`/`test:tasks`-style suite under
  `pnpm verify:foundation`.
- **complete/skip routes:** assert they upsert the right key, write an `admin_audit_events` row with
  the right `action`, and 403 for a non-admin (`assertAdminUser`). Assert `AccessContext` is unchanged
  (no extra fields).
- **app.tsx branch:** component/e2e test (Playwright with mocked REST, `tests/e2e/mock-*.ts`): a
  bootstrap owner with `!completed && !skipped` sees the wizard; after `complete`, sees the app shell;
  a non-owner never sees the wizard; a status-endpoint error falls through to the app shell.
- **Wizard skippability/resumability:** test that "Skip setup" on any step reaches the app shell; that
  re-entry resumes at the first not-done step.
- **Chat overlay gating:** test the toggle is disabled until `selected` is set AND a CLI is available,
  and that it makes no chat call while disabled.
- **Gate:** `pnpm verify:foundation` green (lint, format, file-size <1000 lines per file, typecheck,
  migrate, integration). No new migration, so `db:migrate` hash-check is unaffected. The two
  dependency-blocked end-to-end paths (real multiplexer write effect + real chat overlay reply) are
  validated at the DEPLOY checkpoint, not in this slice's CI.

---

## Acceptance criteria

1. `GET /api/onboarding/status` returns `{ completed, skipped, steps }` with **server-derived** step
   `done` flags (multiplexer from `chat.multiplexer` + presence; cliAuth from `cliAvailable`;
   connectors from connector-account existence); admin-gated; follows the per-method `DataContextDb`
   pattern.
2. `POST /api/onboarding/complete` and `POST /api/onboarding/skip` upsert `onboarding.completed` /
   `onboarding.skipped`, are `requireAdmin`-gated, and each writes an `admin_audit_events` row.
3. `cli-availability.ts` gains `herdrAvailable` alongside `tmuxAvailable`, presence-only, with the
   same injectable `WhichDeps` seam.
4. `app.tsx` adds an onboarding branch that fires **only** for `isInstanceAdmin && isBootstrapOwner`
   when `!completed && !skipped`, mirroring the `account_pending` branch shape, and does **not** call
   or modify the unauthenticated `/api/bootstrap/status` probe.
5. The wizard renders four ordered steps (welcome+skip / multiplexer-instructions+select / CLI-auth-
   instructions+recheck / connector via reused `ConnectGooglePanel`); **every step is skippable**, the
   whole flow is skippable, and re-entry **resumes** at the first not-done step.
6. Step 2 writes the `chat.multiplexer` (`"tmux"|"herdr"`) instance setting through the existing
   audited admin upsert (`PATCH /api/admin/settings/:key`); the multiplexer/CLI steps show install/
   auth instructions and a manual re-check button (no auto-install, no blocking poll loop).
7. The optional Jarvis chat overlay mounts in the wizard, is **disabled until a CLI path is usable**
   (multiplexer selected + chosen CLI present), reuses the existing chat drawer/stream, and never
   gates step completion.
8. New shared contracts (`OnboardingStatusResponse` + route schemas; `ChatMultiplexer` if not already
   landed by the CLI-adapter slice) exist in `packages/shared/src/platform-api.ts` and are exported
   from the barrel; a `queryKeys.onboarding` namespace exists.
9. No new migration; no secret-shaped field in any onboarding response; `AccessContext` unchanged;
   all writes audited.
10. `pnpm verify:foundation` green (lint, format, file-size, typecheck, migrate, integration),
    including the new unit + integration tests.

---

## Out of scope / deferred

- **API-key entry in onboarding.** Locked decision: CLI-only this phase. API-key chat is deferred;
  API-key entry remains available in normal Settings via the shipped `AiSettingsPanel`
  (`apps/web/src/ai/ai-settings-panel.tsx`), but onboarding does not feature it. (Epic #47 #6 lists
  "CLI-auth **or** API-key"; this slice ships the CLI-auth path only and defers the API-key onboarding
  branch.)
- **Auto-installing the multiplexer or the CLIs.** The API runs unprivileged (ADR 0008 §2; the
  CLI-adapter + deployable specs); onboarding shows instructions only.
- **Per-member onboarding / per-user onboarding state table.** This slice is founder/instance-scoped;
  per-user onboarding (if ever needed) is a later slice with its own migration.
- **The multiplexer abstraction itself, the engine refactor, and the chat-from-container bridge** —
  owned by the CLI-adapter and deployable-stack slices respectively. This slice only writes the
  selection setting and consumes the presence probes.
- **A new chat endpoint or chat engine.** The overlay reuses the existing chat HTTP surface.
- **Module-enablement seam (ADR 0009)** — separate Phase 2 slice (#47 #4).

## Open risks

- **`chat.multiplexer` contract ownership race.** The CLI-adapter slice (§4.2) selects the
  multiplexer "via config / onboarding" but does **not** define a persisted setting or a shared
  contract (verified by grep). This onboarding slice therefore defines and writes `chat.multiplexer`.
  If the CLI-adapter slice lands the contract first, onboarding must _consume_ it (drop its own type,
  import theirs). **Coordinate at build time** via the run manifest / herdr-pane-message so the type is
  defined exactly once — duplicate definitions in `platform-api.ts` would fail typecheck.
- **DEPLOY-checkpoint-only validation.** The real effect of selecting a multiplexer (the engine
  actually using it) and the chat overlay returning real replies both require the CLI-adapter +
  deployable-stack slices on a live host. The wizard skeleton, the `/api/onboarding/*` endpoints, the
  step components, and the connector reuse are all buildable and CI-testable now; the two end-to-end
  paths are signed off at the DEPLOY checkpoint (#47 #7). The build must not stall waiting on those
  slices — it wires to the existing AI/connector panels and the presence probes, which already exist.
- **Presence ≠ authed.** `cliAvailable` is PATH-presence only (`cli-availability.ts:28-31`); a CLI can
  be installed but not logged in. Step 3's "done" derivation is therefore best-effort. Mitigate by
  wording the step as "CLI detected — make sure you've run its login on the host" rather than claiming
  authentication, and let the founder advance regardless (the step is skippable). A true auth probe is
  out of scope (it would need to run the CLI; the spec forbids that on this path).
- **Status query adds a fetch for the founder.** It is `enabled` only for the bootstrap owner, so the
  cost is one extra request for exactly one user, once per session until onboarding completes; no
  impact on household members. Acceptable.
- **Founder skips, then wants onboarding back.** `onboarding.skipped`/`completed` are admin settings;
  re-running onboarding later would mean clearing them. A "Re-run setup" affordance in admin Settings
  is a small follow-up, not required for the DEPLOY checkpoint; noted so it is not forgotten.
