# Phase 2 · Slice A — Multi-user accounts (self-registration + admin lifecycle)

**Status:** approved (2026-06-10)
**Epic:** #47 (Phase 2 · Portable, Deployable & Multi-user)
**Risk tier:** security (touches auth · sessions · accounts · RLS)
**Decisions:** ADR 0007 (house model), ADR 0008 (per-instance onboarding), ADR 0009 (finish-not-rearchitect)

## Problem

Jarv1s is built for the "house" model (ADR 0007): one self-hosted instance, multiple
household accounts (Ben + Katherine + ...), each with its own private data. Today the
instance bootstraps a single admin (first user) and there is **no controlled way to add a
second account** — better-auth's `/api/auth/sign-up/email` is open to any visitor, and there
is no per-account lifecycle (approve / deactivate / remove) or proof that one user's secrets
are isolated from another's.

This slice delivers controlled multi-user account creation and lifecycle management, and —
critically — **proves auth-secret isolation with a real second user**, including that an
instance-admin still cannot read another user's private content (CLAUDE.md's hardest
invariant: admin power is configuration power only).

This is the security foundation the rest of Phase 2 (portable chat adapter, deploy image,
onboarding) builds on.

## Non-goals

- **No admin-invite / temp-password flow.** Account creation is self-registration only; the
  admin shares a link. (Considered and explicitly dropped — the approval gate gives the admin
  the same control without password-handoff friction. Reverses the epic's original
  "admin-invite" wording by product decision.)
- **No push notification** to the admin when an approval is pending — the admin glances at the
  admin panel. (Deferrable to a later slice if it proves annoying.)
- **No polling / live auto-advance** of the "awaiting approval" screen — the user refreshes
  after approval.
- **No use of better-auth's `admin` plugin.** Its parallel `role`/`banned` model competes with
  our `is_instance_admin` + RLS authority and operates beside (not through) the RLS we are
  proving. We own the lifecycle in the app layer instead (see Approach below).
- Onboarding wizard, multiplexer install, deploy image — separate Phase 2 slices.

## Chosen approach (and the fork we rejected)

**Own the account lifecycle in the app layer; keep better-auth doing only credentials +
sessions.** Add a `status` state machine to `app.users`, drive all transitions through the
existing `settings` admin routes + `requireAdmin` guard + `admin_audit_events`, and enforce
status at the single `resolveAccessContext` chokepoint every request already passes through.

**Rejected — lean on better-auth's `admin` plugin** (ban/role/listUsers/removeUser). It
introduces a second authorization model (`role` string + `banned` flag) that must be mapped
to and kept in sync with our `is_instance_admin` + RLS world, runs user mutations as the auth
role _outside_ the RLS reasoning hardened in migrations 0045/0046, and still does not model
"pending approval" (we'd build that anyway). Its "less plumbing" is illusory: the mapping +
sync cost exceeds the ~20 lines of session-revocation that the app-layer approach needs. The
whole point of this slice is to _prove_ isolation through RLS — a parallel admin model works
against that. (`hybrid` was also rejected: two models plus glue is the worst of both.)

This is the "finish-not-rearchitect" path (ADR 0009): `is_instance_admin`, `requireAdmin`,
`admin_audit_events`, and `/api/admin/*` routes already exist — we extend them, single source
of authority stays RLS.

## Architecture

### 1. Data model (one new migration, next global number assigned at landing)

All changes are additive; module SQL placement follows the migration invariants (never edit an
applied migration; new file only).

**`app.users` — two new columns:**

```sql
ALTER TABLE app.users
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'deactivated')),
  ADD COLUMN is_bootstrap_owner boolean NOT NULL DEFAULT false;
```

- `status` — `pending` (created under the approval gate; valid credentials, no app access),
  `active` (normal), `deactivated` (admin-suspended; login blocked, sessions revoked, data
  preserved). Default `active` so existing rows and the bootstrap owner stay active; backfill
  explicit in the migration.
- `is_bootstrap_owner` — marks the founding admin durably (not inferred from `created_at`,
  which is fragile under import/backfill). Set once for the first user.

**`app.instance_settings` — two registration controls** (key/value table; admin upsert routes
already exist):

| Key                              | Values               | Default  | Meaning                                           |
| -------------------------------- | -------------------- | -------- | ------------------------------------------------- |
| `registration.enabled`           | `"true"` / `"false"` | `"true"` | When false, sign-up endpoint refuses new accounts |
| `registration.requires_approval` | `"true"` / `"false"` | `"true"` | When true, new sign-ups land in `pending`         |

**Safe-by-default:** the door is open (matches the "admin shares a link" model) but a stray
shared URL cannot auto-admit a stranger — the admin confirms each one. The admin can drop the
approval gate anytime for a trusted household.

RLS note: the new columns live on `app.users`, which already has ENABLE RLS (migration 0045)
with owner-only self-row policies for runtime roles. Status reads happen via the auth/admin
paths that already touch `users`; no new policy surface on secret tables. The migration must
not weaken the 0045/0046 posture (FORCE RLS on `auth_accounts` / `better_auth_sessions`).

### 2. Registration, approval & access enforcement (in `packages/auth`)

Three chokepoints:

**(a) Sign-up gating — better-auth `databaseHooks.user.create.before`.**
Reads `registration.enabled`; if `false`, throws → sign-up rejected. (New hook; today only an
`after` hook exists.)

**(b) Status assignment — extend the existing `after` hook (`bootstrapFirstJarvisUser`).**
Keeps the advisory-lock + first-user detection. Adds the status/owner decision:

- First user → `status = 'active'`, `is_instance_admin = true`, `is_bootstrap_owner = true`
  (existing workspace + audit bootstrap unchanged).
- Subsequent users → `status = 'pending'` if `registration.requires_approval` is on, else
  `'active'`; `is_instance_admin = false`, `is_bootstrap_owner = false`.

**(c) Access enforcement — `resolveRequestAccessContext` (the single chokepoint).**
After resolving the session → user, check `status`:

- `active` → proceed (returns `{ actorUserId, requestId }` — `AccessContext` shape unchanged).
- `pending` → throw typed `AccountPendingApprovalError`.
- `deactivated` → throw typed `AccountDeactivatedError`.

Both map to **HTTP 403** with distinct machine-readable codes (`account_pending` /
`account_deactivated`). Every API route already flows through this resolver, so a non-active
user is locked out everywhere with zero per-route changes.

**Session revocation on deactivate (~20 lines).** When an admin deactivates a user, delete
that user's `better_auth_sessions` rows via the `jarvis_auth_runtime` role so live sessions die
immediately, not just at next login.

**Bearer-token path:** the legacy `AuthSessionResolver` path (CLI bridge) must apply the same
status check — fold the check into the shared resolution so both the better-auth and
bearer-token branches enforce it.

### 3. Frontend (in `apps/web`)

- On a **403 + `account_pending`** code, the web shell renders an **"Awaiting approval"** screen
  instead of the app — the user stays signed in, just gated; they refresh after approval (no
  polling). `resolveAccessContext` returns `active` on the next request and the app loads.
- On **403 + `account_deactivated`**, render "Your account is no longer active" + sign-out.
- Extend the existing admin settings section (already gated behind `isInstanceAdmin`):
  - **Pending approvals** list (approve / reject), shown only when any exist.
  - **Users** table: status badge, deactivate / reactivate, promote / demote, delete (with
    confirm dialog).
  - **Registration** control: the two-toggle pair (enabled, requires-approval).

### 4. Admin management surface (in `packages/settings`)

New routes, all behind the existing `requireAdmin` guard, all writing an `admin_audit_events`
row (actor, action, target):

| Route                                          | Action                                                        |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/admin/users` _(extend)_              | return `status` + `is_instance_admin` + `is_bootstrap_owner`  |
| `POST /api/admin/users/:id/approve`            | `pending → active`                                            |
| `POST /api/admin/users/:id/reject`             | delete the never-activated pending account (plain row delete) |
| `POST /api/admin/users/:id/deactivate`         | `active → deactivated` + revoke sessions                      |
| `POST /api/admin/users/:id/reactivate`         | `deactivated → active`                                        |
| `POST /api/admin/users/:id/promote`            | set `is_instance_admin = true`                                |
| `POST /api/admin/users/:id/demote`             | set `is_instance_admin = false`                               |
| `DELETE /api/admin/users/:id`                  | full teardown via the `delete:user` script path               |
| `GET` / `PUT /api/admin/settings/registration` | read / write the two registration settings                    |

Shared contracts (`packages/shared/*-api.ts`) get the new request/response schemas; the
`settings` repository gets the corresponding methods. `delete` reuses the existing `delete:user`
teardown logic (do not duplicate teardown).

### 5. Guardrails (repository/service layer + DB backstop where cheap)

- **At-least-one-admin:** demote / deactivate / delete is refused if the target is the only
  remaining **active** instance-admin. Typed error; surfaced as 409/422.
- **Bootstrap-owner protection:** the `is_bootstrap_owner` user cannot be demoted, deactivated,
  or deleted by anyone other than themselves — prevents a second admin locking out the founder.
- **No self-lockout:** an admin cannot demote / deactivate / delete their own account in a way
  that drops the instance below one active admin.

Enforce in the service layer (clear typed errors) with a DB-level CHECK/trigger backstop where
inexpensive, so the invariant holds even outside the app path.

## Security verification (the exit gate)

New integration suite `multi-user-isolation` (runs in `pnpm verify:foundation`). Provisions two
genuinely separate real users (A + B — full sign-up path, real sessions) plus an admin user.

**Positive isolation — A cannot reach B:**

- `auth_accounts` (OAuth tokens, password hash)
- `better_auth_sessions` (cannot read or reuse B's session)
- connector credentials (encrypted OAuth tokens never surface across users)
- AI provider keys
- vault files (via `VaultContext`)
- representative per-user tables (tasks, memory, chat) — owner-only RLS holds for a _real_
  second user, not just synthetic contexts

**Admin-bypass negative test (headline assertion):** an instance-admin user, acting through
normal app routes, **still cannot read another user's private content** — not vault, not
connector secrets, not tasks/memory. Locks in CLAUDE.md: admin power is configuration power
only; RLS applies to admins too. If admin can read B's data, the slice has failed.

**Lifecycle assertions:**

- sign-up blocked when `registration.enabled = false`
- sign-up lands `pending` when approval on, `active` when off
- `pending` user → every app route 403s with `account_pending`
- `deactivated` user → live sessions die immediately (revocation works), login blocked
- guardrails → cannot demote / deactivate / delete the last active admin or the bootstrap owner

## Acceptance criteria

- [ ] Migration adds `status` + `is_bootstrap_owner` to `app.users` and seeds the two
      registration settings; does not weaken the 0045/0046 RLS posture.
- [ ] Self-registration honors `registration.enabled` and `registration.requires_approval`;
      first user is `active` admin + bootstrap owner.
- [ ] Status enforced at `resolveAccessContext` for **both** the better-auth and bearer-token
      paths; `pending`/`deactivated` → 403 with distinct codes.
- [ ] Admin routes (approve/reject/deactivate/reactivate/promote/demote/delete + registration
      settings) work, are `requireAdmin`-gated, and write audit events.
- [ ] Deactivation revokes live sessions immediately.
- [ ] Guardrails enforced (at-least-one-admin, bootstrap-owner, no self-lockout), DB-backstopped.
- [ ] Frontend "awaiting approval" + "deactivated" screens; admin UI for pending/users/registration.
- [ ] `multi-user-isolation` suite green, **including the admin-bypass negative test**.
- [ ] `pnpm verify:foundation` green (lint, format, file-size, typecheck, migrate, integration).

## Risks & notes

- **Security tier.** Merge requires the cross-model (Opus) adversarial QA pass that hunts
  _unproven trust boundaries_, a posted `gh pr comment` verdict, and Ben's explicit merge
  sign-off — never auto-merge.
- **Migration number is global**, assigned by landing order; do not hardcode it in the spec.
- **`AccessContext` shape is frozen** at `{ actorUserId, requestId }` — status is checked
  during resolution and must not be added to the context (Slice 1f invariant).
- **Integration tests reset the shared dev DB** (wipes users including `bendlove@gmail.com`); a
  running `dev:worker` steals pg-boss jobs — stop it before `verify:foundation`.
- Collision check: this slice owns `packages/auth`, `packages/settings`, `apps/web` admin UI,
  shared contracts, and a new migration. Coordinate migration ordering with any sibling slice
  that also adds a migration.
