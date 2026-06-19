# Production-Safe DB Role Bootstrap Passwords — Implementation Plan

> **For agentic workers:** This repo disables the superpowers execution sub-skills by design.
> Drive the plan yourself, task by task, under `coordinated-build`. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Stop `pnpm db:migrate` from creating/resetting Jarvis runtime DB roles with committed
development passwords, while keeping local dev zero-friction and failing closed in production.

**Architecture:** Make the four runtime-role passwords flow from a single source of truth — the
configured connection URLs returned by `getJarvisDatabaseUrls`. Strip all password literals out of
the bootstrap SQL (`0000_roles.sql` keeps role creation, attributes, grants — but no `PASSWORD`).
Add a TS role-password step in the migrate runner that parses each role's password from its
configured URL, refuses to proceed in production when a password is missing or still a dev default,
and applies it via a safely-escaped `ALTER ROLE ... PASSWORD`. Because both the bootstrap-set
password and the runtime connection derive from the same URL, they stay in sync automatically.

**Tech Stack:** TypeScript (ESM, NodeNext), `pg` (Client `escapeLiteral`/`escapeIdentifier`),
Vitest (`tests/unit`, which the `verify:foundation` gate runs), Postgres 17.

## Global Constraints

- Never edit hash-guarded applied migrations (`infra/postgres/migrations/*`, module `sql/*`). The
  bootstrap files (`infra/postgres/bootstrap/*`) are re-run every migrate and carry **no hash
  guard** — editing them to remove passwords is in-scope and required.
- Bootstrap/grants SQL must stay **idempotent** (re-runnable on every `pnpm db:migrate`).
- No `BYPASSRLS`/superuser on runtime roles; preserve existing role hardening attributes, grants,
  and `GRANT jarvis_auth_runtime TO jarvis_migration_owner`.
- Secrets never escape: do not log role passwords; error messages must name the role, never the
  password value.
- Local dev (NODE_ENV ≠ production) must work with zero manual password provisioning. The dev
  literals may remain only in `getJarvisDatabaseUrls` fallbacks, never in bootstrap SQL.
- Production (`NODE_ENV === "production"`) must require explicit non-default role credentials and
  fail closed otherwise.
- DB/test commands use `JARVIS_PGDATABASE=jarv1s_117_role_passwords`.
- Stage only changed paths; never `git add -A`; never repo-wide `pnpm format`. Commit trailer:
  `Co-Authored-By: Claude Sonnet 4.6`.

## File Structure

- **Create** `packages/db/src/role-bootstrap.ts` — pure plan derivation + apply step:
  - `RUNTIME_ROLE_PASSWORD_DEFAULTS` (the 4 dev literals)
  - `buildRolePasswordPlan(urls, env?)` → `RolePasswordEntry[]` (parse + production guard)
  - `applyRolePasswords(connectionString, plan)` → executes escaped `ALTER ROLE ... PASSWORD`
- **Create** `packages/db/src/role-bootstrap.test.ts`? No — unit tests live in `tests/unit`
  (that's where the gate's `test:unit` looks). **Create** `tests/unit/role-bootstrap.test.ts`.
- **Modify** `packages/db/src/index.ts` — export `./role-bootstrap.js`.
- **Modify** `infra/postgres/bootstrap/0000_roles.sql` — remove every `PASSWORD '<literal>'`;
  keep `CREATE ROLE ... LOGIN` / `ALTER ROLE ... WITH LOGIN`, attributes, grants.
- **Modify** `scripts/migrate.ts` — after `runSqlFiles(bootstrap)`, build the plan and call
  `applyRolePasswords(urls.bootstrap, plan)` before any runtime-role connection.
- **Modify** `docs/operations/release-hardening.md` — document the "set from configured secret every
  run; fail closed in production" behavior.

`tests/unit/db-urls.test.ts` already covers the production-URL-missing path; leave it intact.

---

### Task 1: Role-password plan derivation (`buildRolePasswordPlan`)

**Files:**

- Create: `packages/db/src/role-bootstrap.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/unit/role-bootstrap.test.ts`

**Interfaces:**

- Consumes: `JarvisDatabaseUrls` from `./urls.js` (fields `migration`, `app`, `worker`, `auth`,
  `bootstrap`).
- Produces:
  - `interface RolePasswordEntry { readonly role: string; readonly password: string; }`
  - `const RUNTIME_ROLE_PASSWORD_DEFAULTS: ReadonlySet<string>` = `{ "migration_password",
"app_password", "worker_password", "auth_password" }`
  - `function buildRolePasswordPlan(urls: JarvisDatabaseUrls, env?: NodeJS.ProcessEnv):
RolePasswordEntry[]` — order: migration_owner, app_runtime, worker_runtime, auth_runtime.
    Parses `new URL(urls.X).password` (URL-decoded by the URL parser). In production
    (`env.NODE_ENV === "production"`): throws if any password is empty, and throws if any password
    is in `RUNTIME_ROLE_PASSWORD_DEFAULTS`. Outside production, returns the (dev-default) passwords
    as-is. Errors name the **role**, never the password value.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/role-bootstrap.test.ts
import { describe, expect, it } from "vitest";

import {
  RUNTIME_ROLE_PASSWORD_DEFAULTS,
  buildRolePasswordPlan,
  getJarvisDatabaseUrls
} from "@jarv1s/db";

describe("buildRolePasswordPlan", () => {
  it("derives runtime role passwords from local dev fallback URLs", () => {
    const plan = buildRolePasswordPlan(getJarvisDatabaseUrls({} as NodeJS.ProcessEnv));
    expect(plan).toEqual([
      { role: "jarvis_migration_owner", password: "migration_password" },
      { role: "jarvis_app_runtime", password: "app_password" },
      { role: "jarvis_worker_runtime", password: "worker_password" },
      { role: "jarvis_auth_runtime", password: "auth_password" }
    ]);
  });

  it("derives passwords from explicit production URLs", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://jarvis_migration_owner:mig-secret@db/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    const plan = buildRolePasswordPlan(getJarvisDatabaseUrls(env), env);
    expect(plan.map((e) => e.password)).toEqual([
      "mig-secret",
      "app-secret",
      "worker-secret",
      "auth-secret"
    ]);
  });

  it("refuses in production when a role password is missing", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://migration.example/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    expect(() => buildRolePasswordPlan(getJarvisDatabaseUrls(env), env)).toThrow(
      /jarvis_migration_owner/
    );
  });

  it("refuses in production when a role password is still a development default", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://jarvis_migration_owner:migration_password@db/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    expect(() => buildRolePasswordPlan(getJarvisDatabaseUrls(env), env)).toThrow(
      /jarvis_migration_owner.*development-default/
    );
    expect(RUNTIME_ROLE_PASSWORD_DEFAULTS.has("app_password")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm
exec vitest run tests/unit/role-bootstrap.test.ts`. Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `role-bootstrap.ts` (plan half only)**

```ts
import type { JarvisDatabaseUrls } from "./urls.js";

export interface RolePasswordEntry {
  readonly role: string;
  readonly password: string;
}

export const RUNTIME_ROLE_PASSWORD_DEFAULTS: ReadonlySet<string> = new Set([
  "migration_password",
  "app_password",
  "worker_password",
  "auth_password"
]);

const ROLE_URL_SOURCES: ReadonlyArray<{ role: string; url: keyof JarvisDatabaseUrls }> = [
  { role: "jarvis_migration_owner", url: "migration" },
  { role: "jarvis_app_runtime", url: "app" },
  { role: "jarvis_worker_runtime", url: "worker" },
  { role: "jarvis_auth_runtime", url: "auth" }
];

export function buildRolePasswordPlan(
  urls: JarvisDatabaseUrls,
  env: NodeJS.ProcessEnv = process.env
): RolePasswordEntry[] {
  const isProduction = env.NODE_ENV === "production";

  return ROLE_URL_SOURCES.map(({ role, url }) => {
    const password = new URL(urls[url]).password;

    if (isProduction) {
      if (!password) {
        throw new Error(
          `Role ${role} has no password in its configured connection URL; ` +
            `production role bootstrap cannot proceed.`
        );
      }
      if (RUNTIME_ROLE_PASSWORD_DEFAULTS.has(password)) {
        throw new Error(
          `Role ${role} is configured with a development-default password; ` +
            `refusing to bootstrap it in production.`
        );
      }
    }

    return { role, password };
  });
}
```

- [ ] **Step 4: Export from index** — add `export * from "./role-bootstrap.js";` to
      `packages/db/src/index.ts`.

- [ ] **Step 5: Run test, verify pass** — same vitest command. Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/role-bootstrap.ts packages/db/src/index.ts tests/unit/role-bootstrap.test.ts
git commit -m "feat(db): derive runtime role passwords from configured URLs"
```

---

### Task 2: Apply step (`applyRolePasswords`) + bootstrap SQL password removal

**Files:**

- Modify: `packages/db/src/role-bootstrap.ts`
- Modify: `infra/postgres/bootstrap/0000_roles.sql`
- Test: `tests/unit/role-bootstrap.test.ts`

**Interfaces:**

- Produces: `async function applyRolePasswords(connectionString: string, plan: RolePasswordEntry[]):
Promise<void>` — connects (superuser/bootstrap URL), runs one `ALTER ROLE <escapedIdent> WITH
LOGIN PASSWORD <escapedLiteral>` per entry using `pg` Client `escapeIdentifier`/`escapeLiteral`.
- Adds: `function buildAlterRoleStatement(client, entry): string` (exported for unit test of the
  escaping, so the test needs no live DB).

- [ ] **Step 1: Write the failing test** (append to `tests/unit/role-bootstrap.test.ts`)

```ts
import pg from "pg";
import { buildAlterRoleStatement } from "@jarv1s/db";

describe("buildAlterRoleStatement", () => {
  it("escapes the identifier and password literal", () => {
    const client = new pg.Client();
    const sql = buildAlterRoleStatement(client, {
      role: "jarvis_app_runtime",
      password: "a'b\\c"
    });
    expect(sql).toContain('"jarvis_app_runtime"');
    expect(sql).toContain("WITH LOGIN PASSWORD ");
    expect(sql).not.toContain("a'b\\c"); // raw, unescaped form must not appear
  });
});
```

- [ ] **Step 2: Run, verify fail** — `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm exec vitest
run tests/unit/role-bootstrap.test.ts`. Expected: FAIL (`buildAlterRoleStatement` undefined).

- [ ] **Step 3: Implement apply half**

```ts
import pg from "pg";

const { Client } = pg;

export function buildAlterRoleStatement(client: pg.Client, entry: RolePasswordEntry): string {
  return `ALTER ROLE ${client.escapeIdentifier(entry.role)} WITH LOGIN PASSWORD ${client.escapeLiteral(
    entry.password
  )}`;
}

export async function applyRolePasswords(
  connectionString: string,
  plan: RolePasswordEntry[]
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const entry of plan) {
      await client.query(buildAlterRoleStatement(client, entry));
    }
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Strip passwords from `0000_roles.sql`** — change each
      `CREATE ROLE <r> LOGIN PASSWORD '<lit>'` → `CREATE ROLE <r> LOGIN`, and each
      `ALTER ROLE <r> WITH LOGIN PASSWORD '<lit>'` → `ALTER ROLE <r> WITH LOGIN`. Keep the attribute
      ALTER block, the GRANT CONNECT/CREATE DO block, and `GRANT jarvis_auth_runtime TO
jarvis_migration_owner` unchanged. (Roles get their passwords from `applyRolePasswords` in
      Task 3.) Add a header comment noting passwords are set by the migration runner.

- [ ] **Step 5: Run, verify pass** — same vitest command. Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/role-bootstrap.ts infra/postgres/bootstrap/0000_roles.sql tests/unit/role-bootstrap.test.ts
git commit -m "feat(db): apply role passwords from runner; drop literals from bootstrap SQL"
```

---

### Task 3: Wire the apply step into the migrate runner

**Files:**

- Modify: `scripts/migrate.ts`

**Interfaces:**

- Consumes: `buildRolePasswordPlan`, `applyRolePasswords` from `@jarv1s/db`; `urls` from
  `getJarvisDatabaseUrls()`.

- [ ] **Step 1: Edit `scripts/migrate.ts`** — import the two new symbols; immediately after
      `await runSqlFiles(urls.bootstrap, bootstrapDirectory);` add:

```ts
await applyRolePasswords(urls.bootstrap, buildRolePasswordPlan(urls));
```

(`buildRolePasswordPlan` reads `process.env` by default, so the production guard runs here.)

- [ ] **Step 2: Verify dev bootstrap end-to-end** —
      `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm db:migrate`. Expected: roles bootstrap, all
      migrations apply, runtime grants current (the migration role connects with the just-set password).

- [ ] **Step 3: Sanity-check the production guard refuses** — run a one-off:
      `NODE_ENV=production JARVIS_BOOTSTRAP_DATABASE_URL=postgres://postgres:x@localhost:55433/jarv1s_117_role_passwords JARVIS_MIGRATION_DATABASE_URL=postgres://jarvis_migration_owner:migration_password@localhost:55433/jarv1s_117_role_passwords JARVIS_APP_DATABASE_URL=... JARVIS_AUTH_DATABASE_URL=... JARVIS_WORKER_DATABASE_URL=... pnpm db:migrate`
      with the migration URL holding a dev-default password. Expected: exits non-zero with the
      "development-default password; refusing to bootstrap it in production" error **before** any
      ALTER runs. (Documented check; not committed.)

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.ts
git commit -m "feat(db): set runtime role passwords during migrate bootstrap"
```

---

### Task 4: Regression test — bootstrap SQL carries no password literals

**Files:**

- Test: `tests/unit/role-bootstrap.test.ts`

- [ ] **Step 1: Write the failing-then-passing guard test** (append)

```ts
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("bootstrap SQL", () => {
  it("contains no committed Jarvis role-password literals", async () => {
    const bootstrapDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../infra/postgres/bootstrap"
    );
    const files = (await readdir(bootstrapDir)).filter((f) => f.endsWith(".sql"));
    for (const file of files) {
      const sql = await readFile(join(bootstrapDir, file), "utf8");
      for (const literal of RUNTIME_ROLE_PASSWORD_DEFAULTS) {
        expect(sql, `${file} must not contain ${literal}`).not.toContain(literal);
      }
      expect(sql, `${file} must not assign role passwords`).not.toMatch(/PASSWORD\s+'/i);
    }
  });
});
```

- [ ] **Step 2: Run, verify pass** — `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm exec vitest
run tests/unit/role-bootstrap.test.ts`. Expected: all passing (depends on Task 2's SQL edit).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/role-bootstrap.test.ts
git commit -m "test(db): assert bootstrap SQL has no role-password literals"
```

---

### Task 5: Document the rotation behavior

**Files:**

- Modify: `docs/operations/release-hardening.md`

- [ ] **Step 1: Add a "Database role passwords" subsection** stating: runtime role passwords come
      from the configured connection URLs (`JARVIS_*_DATABASE_URL` in production; local dev fallbacks
      otherwise); `pnpm db:migrate` re-applies them from the configured secret on every run (idempotent,
      never resets to a dev default); production migration fails closed when a role password is missing
      or still a development default; rotating a role = update its `JARVIS_*_DATABASE_URL` secret and
      re-run `pnpm db:migrate`.

- [ ] **Step 2: Commit**

```bash
git add docs/operations/release-hardening.md
git commit -m "docs(ops): document DB role password provisioning + rotation"
```

---

### Task 6: Full gate

- [ ] **Step 1** — `JARVIS_PGDATABASE=jarv1s_117_role_passwords pnpm verify:foundation`. Expected:
      lint, format:check, check:file-size, typecheck, test:unit (incl. new role-bootstrap tests),
      db:migrate (dev bootstrap green), test:integration all pass.
- [ ] **Step 2** — `pnpm audit:release-hardening` green.
- [ ] Then hand to `coordinated-wrap-up`.

---

## Self-Review

- **Spec coverage:**
  - §1 move literals out of SQL → Task 2 (SQL edit) + Task 1/2 (TS-owned passwords). ✓
  - §2 zero-friction local dev → dev fallbacks stay in `urls.ts`; Task 3 Step 2 proves it. ✓
  - §3 safe on repeated runs → `applyRolePasswords` sets from configured secret every run; documented Task 5. ✓
  - §4 regression coverage → Task 1 (derivation + fail-closed), Task 2 (escaping), Task 4 (no
    literals in SQL); existing `db-urls.test.ts` covers prod-URL-missing. ✓
  - Acceptance: no literals (Task 4), dev bootstrap works (Task 3.2), prod fails closed (Task 1/3.3),
    documented (Task 5), existing tests pass + verify:foundation (Task 6). ✓
- **Placeholder scan:** none — all code shown.
- **Type consistency:** `RolePasswordEntry`, `buildRolePasswordPlan`, `applyRolePasswords`,
  `buildAlterRoleStatement`, `RUNTIME_ROLE_PASSWORD_DEFAULTS` consistent across tasks. ✓

## Open question for coordinator

Rotation behavior chosen = **set from configured secret on every run** (spec §3 option a), not
create-if-missing. Simplest + idempotent + never resets to dev. Flag if you want option b instead.
