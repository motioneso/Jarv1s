# Active Sessions List + Revoke Spec

Issue: #237
Status: approved for build
Owner: agent

## Current State

The Settings > Profile & account pane renders an `Active sessions` section in
`apps/web/src/settings/settings-profile-subviews.tsx`, but it is sample-state only:

- no list-sessions endpoint exists;
- revoke-one and revoke-all only mutate local component state;
- the UI shows `NotWired`;
- the Better Auth session table already stores session metadata in `app.better_auth_sessions`:
  `id`, `user_id`, `expires_at`, `created_at`, `updated_at`, `ip_address`, `user_agent`, and secret
  `token`.

Admin user management already has a coarse `revokeUserSessions(userId)` hook that deletes every
session for a target user. #237 needs a current-user, per-session version for the account settings
surface.

## Goal

Let a signed-in user inspect their own active sessions and revoke one session or all other sessions
without exposing session secrets or crossing user boundaries.

## Scope

1. Add shared API contracts for current-user session management.
   - `GET /api/me/sessions`
   - `DELETE /api/me/sessions/:id`
   - `DELETE /api/me/sessions/others`
   - Response DTO should expose only safe metadata:
     - `id`
     - `isCurrent`
     - `createdAt`
     - `lastSeenAt` from `updated_at`
     - `expiresAt`
     - `ipAddress` as nullable
     - `userAgent` as nullable
     - optional derived display fields if implemented server-side, such as `deviceLabel`, `browser`,
       `os`, `deviceKind`

2. Extend the auth/session boundary.
   - Add methods on `JarvisAuthRuntime` or a small auth-owned session service for:
     - list sessions for the current actor;
     - revoke one session owned by the current actor;
     - revoke all sessions for the current actor except the current session.
   - The settings route may call this boundary, but must not read or return session `token`.
   - Mutations must include `WHERE user_id = actorUserId`; a user must not be able to revoke another
     user's session by guessing an id.

3. Current-session handling.
   - `GET /api/me/sessions` must mark the request's current session as `isCurrent: true`.
   - Bulk revoke must preserve the current session.
   - Per-session revoke may omit/forbid current-session revocation in this UI. If the implementation
     chooses to support it, it must behave like sign-out and the client must transition accordingly.
   - Support both normal Better Auth cookie sessions and the hardened legacy bearer-session path
     without logging raw tokens.

4. Wire the Settings UI.
   - Replace the local `useState<SampleSession[]>` sample source with React Query calls.
   - Remove the `NotWired` banner after the real endpoint is used.
   - Keep destructive confirmation for revoke-one and revoke-all-others.
   - Show current session distinctly and do not offer the bulk action when there are no other
     sessions.
   - Use safe fallback labels when device/browser parsing is unavailable.

## Out of Scope

- Admin revoke sessions UI; that is covered by #230.
- Account deletion; that remains #239.
- Password/2FA management.
- GeoIP lookup or external location enrichment.
- Storing new browser fingerprinting data.
- Exposing raw session tokens, cookie values, bearer tokens, or token fingerprints through the API.

## Acceptance Criteria

- A user can list only their own non-expired sessions.
- The current session is identified correctly for cookie auth and bearer-session auth.
- Revoking one non-current session invalidates that session and removes it from the list.
- Revoking all other sessions preserves the current session and invalidates every other session owned
  by the same user.
- Guessing another user's session id does not reveal whether it exists and does not revoke it.
- API responses never include session tokens or auth secret payloads.
- Settings UI no longer shows `NotWired` for Active sessions.
- Tests cover list, revoke-one, revoke-others, current-session preservation, and cross-user
  isolation.

## Build Notes

- Keep session table access inside auth-owned code or an explicit auth/session service. Settings
  routes should depend on that service rather than hand-writing auth-table queries with a root DB
  handle.
- Treat `updated_at` as last-seen unless Better Auth exposes a more precise value.
- Device/browser labels can be basic; correctness of access control and revocation matters more than
  polished user-agent parsing in V1.
- Recommended order: build after #260 owner/admin bootstrap recovery, and before #238 data export or
  #239 account deletion.
