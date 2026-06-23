# Self-service account deletion + deletion-matrix hardening

**Status:** Approved design — ready to build
**Date:** 2026-06-22
**Owner:** Ben
**GitHub:** #239
**Grounded on:** `origin/main` @ `15448ba` (current branch `docs/update-stale-documentation`,
docs-only ahead, source tree unchanged).
**Ordering:** after #237 (active sessions) and #238 (data export).
**⚠️ Final merge requires explicit Ben sign-off** (destructive account/security work).

---

## Goal

Give the owner a self-service "Delete my account" flow in Settings and harden the deletion
matrix so every module's user-owned tables are covered. The existing admin-path `deleteUserData`
function is reused and extended — no parallel deletion logic.

Success = in Settings on the deployed instance: the "Danger zone" row leads to a hard-
confirmation dialog that actually deletes the account when confirmed; all module tables owned
by the deleted user are removed; `pnpm verify:foundation` green.

---

## Architecture

### New endpoint: `DELETE /api/me/account`

In `packages/settings/src/routes.ts`, guarded by the existing `settings.manage` or a new
`settings.delete-account` permission (whichever is appropriate — preference is reusing
`settings.manage` to avoid proliferating granular permissions for single-use actions).

#### Hard confirmation

Request body:

```typescript
{
  confirmPhrase: string;
} // must equal "delete my account"
```

Returns `400` if `confirmPhrase` does not match exactly (case-insensitive). The phrase is
checked server-side; the client sends whatever the user typed.

Re-authentication is **not required** for this MVP — the existing session constitutes
sufficient proof. (Re-auth could be added later via a dedicated challenge endpoint; deferred
as it would require non-trivial auth-layer plumbing.) This decision must be noted in the
confirmation dialog copy.

#### Deletion flow

1. Validate the `confirmPhrase`.
2. Assert the user is not the last active admin (`assertNotLastActiveAdmin` — already in
   `scripts/delete-user-data.ts`; same guard reused).
3. Call `deleteUserData({ userId, actorUserId, requestId, execute: true })` (the canonical
   service). Do **not** duplicate table cleanup in the route.
4. Return `204 No Content`. The session cookie is now invalid (user row deleted); the
   client redirects to the sign-in page.

The route must not leak whether a `LastActiveAdminError` was thrown — return `409 Conflict`
with a safe message ("Cannot delete the last active administrator account") without
referencing the internal error type.

### Deletion matrix hardening (`scripts/delete-user-data.ts`)

The current matrix (lines 50–67) is missing all tables added after the initial settings
work. Add these entries:

```typescript
// Memory module
["app.memory_chunks",           "owner_user_id = $1::uuid"],
["app.memory_links",            "owner_user_id = $1::uuid"],
["app.chat_memory_facts",       "owner_user_id = $1::uuid"],
["app.chat_memory_suppressions","owner_user_id = $1::uuid"],

// Structured state
["app.commitments",             "owner_user_id = $1::uuid"],
["app.entities",                "owner_user_id = $1::uuid"],
["app.medications",             "owner_user_id = $1::uuid"],
["app.medication_logs",         "owner_user_id = $1::uuid"],
["app.preferences",             "owner_user_id = $1::uuid"],

// Wellness
["app.wellness_checkins",       "owner_user_id = $1::uuid"],
["app.wellness_therapy_notes",  "owner_user_id = $1::uuid"],

// Data export (from #238)
["app.data_export_jobs",        "owner_user_id = $1::uuid"],
```

**`app.data_export_jobs` depends on #238 landing first.** If #238 has not landed when this
builds, omit that entry and add it in the same PR that lands #238 (or a fast-follow).

#### Vault cleanup for exports

When `app.data_export_jobs` rows are deleted as part of the cascade, the export artifact
files under `{vaultBase}/{userId}/exports/` are already cleaned up by the existing
`deleteUserVaultDir` call in `deleteUserData` (which removes the entire user vault subtree).
No additional per-artifact cleanup is needed.

#### Order of deletion

The `deleteUserData` script deletes rows in table order. The new rows must be placed
**before** the `app.users` row deletion (which is already last). The recommended order
keeps module tables ahead of the root identity row. Modules with FK → `app.users` will
cascade on `ON DELETE CASCADE` where defined; the explicit delete is belt-and-suspenders
for tables where cascade is absent.

### Settings UI changes

**File:** `apps/web/src/settings/settings-profile-subviews.tsx`
(or wherever the Danger zone row currently lives — verify from the `NotWired` marker in
`settings-profile-subviews.tsx` or `settings-admin-panes.tsx`).

The "Delete account" row in Danger zone currently shows a "coming soon" placeholder. Replace
with:

1. **"Delete account" button** → opens a confirmation modal.
2. **Modal content:**
   - Warning heading: "This is permanent and cannot be undone."
   - Body copy: lists what will be deleted (profile, data, vault files, sessions).
   - Note: "You are currently signed in — no additional authentication is required for this
     action."
   - Text input: "Type **delete my account** to confirm."
   - Two buttons: "Cancel" / "Delete my account" (destructive style; enabled only when the
     phrase matches).
3. On confirm: `DELETE /api/me/account` with `{ confirmPhrase }`.
4. On `204`: redirect to `/` (sign-in page) with a query param `?deleted=1` so the page
   can show a confirmation message.
5. On `409` (last-admin guard): show inline error "This account is the last active
   administrator. Transfer ownership before deleting."
6. On `400` (phrase mismatch): this should not happen (button is disabled until phrase
   matches client-side), but show "Confirmation phrase did not match" if it does.

**StrictMode trap:** Do not call the delete mutation inside a `setState` updater — call it
directly from the `onClick` handler. (StrictMode double-fires updaters.)

---

## No migration

No new tables for this issue. The deletion-matrix update is code-only
(`scripts/delete-user-data.ts`). The `app.data_export_jobs` table comes from #238's
migration `0099`.

---

## Out of scope

- Re-authentication / password verification before deletion (deferred — needs auth-layer challenge API)
- Admin-initiated deletion of another user (already exists via the operator script)
- Scheduled / delayed deletion (immediate only)
- Download-before-delete reminder ("Export your data first") — the UI can suggest this as a
  non-blocking note but must not gate the deletion on having an export

---

## Acceptance criteria

- [ ] `DELETE /api/me/account` with `{ confirmPhrase: "delete my account" }` deletes the
      actor's account and returns `204`; subsequent API calls with the same session return
      `401`
- [ ] `DELETE /api/me/account` with the wrong phrase returns `400`
- [ ] User A cannot delete User B's account (`actorUserId` is always derived from the session,
      never from the request body)
- [ ] `deleteUserData` dry-run covers all tables in the updated matrix; counts include
      memory, structured-state, wellness, and export-jobs rows
- [ ] Last-admin guard: a sole admin account returns `409`
- [ ] Settings "Delete account" button opens the confirmation modal; the "Delete my account"
      button is disabled until the phrase matches exactly
- [ ] After successful deletion the browser navigates to `/` (sign-in page)
- [ ] No stack trace, error detail, or personal data appears in the `409`/`400` response bodies
- [ ] **Explicit Ben sign-off required before merge** — noted in PR description
- [ ] `pnpm verify:foundation` green
