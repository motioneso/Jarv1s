# Profile Account Settings Cleanup Handoff

## Goal

Implement Ben's `/settings` Profile & account feedback:

1. Hide the email verification badge when the user is not verified.
2. Remove the non-functional "Sign-in security" provider-managed row.
3. Group duplicate-looking active sessions in the UI.

Keep this small. Do not add a new auth/device model.

## Base

Worktree: `~/Jarv1s/.claude/worktrees/profile-account-settings-cleanup`

Branch: `coord/profile-account-settings-cleanup`

Base: `origin/main`

## Relevant Files

- `apps/web/src/settings/settings-personal-panes.tsx`
- `apps/web/src/settings/settings-profile-subviews.tsx`
- likely one focused unit test under `tests/unit/`

Use codebase-memory MCP first for discovery if available, then fall back to file reads.

## Product Decisions

### Email verification

`user.emailVerified` is a Better Auth user field. It would become true if an OAuth/OIDC provider asserts a verified email, or if Jarv1s later adds a local email verification flow. Jarv1s does not currently expose a local "verify your email" action.

Desired UI: keep the "Verified" badge only when true. If false, do not render a "Not verified" badge.

### Sign-in security row

The provider-managed sign-in security row is non-functional. Remove it from the Account group.

### Session grouping

There is no stable device id today. `better_auth_sessions` has only session id, token, timestamps, IP, user agent, and user id. Do not add schema/API/device cookies for this task.

Group on the frontend by the displayed identity:

```ts
deviceLabel + browser + os + ipAddress
```

For each group:

- Show one row.
- Preserve the existing icon/device label/meta/IP display.
- If any grouped session is current, mark the row as current and do not show a revoke button.
- If the group has multiple sessions, show a compact count such as `3 sessions`.
- For a non-current group, "Sign out" should revoke every session in that group. Use the existing `revokeMySession(id)` mutation; no new API.
- "Sign out all others" should continue to use the existing bulk endpoint.

## Guardrails

- Ponytail mode: shortest correct diff wins.
- No new dependency.
- No schema/API change.
- Do not weaken session revoke safety.
- Do not expose raw bearer session IDs; use existing DTO ids only.
- Preserve accessibility basics.

## Checks

Run at minimum:

```bash
pnpm --filter @jarv1s/web typecheck
pnpm vitest run <focused-test-file>
```

If you add no test file because a suitable React SSR test is not practical, explain why and run a stronger nearby check. Prefer one small test.

## Start

1. Run `pnpm install` if `node_modules` is missing.
2. Read `AGENTS.md`, `CLAUDE.md`, and this handoff in full.
3. Inspect the relevant components and existing test patterns.
4. Implement the minimal change.
5. Run checks.
6. Commit the implementation.
7. Report commit SHA, checks, and caveats in the Herdr pane.
