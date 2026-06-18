# People & access: approval model cleanup + revoke sessions UI

Issue: #230
Status: Approved for build planning
Label: RFA

## Current state

The original settings design gap asked Jarv1s to decide between an Invite dialog
and the actual account model. That decision is already made: Jarv1s uses open
self-registration with an admin approval queue, not admin-created invites.

The backend already supports the core people/access lifecycle:

- list users;
- approve/reject pending users;
- deactivate/reactivate users;
- promote/demote admins;
- delete a user;
- read/update registration settings;
- revoke a user's sessions with
  `POST /api/admin/users/:id/revoke-sessions`.

The current People & access UI still has two residual gaps:

- an `Invite` button that only toasts "Invitations are coming soon";
- no per-member "revoke sessions" menu action, even though the backend route
  exists.

## Goal

Make People & access match the real product model:

- no fake invite affordance;
- clear path to registration controls;
- per-member session revocation available from the member action menu.

## Non-goals

- Do not build invite links, emailed invitations, pre-approved accounts, or
  role-at-invite-time.
- Do not change the account lifecycle state machine.
- Do not change the existing admin delete/deactivate semantics.
- Do not build the current-user active-session list from #237.

## Design

### Invite affordance

Replace the `Invite` button in `PeoplePane`.

Preferred behavior:

- label the action `Registration settings` or similar;
- open/navigate to the existing Identity & registration settings pane if the
  settings shell has a local view/navigation primitive available;
- otherwise remove the action and add a short note near the members list:
  "New people create an account, then wait for approval here."

Do not keep a button that promises invitations.

### Revoke sessions action

Add a new admin user action, `revokeSessions`, for eligible non-current users.

Eligibility:

- target exists in the member list;
- target is not the current user;
- action should be available for active and deactivated users, because stale
  sessions can exist around status transitions or browser state;
- it can be hidden for pending users because they should not yet have app access
  and pending rejection already deletes the account.

UI behavior:

- add a menu item: `Sign out everywhere` or `Revoke sessions`;
- show a destructive confirmation;
- on confirm, call `POST /api/admin/users/:id/revoke-sessions`;
- show success toast with the count returned by the backend, without exposing
  session IDs/tokens;
- invalidate the admin users query only if needed for consistency. Session
  revocation does not change the user row, so it may not need a refetch.

### API client

Add a typed client function in `apps/web/src/api/client.ts`:

```ts
export async function revokeAdminUserSessions(
  id: string
): Promise<{ success: boolean; count: number }>;
```

The shared route schema already exists for the backend route. Reuse its response
shape if exported; otherwise add/export the response type in `@jarv1s/shared`
without leaking session identifiers.

## Tests

Unit:

- admin policy returns `revokeSessions` for eligible non-current members and not
  for the current user or pending users;
- menu renders the revoke action when available.

E2E/UI:

- People & access no longer shows a fake `Invite` action;
- clicking revoke sessions opens a confirmation;
- confirming calls the backend and shows a count-only success message.

Integration:

- existing backend coverage for `POST /api/admin/users/:id/revoke-sessions`
  remains the source of truth: target sessions are revoked, caller survives, and
  response contains only count/success.

## Acceptance criteria

- The People & access UI no longer advertises invites as coming soon.
- The UI clearly communicates the approval-based join model.
- Admins can revoke another user's sessions from People & access.
- Revocation responses and toasts do not reveal session IDs, tokens, or raw auth
  table fields.
- The feature is covered by focused UI/unit tests plus existing backend
  integration coverage.
