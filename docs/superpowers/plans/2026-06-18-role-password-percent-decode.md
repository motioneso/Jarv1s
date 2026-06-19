# Role-Password Percent-Decode Fix Implementation Plan

> **For agentic workers:** Execution sub-skills are disabled in this repo; the build agent drives
> this plan task-by-task itself under coordinated-build. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `buildRolePasswordPlan` decode the percent-encoded password from each connection URL
so the password applied via `ALTER ROLE` exactly matches the password the `pg` driver authenticates
with at runtime.

**Architecture:** `packages/db/src/role-bootstrap.ts` currently reads `new URL(urls[url]).password`,
which returns the **percent-encoded** component. The `pg` driver (`pg-connection-string` index.js:45)
applies `decodeURIComponent` to the password when it connects. So for any role password containing a
URL-special character (`@`, `:`, `/`, `%`, …) the bootstrap assigns the encoded literal while the
runtime connects with the decoded value → authentication fails. Fix: decode the URL password to
mirror the driver exactly, before the production fail-closed checks run.

**Tech Stack:** TypeScript, Vitest, `pg`, WHATWG `URL`.

## Global Constraints

- Do not edit applied migrations or bootstrap SQL (no behavior change there).
- `Secrets never escape`: error messages must continue to name the role only, never the password.
- Decoding must mirror the driver — whatever `pg-connection-string` derives is exactly what we apply
  (it uses `decodeURIComponent`); do not add divergent handling.
- Fail-closed dev-default detection must run against the **decoded** password (correct semantics).
- Isolated DB for any DB-touching command: `JARVIS_PGDATABASE=jarv1s_117_role_passwords`.

---

### Task 1: Decode percent-encoded role passwords from connection URLs

**Files:**

- Modify: `packages/db/src/role-bootstrap.ts:51` (`buildRolePasswordPlan`)
- Test: `tests/unit/role-bootstrap.test.ts`

**Interfaces:**

- Consumes: `getJarvisDatabaseUrls(env)` → `JarvisDatabaseUrls`; `buildRolePasswordPlan(urls, env)`
  → `RolePasswordEntry[]` (`{ role, password }`).
- Produces: no signature change — `buildRolePasswordPlan` returns the same shape, but each
  `password` is now percent-decoded.

- [ ] **Step 1: Write the failing test**

Add to the `buildRolePasswordPlan` describe block in `tests/unit/role-bootstrap.test.ts`:

```ts
it("percent-decodes role passwords so they match what the pg driver authenticates with", () => {
  // p@ss:w0rd must be percent-encoded in the URL userinfo as p%40ss%3Aw0rd.
  const env = {
    NODE_ENV: "production",
    JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
    JARVIS_MIGRATION_DATABASE_URL: "postgres://jarvis_migration_owner:p%40ss%3Aw0rd@db/prod",
    JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
    JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
    JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
  } as NodeJS.ProcessEnv;
  const plan = buildRolePasswordPlan(getJarvisDatabaseUrls(env), env);
  const migration = plan.find((e) => e.role === "jarvis_migration_owner");
  expect(migration?.password).toBe("p@ss:w0rd");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm vitest run tests/unit/role-bootstrap.test.ts -t "percent-decodes"`
Expected: FAIL — received `"p%40ss%3Aw0rd"`, expected `"p@ss:w0rd"`.

- [ ] **Step 3: Write minimal implementation**

In `packages/db/src/role-bootstrap.ts`, change line 51 from:

```ts
const password = new URL(urls[url]).password;
```

to:

```ts
// `URL.password` is percent-encoded; the pg driver decodes it via decodeURIComponent
// when it connects (pg-connection-string). Decode here so the password we ALTER ROLE
// with is byte-for-byte what the runtime role authenticates with.
const password = decodeURIComponent(new URL(urls[url]).password);
```

- [ ] **Step 4: Run the role-bootstrap suite to verify it passes**

Run: `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm vitest run tests/unit/role-bootstrap.test.ts`
Expected: PASS — new test green; existing dev-fallback/production/fail-closed/escaping/SQL-scan
tests still green (their passwords have no encoded chars, so decoding is a no-op for them).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/role-bootstrap.ts tests/unit/role-bootstrap.test.ts
git commit -m "fix(db): percent-decode role passwords to match pg driver auth"
```

---

## Verification (after Task 1)

- [ ] Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`
- [ ] Fresh rebase: `git fetch origin main && git rebase origin/main`
- [ ] Full gate (isolated DB): `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm verify:foundation` → record VF_EXIT
- [ ] `pnpm audit:release-hardening` → record AUDIT_EXIT
- [ ] Push branch; report VF_EXIT / AUDIT_EXIT + head SHA to `Coordinator`.

## Self-Review

- **Spec coverage:** The fix lane's single requirement — decode percent-encoded passwords so the
  applied password matches the driver — is implemented by Task 1.
- **Placeholder scan:** none.
- **Type consistency:** `buildRolePasswordPlan` / `getJarvisDatabaseUrls` / `RolePasswordEntry`
  used consistently; no signature changes.
