# UAT Seed Levels (#1025, Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tests/uat/seed/` — a deterministic, tiered (`bare` → `solo-admin` → `admin+data` → `multi-user`) database seed for the Phase 1 UAT provisioner, so #1026's Playwright suite can drive a real, lived-in dev instance.

**Architecture:** A CLI entrypoint (`tests/uat/seed/cli.ts`) runs **inside the compose network** as a new one-shot `ops`-profile service (mirroring `migrate`/`module-install` exactly), because `infra/docker-compose.prod.yml`'s `postgres` service publishes no host port — a host-side script cannot reach it directly. The CLI composes level chunks, each writing through one of two legitimate connections: (a) `jarvis_migration_owner` for the `app.users` + `app.auth_accounts` bootstrap only (per spec §4.1, using its existing `jarvis_auth_runtime` membership), and (b) `jarvis_app_runtime` wrapped in the existing `DataContextRunner.withDataContext()` pattern + each module's real repository classes for every feature chunk — this satisfies FORCE RLS on every `app_runtime`-scoped table (confirmed universal via a full grep of `packages/*/sql/*.sql`) the same way production requests do, with zero RLS carve-outs.

**Tech Stack:** tsx (existing dev dependency), Kysely (`@jarv1s/db`), `better-auth/crypto` (`hashPassword`), each module's own repository package, Docker Compose (`ops` profile, one-shot `run --rm`).

## Global Constraints

- **Deterministic — hard constraint (Ben, 2026-07-13):** no `Date.now()`, no bare `new Date()` for any seed-authored business content (task due dates, calendar event times, "posted N days ago" news items, user `created_at` for auth rows). All such values derive from one fixed injected base timestamp, `UAT_SEED_BASE_TIMESTAMP`. **Scope confirmed by Coordinator, 2026-07-13:** this does NOT extend to (a) repository-internal `new Date()` calls a module's own `create`/`upsert` method makes for its own audit columns (e.g. `ConnectorsRepository.createAccount`'s `created_at`/`updated_at`) — reusing real repository code is the whole point, and rewriting those methods to accept an injected clock is out of scope for #1025 — nor to (b) inherent cryptographic randomness (AES-256-GCM IV, scrypt salt) that no Playwright assertion depends on; a deterministic salt would itself be a vulnerability, so `hashPassword`'s real random salt stays as-is.
- **Lived-in account (Ben, 2026-07-13):** `admin+data` must have realistic volume/spread per chunk (roughly 8-15 rows per feature, spread across distinct fixed dates/categories), not one token row.
- **No admin private-data bypass / no BYPASSRLS on runtime roles (CLAUDE.md hard invariant):** never grant `BYPASSRLS` to `jarvis_app_runtime`/`jarvis_worker_runtime`; never widen a runtime role's grants. The dual-connection design below is how this constraint is satisfied without ever touching a runtime role's privileges.
- **Local/coordinator-only — no CI, no DinD (Ben, 2026-07-13).**
- **DataContextDb only (CLAUDE.md hard invariant):** every feature-chunk write goes through `DataContextRunner.withDataContext({actorUserId}, work)` and calls existing repository methods — never a raw `db.insertInto` outside that pattern, never a second bespoke DB-access path.
- **AccessContext shape (CLAUDE.md hard invariant):** `{actorUserId, requestId?}` only — never add fields.
- **No new migration; do not touch `foundation-schema-catalog`** — seed writes rows only, adds no schema.
- **Comment density (handoff):** generous why-comments citing #1025/#1000 at the determinism guard, the privileged-connection use, the loginable-admin hash path, and each chunk's realistic-volume rationale.
- **Guardrails:** no `git add -A`/`git add .` (explicit paths only); do not touch `docs/coordination/`; do not run repo-wide `pnpm format` (format only authored files); do not edit `tests/uat/provisioner.ts` beyond the seed-hook wiring in Task 6.

## Architecture decisions — Coordinator APPROVED 2026-07-13, build now

The spec (`docs/superpowers/specs/2026-07-12-dev-uat-harness.md`) left two things unsettled; both are now **resolved and signed off**:

1. **FORCE RLS blocks `jarvis_migration_owner` on every feature table.** Spec §4.1 only explains the `app.users`/`app.auth_accounts` write path (via `jarvis_migration_owner`'s membership in `jarvis_auth_runtime`, added for migration 0045). It says nothing about the other ~25 FORCE-RLS'd, `jarvis_app_runtime`-scoped tables (tasks, calendar_events, sports_follows, news_prefs, ai_provider_configs, etc. — confirmed via `grep -rn "FORCE ROW LEVEL SECURITY" packages/*/sql/*.sql`), and `jarvis_migration_owner` has no membership in `jarvis_app_runtime` (confirmed via `infra/postgres/bootstrap/0000_roles.sql`), so it cannot write those tables at all. **APPROVED (dual-connection — do NOT add `GRANT jarvis_app_runtime TO jarvis_migration_owner` anywhere, it is not needed and would widen a runtime role):** a second connection as `jarvis_app_runtime`, wrapped in the existing `DataContextRunner`, calling each module's real repository `.create()`/`.upsert()` methods as the seeded actor — the same legitimate path production requests take, not a bypass. `external_modules` writes go through the real admin path with a genuine `is_instance_admin=true` actor so `app.current_actor_is_admin()` passes legitimately — never a superuser-skip. **TRIPWIRE (binding):** if wiring the real repo path ever forces an RLS carve-out / BYPASSRLS / role widening, STOP and escalate to the Coordinator — do not work around it.
2. **Postgres has no host-published port.** `infra/docker-compose.prod.yml`'s `postgres` service has no `ports:` block — the DB hostnames in the UAT env file (`postgres`) only resolve inside the compose network. The seed therefore cannot be a host-side script as the spec's phrasing implies (`"the seed script connects as jarvis_migration_owner ... the same role scripts/migrate.ts uses"` — but `scripts/migrate.ts` itself only ever runs _inside_ the one-shot `migrate` compose service, never from the host). **APPROVED (scope expansion into `infra/docker-compose.prod.yml` is fine):** add a new one-shot `seed` service, mirroring `migrate`/`module-install` exactly. **HARD, binding:** (a) profile-gate it (`ops`/`seed` profile) so it is INERT on a normal prod `up` — never runs unless the profile is explicitly selected; (b) the entrypoint hard-guards that it runs ONLY against the ephemeral/UAT DB — refuse if the target looks like real prod; (c) touch ONLY the seed-service addition in that file. Why-comment citing #1025/#1000.

**Determinism scope (Coordinator-confirmed correct, not stricter):** covers SEED-AUTHORED business content (dates/ids the tests assert on) — derive "recent" dates from the fixed injected base, never the clock. Repo-internal audit columns (`created_at`/`updated_at` a repository sets itself) and crypto randomness (password salt/IV) are OUT of scope and MUST stay real/random — a deterministic salt would be a vulnerability. Keep `hashPassword`'s real random salt.

**Notes chunk (binding):** seed via `VaultContext` — NEVER raw `fs` (hard invariant: VaultContext for all vault I/O). A thinner chunk (fewer files) is fine if the full write path is heavy to wire, but do NOT substitute a DB-backed proxy (e.g. `app.commitments`) instead of real vault files — that alternative was considered and rejected.

**Multi-user: DEFERRED to issue #1030 (fast-follow, already filed).** This PR is scoped to `solo-admin` + `admin+data` + the job-search presence/absence toggle only — that's what #1026 needs. Keep the explicit `throw` in `seedLevel`'s `multi-user` branch, but its message must point at **#1030**. Do not build a second-user chunk in this PR.

Task 1 (below) is **done** — approval received, dual-connection + new compose service both signed off. Proceed straight through Tasks 2-8.

---

### Task 1: Escalate this plan to the Coordinator (no code)

**Files:** none (messaging only).

- [ ] **Step 1:** Run `herdr pane list` and confirm exactly one pane holds the label `Coordinator` (session `58a78927-385c-4b1d-8fa0-94db20255d6f` per the handoff).
- [ ] **Step 2:** Use the `herdr-pane-message` skill to send a terse message summarizing: plan saved at `docs/superpowers/plans/2026-07-13-uat-seed-levels.md`; the two open architecture decisions above (dual-connection RLS design; new `ops`-profile compose service since Postgres has no host port); the determinism-scope interpretation (business content only, not repo-internal audit timestamps/crypto nonces); ask for explicit go-ahead before Task 3.
- [ ] **Step 3:** STOP. Do not proceed to Task 3 until the Coordinator responds with approval (or amended instructions). If amended, update this plan file in place before continuing.

---

### Task 2: Seed core module — connections, timestamp helper, CLI skeleton

**Files:**

- Create: `tests/uat/seed/connections.ts`
- Create: `tests/uat/seed/timestamps.ts`
- Create: `tests/uat/seed/types.ts`
- Create: `tests/uat/seed/cli.ts`
- Test: `tests/uat/seed/timestamps.test.ts`

**Interfaces:**

- Produces: `UAT_SEED_BASE_TIMESTAMP: Date` (fixed constant), `daysBefore(base: Date, days: number): Date`, `daysAfter(base: Date, days: number): Date` — from `timestamps.ts`.
- Produces: `UatSeedLevel = "bare" | "solo-admin" | "admin+data" | "multi-user"`, `UatSeedChunk = "news" | "sports" | "tasks" | "calendar" | "notes" | "job-search"`, `SeedOptions { level: UatSeedLevel; excludeChunks?: readonly UatSeedChunk[] }` — from `types.ts`.
- Produces: `createMigrationOwnerDb(): Kysely<JarvisDatabase>`, `createAppRuntimeRunner(): DataContextRunner` — from `connections.ts`.
- Consumes (later tasks): all of the above.

- [ ] **Step 1: Write the failing test for the timestamp helper**

```typescript
// tests/uat/seed/timestamps.test.ts
import { describe, expect, it } from "vitest";
import { UAT_SEED_BASE_TIMESTAMP, daysBefore, daysAfter } from "./timestamps.js";

describe("uat seed timestamps", () => {
  it("derives dates from the fixed base timestamp, never the wall clock", () => {
    // #1025/#1000: the seed must be deterministic — any "recent" date is an offset
    // from a fixed epoch, never Date.now(), or the seed (and any assertion built
    // against it) flakes run to run.
    expect(UAT_SEED_BASE_TIMESTAMP.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(daysBefore(UAT_SEED_BASE_TIMESTAMP, 3).toISOString()).toBe("2026-01-12T12:00:00.000Z");
    expect(daysAfter(UAT_SEED_BASE_TIMESTAMP, 2).toISOString()).toBe("2026-01-17T12:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/timestamps.test.ts` (or the repo's standard vitest invocation — check `package.json` `test` script if this differs)
Expected: FAIL with "Cannot find module './timestamps.js'"

- [ ] **Step 3: Implement `timestamps.ts`**

```typescript
// tests/uat/seed/timestamps.ts

/**
 * #1025/#1000: fixed epoch every seed chunk derives "recent" dates from. Never
 * replace with `new Date()` / `Date.now()` — the UAT seed must produce byte-identical
 * rows on every run so Playwright fixtures (#1026) don't flake against wall-clock drift.
 */
export const UAT_SEED_BASE_TIMESTAMP: Date = new Date("2026-01-15T12:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBefore(base: Date, days: number): Date {
  return new Date(base.getTime() - days * MS_PER_DAY);
}

export function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Implement `types.ts`**

```typescript
// tests/uat/seed/types.ts

/**
 * #1025: the level ladder from spec §4.3 — each level is additive over the
 * previous one (admin+data = solo-admin + feature chunks; multi-user adds a
 * second user + cross-user fixtures on top of admin+data). Not four independent
 * seed files.
 */
export type UatSeedLevel = "bare" | "solo-admin" | "admin+data" | "multi-user";

/** #1025 spec §4.4: per-feature chunk list seeded at admin+data and above. */
export type UatSeedChunk = "news" | "sports" | "tasks" | "calendar" | "notes" | "job-search";

export interface SeedOptions {
  readonly level: UatSeedLevel;
  /** #1025: e.g. omit "job-search" to prove the absent-module UI path. */
  readonly excludeChunks?: readonly UatSeedChunk[];
}
```

- [ ] **Step 6: Implement `connections.ts`**

```typescript
// tests/uat/seed/connections.ts
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";

import { DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { getJarvisDatabaseUrls } from "@jarv1s/db";

/**
 * #1025 hard invariant (tier=sensitive): dev-only privileged connection for the
 * app.users / app.auth_accounts bootstrap ONLY (spec §4.1). jarvis_migration_owner
 * is migration-class tooling — NOSUPERUSER/NOBYPASSRLS, member of jarvis_auth_runtime
 * only (infra/postgres/bootstrap/0000_roles.sql) — never grant it BYPASSRLS or widen
 * it to jarvis_app_runtime; that would violate the "no BYPASSRLS on runtime roles"
 * hard invariant (CLAUDE.md) by turning migration-owner into a de facto bypass role.
 */
export function createMigrationOwnerDb(): Kysely<JarvisDatabase> {
  const { migration } = getJarvisDatabaseUrls();
  return new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: migration }) })
  });
}

/**
 * #1025: every feature chunk (news/sports/tasks/calendar/notes) writes through this
 * connection + DataContextRunner.withDataContext, exactly the path production
 * requests take. jarvis_migration_owner cannot write these tables — every
 * feature table in this codebase has FORCE ROW LEVEL SECURITY scoped
 * `TO jarvis_app_runtime` (confirmed via `grep -rn "FORCE ROW LEVEL SECURITY"
 * packages/*\/sql/*.sql`), and jarvis_migration_owner is not a member of that
 * role. Using the real app_runtime connection + real repository methods means
 * every seeded row is written exactly the way a real request would write it —
 * no RLS carve-out, no bypass.
 */
export function createAppRuntimeRunner(): DataContextRunner {
  const { app } = getJarvisDatabaseUrls();
  const rootDb = new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: app }) })
  });
  return new DataContextRunner(rootDb);
}
```

Check `@jarv1s/db`'s package export surface for `getJarvisDatabaseUrls`/`DataContextRunner`/`JarvisDatabase` before writing this — if any of these three aren't exported from the package root, add the export in `packages/db/src/index.ts` (grep first: `grep -n "getJarvisDatabaseUrls\|DataContextRunner\|export \* from \"./data-context" packages/db/src/index.ts`).

- [ ] **Step 7: Commit**

```bash
git add tests/uat/seed/connections.ts tests/uat/seed/timestamps.ts tests/uat/seed/timestamps.test.ts tests/uat/seed/types.ts
git commit -m "feat(uat-seed): add connection + timestamp primitives (#1025)"
```

---

### Task 3: `solo-admin` level — loginable admin via real scrypt hash

**Files:**

- Create: `tests/uat/seed/admin.ts`
- Test: `tests/uat/seed/admin.test.ts`

**Interfaces:**

- Consumes: `createMigrationOwnerDb()` from Task 2.
- Produces: `seedSoloAdmin(migrationDb: Kysely<JarvisDatabase>): Promise<{ userId: string; email: string; password: string }>` — later tasks (Task 4+) take `userId` as the `actorUserId` for `withDataContext`.

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/uat/seed/admin.test.ts
// Requires a live dev Postgres (JARVIS_MIGRATION_DATABASE_URL) — run against the
// standard dev compose stack, not the ephemeral UAT one, for fast local iteration.
import { describe, expect, it } from "vitest";
import { createMigrationOwnerDb } from "./connections.js";
import { seedSoloAdmin } from "./admin.js";

describe("seedSoloAdmin", () => {
  it("creates a loginable admin via the real credential-account shape", async () => {
    const db = createMigrationOwnerDb();
    try {
      const { userId, email, password } = await seedSoloAdmin(db);
      expect(email).toBe("uat-admin@jarv1s.local");
      expect(password).toBe("uat-admin-password-1025");

      const user = await db
        .selectFrom("app.users")
        .select(["id", "email", "is_instance_admin", "is_bootstrap_owner", "status"])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow();
      expect(user.is_instance_admin).toBe(true);
      expect(user.status).toBe("active");

      const account = await db
        .selectFrom("app.auth_accounts")
        .select(["account_id", "provider_id", "user_id"])
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow();
      expect(account.account_id).toBe(userId); // real better-auth convention, not email
      expect(account.provider_id).toBe("credential");
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/admin.test.ts`
Expected: FAIL with "Cannot find module './admin.js'"

- [ ] **Step 3: Implement `admin.ts`**

```typescript
// tests/uat/seed/admin.ts
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { sql, type Kysely } from "kysely";

import type { JarvisDatabase } from "@jarv1s/db";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";

const UAT_ADMIN_EMAIL = "uat-admin@jarv1s.local";
const UAT_ADMIN_PASSWORD = "uat-admin-password-1025";

/**
 * #1025 spec §4.2: a genuinely loginable admin — real scrypt hash via
 * better-auth/crypto's hashPassword, real app.users + app.auth_accounts row
 * shapes, so Playwright (#1026) exercises the actual /login path rather than
 * a faked session. app.better_auth_sessions is deliberately NOT seeded here:
 * seeding a session would bypass the auth surface the epic exists to exercise.
 */
export async function seedSoloAdmin(
  migrationDb: Kysely<JarvisDatabase>
): Promise<{ userId: string; email: string; password: string }> {
  const userId = "00000000-0000-4000-8000-000000000001"; // #1025: fixed, not randomUUID() — deterministic across runs
  const passwordHash = await hashPassword(UAT_ADMIN_PASSWORD);

  await migrationDb
    .insertInto("app.users")
    .values({
      id: userId,
      email: UAT_ADMIN_EMAIL,
      name: "UAT Admin",
      email_verified: true,
      is_instance_admin: true,
      is_bootstrap_owner: true,
      status: "active",
      created_at: UAT_SEED_BASE_TIMESTAMP,
      updated_at: UAT_SEED_BASE_TIMESTAMP
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  // #1025 hard invariant: app.auth_accounts is FORCE-RLS'd TO jarvis_auth_runtime
  // (spec §4.1). jarvis_migration_owner can satisfy that policy because it is a
  // member of jarvis_auth_runtime (infra/postgres/bootstrap/0000_roles.sql, added
  // for migration 0045's SECURITY DEFINER ownership) — SET LOCAL ROLE, not BYPASSRLS.
  await sql`SET LOCAL ROLE jarvis_auth_runtime`.execute(migrationDb);
  await migrationDb
    .insertInto("app.auth_accounts")
    .values({
      id: randomUUID(),
      account_id: userId, // better-auth convention: the user's own id, NOT the email
      provider_id: "credential",
      user_id: userId,
      password: passwordHash,
      scope: null,
      created_at: UAT_SEED_BASE_TIMESTAMP,
      updated_at: UAT_SEED_BASE_TIMESTAMP
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
  await sql`RESET ROLE`.execute(migrationDb);

  return { userId, email: UAT_ADMIN_EMAIL, password: UAT_ADMIN_PASSWORD };
}
```

Before finalizing this step, confirm the exact `app.users`/`app.auth_accounts` Kysely table-type column names against `packages/db/src/types.ts` (grep `"users:"` and `"auth_accounts:"`) — adjust field names if they differ from this draft (e.g. snake_case mapping specifics).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2 (needs a live dev Postgres — use the standard dev compose stack's migration connection, per `packages/db/src/urls.ts` defaults)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/uat/seed/admin.ts tests/uat/seed/admin.test.ts
git commit -m "feat(uat-seed): solo-admin level with loginable credential account (#1025)"
```

---

### Task 4: `admin+data` — news, sports, AI provider/model/binding chunks

**Files:**

- Create: `tests/uat/seed/chunks/news.ts`
- Create: `tests/uat/seed/chunks/sports.ts`
- Create: `tests/uat/seed/chunks/ai.ts`
- Test: `tests/uat/seed/chunks/news.test.ts`
- Test: `tests/uat/seed/chunks/sports.test.ts`
- Test: `tests/uat/seed/chunks/ai.test.ts`

**Interfaces:**

- Consumes: `createAppRuntimeRunner()` (Task 2), `UAT_SEED_BASE_TIMESTAMP`/`daysBefore` (Task 2), `seedSoloAdmin`'s returned `userId` (Task 3) as `actorUserId`.
- Produces: `seedNewsChunk(runner: DataContextRunner, actorUserId: string): Promise<void>`, `seedSportsChunk(runner: DataContextRunner, actorUserId: string): Promise<void>`, `seedAiProviderChunk(runner: DataContextRunner, actorUserId: string): Promise<void>` — Task 5 calls all three plus its own chunks under one `withDataContext` composition (or sequentially — each chunk opens its own transaction via `withDataContext`, since Kysely transactions can't span multiple repository calls invoked at different times without holding one open connection for the whole chunk list; sequential separate transactions are fine here since determinism, not atomicity-across-chunks, is the constraint).

- [ ] **Step 1: Write the failing test for the AI provider/model/binding chunk (news chunk depends on it — build first)**

```typescript
// tests/uat/seed/chunks/ai.test.ts
import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { createMigrationOwnerDb } from "../connections.js";
import { seedAiProviderChunk } from "./ai.js";

describe("seedAiProviderChunk", () => {
  it("binds a provider+model to module.news so news settings don't 503", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedAiProviderChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const binding = await scopedDb.db
        .selectFrom("app.ai_service_bindings" as never) // #1025: confirm real table name in packages/ai/sql before finalizing
        .selectAll()
        .where("service", "=", "module.news")
        .executeTakeFirst();
      expect(binding).toBeDefined();
    });
  });
});
```

Before finalizing this test, grep `packages/ai/sql/*.sql` for the real service-binding table name (`grep -n "CREATE TABLE.*service" packages/ai/sql/*.sql`) and adjust the query — do not guess the table name silently.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/chunks/ai.test.ts`
Expected: FAIL with "Cannot find module './ai.js'"

- [ ] **Step 3: Implement `chunks/ai.ts`**

```typescript
// tests/uat/seed/chunks/ai.ts
import type { DataContextRunner } from "@jarv1s/db";
import { AiRepository } from "@jarv1s/ai"; // #1025: confirm exact export path via packages/ai/src/index.ts
import { createAiSecretCipher } from "@jarv1s/ai/crypto"; // #1025: confirm exact export path

/**
 * #1025 spec §4.4: without an active provider+model bound to module.news, the
 * news settings UI 503s ("Topic checking is unavailable right now" —
 * packages/news/src/settings/index.tsx). A fake, non-functional provider is
 * enough for UAT — Playwright only asserts the settings surface stops 503ing,
 * it never calls the real upstream AI API.
 */
export async function seedAiProviderChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new AiRepository();
  const cipher = createAiSecretCipher();

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const provider = await repo.createProvider(scopedDb, {
      providerKey: "uat-fake-provider",
      displayName: "UAT Fake Provider",
      encryptedCredential: cipher.encryptJson({ cli: true }) // #1025: never a real credential
    });
    const model = await repo.createModel(scopedDb, {
      providerId: provider.id,
      modelKey: "uat-fake-json-model",
      displayName: "UAT Fake JSON Model",
      capabilities: ["json"] // #1025: confirm exact capability enum values against packages/ai/src/repository.ts's CreateAiModelInput
    });
    await repo.setServiceBinding(
      scopedDb,
      "module.news",
      { providerId: provider.id, modelId: model.id },
      actorUserId
    );
  });
}
```

Before finalizing: re-read `CreateAiProviderInput`/`CreateAiModelInput` (`packages/ai/src/repository.ts` lines ~130-170) and `setServiceBinding`'s exact parameter shape (line ~721) to confirm every field name above — this draft is from memory of an earlier read this session and must be checked against the file, not assumed.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS

- [ ] **Step 5: Write the failing test for the news chunk**

```typescript
// tests/uat/seed/chunks/news.test.ts
import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedAiProviderChunk } from "./ai.js";
import { seedNewsChunk } from "./news.js";

describe("seedNewsChunk", () => {
  it("creates realistic followed-topic volume, not one token row", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedAiProviderChunk(runner, userId);
    await seedNewsChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const prefs = await scopedDb.db.selectFrom("app.news_prefs").selectAll().execute();
      expect(prefs.length).toBeGreaterThanOrEqual(8); // #1025: "lived-in", not one row
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/chunks/news.test.ts`
Expected: FAIL with "Cannot find module './news.js'"

- [ ] **Step 7: Implement `chunks/news.ts`**

```typescript
// tests/uat/seed/chunks/news.ts
import type { DataContextRunner } from "@jarv1s/db";
import { NewsPrefsRepository } from "@jarv1s/news"; // #1025: confirm exact export path

// #1025 "lived-in account" (Ben, 2026-07-13): a realistic topic/source spread,
// not a single token row — proves the UI against real-feeling volume.
const UAT_NEWS_TOPICS: readonly string[] = [
  "artificial intelligence",
  "climate policy",
  "space exploration",
  "open source software",
  "renewable energy",
  "electric vehicles",
  "quantum computing",
  "public health policy"
];

export async function seedNewsChunk(runner: DataContextRunner, actorUserId: string): Promise<void> {
  const repo = new NewsPrefsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const topic of UAT_NEWS_TOPICS) {
      await repo.create(scopedDb, { kind: "topic", value: topic }); // #1025: confirm exact CreateNewsPrefRequest field name for the topic string (may be `topic`/`value`/`term`) against packages/news/src/repository.ts
    }
  });
}
```

Before finalizing: re-read `CreateNewsPrefRequest`'s exact field names (`packages/news/src/repository.ts` / `@jarv1s/shared`'s news-api contract) — this draft's `value` field name is a placeholder guess and MUST be corrected against the real type before this step is considered done (violates "No Placeholders" otherwise — fix during implementation, not left as TBD in the merged code).

- [ ] **Step 8: Run test to verify it passes**

Run: same command as Step 6
Expected: PASS

- [ ] **Step 9: Write the failing test for the sports chunk**

```typescript
// tests/uat/seed/chunks/sports.test.ts
import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedSportsChunk } from "./sports.js";

describe("seedSportsChunk", () => {
  it("follows several teams/competitions", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedSportsChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const follows = await scopedDb.db.selectFrom("app.sports_follows").selectAll().execute();
      expect(follows.length).toBeGreaterThanOrEqual(3);
    });
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/chunks/sports.test.ts`
Expected: FAIL with "Cannot find module './sports.js'"

- [ ] **Step 11: Implement `chunks/sports.ts`**

```typescript
// tests/uat/seed/chunks/sports.ts
import type { DataContextRunner } from "@jarv1s/db";
import { SportsFollowsRepository } from "@jarv1s/sports"; // #1025: confirm exact export path

/** #1025 "lived-in account": a handful of followed teams/whole-competitions, not one row. */
const UAT_SPORTS_FOLLOWS: ReadonlyArray<{ competitionKey: string; teamKey: string | null }> = [
  { competitionKey: "nfl", teamKey: "nfl-sf-49ers" }, // #1025: confirm real competition/team key format against packages/sports/src seed data or fixtures before finalizing
  { competitionKey: "nba", teamKey: "nba-bos-celtics" },
  { competitionKey: "premier-league", teamKey: null }
];

export async function seedSportsChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new SportsFollowsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const follow of UAT_SPORTS_FOLLOWS) {
      await repo.create(scopedDb, follow);
    }
  });
}
```

Before finalizing: confirm real `competitionKey`/`teamKey` values the sports module actually recognizes (grep `packages/sports/src` for a static team/competition catalog) — placeholder keys above must be replaced with real ones before this step is done.

- [ ] **Step 12: Run test to verify it passes**

Run: same command as Step 10
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add tests/uat/seed/chunks/ai.ts tests/uat/seed/chunks/ai.test.ts tests/uat/seed/chunks/news.ts tests/uat/seed/chunks/news.test.ts tests/uat/seed/chunks/sports.ts tests/uat/seed/chunks/sports.test.ts
git commit -m "feat(uat-seed): admin+data news/sports/ai chunks (#1025)"
```

---

### Task 5: `admin+data` — tasks, calendar, notes chunks + job-search toggle

**Files:**

- Create: `tests/uat/seed/chunks/tasks.ts`
- Create: `tests/uat/seed/chunks/calendar.ts`
- Create: `tests/uat/seed/chunks/notes.ts`
- Create: `tests/uat/seed/chunks/job-search.ts`
- Test: matching `.test.ts` for each

**Interfaces:**

- Consumes: same as Task 4.
- Produces: `seedTasksChunk`, `seedCalendarChunk`, `seedNotesChunk`, `seedJobSearchChunk` (each `(runner, actorUserId) => Promise<void>`) — Task 6 composes all chunks from Tasks 4+5 into `admin+data`.

- [ ] **Step 1: Write the failing test + implement `chunks/tasks.ts`**

```typescript
// tests/uat/seed/chunks/tasks.test.ts
import { describe, expect, it } from "vitest";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedTasksChunk } from "./tasks.js";

describe("seedTasksChunk", () => {
  it("creates a realistic spread of tasks across statuses and due dates", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedTasksChunk(runner, userId);

    await runner.withDataContext({ actorUserId: userId }, async (scopedDb) => {
      const tasks = await scopedDb.db.selectFrom("app.tasks").selectAll().execute();
      expect(tasks.length).toBeGreaterThanOrEqual(10);
    });
  });
});
```

```typescript
// tests/uat/seed/chunks/tasks.ts
import type { DataContextRunner } from "@jarv1s/db";
import { TasksRepository } from "@jarv1s/tasks"; // #1025: confirm exact export path
import { UAT_SEED_BASE_TIMESTAMP, daysBefore, daysAfter } from "../timestamps.js";

/**
 * #1025 "lived-in account": a spread across statuses/due dates so the tasks
 * list/board views have something real to render, not one placeholder row.
 * All dueAt values derive from UAT_SEED_BASE_TIMESTAMP — never `new Date()`.
 */
const UAT_TASKS: ReadonlyArray<{
  title: string;
  status?: "open" | "done";
  dueAt?: Date;
  priority?: number;
}> = [
  { title: "Draft Q1 planning doc", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 3), priority: 1 },
  { title: "Review PR backlog", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1), priority: 2 },
  { title: "Renew domain registration", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 10) },
  { title: "Book dentist appointment", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 14) },
  { title: "Fix leaking faucet", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 2) },
  { title: "Send thank-you note", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 5) },
  { title: "Prepare quarterly taxes", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 30) },
  { title: "Plan weekend trip", priority: 3 },
  { title: "Update resume", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 21) },
  { title: "Organize garage", status: "done", dueAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 10) },
  { title: "Read design doc from teammate", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 2) },
  { title: "Schedule car maintenance", dueAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 7) }
];

export async function seedTasksChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new TasksRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    for (const task of UAT_TASKS) {
      await repo.create(scopedDb, {
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        priority: task.priority ?? null
      });
    }
  });
}
```

Note: `TasksRepository.create` (per `packages/tasks/src/repository.ts:197`) does idempotency checks via `externalKey`+`source` — since these seed rows pass neither, confirm at implementation time whether repeated seed runs (idempotent re-provisioning) would duplicate rows, and if so pass a stable `externalKey` (e.g. `uat-seed-task-${index}`) + `source: "uat-seed"` per row so re-running the seed against the same DB is idempotent — this matters because the provisioner may call the seed hook more than once during iteration.

- [ ] **Step 2: Run test, verify fail then pass** (same pattern as prior tasks — command: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/chunks/tasks.test.ts`)

- [ ] **Step 3: Write the failing test + implement `chunks/calendar.ts`**

```typescript
// tests/uat/seed/chunks/calendar.ts
import { randomUUID } from "node:crypto";
import type { DataContextRunner } from "@jarv1s/db";
import { ConnectorsRepository } from "@jarv1s/connectors"; // #1025: confirm exact export path
import { createConnectorSecretCipher } from "@jarv1s/connectors/crypto"; // #1025: confirm exact export path
import { CalendarRepository } from "@jarv1s/calendar"; // #1025: confirm exact export path
import { UAT_SEED_BASE_TIMESTAMP, daysAfter, daysBefore } from "../timestamps.js";

/**
 * #1025: calendar_events are connector-synced cached rows (packages/calendar/src/
 * repository.ts's upsertCachedEvent), not directly user-authored — a real
 * calendar UI has no events without a connector_account. `'google'` is a
 * pre-seeded connector_definitions row (migration 0044) so this needs no new
 * definition, only a fake account under it.
 */
export async function seedCalendarChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const connectors = new ConnectorsRepository();
  const calendar = new CalendarRepository();
  const cipher = createConnectorSecretCipher();

  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    const account = await connectors.createAccount(scopedDb, {
      providerId: "google",
      scopes: ["calendar.read"],
      encryptedSecret: cipher.encryptJson({ cli: true }) // #1025: fake, never a real OAuth token
    });

    const events: ReadonlyArray<{ title: string; startsAt: Date; endsAt: Date }> = [
      {
        title: "Team standup",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 1)
      },
      {
        title: "Dentist appointment",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 5),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 5)
      },
      {
        title: "Quarterly review",
        startsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 12),
        endsAt: daysAfter(UAT_SEED_BASE_TIMESTAMP, 12)
      },
      {
        title: "Past: Project kickoff",
        startsAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 20),
        endsAt: daysBefore(UAT_SEED_BASE_TIMESTAMP, 20)
      }
    ];
    for (const [index, event] of events.entries()) {
      await calendar.upsertCachedEvent(scopedDb, {
        id: randomUUID(), // acceptable: not asserted-against content, only a DB PK
        connectorAccountId: account.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        externalId: `uat-seed-event-${index}` // #1025: stable external id keeps upsertCachedEvent's onConflict idempotent across re-seeds
      });
    }
  });
}
```

**Confirmed:** `packages/connectors/src/crypto.ts` exports `createConnectorSecretCipher(env)` exactly mirroring `createAiSecretCipher` (dev default key `jarv1s-development-connector-secret`, zero extra env config needed) — the import in the code block above is correct as written. Remaining confirm-before-finalizing item: exact field names in `CreateConnectorAccountInput`/`ConnectorAccountSafeRow` (`packages/connectors/src/repository.ts`) — re-check against the file since this draft is from an earlier read this session.

- [ ] **Step 4: Write failing test, verify fail then pass for calendar chunk** (mirror the tasks-chunk test pattern; assert `app.calendar_events` row count ≥ 4)

- [ ] **Step 5: Implement the `notes` chunk via `VaultContext` (Coordinator-binding: never raw `fs`)**

The notes module (`packages/notes/src/`) has no note-content repository of its own — notes live in an external vault via `VaultContext`, not as `app.*` DB rows (per project memory "No Note Viewer": the shell only shows search + provenance, never raw note content). **A DB-backed proxy (`app.commitment_candidates`/`app.commitments` standing in for real vault files) was considered and is explicitly rejected** — the hard invariant "VaultContext for all vault I/O" applies to seed code same as production code; there is no seed-tooling carve-out. Implement `chunks/notes.ts` by calling `withVaultContext` (`packages/vault/src/context.ts` — read it first to confirm the exact export name/signature) for the seeded admin's `actorUserId`, then writing a small, fixed set of real markdown files through it (e.g. 3-5 notes with deterministic filenames/content derived from the injected base timestamp, no wall-clock). A thinner chunk (fewer files) is acceptable if the full write surface is heavy to wire — but every file must go through `VaultContext`, never a direct `fs.writeFile`/`mkdir` call. Write it as a real (not placeholder) implementation before this step is marked done.

- [ ] **Step 6: Implement `chunks/job-search.ts` — the absence/presence toggle**

```typescript
// tests/uat/seed/chunks/job-search.ts
import type { DataContextRunner } from "@jarv1s/db";

/**
 * #1025 spec §4.4: job-search is an external module — "not installed" is the
 * admin+data DEFAULT (proves the UI's absent-module path); this function only
 * runs when the level composition explicitly does NOT exclude "job-search"
 * (i.e. the caller decided to prove the installed-module path instead).
 * "Installed" means app.external_modules / the module registry shows
 * installed-enabled — NOT running the full module-reconcile download flow,
 * which is a privileged host operation out of scope here.
 */
export async function seedJobSearchChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    // #1025: confirm the exact app.external_modules row shape needed to mark
    // "job-search" installed-enabled by reading packages/settings/src/
    // repository-external-modules.ts and packages/settings/sql/0152_external_modules.sql
    // before finalizing this insert — do not guess column names here.
    throw new Error(
      "seedJobSearchChunk: confirm app.external_modules row shape against packages/settings/src/repository-external-modules.ts before implementing"
    );
  });
}
```

Replace the placeholder `throw` with the real insert once `packages/settings/src/repository-external-modules.ts` is read — this file is explicitly a "read before implementing" step, not a shipped placeholder; the task is not done until the throw is replaced with a real implementation and its own passing test.

- [ ] **Step 7: Commit**

```bash
git add tests/uat/seed/chunks/tasks.ts tests/uat/seed/chunks/tasks.test.ts tests/uat/seed/chunks/calendar.ts tests/uat/seed/chunks/calendar.test.ts tests/uat/seed/chunks/notes.ts tests/uat/seed/chunks/notes.test.ts tests/uat/seed/chunks/job-search.ts tests/uat/seed/chunks/job-search.test.ts
git commit -m "feat(uat-seed): tasks/calendar/notes/job-search chunks (#1025)"
```

---

### Task 6: Level composition + `multi-user` + CLI entrypoint

**Files:**

- Create: `tests/uat/seed/levels.ts`
- Modify: `tests/uat/seed/cli.ts` (skeleton from Task 2)
- Test: `tests/uat/seed/levels.test.ts`

**Interfaces:**

- Consumes: `seedSoloAdmin` (Task 3), all `seed*Chunk` functions (Tasks 4-5), `createMigrationOwnerDb`/`createAppRuntimeRunner` (Task 2).
- Produces: `seedLevel(options: SeedOptions): Promise<void>` — this is the function the compose `seed` service's CLI calls, and the one wired into the provisioner's seed hook in Task 7.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/uat/seed/levels.test.ts
import { describe, expect, it } from "vitest";
import { createMigrationOwnerDb } from "./connections.js";
import { seedLevel } from "./levels.js";

describe("seedLevel", () => {
  it("bare seeds nothing beyond the migrated schema", async () => {
    await seedLevel({ level: "bare" });
    // no users/data — nothing further to assert beyond "did not throw"
  });

  it("admin+data excludes named chunks", async () => {
    await seedLevel({ level: "admin+data", excludeChunks: ["job-search"] });
    const db = createMigrationOwnerDb();
    try {
      const admin = await db
        .selectFrom("app.users")
        .selectAll()
        .where("email", "=", "uat-admin@jarv1s.local")
        .executeTakeFirstOrThrow();
      expect(admin.is_instance_admin).toBe(true);
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/uat/seed/levels.test.ts`
Expected: FAIL with "Cannot find module './levels.js'"

- [ ] **Step 3: Implement `levels.ts`**

```typescript
// tests/uat/seed/levels.ts
import { createAppRuntimeRunner, createMigrationOwnerDb } from "./connections.js";
import { seedSoloAdmin } from "./admin.js";
import { seedAiProviderChunk } from "./chunks/ai.js";
import { seedNewsChunk } from "./chunks/news.js";
import { seedSportsChunk } from "./chunks/sports.js";
import { seedTasksChunk } from "./chunks/tasks.js";
import { seedCalendarChunk } from "./chunks/calendar.js";
import { seedNotesChunk } from "./chunks/notes.js"; // #1025: only if Task 5 Step 5 lands a real implementation
import { seedJobSearchChunk } from "./chunks/job-search.js";
import type { SeedOptions, UatSeedChunk } from "./types.js";

// #1025 spec §4.3: the level ladder is additive — this is the single source of
// truth for "which chunks exist at admin+data", so excludeChunks (job-search
// toggle) subtracts from this list rather than needing a fifth hardcoded level.
const ADMIN_DATA_CHUNKS: ReadonlyArray<{
  key: UatSeedChunk;
  run: (runner: ReturnType<typeof createAppRuntimeRunner>, actorUserId: string) => Promise<void>;
}> = [
  { key: "news", run: (runner, actorUserId) => seedNewsChunk(runner, actorUserId) },
  { key: "sports", run: (runner, actorUserId) => seedSportsChunk(runner, actorUserId) },
  { key: "tasks", run: (runner, actorUserId) => seedTasksChunk(runner, actorUserId) },
  { key: "calendar", run: (runner, actorUserId) => seedCalendarChunk(runner, actorUserId) },
  { key: "notes", run: (runner, actorUserId) => seedNotesChunk(runner, actorUserId) },
  { key: "job-search", run: (runner, actorUserId) => seedJobSearchChunk(runner, actorUserId) }
];

export async function seedLevel(options: SeedOptions): Promise<void> {
  if (options.level === "bare") {
    return; // #1024/#1000: bare is the Phase 1 no-op — a migrated DB, nothing more.
  }

  const migrationDb = createMigrationOwnerDb();
  let adminUserId: string;
  try {
    ({ userId: adminUserId } = await seedSoloAdmin(migrationDb));
  } finally {
    await migrationDb.destroy();
  }

  if (options.level === "solo-admin") {
    return;
  }

  // admin+data and multi-user both include every non-excluded chunk.
  const runner = createAppRuntimeRunner();
  const exclude = new Set(options.excludeChunks ?? []);
  // #1025: AI provider/model/binding must land before the news chunk, since
  // news settings check for an active module.news binding — order matters here,
  // it is not a parallelizable Promise.all.
  await seedAiProviderChunk(runner, adminUserId);
  for (const chunk of ADMIN_DATA_CHUNKS) {
    if (exclude.has(chunk.key)) continue;
    await chunk.run(runner, adminUserId);
  }

  if (options.level === "multi-user") {
    // #1025/#1000: multi-user (second user + cross-user share/RLS fixtures) is
    // explicitly deferred to fast-follow issue #1030 per Coordinator ruling
    // 2026-07-13 — this PR ships solo-admin + admin+data + the job-search
    // toggle only. Flagged loudly (not a silent stub) so #1030 has a clear seam.
    throw new Error("seedLevel: multi-user is deferred to #1030 — not implemented in this PR");
  }
}
```

Note: the `multi-user` level's `throw` above is intentional and permanent for this PR — Coordinator-deferred to issue #1030, not a placeholder to fill in during Task 7/8. Do not add a "Task 6b" second-user chunk here. Call this out explicitly in the wrap-up PR body (`Part of #1000`, referencing #1030 as the fast-follow).

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (both `it` blocks — the second requires a live dev Postgres with all migrations applied)

- [ ] **Step 5: Implement the CLI entrypoint**

```typescript
// tests/uat/seed/cli.ts
import { seedLevel } from "./levels.js";
import type { UatSeedChunk, UatSeedLevel } from "./types.js";

/**
 * #1025: entrypoint for the new `seed` ops-profile compose service (see
 * infra/docker-compose.prod.yml) — runs inside the compose network since
 * postgres publishes no host port, so this can never be invoked as a plain
 * host-side script (see plan's "Architecture decisions" section).
 */
async function main(): Promise<void> {
  // #1025/#1000 (Coordinator ruling, binding): hard-refuse unless the caller
  // proves this is the ephemeral UAT compose stack. composeSeedHook is the
  // ONLY caller that sets this token (Task 7 Step 3) — a real prod deploy
  // never does, so a stray `docker compose --profile ops run seed` against a
  // prod-shaped stack fails closed instead of seeding fixture data into it.
  if (process.env.JARVIS_UAT_SEED_CONFIRM !== "1") {
    throw new Error(
      "[uat-seed] refusing to run: JARVIS_UAT_SEED_CONFIRM=1 not set — this entrypoint only runs " +
        "inside the ephemeral UAT compose stack (see tests/uat/provisioner.ts composeSeedHook)"
    );
  }

  const level = (process.env.JARVIS_UAT_SEED_LEVEL ?? "bare") as UatSeedLevel;
  const excludeChunks = (process.env.JARVIS_UAT_SEED_EXCLUDE_CHUNKS ?? "")
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk): chunk is UatSeedChunk => chunk.length > 0);

  await seedLevel({ level, excludeChunks });
  console.log(
    `[uat-seed] seeded level "${level}"${excludeChunks.length ? ` (excluding: ${excludeChunks.join(", ")})` : ""}`
  );
}

main().catch((error) => {
  console.error("[uat-seed] failed:", error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Commit**

```bash
git add tests/uat/seed/levels.ts tests/uat/seed/levels.test.ts tests/uat/seed/cli.ts
git commit -m "feat(uat-seed): level composition + CLI entrypoint (#1025)"
```

---

### Task 7: Wire into the provisioner + new compose service (only after Coordinator sign-off from Task 1)

**Files:**

- Modify: `infra/docker-compose.prod.yml` (add `seed` service ONLY — approved scope expansion per Coordinator ruling; touch nothing else in this file)
- Modify: `tests/uat/provisioner.ts` (extend `SeedHook`/`UatSeedLevel`, replace `bareSeedHook` call site)

**Interfaces:**

- Consumes: `seedLevel` (Task 6, invoked indirectly via the compose `seed` service, not imported directly into `provisioner.ts` — the provisioner shells out via `docker compose run`, it does not import `tests/uat/seed/*` as a library, since it cannot open a DB connection to the ephemeral instance from the host).
- Produces: updated `SeedHook` type consumed by `main()`.

- [ ] **Step 1: Add the `seed` service to `infra/docker-compose.prod.yml`**, immediately after the existing `module-install` service (after line 76), mirroring its exact structure:

```yaml
  seed:
    image: ghcr.io/motioneso/jarv1s:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    build:
      context: ..
      dockerfile: Dockerfile
    <<: *app-env-file
    # #1025/#1000: UAT-only — seeds tiered dev/test data through the same
    # in-network connections migrate/module-install use (postgres has no
    # host-published port, so this cannot run as a host-side script).
    # profiles: ["ops"] keeps this INERT on a normal `up` — it never runs
    # unless the ops profile is explicitly selected (Coordinator ruling,
    # binding). JARVIS_UAT_SEED_CONFIRM is the second, entrypoint-side guard
    # (tests/uat/seed/cli.ts) that refuses to run unless composeSeedHook set it.
    command: ["node_modules/.bin/tsx", "tests/uat/seed/cli.ts"]
    environment:
      JARVIS_UAT_SEED_LEVEL: "${JARVIS_UAT_SEED_LEVEL:-bare}"
      JARVIS_UAT_SEED_EXCLUDE_CHUNKS: "${JARVIS_UAT_SEED_EXCLUDE_CHUNKS:-}"
      JARVIS_UAT_SEED_CONFIRM: "${JARVIS_UAT_SEED_CONFIRM:?refusing to seed: not invoked via the UAT provisioner}"
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["ops"]
    networks:
      - jarv1s
```

- [ ] **Step 2: Read the current `SeedHook` type and call site in `tests/uat/provisioner.ts`** (lines 146-154 and 399 per the last full read this session) before editing — confirm line numbers haven't shifted.

- [ ] **Step 3: Replace the `SeedHook` type and `bareSeedHook`, add a compose-backed hook**

```typescript
// tests/uat/provisioner.ts — replace lines 146-154
export type UatSeedLevel = "bare" | "solo-admin" | "admin+data" | "multi-user";

export type SeedHook = (ctx: {
  readonly projectName: string;
  readonly level: UatSeedLevel;
  readonly excludeChunks?: readonly string[];
}) => Promise<void>;

export const bareSeedHook: SeedHook = async () => {};

/**
 * #1025: runs tests/uat/seed/cli.ts as a one-shot `seed` ops-profile compose
 * service (same network-reachability reason `migrate` runs as a compose
 * service, not a host script — postgres publishes no host port).
 *
 * JARVIS_UAT_SEED_CONFIRM=1 is the entrypoint-side half of the Coordinator's
 * binding prod-guard: composeSeedHook is the ONLY caller that sets it, so
 * cli.ts (Task 6) refuses to run for anything else that might invoke the
 * `seed` service against a non-ephemeral stack.
 */
export const composeSeedHook: SeedHook = async ({ projectName, level, excludeChunks }) => {
  await runCommand(
    "docker",
    buildUatComposeArgs(projectName, [
      "--profile",
      "ops",
      "run",
      "--rm",
      "-e",
      `JARVIS_UAT_SEED_LEVEL=${level}`,
      "-e",
      `JARVIS_UAT_SEED_EXCLUDE_CHUNKS=${(excludeChunks ?? []).join(",")}`,
      "-e",
      "JARVIS_UAT_SEED_CONFIRM=1",
      "seed"
    ])
  );
};
```

- [ ] **Step 4: Update the `main()` call site** (was `await bareSeedHook({ projectName });` at line 399) to read the desired level from an env var and call `composeSeedHook`:

```typescript
// tests/uat/provisioner.ts — replace the bareSeedHook call in main()
const level = (process.env.JARVIS_UAT_SEED_LEVEL ?? "bare") as UatSeedLevel;
await composeSeedHook({ projectName, level }); // #1024/#1000 seam, filled by #1025
```

- [ ] **Step 5: Confirm `runCommand`/`buildUatComposeArgs` are already in scope at this point in the file** (both are defined earlier in `provisioner.ts` per the Task 2/prior-session read) — no new imports needed.

- [ ] **Step 6: Run the existing provisioner smoke path locally** (whatever command Phase 1's PR used to exercise this file end-to-end — check `package.json` for a `uat:smoke`-style script before inventing one) to confirm `bare` still round-trips with no seed side effects, then `admin+data` produces a loginable admin.

- [ ] **Step 7: Commit**

```bash
git add tests/uat/provisioner.ts infra/docker-compose.prod.yml
git commit -m "feat(uat): wire seed levels into the provisioner seed hook (#1025)"
```

---

### Task 8: Gate + PR (via `coordinated-wrap-up`)

- [ ] Run `pnpm verify:foundation`; record its exit code.
- [ ] Run the pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`; record exit codes.
- [ ] `git fetch origin main && git rebase origin/main`.
- [ ] Open PR: base `main`, body includes `Part of #1000` + `Closes #1025`, recorded exit codes, and the plain "What's new" line: _"Internal: adds the tiered lived-in seed that UAT tests run against."_ Explicitly call out in the PR body: (a) `multi-user` level is a documented `throw` deferred to fast-follow **#1030**, by design, not a gap in this PR; (b) the `notes` chunk ships via `VaultContext` (per Task 5 Step 5), noting its actual file count if thinner than the other chunks.
- [ ] Report the PR number to the `Coordinator` pane. Do not merge.

## Self-Review

**Spec coverage:** §4.2 loginable admin (Task 3) ✓; §4.3 level ladder (Task 6, `multi-user` intentionally deferred to #1030 per Coordinator ruling — not this PR's scope) ✓; §4.4 chunks — news/sports/AI (Task 4) ✓, tasks/calendar (Task 5) ✓, notes (Task 5 Step 5, via `VaultContext`, no DB-proxy substitute) ✓, job-search toggle (Task 5 Step 6, real shape deferred to a one-line "read before implementing" step since the exact `app.external_modules` row shape wasn't grounded this session) ✓; seed-hook wiring (Task 7, now with the `JARVIS_UAT_SEED_CONFIRM` prod-guard) ✓; gate+PR (Task 8) ✓.

**Placeholder scan:** Two spots intentionally defer a concrete field/table name to a "read this file first" instruction rather than guessing wrong in committed code (AI service-binding table name in Task 4 Step 1; news pref field name in Task 4 Step 7); one, job-search's `app.external_modules` row shape (Task 5 Step 6), is grounded via a required file-read step before the real (non-placeholder) implementation is written — each names the exact file to read and treats the guess as unacceptable to ship, consistent with "No Placeholders." Task 6's `multi-user` `throw` is a deliberate, Coordinator-approved permanent boundary for this PR (points at #1030), not an unresolved placeholder.

**Type consistency:** `SeedOptions`/`UatSeedLevel`/`UatSeedChunk` (Task 2) are the single definitions reused unchanged through Tasks 4-7; `seed*Chunk(runner, actorUserId)` signature is uniform across every chunk file; `SeedHook` in Task 7 is the only place the provisioner-facing shape is defined, replacing (not duplicating) Phase 1's version.
