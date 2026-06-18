# Account Card Real Status Spec

Issue: #236
Status: approved for build
Owner: agent

## Current State

The Profile & account pane already reads the signed-in user from `GET /api/me` and allows profile name/addressed-as updates through `PATCH /api/me/profile`.

The Account card still has two stale design-pass assumptions:

- The Email row always shows `Verified`, even though `app.users.email_verified` exists and Better Auth maps it as `emailVerified`.
- The Security row promises password and two-factor authentication but is only a `coming` placeholder. We are not building in-app auth-provider management right now; #231 was closed not planned, and provider setup remains operator/env configured unless that strategy changes.

## Goal

Make the Account card truthful and backed by real account state without introducing a broader auth-provider settings project.

## Scope

1. Expose email verification state through the existing `UserDto`.
   - Add `emailVerified: boolean` to `packages/shared/src/platform-api.ts`.
   - Include `emailVerified` in `userSchema`.
   - Populate it from `user.email_verified` in `packages/settings/src/routes.ts`.
   - Update any tests/fixtures that construct `UserDto`.

2. Replace the hard-coded Email badge in `apps/web/src/settings/settings-personal-panes.tsx`.
   - Show `Verified` only when `me.user.emailVerified` is true.
   - Show a distinct non-success state when false, such as `Not verified`.
   - Do not add fake verification actions unless an existing backend route already supports them.

3. Replace the fake Security promise with a truthful account/security row.
   - Remove the `coming` password/2FA wording from this card.
   - The row should communicate that sign-in security is managed by the configured auth provider / current sign-in method.
   - If #237 has already landed when this is built, link or scroll to the active-sessions section as the practical security management surface.
   - If #237 has not landed, keep the row read-only and do not imply password/2FA controls exist.

## Out of Scope

- Password change flows.
- 2FA enrollment or recovery.
- In-app auth-provider provisioning.
- Email verification/resend flows.
- Active sessions implementation; that remains #237.
- Account deletion; that remains #239.

## Acceptance Criteria

- `GET /api/me` includes `user.emailVerified` and validates against the shared route schema.
- The Account card email badge reflects the actual `emailVerified` value instead of always displaying `Verified`.
- The Account card no longer advertises unavailable password/2FA settings.
- The Security/account-status row is read-only unless an already-built route supports an action.
- Existing profile autosave behavior remains unchanged.
- Tests or type checks cover the changed DTO/schema/serialization surface.

## Build Notes

- This should be a small settings/API contract update.
- Prefer additive DTO/schema changes over adding a new account endpoint.
- Keep copy plain and operational; the card should not become a productized auth settings surface.
