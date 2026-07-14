# UAT Seed Credential Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repository override:** `coordinated-build` disables those execution skills. Execute this plan inline with `superpowers:test-driven-development` after Coordinator approval.

**Goal:** Print the deterministic seeded owner/admin login to UAT setup stdout while keeping the output unreachable without the existing UAT seed confirmation fence.

**Architecture:** Add one small stdout helper beside the seed fixture constants in `tests/uat/seed/admin.ts`, guarded by the exact `JARVIS_UAT_SEED_CONFIRM=1` token already enforced by the seed CLI and set only by `composeSeedHook`. Call it only after both seeded owner records are written. UAT intentionally uses a prod-shaped container with `NODE_ENV=production`, so tests prove that production mode logs only with the explicit UAT token and stays silent without it.

**Tech Stack:** TypeScript, Node.js stdout, Vitest

---

### Task 1: Guarded UAT Seed Credential Output

**Files:**

- Modify: `tests/uat/seed/admin.ts:8-78`
- Test: `tests/uat/seed/admin.test.ts:5-45`

- [ ] **Step 1: Write the failing guard tests**

Update the import and add focused tests that inject an output collector, proving both sides of the security fence without requiring Postgres:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logUatAdminCredentials,
  seedSoloAdmin,
  UAT_ADMIN_EMAIL,
  UAT_ADMIN_PASSWORD
} from "./admin.js";

describe("logUatAdminCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prints seeded owner credentials for a confirmed UAT run", () => {
    const output: string[] = [];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JARVIS_UAT_SEED_CONFIRM", "1");

    logUatAdminCredentials({ email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD }, (text) =>
      output.push(text)
    );

    const logged = output.join("");
    // Exact allowlist: the sink may receive only the deterministic fixture login.
    expect(output).toEqual([
      `[uat-seed] owner/admin login: email=${UAT_ADMIN_EMAIL} password=${UAT_ADMIN_PASSWORD}\n`
    ]);
    expect(logged).not.toMatch(/\b[a-f0-9]{32}:[a-f0-9]{128}\b/i); // better-auth scrypt hash
    expect(logged).not.toMatch(
      /password_hash|session_token|access_token|refresh_token|id_token|client_secret/i
    );
  });

  it("prints nothing in production mode without UAT seed confirmation", () => {
    const output: string[] = [];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JARVIS_UAT_SEED_CONFIRM", undefined);

    logUatAdminCredentials({ email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD }, (text) =>
      output.push(text)
    );

    expect(output).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/uat/seed/admin.test.ts -t "logUatAdminCredentials"
```

Expected: FAIL because `logUatAdminCredentials` is not exported from `admin.ts`.

- [ ] **Step 3: Implement the minimum guarded stdout write**

Add the helper beside the deterministic seed fixture constants:

```typescript
export function logUatAdminCredentials(
  credentials: { readonly email: string; readonly password: string },
  writeStdout: (text: string) => void = (text) => {
    process.stdout.write(text);
  }
): void {
  // #1040 SECURITY HARD FENCE: the UAT stack is prod-shaped and intentionally runs with
  // NODE_ENV=production, so environment mode cannot distinguish it. Reuse the exact seed-only
  // confirmation token that composeSeedHook sets and cli.ts already requires; real production
  // bootstrap never sets this token or calls this fixture-only module.
  if (process.env.JARVIS_UAT_SEED_CONFIRM !== "1") return;

  writeStdout(
    `[uat-seed] owner/admin login: email=${credentials.email} password=${credentials.password}\n`
  );
}
```

After both the `app.users` and `app.auth_accounts` inserts succeed, log and return the same deterministic fixture values:

```typescript
const credentials = { email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD };
logUatAdminCredentials(credentials);
return { userId, ...credentials };
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/uat/seed/admin.test.ts -t "logUatAdminCredentials"
```

Expected: PASS for confirmed-UAT output and production-without-confirmation silence.

- [ ] **Step 5: Run scoped static checks**

Run:

```bash
pnpm exec prettier --check tests/uat/seed/admin.ts tests/uat/seed/admin.test.ts
pnpm exec eslint tests/uat/seed/admin.ts tests/uat/seed/admin.test.ts --max-warnings=0
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the security-fenced change**

```bash
git add tests/uat/seed/admin.ts tests/uat/seed/admin.test.ts docs/superpowers/plans/2026-07-13-uat-seed-log-creds.md
git commit -m "feat(uat): print seeded owner login during setup" -m "UAT operators can now see the throwaway seeded owner login needed for authenticated acceptance work. No production or real-user credentials are exposed." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Full Verification

**Files:**

- Verify only; no additional files

- [ ] **Step 1: Run the full local gate**

Run:

```bash
pnpm verify:foundation
```

Expected: exit 0; lint, format, file-size, design-token, ambient-date, package-dependency, typecheck, unit, migration, and integration checks all pass.

- [ ] **Step 2: Confirm the final scope**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: clean tree after commit; only the plan plus `tests/uat/seed/admin.ts` and `tests/uat/seed/admin.test.ts` differ for #1040. No `docs/coordination/`, real-user auth/session code, frontend code, or production bootstrap code changes.
