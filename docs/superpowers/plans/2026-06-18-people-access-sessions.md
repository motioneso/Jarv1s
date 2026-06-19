# People Access Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fake invite UI and let admins revoke another user's sessions from People & access.

**Architecture:** Keep backend unchanged; existing `POST /api/admin/users/:id/revoke-sessions` remains source of truth. Add one shared count-only response type, one web client function, one policy action, and one menu/confirmation path. Since `PeoplePane` cannot switch settings sections directly today, replace Invite with a join-model note instead of adding navigation plumbing.

**Tech Stack:** React, TanStack Query, TypeScript shared API types, Vitest unit tests, Playwright e2e route mocks.

---

## File Structure

- Modify `packages/shared/src/platform-api.ts`: export count-only admin revoke sessions response type.
- Modify `apps/web/src/api/client.ts`: add `revokeAdminUserSessions(id)` typed client function.
- Modify `apps/web/src/settings/settings-admin-policy.ts`: add `revokeSessions` action for active/deactivated non-current, non-pending users.
- Modify `apps/web/src/settings/settings-admin-panes.tsx`: remove Invite button/toast, add approval-model note, render destructive `Sign out everywhere` action, toast only revoked count.
- Modify `tests/unit/web-settings-admin-policy.test.ts`: cover revoke policy eligibility.
- Modify `tests/e2e/mock-api.ts`: add minimal admin users/revoke route mocks and `createMockUser`.
- Modify `tests/e2e/app-shell.spec.ts`: cover no Invite action, confirmation, revoke POST, count-only success.

---

### Task 1: Policy Action

**Files:**

- Modify: `apps/web/src/settings/settings-admin-policy.ts`
- Test: `tests/unit/web-settings-admin-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Add these cases to `tests/unit/web-settings-admin-policy.test.ts`:

```ts
it("offers session revoke for active and deactivated non-current members", () => {
  const current = member({ id: "current", isInstanceAdmin: true });
  const active = member({ id: "active" });
  const deactivated = member({ id: "deactivated", status: "deactivated" });

  expect(adminUserActions(active, current, [current, active])).toContain("revokeSessions");
  expect(adminUserActions(deactivated, current, [current, deactivated])).toContain(
    "revokeSessions"
  );
});

it("does not offer session revoke for current or pending users", () => {
  const current = member({ id: "current", isInstanceAdmin: true });
  const pending = member({ id: "pending", status: "pending" });

  expect(adminUserActions(current, current, [current, pending])).not.toContain("revokeSessions");
  expect(adminUserActions(pending, current, [current, pending])).not.toContain("revokeSessions");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm vitest run tests/unit/web-settings-admin-policy.test.ts
```

Expected: TypeScript/Vitest fails because `"revokeSessions"` is not part of `AdminUserAction`.

- [ ] **Step 3: Implement minimal policy**

In `apps/web/src/settings/settings-admin-policy.ts`, change the action type and add helper:

```ts
export type AdminUserAction = "admin" | "deactivate" | "reactivate" | "remove" | "revokeSessions";

export function canRevokeAdminUserSessions(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser
): boolean {
  return !isCurrentUser(user, currentUser) && user.status !== "pending";
}
```

Then append the action in `adminUserActions` before `remove`:

```ts
if (canRevokeAdminUserSessions(user, currentUser)) actions.push("revokeSessions");
```

Update existing expected arrays in policy tests:

```ts
expect(adminUserActions(target, current, [current, target])).toEqual([
  "admin",
  "deactivate",
  "revokeSessions",
  "remove"
]);
```

```ts
expect(adminUserActions(target, current, [current, target])).toEqual([
  "admin",
  "reactivate",
  "revokeSessions",
  "remove"
]);
```

```ts
expect(adminUserActions(target, current, policy)).toEqual([
  "admin",
  "deactivate",
  "revokeSessions",
  "remove"
]);
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
pnpm vitest run tests/unit/web-settings-admin-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-admin-policy.ts tests/unit/web-settings-admin-policy.test.ts
git commit -m "feat: add admin session revoke policy" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 2: Typed Client

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add shared response type**

In `packages/shared/src/platform-api.ts`, near `RevokeMyOtherSessionsResponse`, add:

```ts
export interface AdminRevokeSessionsResponse {
  readonly success: boolean;
  readonly count: number;
}
```

- [ ] **Step 2: Add web client function**

In `apps/web/src/api/client.ts`, import `AdminRevokeSessionsResponse` from `@jarv1s/shared` and add near other admin user functions:

```ts
export async function revokeAdminUserSessions(id: string): Promise<AdminRevokeSessionsResponse> {
  return requestJson<AdminRevokeSessionsResponse>(
    `/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`,
    { method: "POST" }
  );
}
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/platform-api.ts apps/web/src/api/client.ts
git commit -m "feat: add admin revoke sessions client" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 3: People Pane UI

**Files:**

- Modify: `apps/web/src/settings/settings-admin-panes.tsx`

- [ ] **Step 1: Implement UI action**

In `apps/web/src/settings/settings-admin-panes.tsx`:

Remove `UserPlus` from the lucide import and add `LogOut`:

```ts
  LogOut,
```

Import `revokeAdminUserSessions` from `../api/client`.

Update `ActionVars` so success can inspect returned count without refetch:

```ts
interface ActionVars {
  readonly fn: (id: string) => Promise<unknown>;
  readonly id: string;
  readonly message: string | ((data: unknown) => string);
  readonly tone?: "ready" | "drift";
  readonly refetchUsers?: boolean;
}
```

Update `onSuccess`:

```ts
    onSuccess: (data, vars) => {
      if (vars.refetchUsers ?? true) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminUsers });
      }
      toast(typeof vars.message === "function" ? vars.message(data) : vars.message, {
        tone: vars.tone
      });
    },
```

In `PersonRow`, add:

```ts
const canRevokeSessions = props.actions.includes("revokeSessions");
```

Render menu item before destructive remove separator:

```tsx
{
  canRevokeSessions ? (
    <button
      className="ppl__menuitem ppl__menuitem--danger"
      role="menuitem"
      onClick={() => act("revokeSessions")}
    >
      <LogOut size={15} />
      Sign out everywhere
    </button>
  ) : null;
}
```

Handle the action in `onAction` before remove:

```ts
    } else if (action === "revokeSessions") {
      confirm({
        title: `Sign out ${name} everywhere?`,
        description:
          "This ends their active sessions without changing their role, status, or history.",
        confirmLabel: "Sign out everywhere",
        danger: true,
        onConfirm: () =>
          actionMutation.mutate({
            fn: revokeAdminUserSessions,
            id: user.id,
            message: (data) =>
              `${name} signed out everywhere (${(data as { count?: number }).count ?? 0} sessions revoked)`,
            tone: "drift",
            refetchUsers: false
          })
      });
```

Replace the `Group title="Members"` action with this desc:

```tsx
      <Group
        title="Members"
        desc="New people create an account, then wait for approval here."
      >
```

- [ ] **Step 2: Run focused typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx
git commit -m "feat: add people session revoke action" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 4: E2E Coverage

**Files:**

- Modify: `tests/e2e/mock-api.ts`
- Modify: `tests/e2e/app-shell.spec.ts`

- [ ] **Step 1: Add admin user mocks**

In `tests/e2e/mock-api.ts`, import `UserDto`, add to `MockApiState`:

```ts
  adminUsers?: UserDto[];
  revokedAdminSessionCount?: number;
```

In `mockApi`, register routes before task routes:

```ts
await page.route("**/api/admin/users", (route) => handleAdminUsersRoute(route, state));
await page.route("**/api/admin/users/*/revoke-sessions", (route) =>
  handleAdminUserRevokeSessionsRoute(route, state)
);
```

Add helpers:

```ts
function adminUsersFor(state: MockApiState): UserDto[] {
  if (!state.adminUsers) {
    state.adminUsers = [
      meResponseFor(state).user,
      createMockUser("member-1", "Member User", "member@example.test")
    ];
  }
  return state.adminUsers;
}

async function handleAdminUsersRoute(route: Route, state: MockApiState): Promise<void> {
  if (route.request().method() !== "GET") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  return fulfillJson(route, 200, { users: adminUsersFor(state) });
}

async function handleAdminUserRevokeSessionsRoute(
  route: Route,
  state: MockApiState
): Promise<void> {
  const request = route.request();
  const userId = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-2) ?? "");

  if (request.method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  if (!adminUsersFor(state).some((user) => user.id === userId)) {
    return fulfillJson(route, 404, { error: "User not found" });
  }

  return fulfillJson(route, 200, { success: true, count: state.revokedAdminSessionCount ?? 2 });
}

export function createMockUser(
  id: string,
  name: string,
  email: string,
  overrides: Partial<UserDto> = {}
): UserDto {
  return {
    id,
    email,
    name,
    isInstanceAdmin: false,
    status: "active",
    isBootstrapOwner: false,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 2: Add e2e test**

In `tests/e2e/app-shell.spec.ts`, import `createMockUser` and add:

```ts
test("people access uses approval model and revokes member sessions", async ({ page }) => {
  let revokeUrl: string | undefined;

  await mockApi(page, {
    authenticated: true,
    adminUsers: [
      createMockUser("user-1", "Owner User", "owner@example.test", {
        isInstanceAdmin: true,
        isBootstrapOwner: true
      }),
      createMockUser("member-1", "Member User", "member@example.test")
    ],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    revokedAdminSessionCount: 3,
    tasks: []
  });

  await page.route("**/api/admin/users/*/revoke-sessions", async (route) => {
    revokeUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, count: 3 })
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Admin / Setup" }).click();

  await expect(page.getByRole("heading", { name: "People & access" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Invite/i })).toHaveCount(0);
  await expect(
    page.getByText("New people create an account, then wait for approval here.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions for Member User" }).click();
  await page.getByRole("menuitem", { name: "Sign out everywhere" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign out Member User everywhere?" })
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Sign out Member User everywhere?" })
    .getByRole("button", { name: "Sign out everywhere" })
    .click();

  await expect.poll(() => revokeUrl).toContain("/api/admin/users/member-1/revoke-sessions");
  await expect(
    page.getByText("Member User signed out everywhere (3 sessions revoked)")
  ).toBeVisible();
  await expect(page.getByText(/session-/i)).toHaveCount(0);
});
```

- [ ] **Step 3: Run e2e test to verify pass**

Run:

```bash
pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "people access uses approval model"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mock-api.ts tests/e2e/app-shell.spec.ts
git commit -m "test: cover people access session revoke" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 5: Focused Gate

**Files:**

- Verify only

- [ ] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/web-settings-admin-policy.test.ts
pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "people access uses approval model"
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 2: Run cheap pre-push trio**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 3: Commit only if formatting touched files**

```bash
git add <formatted-files>
git commit -m "style: format people access sessions changes" -m "Co-Authored-By: Codex <codex@openai.com>"
```

Skip this commit if no files changed.

---

## Self-Review

- Spec coverage: fake Invite removed; approval-based note added; revoke action available for non-current active/deactivated users; pending/current users excluded; POST client typed; toast reports count only; no active-session list built.
- Placeholders: none.
- Type consistency: action name is `revokeSessions`; client function is `revokeAdminUserSessions`; response type is `AdminRevokeSessionsResponse`.
