# Phase 4 — Secondary-user Onboarding (member-role wizard, per-user state)

**Status:** draft (2026-06-13) · pending user review
**Epic:** #49 (Phase 4 · Secondary-User Onboarding) — exit criteria #1 ("Secondary-user onboarding
walks a new user through the now-real sections — hybrid Jarvis-guided + **skippable** — reusing the
Phase-2 primary-onboarding plumbing") and #3 ("Per-user data isolation validated in practice").
**Decisions:** ADR 0007 (house model; §4 — members inherit the shared host CLI subscription).
**Risk tier:** security (adds the first **per-user** onboarding-state surface + an RLS-bearing schema
change on `app.users`; reuses the multi-user isolation gate to prove a member cannot reach the
founder's or another member's private data).
**Depends on:** the Phase-2 primary-user onboarding slice
(`docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md`) landing **first** — this
slice reuses and **generalizes** its spine: the `apps/web/src/onboarding/` `OnboardingWizard` route
tree, the `GET /api/onboarding/status` contract, the `app.tsx` onboarding branch, and the
`POST /api/onboarding/complete` / `/skip` routes. See §Open risks for the exact coupling and what
this slice owns vs. consumes.

---

## Goal

The Phase-2 primary-onboarding slice scoped onboarding to the **bootstrap owner** only: its
`app.tsx` branch fires solely for `isInstanceAdmin && isBootstrapOwner`, its step list is the
founder's provisioning checklist (multiplexer install, instance/registration settings, CLI-auth,
connectors), and it stores completion as **instance-global** keys in `app.instance_settings`. It
**explicitly punted per-user onboarding** to "a later slice with its own migration" (primary spec
§Out of scope: _"Per-member onboarding / per-user onboarding state table … is a later slice with its
own migration"_). **This is that slice.**

After the founder approves a household member (the `pending → active` lifecycle from
`docs/superpowers/specs/2026-06-10-p2-multi-user-accounts-design.md`, enforced at
`resolveRequestAccessContext`, `packages/auth/src/index.ts:314-329`), that member signs in and lands
in the **member onboarding wizard** — the _same_ `OnboardingWizard` route tree, parameterized by
role. The member does **not** repeat any founder provisioning: ADR 0007 §4 locks that members
**inherit the shared host CLI subscription** the founder provisioned in Phase 2, so there is **no
CLI-auth step** for members. The member's steps are: welcome/skip, an **optional, skippable** API-key
opt-out, per-user connector setup (reusing `ConnectGooglePanel` verbatim,
`apps/web/src/connectors/connect-google-panel.tsx`), and a lightweight **client-only section tour**
of the now-real product sections (Tasks / Calendar / Email / Briefings / Wellness / Notifications /
Settings — one line each).

Completion is recorded **per user**, not instance-globally — a new owner-only seam on `app.users`
that rides the self-row RLS already proven in migrations 0045/0047. The founder keeps using the
instance-global provisioning state; members use the per-user state. The same `app.tsx` branch and the
same `GET /api/onboarding/status` contract resolve completion **per actor**.

This unblocks epic #49 exit criterion #2 (the manual Katherine acceptance run) and is gated in CI by
extending `tests/integration/multi-user-isolation.test.ts` (exit criterion #3).

---

## Architecture

**One wizard, parameterized by role — not a second wizard.** The locked decision is to **reuse the
Phase-2 `OnboardingWizard` route tree** and the `GET /api/onboarding/status` contract, selecting the
step list by `isBootstrapOwner`. The Phase-2 wizard already holds a current-step index, renders an
ordered list of individually-skippable step components, renders a persistent "Skip setup"
affordance, and reads `getOnboardingStatus()` to mark steps done and resume at the first not-done
step. This slice changes **which steps** that machinery iterates over (a role-selected array) and
**where completion is recorded** (per-user for members), leaving the spine untouched. No duplicate
wizard component, no parallel route tree, no second status endpoint.

**Per-user onboarding state is a new owner-only column on `app.users`, riding existing self-row
RLS.** The cheapest correct seam — verified against the live policy set — is a single nullable
column `app.users.onboarding_completed_at timestamptz`. `app.users` already carries per-account state
(`status`, `is_bootstrap_owner`, added in `0050_multi_user_accounts.sql`) and already has, for
`jarvis_app_runtime`, **self-row SELECT / INSERT / UPDATE** policies keyed on
`id = app.current_actor_user_id()` (`infra/postgres/migrations/0045_auth_secret_rls.sql:85-102`,
tightened in `0047_users_rls_tighten.sql:23-29`). Therefore:

- A member can **read its own** `onboarding_completed_at` through `app_runtime` directly (self-row
  SELECT) — **no new SECURITY DEFINER helper needed**, and we do **not** have to rebuild
  `app.get_user_by_id` / `app.list_all_users` (whose fixed return columns deliberately omit it; see
  §Components 1 for why we keep it out of those helpers).
- A member can **write its own** value through `app_runtime` (self-row UPDATE).
- An admin/founder **cannot read another member's** `onboarding_completed_at` via `app_runtime`: the
  admin policy on `app.users` is **UPDATE-only** (`users_app_runtime_admin_update`,
  `0050_multi_user_accounts.sql:118-124`); the SELECT policy stays self-row. RLS holds for admins —
  the headline invariant.

A column on `app.users` is chosen over a new `onboarding_state` table because (a) it is per-account
state on the account row, exactly like `status`; (b) the self-row policy set we need **already
exists** — a new table would require authoring the same three policies plus FORCE-RLS posture from
scratch; (c) it adds no JOIN to the hot `getOnboardingStatus` path. (The rejected new-table option is
steelmanned in §Open risks.)

**`app.users` is an APP-level table, so its column + RLS live in `infra/postgres/migrations/`, not a
module `sql/` dir.** This is the one deliberate exception to "module SQL in the owning module's
`sql/` dir": `app.users` is core platform schema managed under `infra/postgres/migrations/` (every
users migration — 0045, 0046, 0047, 0050 — lives there; no module owns `app.users`). The
`0050_multi_user_accounts.sql` precedent is exact: account-lifecycle columns + their RLS on
`app.users` are an app-level migration. This slice adds **one new migration file** (next global
number assigned at landing order — do **not** hardcode; the current high-water mark across
`infra/postgres/migrations/` and module `sql/` dirs is `0064`, so the runner will assign the next
free number) that `ALTER TABLE app.users ADD COLUMN onboarding_completed_at`. It does **not** touch
or re-grant the SELF policies (they already cover the new column — RLS policies are row-level, not
column-level), and it must **not weaken** the 0045/0046/0047/0050 posture.

**Status resolution becomes per-actor.** Today the Phase-2 `GET /api/onboarding/status` returns
instance-global founder-provisioning state. This slice **generalizes** it: the route reads the
caller's `isBootstrapOwner` and returns the **founder shape** (instance-global provisioning steps,
unchanged) for the founder and the **member shape** (per-user completion + the member step list's
derived flags) for a member. The `apps/web/src/app.tsx` branch is correspondingly generalized: it
fires for **any active user** whose role-appropriate onboarding is not yet complete — the founder
gate (instance-global `onboarding.completed`/`skipped`) is unchanged, and a new member gate
(per-user `onboarding_completed_at IS NULL`) is added.

**Server surface stays in `packages/settings`** — the module that owns `app.instance_settings`,
`requireAdmin`, `admin_audit_events`, and (per the Phase-2 slice) the `/api/onboarding/*` routes.
This slice adds **no new module and no new route path**: it adds two repository methods
(`getMemberOnboardingState`, `setMemberOnboardingComplete`) and branches the existing status/complete
handlers on role. Routes follow the established per-method `DataContextDb` pattern
(`packages/settings/src/routes.ts:145-170`, repository methods take `scopedDb` and call
`assertDataContextDb` first, `packages/settings/src/repository.ts:47-53`).

**Connector-done is derived client-side, preserving module isolation.** The member's connector step
reuses `ConnectGooglePanel`, which already calls the connectors module's own per-user endpoint
`GET /api/connectors/accounts` (owner-scoped via `ConnectorsRepository.listAccounts`,
`packages/connectors/src/repository.ts:89-93`) through the existing `listConnectorAccounts()` client
function (`apps/web/src/api/client.ts:422`). The settings `getOnboardingStatus` endpoint therefore
does **not** query `app.connector_accounts` (that would break module isolation — settings would read
connectors' owned table directly). Instead the member's "connectors.done" flag is derived in the
client from `listConnectorAccounts()` (the connectors module's declared public API). This is a
deliberate correction of the Phase-2 spec's server-side connector derivation, which would have
coupled settings to the connectors table — see §Open risks.

---

## Components

### 1. Migration: `app.users.onboarding_completed_at` (new app-level migration file)

- **What it does:** `ALTER TABLE app.users ADD COLUMN IF NOT EXISTS onboarding_completed_at
timestamptz` (nullable; default NULL = not-yet-onboarded). NULL for every existing row on upgrade
  — including the bootstrap owner, who never uses this column (the founder's completion stays
  instance-global). No backfill needed; the founder's app.tsx branch reads the instance-global keys,
  not this column.
- **RLS:** **none added.** The existing `app.users` self-row SELECT/UPDATE policies for
  `jarvis_app_runtime` (`0045:85-102`, `0047:23-29`) are row-level and already authorize the actor's
  own row, columns included. The admin UPDATE policy (`0050:118-124`) is UPDATE-only and does not
  widen SELECT. The migration must **not** alter, drop, or re-create any users policy, and must not
  weaken FORCE RLS on `auth_accounts`/`better_auth_sessions` (0045/0046) — it touches only the
  `app.users` column set.
- **Deliberately NOT rebuilt:** `app.get_user_by_id(uuid)` and `app.list_all_users()` (SECURITY
  DEFINER, owned by `jarvis_auth_runtime`, `0050:58-110`) are **left unchanged** — their fixed return
  columns intentionally omit `onboarding_completed_at`. The member reads its own onboarding state via
  the **self-row SELECT path** (a plain `selectFrom("app.users")` under the actor's `app_runtime`
  GUC), not via the admin/cross-user helper. Keeping it out of the helpers preserves the invariant
  that the admin user-list path can never surface another user's onboarding state.
- **Depends on:** nothing. Pure additive DDL. Placed in `infra/postgres/migrations/` (app-level
  table; `0050` precedent). Migration number is global, assigned by landing order — never hardcoded
  in code; coordinate ordering with any sibling slice that also adds a migration.
- **Type change:** add `onboarding_completed_at: NullableTimestampColumn` to `UsersTable`
  (`packages/db/src/types.ts:27-38`). The `User`/`UserDto` admin serialization is **not** extended —
  `onboarding_completed_at` must **not** appear on `UserDto` (`packages/shared/src/platform-api.ts:3-12`)
  or in `serializeUser` (`packages/settings/src/routes.ts:483-494`), so the admin `GET /api/admin/users`
  list never exposes per-user onboarding state across users.

### 2. `getOnboardingStatus` (settings repository + route) — generalized per-actor

- **What it does:** the existing `GET /api/onboarding/status` handler (Phase-2) is branched on the
  caller's role inside its `withDataContext`:
  - **Founder** (`isBootstrapOwner`): returns the Phase-2 founder shape unchanged (instance-global
    `onboarding.completed`/`skipped` + the multiplexer/cliAuth/connector provisioning steps).
  - **Member** (not `isBootstrapOwner`): returns the **member shape**
    `{ role: "member", completed: boolean, steps: { apiKeyOptOut: { done }, connectors: { done } } }`
    where `completed` is `onboarding_completed_at IS NOT NULL` read from the **member's own row**, and
    the member step `done` flags are best-effort (see below). The section tour is client-only and has
    no server-derived flag.
- **Member-state read:** a new repository method `getMemberOnboardingState(scopedDb, actorUserId):
Promise<{ completedAt: Date | null }>` that does `scopedDb.db.selectFrom("app.users").select(
"onboarding_completed_at").where("id", "=", actorUserId).executeTakeFirst()` — the self-row SELECT
  policy returns exactly the actor's row. Must call `assertDataContextDb(scopedDb)` first
  (`repository.ts:47-53`) and take only `DataContextDb` (DataContextDb-only invariant).
- **Member `apiKeyOptOut.done` derivation:** best-effort and **non-blocking** — the opt-out step is
  skippable, so `done` may simply mirror "the member has either configured an AI provider key OR
  explicitly skipped this step". To avoid coupling settings to the AI module's tables, the simplest
  correct derivation is **client-side** (the AI settings already expose the member's providers via
  `listAiProviders()`); the server may return `apiKeyOptOut.done: false` as a neutral default and let
  the client compute display state. (The step is optional; its `done` flag is cosmetic, never a
  gate.)
- **Member `connectors.done` derivation:** **client-side**, from `listConnectorAccounts()` (see
  §Architecture — module isolation). The server status response does **not** include a
  server-derived connectors flag for members; the client marks the step done when the member has at
  least one connector account.
- **How it's used:** the generalized `app.tsx` branch reads `completed` (founder: instance-global;
  member: per-user) to decide routing; `OnboardingWizard` reads the role + steps to pick the step
  array and render per-step status. The web client's existing `getOnboardingStatus()`
  (Phase-2, in `apps/web/src/api/client.ts`) gains the member shape in its response type.
- **Auth:** **not** admin-gated for members — a member must read **their own** onboarding status.
  This is the one place the Phase-2 admin-gate is relaxed: the handler requires an **active
  authenticated user** (via `resolveAccessContext` + `requireKnownUser`,
  `routes.ts:73-86,440-452`), not `assertAdminUser`. The founder branch still returns founder data
  only to the founder; a member can only ever read its own per-user state (self-row RLS guarantees
  this even if the handler logic regressed). Pending/deactivated users never reach it —
  `resolveRequestAccessContext` throws `AccountPendingApprovalError`/`AccountDeactivatedError` first
  (`packages/auth/src/index.ts:322-327`).

### 3. `setMemberOnboardingComplete` (settings repository) + `POST /api/onboarding/complete` (generalized)

- **What it does:** the existing `POST /api/onboarding/complete` handler branches on role:
  - **Founder:** unchanged — upserts the instance-global `onboarding.completed` key via the audited
    `upsertInstanceSetting` path (Phase-2).
  - **Member:** calls a new repository method `setMemberOnboardingComplete(scopedDb, { actorUserId,
requestId })` that does `updateTable("app.users").set({ onboarding_completed_at: new Date(),
updated_at: new Date() }).where("id", "=", actorUserId)` — the self-row UPDATE policy
    (`0045:96-102`) authorizes the actor's own row only. The method calls `assertDataContextDb` first
    and takes only `DataContextDb`.
- **Member "skip" == "complete".** For a member there is no separate persisted "skipped" state: the
  whole flow and every step are skippable, and a member who skips is simply done (the section tour and
  optional API-key opt-out have no instance effect to leave half-finished). So
  `POST /api/onboarding/skip` for a member routes to `setMemberOnboardingComplete` as well —
  stamping `onboarding_completed_at` so the member is never re-prompted. (The founder branch keeps its
  distinct `onboarding.skipped` key, unchanged.) This collapses the member lifecycle to a single
  terminal "onboarded" state, matching the locked decision that every member step is skippable.
- **Audit:** the member completion writes an `admin_audit_events` row via the settings
  `insertAuditEvent` path (`repository.ts:300-324`) with `action: "onboarding.member_complete"`,
  `targetType: "user"`, `targetId: actorUserId`, `requestId` from `requireRequestId(accessContext)`
  (`routes.ts:454-460`). This keeps every onboarding write durably recorded (the founder writes are
  already audited via `upsertInstanceSetting`).
- **Invariant:** `AccessContext` stays `{ actorUserId, requestId }` — the handler reads only those
  two fields and adds nothing (Slice 1f; CLAUDE.md "AccessContext shape").
- **Depends on:** `requireKnownUser` (not `assertAdminUser`) so a member can complete its own
  onboarding; the per-method `withDataContext` route pattern (`routes.ts:152-163` template).

### 4. `OnboardingWizard` role parameterization (`apps/web/src/onboarding/`)

The Phase-2 `OnboardingWizard` spine is reused. The change is a **role-selected step array**:

- The wizard reads `getOnboardingStatus().role` (or, equivalently, `me.isBootstrapOwner`) and
  chooses:
  - **Founder steps** (Phase-2, unchanged): welcome / multiplexer-instructions+select /
    CLI-auth-instructions+recheck / connector.
  - **Member steps** (this slice): `MemberWelcomeStep` / `ApiKeyOptOutStep` (optional, skippable) /
    `MemberConnectorStep` (reuses `ConnectGooglePanel`) / `SectionTourStep` (client-only).
- Founder-only steps — **multiplexer install, instance/registration settings, CLI-auth** — are
  **hidden** for members (ADR 0007 §4: members inherit the shared host CLI; the founder provisioned
  the multiplexer + CLI in Phase 2). There is **no CLI-auth step** in the member array.
- The persistent "Skip setup" affordance and per-step "Skip this step" affordance are reused
  verbatim; for a member they call the member-completion path (§Components 3).

New member step components:

- **`MemberWelcomeStep`** — a welcome panel for the household member + the prominent skip option. No
  server interaction. (Mirrors Phase-2 `WelcomeStep`.)
- **`ApiKeyOptOutStep`** — **optional and skippable**. Locked decision: members inherit the shared
  host CLI subscription, so AI chat already works for them with **no setup**. This step exists only
  to let a member who wants their **own** API key opt out of the shared CLI path; it is a single
  "Skip — I'll use the shared assistant" affordance plus a link/teaser to the Assistant & AI
  advanced settings pane for entering a personal key. It is
  **never required** and never gates progress. It writes nothing itself (key entry, if chosen, flows
  through the shipped per-user AI settings, whose keys are AES-256-GCM encrypted at rest and never
  returned to the client). For the member, this step is the closest equivalent to the founder's
  CLI-auth step but is fully optional.
- **`MemberConnectorStep`** — reuses `ConnectGooglePanel` **verbatim**
  (`apps/web/src/connectors/connect-google-panel.tsx`), the shipped 3-step guided OAuth flow whose
  accounts are per-user/owner-scoped (`ConnectorsRepository.createAccount` stamps
  `owner_user_id = app.current_actor_user_id()`, `repository.ts:118`). No new connector code. Marked
  done client-side when `listConnectorAccounts()` returns ≥1 account. Skippable.
- **`SectionTourStep`** — a **client-only**, no-coachmark-engine tour: a single panel listing the
  now-real product sections with one line each — **Tasks, Calendar, Email, Briefings, Wellness,
  Notifications, Settings** — each linking to its route. No server interaction, no persisted "tour
  seen" state, no coachmark/overlay library. (If a listed section's module is disabled for the member,
  the client omits that line; the tour is purely informational.) This satisfies the "walks a new user
  through the now-real sections" exit criterion without building a tour engine.

All member steps are individually skippable and the whole flow is skippable; the wizard never blocks
on a not-done step. Styling reuses the existing `panel` / `connect-steps` / `primary-button` /
`ghost-button` classes (`apps/web/src/styles.css`), the same vocabulary as `ConnectGooglePanel`.

- **Depends on:** the Phase-2 `OnboardingWizard` spine; `getOnboardingStatus`, the member
  complete/skip client functions; `ConnectGooglePanel`; `listConnectorAccounts` and (for the optional
  opt-out display) `listAiProviders` (`apps/web/src/api/client.ts`); React Router (the dep `app.tsx`
  already uses). The wizard mounts outside the full `AppShell`, like `PendingApprovalScreen`
  (`apps/web/src/app.tsx:124-136`).

### 5. `app.tsx` branch — generalized to fire for members

- **What it does:** the Phase-2 onboarding branch (which fires only for `isInstanceAdmin &&
isBootstrapOwner`) is generalized so it **also** fires for an **active member** whose per-user
  onboarding is incomplete. Concretely, after `meQuery` resolves to a user with `status === "active"`:
  - **Founder** (`isBootstrapOwner`): unchanged — run the founder `onboardingStatusQuery`; if
    `!completed && !skipped`, render `<OnboardingWizard/>` (Phase-2).
  - **Member** (not `isBootstrapOwner`): run the (now member-shaped) `onboardingStatusQuery`; if
    `!completed`, render `<OnboardingWizard/>` (member step array). On completion, the client
    invalidates `queryKeys.onboarding.status` and the branch falls through to the app shell.
  - The query stays `enabled` only for active users and is keyed on `queryKeys.onboarding.status`
    (Phase-2 namespace, reused).
- **How it's used:** this mirrors the existing `account_pending`/`deactivated` branch shape exactly
  (`apps/web/src/app.tsx:61-67`) — a single early `return` before the `<BrowserRouter>` app-shell
  render. A founder who has finished onboarding and a member who has finished onboarding both fall
  straight through to the shell.
- **Does NOT touch `/api/bootstrap/status`.** That unauthenticated probe is by-design metric-free
  (OTNR-P4 #122); onboarding status remains an authenticated endpoint.
- **Depends on:** the member-shaped fields on the Phase-2 `OnboardingStatusResponse` shared contract
  (§Components 6); the `queryKeys.onboarding` namespace (Phase-2). No `app.tsx` structural change
  beyond generalizing the branch predicate.

### 6. Shared contracts (`packages/shared/src/platform-api.ts`)

- **What changes:** the Phase-2 `OnboardingStatusResponse` is widened to a **discriminated union on
  `role`** (`"founder" | "member"`) — the founder variant keeps the Phase-2 fields; the member
  variant carries `{ role: "member", completed: boolean, steps: { apiKeyOptOut: { done: boolean },
connectors: { done: boolean } } }`. The complete/skip route schemas (Phase-2) are unchanged in
  shape (no body); their handlers branch on role server-side. Add the response-schema variant + the
  TS union; export from the barrel (`packages/shared/src/index.ts:14` already re-exports
  `platform-api`).
- **What must NOT change:** `UserDto` (`platform-api.ts:3-12`) gains **no** onboarding field — per-user
  onboarding state is read only through `getOnboardingStatus`, never leaked on the admin user list.
- **Depends on:** the Phase-2 onboarding contracts existing (this slice extends them, not creates
  them — coordinate at build time per §Open risks). `queryKeys.onboarding` namespace already exists
  from Phase-2 (`apps/web/src/api/query-keys.ts`).

---

## Data flow

1. Founder approves a pending member via `POST /api/admin/users/:id/approve`
   (`packages/settings/src/routes.ts:172-201`) → member row `status` flips `pending → active`,
   audited.
2. Member signs in (fresh session, since `pending` blocked app access). Web shell calls
   `GET /api/me`; `resolveRequestAccessContext` authenticates and confirms `status === "active"`
   (`packages/auth/src/index.ts:314-327`); `serializeUser` returns the member `UserDto` with
   `isBootstrapOwner: false` (`routes.ts:483-494`).
3. `app.tsx`, seeing an active non-bootstrap user, runs the member `onboardingStatusQuery` →
   `GET /api/onboarding/status`. The handler's `withDataContext` runs `requireKnownUser` (not
   `assertAdminUser`) + `getMemberOnboardingState(scopedDb, actorUserId)`, reading the member's **own**
   `app.users.onboarding_completed_at` via the self-row SELECT policy.
4. `onboarding_completed_at IS NULL` → `completed: false` → `app.tsx` renders `<OnboardingWizard/>`
   with the **member step array**. The member works steps:
   - `MemberWelcomeStep`: read-only welcome + skip.
   - `ApiKeyOptOutStep` (optional): skip to use the inherited shared CLI, or follow the link into
     Assistant & AI advanced settings to enter a personal key (encrypted at rest by the shipped AI
     settings path).
   - `MemberConnectorStep`: `ConnectGooglePanel` OAuth → a per-user connector account is created
     (`owner_user_id = app.current_actor_user_id()`); the client marks the step done when
     `listConnectorAccounts()` returns ≥1.
   - `SectionTourStep`: client-only section list; "Done" advances.
5. Member clicks Finish (or Skip on any step / Skip setup) → `POST /api/onboarding/complete` (or
   `/skip`, which for a member routes to the same completion) → `setMemberOnboardingComplete` stamps
   `onboarding_completed_at = now()` on the member's own row (self-row UPDATE), audited
   (`onboarding.member_complete`) → client invalidates `queryKeys.onboarding.status` → `app.tsx`
   branch falls through → app shell renders.
6. Re-entry: if the member reloads before finishing, status re-derives `completed: false` and the
   wizard resumes at the first not-done step (resumability is a pure function of derived flags +
   per-user completion). After completion, `onboarding_completed_at` is set and the member is never
   re-prompted.
7. Isolation at every step: connector accounts, AI keys, vault, memory, chat, tasks, and wellness
   data the member touches are owner-scoped (owner-only RLS); the founder/admin cannot read them
   (proven by the extended `multi-user-isolation` suite, §Testing).

---

## Error handling

- **Member status read failure** (DB down, etc.): the status query uses `retry: false` like the
  other auth queries (`apps/web/src/app.tsx:25-26`). On error, fall through to the normal app shell
  rather than trapping the member in a broken wizard — onboarding is optional, so a status error must
  never block app access. Surface a dismissible inline notice. (Same posture as the Phase-2 founder
  branch.)
- **Member completion write failure:** the wizard surfaces the error inline and keeps the member on
  the step (the write is idempotent — `onboarding_completed_at` is a plain timestamp set on the
  actor's own row; retrying re-stamps harmlessly). The member can also just skip again.
- **A member somehow hitting the founder branch (or vice versa):** the handler keys the response on
  the **server-read** `isBootstrapOwner`, not on a client-supplied role, so a member can never coax
  the founder shape; the self-row RLS on `app.users` is the backstop (a member's query returns only
  its own row regardless of handler logic).
- **Pending / deactivated member hitting any onboarding route:** `resolveRequestAccessContext`
  throws first → 403 with `account_pending_approval` / `account_deactivated`
  (`auth/src/index.ts:322-327`), mapped by the settings module error handler
  (`routes.ts:523-541`); `app.tsx` already renders the pending/deactivated screens for these codes
  (`app.tsx:61-67`). A non-active user never reaches the wizard.
- **Connector OAuth failure** in `MemberConnectorStep`: handled entirely by the reused
  `ConnectGooglePanel` (`setError`, `connect-google-panel.tsx:14,101`). Onboarding adds nothing.
- **API-key opt-out:** never makes a failing call — it either skips (no I/O) or links into the
  shipped Assistant & AI advanced settings pane, whose own error handling applies.

---

## Security & invariants

Cites the CLAUDE.md "Hard Invariants" this slice touches:

- **No admin private-data bypass / RLS applies to all actors (the headline invariant).** Per-user
  onboarding state lives on `app.users` under a **self-row SELECT** policy
  (`id = app.current_actor_user_id()`, `0045:85-88` / `0047:23-29`); the admin policy on the same
  table is **UPDATE-only** (`0050:118-124`). So an admin/founder, acting through `app_runtime`,
  **cannot read another member's** `onboarding_completed_at` — the same boundary the
  `multi-user-isolation` admin-bypass test already proves for tasks/vault/secrets. The slice also
  leaves the SECURITY DEFINER cross-user helpers (`get_user_by_id`/`list_all_users`) **without** the
  new column so the admin user-list path can never surface it.
- **Private by default.** The new column defaults NULL and is per-account; connectors/AI keys/vault
  the member configures during onboarding stay owner-only (existing owner-only RLS on those tables).
- **DataContextDb only.** Both new repository methods (`getMemberOnboardingState`,
  `setMemberOnboardingComplete`) take a branded `DataContextDb` and call `assertDataContextDb(scopedDb)`
  first (the per-method pattern, `repository.ts:47-53`). No root Kysely instance crosses the
  repository boundary; no nested `withDataContext`.
- **AccessContext shape frozen.** The generalized status/complete handlers read only
  `accessContext.actorUserId` and `accessContext.requestId`; nothing is added (Slice 1f;
  `workspaceId` stays removed).
- **Secrets never escape.** The member flow surfaces **no** secret-shaped field: the status response
  carries booleans + a timestamp-derived `completed`; the API-key opt-out writes nothing (key entry,
  if chosen, flows through the shipped AI settings, AES-256-GCM at rest, never returned); the
  connector step reuses `ConnectGooglePanel`, whose encrypted-at-rest secret handling is already
  shipped.
- **Module isolation.** Onboarding lives in `packages/settings`. It reads per-user onboarding state
  from `app.users` (an app-level table, not a module's owned table). It **does not** query the
  connectors module's `app.connector_accounts` or the AI module's tables — the member's
  connectors/AI step `done` flags are derived client-side from those modules' **declared public
  endpoints** (`GET /api/connectors/accounts`, `listAiProviders`). The section tour links to module
  routes; it imports no module internals.
- **Never edit applied migrations / app-level SQL placement.** This slice adds **one new** migration
  file with the next global number (never edits an applied file; the runner hash-checks). The column
  lives in `infra/postgres/migrations/` because `app.users` is core platform schema with no owning
  module (the `0050_multi_user_accounts.sql` precedent), not in a module `sql/` dir.
- **Audit member completion.** The member-complete write records an `admin_audit_events` row
  (`onboarding.member_complete`) via the settings audit path, so every onboarding terminal action
  (founder and member) is durably recorded.
- **Provider-agnostic AI.** The optional API-key opt-out and the inherited shared-CLI path hardcode
  no provider or model — key entry flows through the existing provider-agnostic Assistant & AI
  advanced settings pane / capability router; onboarding requests no specific provider.

---

## Testing strategy

- **Migration:** a settings/foundation integration assertion that `app.users.onboarding_completed_at`
  exists, defaults NULL, and that the migration does **not** alter the users RLS policy set or weaken
  the 0045/0046 FORCE-RLS posture (re-run `pnpm db:migrate`; hash-check unaffected for prior files).
- **`getMemberOnboardingState` / `setMemberOnboardingComplete` (settings integration suite):** with a
  real approved member (full sign-up → approve), assert `getMemberOnboardingState` returns
  `completedAt: null` initially; `setMemberOnboardingComplete` stamps it; a re-read returns non-null;
  a member **cannot** read or write another member's row (self-row RLS — a cross-user
  `setMemberOnboardingComplete` updates zero rows). Both via `withDataContext`, `DataContextDb`-typed.
- **`GET /api/onboarding/status` per-actor branch:** a founder gets the founder shape; an approved
  member gets the member shape with `completed` reflecting their own column; `requireKnownUser`
  (not admin-gate) admits the member; a pending member 403s with `account_pending_approval`.
- **`POST /api/onboarding/complete` + `/skip` (member):** both stamp `onboarding_completed_at`, write
  an `admin_audit_events` row (`onboarding.member_complete`), and leave `AccessContext` unchanged
  (no extra fields).
- **Extend `tests/integration/multi-user-isolation.test.ts` (the CI gate, exit criterion #3):** the
  suite already provisions real users with full sign-ups and proves admin-bypass + member-to-member
  isolation for tasks/auth_accounts (`multi-user-isolation.test.ts:60-138`). Add cases covering the
  **secondary-onboarding path + the remaining per-user surfaces**:
  - member's `onboarding_completed_at` is invisible to the founder/admin and to another member
    (self-row SELECT); admin user-list (`GET /api/admin/users`) never includes it.
  - per-user **connectors**: member B cannot read member A's connector account metadata; admin
    cannot read A's connector secrets (reuse the existing connector-account owner-scoping).
  - per-user **AI keys**: B cannot read A's AI provider config; admin cannot.
  - per-user **vault**: B cannot read A's vault files (via `VaultContext`); admin cannot.
  - per-user **memory**: B cannot read A's memory facts; admin cannot.
  - per-user **chat**: B cannot read A's chat threads/messages; admin cannot.
  - per-user **wellness**: B cannot read A's wellness data; admin cannot.
  - lifecycle stitch: an approved member completing onboarding sets only its own column; a second
    member starts with NULL (per-user, not instance-global).
- **Wizard role selection / skippability / resumability (Playwright with mocked REST,
  `tests/e2e/mock-*.ts`):** a member (`isBootstrapOwner: false`, `completed: false`) sees the
  **member** step array (welcome / optional API-key opt-out / connector / section tour) and **no**
  CLI-auth or multiplexer step; "Skip setup" on any step reaches the app shell; after complete, the
  member sees the shell; re-entry resumes at the first not-done step; a status error falls through to
  the shell. A founder still sees the founder step array (regression).
- **Manual acceptance (NOT a code task — milestone checklist item):** epic #49 exit criterion #2 —
  **Ben approves Katherine; Katherine signs in, runs the member wizard end-to-end on Ben's instance,
  connects her own Google, and uses Jarv1s as a real second user.** This is the real-human evidence
  that cannot be automated; record it as a milestone checklist item with a short written sign-off, not
  a test.
- **Gate:** `pnpm verify:foundation` green (lint, format, file-size <1000 lines/file, typecheck,
  migrate, integration) **including** the extended `multi-user-isolation` suite. Stop any
  `dev:worker` before running (it steals pg-boss jobs; integration tests reset the shared dev DB).

---

## Acceptance criteria

1. A new app-level migration in `infra/postgres/migrations/` adds
   `app.users.onboarding_completed_at timestamptz` (nullable, default NULL), **adds no new users RLS
   policy**, and does not weaken the 0045/0046/0047/0050 posture; `UsersTable`
   (`packages/db/src/types.ts`) gains the column but `UserDto`/`serializeUser` do **not**.
2. `GET /api/onboarding/status` resolves **per actor**: the founder gets the unchanged instance-global
   founder shape; a member gets `{ role: "member", completed, steps: { apiKeyOptOut, connectors } }`
   with `completed` read from the member's **own** `onboarding_completed_at`; the endpoint admits an
   active member via `requireKnownUser` (not `assertAdminUser`).
3. `POST /api/onboarding/complete` and `POST /api/onboarding/skip` for a member stamp
   `onboarding_completed_at = now()` on the member's own row (self-row UPDATE), write an
   `admin_audit_events` row (`onboarding.member_complete`), and leave `AccessContext` unchanged; the
   founder branch is unchanged (instance-global keys).
4. The **same** `OnboardingWizard` route tree is reused, parameterized by role: founder-only steps
   (multiplexer install, instance/registration settings, CLI-auth) are **hidden** for members; the
   member step array is welcome+skip / optional skippable API-key opt-out / connector (reusing
   `ConnectGooglePanel` verbatim) / client-only section tour. There is **no CLI-auth step** for
   members (ADR 0007 §4 — shared host CLI inherited).
5. The member API-key opt-out step is **optional and skippable** and never gates progress; the
   section tour is **client-only** (no coachmark engine, no persisted "tour seen" state) and lists
   Tasks / Calendar / Email / Briefings / Wellness / Notifications / Settings, one line each.
6. `apps/web/src/app.tsx` generalizes the onboarding branch to fire for an **active member** whose
   per-user onboarding is incomplete (and keeps firing for the founder per instance-global state),
   mirroring the `account_pending` branch shape, and does **not** call or modify
   `/api/bootstrap/status`.
7. The member's connector-done and API-key-done flags are derived **client-side** from the
   connectors/AI modules' declared public endpoints (`listConnectorAccounts`, `listAiProviders`); the
   settings status endpoint does **not** query `app.connector_accounts` or AI tables (module
   isolation).
8. Shared contracts: `OnboardingStatusResponse` is widened to a `role`-discriminated union (founder |
   member) in `packages/shared/src/platform-api.ts` and exported from the barrel; `UserDto` gains no
   onboarding field; the `queryKeys.onboarding` namespace is reused.
9. No secret-shaped field appears in any member onboarding response; `AccessContext` unchanged; member
   completion is audited; the new column is read only via the self-row path, never via the cross-user
   SECURITY DEFINER helpers.
10. `tests/integration/multi-user-isolation.test.ts` is extended to cover the secondary-onboarding
    path (per-user `onboarding_completed_at` invisible across users + to admin) **and** the remaining
    per-user surfaces (connectors, AI keys, vault, memory, chat, wellness), as the CI isolation gate.
11. `pnpm verify:foundation` green (lint, format, file-size, typecheck, migrate, integration),
    including the new unit + integration + extended isolation tests.
12. (Milestone, manual, not code) Katherine onboards and uses Jarv1s as a real second user on Ben's
    instance with a written sign-off (epic #49 #2).

---

## Out of scope / deferred

- **Member multiplexer install / CLI-auth.** Locked out by ADR 0007 §4 — members inherit the shared
  host CLI the founder provisioned in Phase 2. The member wizard has no such steps; the optional
  API-key opt-out is the only AI-related member step.
- **A coachmark / guided-tour engine.** The section tour is a single client-only informational panel;
  no overlay library, no per-step coachmarks, no persisted "tour seen" state.
- **A separate member "skipped" state.** A member who skips is terminally onboarded
  (`onboarding_completed_at` stamped); there is no half-finished member state to model (unlike the
  founder's instance-global provisioning, which keeps a distinct `skipped` key).
- **Surfacing per-user onboarding state on the admin user list.** `UserDto` deliberately omits it;
  the cross-user SECURITY DEFINER helpers are deliberately left unchanged.
- **A "re-run onboarding" affordance for members.** Re-prompting a member would mean clearing
  `onboarding_completed_at`; a small admin/self follow-up, not required for the Katherine acceptance
  run. Noted so it is not forgotten.
- **The Phase-2 founder onboarding itself** (multiplexer/CLI-auth/instance-settings provisioning, the
  Jarvis chat overlay) — owned by the primary-onboarding slice this slice depends on. This slice only
  generalizes the shared spine and adds the member step list + per-user state.
- **Connector/AI/vault feature work.** This slice reuses the shipped per-user connector, AI, and
  vault surfaces verbatim; it does not modify them.

## Open risks

- **Depends on the Phase-2 primary-onboarding slice landing first.** This slice **extends**, not
  creates, the `OnboardingWizard` route tree, the `GET /api/onboarding/status` contract, the
  `OnboardingStatusResponse` shared type, the `/api/onboarding/complete` + `/skip` routes, the
  `queryKeys.onboarding` namespace, and the `app.tsx` onboarding branch. If built before that slice
  merges, there is nothing to generalize. **Sequence after the Phase-2 slice**, or coordinate at
  build time (run manifest / herdr-pane-message) so the spine is authored once and this slice consumes
  it. Building the two in parallel risks duplicate definitions of the wizard, the status contract, and
  the `app.tsx` branch (typecheck/route-collision failures).
- **Correcting the Phase-2 connector-done derivation.** The Phase-2 spec derives the founder's
  `connectors.done` **server-side** in the settings status endpoint "through the connectors module's
  account list" — but reading `app.connector_accounts` from `packages/settings` would break module
  isolation (settings querying a connectors-owned table). This slice derives the **member**
  connector-done client-side via the connectors module's public `GET /api/connectors/accounts`. At
  build time, confirm the founder path also avoids a direct cross-module table read (use the public
  endpoint or a declared connectors API), so neither role couples settings to connectors' schema.
- **Column-on-`app.users` vs. new `onboarding_state` table (steelman of the rejected option).** A new
  table would be the "purest" module-owned home and would avoid widening core `app.users`. But
  `app.users` already carries per-account state (`status`, `is_bootstrap_owner`) **with the exact
  self-row SELECT/INSERT/UPDATE policy set we need already in place** (0045/0047/0050); a new table
  would require re-authoring those three policies + FORCE-RLS posture from scratch and adding a JOIN
  to the hot status path, for no isolation benefit (the same self-row predicate). The column is the
  finish-not-rearchitect choice (ADR 0009). If a future slice needs richer per-user onboarding
  telemetry (multiple flags, timestamps per step), promoting to a table is a clean follow-up — the
  column is forward-compatible (a table could carry the same `completed_at`).
- **Member-state read must use the self-row path, not the SECURITY DEFINER helpers.** If a future
  refactor routes the member read through `app.get_user_by_id` (cross-user, admin-capable) "for
  convenience", it must **not** add `onboarding_completed_at` to that helper's return columns — doing
  so would let the admin user-list path surface another member's onboarding state. The spec keeps the
  member read on the plain self-row `selectFrom("app.users")` precisely to avoid this; flag any PR
  that touches the helpers.
- **Migration number is global**, assigned by landing order (current high-water mark `0064`); do not
  hardcode it. Coordinate ordering with any sibling slice that also adds a migration.
- **Wellness surface assumption.** Epic #49 / the section tour list includes "Wellness"; confirm at
  build time that a wellness module/route exists (the isolation test must target real owner-scoped
  wellness tables). If Wellness is not yet shipped, the tour line is omitted client-side and the
  wellness isolation case is deferred to that module's slice — note it explicitly rather than
  asserting against a non-existent table.
- **Manual acceptance can't be CI-gated.** Exit criterion #2 (Katherine) is real-human evidence; the
  automated gate is the extended `multi-user-isolation` suite. The build must not block on the manual
  run — ship the code + green isolation suite, then schedule the Katherine session as a milestone
  checklist item.
