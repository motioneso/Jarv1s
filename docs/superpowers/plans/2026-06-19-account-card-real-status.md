# Account Card Real Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this coordinated worktree, do not use executing-plans or subagent-driven-development; coordinator approval is required before code changes.

**Goal:** Make `/api/me` expose real email verification state and make the Profile & account Account card display truthful email/security status.

**Architecture:** Add `emailVerified` to the existing shared `UserDto` and `userSchema`, then serialize it from `app.users.email_verified` through the existing settings route. The web pane reads the already-fetched `me.user.emailVerified`; no new endpoint, action, or auth-provider settings flow is added.

**Tech Stack:** TypeScript, Fastify JSON schemas, Vitest integration tests, React settings UI.

---

## File Structure

- Modify `packages/shared/src/platform-api.ts`: add `UserDto.emailVerified` and require `emailVerified` in `userSchema`.
- Modify `packages/settings/src/routes.ts`: include `emailVerified: user.email_verified` in `serializeUser`.
- Modify `tests/integration/auth-settings.test.ts`: add failing assertions that `/api/me` and `/api/admin/users` return the real `emailVerified` value.
- Modify `apps/web/src/settings/settings-personal-panes.tsx`: replace the hard-coded email badge and fake password/2FA row with read-only, truthful account status.

No new files, routes, DB migrations, or frontend test harness.

## Task 1: Contract Test for Real Email Verification

**Files:**

- Modify: `tests/integration/auth-settings.test.ts`

- [ ] **Step 1: Write the failing test assertions**

Update the existing bootstrap `/api/me` assertion:

```ts
expect(me.user).toMatchObject({
  id: ownerUserId,
  email: "owner@example.test",
  emailVerified: false,
  isInstanceAdmin: true
});
```

Update the existing admin users assertion from tuple-only data to include the DTO field:

```ts
expect(
  allowedResponse
    .json<{ users: Array<{ email: string; emailVerified: boolean; isInstanceAdmin: boolean }> }>()
    .users.map((user) => ({
      email: user.email,
      emailVerified: user.emailVerified,
      isInstanceAdmin: user.isInstanceAdmin
    }))
).toEqual([
  { email: "owner@example.test", emailVerified: false, isInstanceAdmin: true },
  { email: "member@example.test", emailVerified: false, isInstanceAdmin: false }
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_deploy236 pnpm db:migrate
JARVIS_PGDATABASE=jarv1s_deploy236 vitest run tests/integration/auth-settings.test.ts
```

Expected: fail because `emailVerified` is absent from the serialized user response.

## Task 2: Add DTO/Schema/Serializer Field

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Modify: `packages/settings/src/routes.ts`

- [ ] **Step 1: Add the shared DTO field and JSON schema requirement**

In `UserDto`:

```ts
readonly emailVerified: boolean;
```

In `userSchema.required`, add `"emailVerified"` after `"email"`.

In `userSchema.properties`, add:

```ts
emailVerified: { type: "boolean" },
```

- [ ] **Step 2: Populate it from the DB user row**

In `serializeUser`:

```ts
emailVerified: user.email_verified,
```

- [ ] **Step 3: Run test to verify it passes**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_deploy236 vitest run tests/integration/auth-settings.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit contract work**

Run:

```bash
git add packages/shared/src/platform-api.ts packages/settings/src/routes.ts tests/integration/auth-settings.test.ts
git commit -m "feat: expose email verification on account DTO" -m "Co-Authored-By: OpenAI Codex <codex@openai.com>"
```

## Task 3: Make Account Card Truthful

**Files:**

- Modify: `apps/web/src/settings/settings-personal-panes.tsx`

- [ ] **Step 1: Update the Email row badge**

Replace the hard-coded `Verified` badge with:

```tsx
<Badge tone={user.emailVerified ? "pine" : "amber"} dot>
  {user.emailVerified ? "Verified" : "Not verified"}
</Badge>
```

- [ ] **Step 2: Replace fake security promise**

Replace:

```tsx
<Row name="Security" desc="Password and two-factor authentication." coming />
```

with:

```tsx
<Row
  name="Sign-in security"
  desc="Managed by the configured auth provider and current sign-in method. Active sessions are listed below."
  control={<Badge tone="neutral">Provider managed</Badge>}
/>
```

- [ ] **Step 3: Run typecheck for the UI contract**

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: pass.

- [ ] **Step 4: Commit UI work**

Run:

```bash
git add apps/web/src/settings/settings-personal-panes.tsx
git commit -m "fix: show truthful account card status" -m "Co-Authored-By: OpenAI Codex <codex@openai.com>"
```

## Task 4: Final Verification Before Wrap-Up

**Files:**

- No code changes expected.

- [ ] **Step 1: Run scoped checks**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_deploy236 vitest run tests/integration/auth-settings.test.ts
pnpm --filter @jarv1s/web typecheck
```

Expected: both pass.

- [ ] **Step 2: Run pre-push trio and rebase**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
git fetch origin main
git rebase origin/main
```

Expected: all pass and rebase completes cleanly.

- [ ] **Step 3: Invoke coordinated-wrap-up**

Read the available `coordinated-wrap-up` skill path, then follow it to run the required gate, push the branch, open the PR, and report evidence to Coordinator.

## Self-Review

- Spec coverage: `/api/me` gets `user.emailVerified`; schema and serializer change together; Account card badge uses real state; Security row no longer advertises password/2FA controls; no fake actions added; profile autosave untouched.
- Placeholder scan: no TBD/TODO/later steps.
- Type consistency: property name is `emailVerified` in DTO, schema, tests, serializer, and React UI.
