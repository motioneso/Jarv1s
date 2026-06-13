# Phase 4 — Secondary-user Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the founder approves a household member, that member signs in and lands in the _same_ `OnboardingWizard` route tree — parameterized by role — that walks them through an optional/skippable member flow (welcome / optional API-key opt-out / per-user Google connector / client-only section tour), recording completion **per user** in a new owner-only `app.member_onboarding` table (NOT a column on `app.users`), with the multi-user isolation gate extended to prove a member cannot reach the founder's or another member's private data — including a member's onboarding state, which not even an admin may read.

**Architecture:** One wizard, parameterized by role — not a second wizard. We **reuse and generalize** the Phase-2 primary-onboarding spine (`apps/web/src/onboarding/` route tree, `GET /api/onboarding/status`, `POST /api/onboarding/complete` + `/skip`, the `queryKeys.onboarding` namespace, the `app.tsx` onboarding branch, the `OnboardingStatusResponse` shared contract).

> **CRITICAL security correction (do not regress to a `users` column):** an earlier draft of this plan stored member onboarding state as `app.users.onboarding_completed_at`. **That is unsafe.** Migration `0052_fix_admin_select_policy.sql` adds policy `users_app_runtime_admin_select ON app.users FOR SELECT USING (app.current_actor_is_admin())` — so an admin actor can directly `SELECT *` from **any** `app.users` row through `jarvis_app_runtime`, and `0050`'s `users_app_runtime_admin_update` lets an admin `UPDATE` any row. A new `app.users` column would therefore be cross-user **readable and writable by any admin**, violating the no-admin-private-data-bypass hard invariant. Keeping the column out of the SECURITY DEFINER helpers (`app.get_user_by_id` / `app.list_all_users`) is **not** sufficient, because an admin can bypass those helpers with a direct table query. The fix is a **separate owner-only table** with its own RLS (self-row only, **no** admin SELECT/UPDATE policy), modelled exactly on `app.chat_memory_facts` (`packages/memory/sql/0041_memory_facts.sql`).

Per-user state is a single row per member in `app.member_onboarding (user_id uuid PK, completed_at timestamptz)`, read/written **only** through the actor's own row via `owner-only` policies keyed on `user_id = app.current_actor_user_id()` (ENABLE + FORCE RLS, no admin policy). Connector- and AI-done flags for the member are derived **client-side** from the connectors/AI modules' public endpoints (`listConnectorAccounts`, `listAiProviders`), so `packages/settings` never reads another module's tables.

**Tech Stack:** TypeScript (strict), Fastify 5 routes with JSON-schema validation (`packages/shared/src/platform-api.ts`), Kysely repositories taking a branded `DataContextDb` (per-method `assertDataContextDb` pattern), React 18 + React Query (`@tanstack/react-query`) + React Router (`react-router`), PostgreSQL with RLS, Vitest for integration tests, Playwright for e2e (mock REST via `tests/e2e/mock-*.ts`).

---

## CRITICAL PRE-READ — scope reconciliation (read before any task)

This plan implements the approved spec **`docs/superpowers/specs/2026-06-13-p4-secondary-user-onboarding-design.md` only**. Two things the autonomous worker MUST internalize:

1. **This slice EXTENDS the Phase-2 primary-onboarding spine; it does not create it.** As of plan authoring, the spine is **not yet merged on `main`** — `apps/web/src/onboarding/` does not exist, there are no `/api/onboarding/*` routes, and `OnboardingStatusResponse` is not yet in `packages/shared/src/platform-api.ts`. The spine is authored by the sibling plan `docs/superpowers/plans/2026-06-12-p2-primary-user-onboarding.md`. **Task 0 is a hard preflight gate** that verifies the spine is present before any work starts. If the spine is absent, STOP and escalate — do **not** re-author the wizard, the status route, the shared contract, or the `app.tsx` branch from scratch (doing so produces duplicate definitions and route collisions; see spec §Open risks).

2. **There is NO Wellness module in this slice, and you must NOT build one.** The orchestration template mentions a "Wellness plan" (tables/RLS → check-ins → FeelingsWheel modal → medications → surfacing tools → readiness signal). **That is not in this spec and there is no approved Wellness spec** — building it would violate the CLAUDE.md "Spec before build" hard gate. In THIS slice, "Wellness" appears only as (a) one informational line in the client-only section tour, **omitted client-side if no wellness module/route exists** (it does not exist today — verified: no `packages/wellness`, no `/api/wellness`), and (b) a **deferred** isolation test case (spec §Open risks "Wellness surface assumption"). Tasks below implement exactly that and nothing more. Do not author wellness tables, RLS, APIs, a FeelingsWheel, medications, or readiness signals.

**Grounding:** before starting, run `pnpm audit:preflight` (must exit 0 — tree current vs `origin/main`). Record the verified commit SHA in the first commit body. Never `git pull`/`checkout`/`reset` a shared working tree to get current (another session may be mid-build).

---

## File Structure

### New files

| Path                                                     | Responsibility                                                                                                                                                                                                                            | Tested by                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `infra/postgres/migrations/<NNNN>_member_onboarding.sql` | App-level DDL: `CREATE TABLE app.member_onboarding` (owner-only, ENABLE + FORCE RLS, self-row policies keyed on `user_id = app.current_actor_user_id()`, **no admin policy**). `<NNNN>` = next free global migration number (see Task 1). | `tests/integration/onboarding-member.test.ts` |
| `tests/integration/onboarding-member.test.ts`            | Integration: migration assertion, `getMemberOnboardingState`/`setMemberOnboardingComplete` repo methods, `GET /status` + `POST /complete` + `/skip` member branch, audit row, AccessContext unchanged.                                    | itself                                        |
| `apps/web/src/onboarding/member-welcome-step.tsx`        | Member welcome panel + skip affordance (no server I/O).                                                                                                                                                                                   | e2e                                           |
| `apps/web/src/onboarding/api-key-opt-out-step.tsx`       | Optional/skippable: "use the shared assistant" skip + link to `AiSettingsPanel`. Writes nothing. Derives `apiKeyOptOut.done` client-side from `listAiProviders()` (module isolation — never a settings-side AI-table read).               | e2e                                           |
| `apps/web/src/onboarding/member-connector-step.tsx`      | Reuses `ConnectGooglePanel` verbatim; done client-side when `listConnectorAccounts()` ≥ 1.                                                                                                                                                | e2e                                           |
| `apps/web/src/onboarding/section-tour-step.tsx`          | Client-only section tour: one line each for the now-real sections; omits a line if its module/route is absent.                                                                                                                            | e2e                                           |
| `apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md` | **Early mockup placeholder** (see Task 6): documents that NO feelings-wheel/wellness UI is in scope for this slice and points to the absent-Wellness deferral. Prevents the autonomous worker from inventing one.                         | n/a (doc)                                     |
| `tests/e2e/onboarding-member.spec.ts`                    | Playwright: member step array (no CLI-auth/multiplexer), skippability, resumability, status-error fall-through; founder regression.                                                                                                       | itself                                        |

### Modified files

| Path                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/types.ts`                       | Add a new `MemberOnboardingTable` interface and register `"app.member_onboarding": MemberOnboardingTable` on `JarvisDatabase`. **Do NOT** add any field to `UsersTable`, `User`, or `UserDto` (onboarding state never rides the user row).                                                                                                                                                                                                                                                               |
| `packages/shared/src/platform-api.ts`            | Widen `OnboardingStatusResponse` to a `role`-discriminated union (`"founder" \| "member"`) + JSON schema variants. **Do not** add an onboarding field to `UserDto`.                                                                                                                                                                                                                                                                                                                                      |
| `packages/settings/src/repository.ts`            | Add `getMemberOnboardingState(scopedDb)` (GUC-scoped, no id arg) + `setMemberOnboardingComplete(scopedDb, input)` (UPSERT keyed on the GUC actor; `input` is `{ actorUserId, requestId }` for the audit row only).                                                                                                                                                                                                                                                                                       |
| `packages/settings/src/routes.ts`                | Branch the existing `/api/onboarding/status`, `/complete`, `/skip` handlers on the server-read `is_bootstrap_owner` (from the SD-helper `getUserById`); relax the member status read to `requireKnownUser` (not `assertAdminUser`). Member completion reads/writes the actor's OWN `app.member_onboarding` row only.                                                                                                                                                                                     |
| `apps/web/src/api/client.ts`                     | Widen the `getOnboardingStatus()` return type to the member union; no new endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/onboarding/onboarding-wizard.tsx`  | Select the step array by role; mount the four new member steps for members.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/src/app.tsx`                           | Generalize the onboarding branch to also fire for an active member whose per-user onboarding is incomplete.                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/integration/multi-user-isolation.test.ts` | Add cases: per-user member-onboarding state invisible across users **and to an admin** (executable admin-context negative read, not just a policy-name check) + absent from admin user list; per-user connectors / AI keys / chat / memory (`memory_chunks` **and** `chat_memory_facts`) isolation — **each seeded with Alice-owned rows first**, then asserted invisible to Bob/admin; lifecycle stitch. (Wellness case explicitly deferred with a comment; vault covered by the existing vault suite.) |
| `tests/e2e/mock-api.ts`                          | Extend the onboarding mock to serve the member status shape (driven by `isBootstrapOwner`).                                                                                                                                                                                                                                                                                                                                                                                                              |

> **Filenames in the spine are assumed from the sibling Phase-2 plan** (`onboarding-wizard.tsx`, `welcome-step.tsx`, `multiplexer-step.tsx`, `cli-auth-step.tsx`, `connector-step.tsx`). Task 0 verifies the actual names and pins them; subsequent tasks reference the pinned names. If a spine file's name differs, adapt the import paths (the _structure_ — a wizard that iterates a step array and reads `getOnboardingStatus()` — is the contract, not the exact filenames).

---

## Tasks (TDD, dependency-ordered)

> Every task: write the failing test → run (expect **FAIL**) → minimal implementation with COMPLETE code → run (expect **PASS**) → commit with explicit `git add <paths>`. **Never `git add -A` / `git add .`** (a sibling session may share this tree).
>
> **Hard-invariant reminders that apply to every task:** repositories take only a branded `DataContextDb` and call `assertDataContextDb(scopedDb)` first; `AccessContext` stays `{ actorUserId, requestId }` (add nothing); no secret-shaped field in any response; no module reads another module's owned table; never edit an applied migration (add a new file); RLS applies to admins (no bypass).

---

### Task 0: Preflight — verify the Phase-2 onboarding spine is present and pin its surface

**Files:**

- Modify: none (verification + pinning only; no commit unless escalation note needed)

- [ ] **Step 0.1: Confirm tree freshness**

Run: `pnpm audit:preflight`
Expected: exit 0. Record the printed commit SHA; you will cite it in Task 1's commit body. If it exits 1 (tree behind baseline), STOP and escalate — do not pull a shared tree.

- [ ] **Step 0.2: Verify the spine exists**

Run:

```bash
ls apps/web/src/onboarding/ && \
grep -rn "OnboardingStatusResponse" packages/shared/src/platform-api.ts && \
grep -rn "/api/onboarding/status" packages/settings/src/routes.ts && \
grep -rn "onboarding:" apps/web/src/api/query-keys.ts && \
grep -rn "OnboardingWizard\|onboardingStatusQuery\|queryKeys.onboarding" apps/web/src/app.tsx
```

Expected: each command prints matches. If `apps/web/src/onboarding/` does not exist OR `OnboardingStatusResponse` is not in `platform-api.ts` OR `/api/onboarding/status` is not in `routes.ts`, the spine has **not** landed.

- [ ] **Step 0.3: Escalation gate (if spine absent) — HARD BLOCK on Tasks 1–12**

If Step 0.2 shows the spine is absent: **STOP. Tasks 1 through 12 are BLOCKED and MUST NOT be executed.** Task 0 is the _only_ runnable task on a branch without the spine. This slice has a hard dependency (spec §Depends-on + §Open risks). Surface the blocker to the coordinator/operator: "Phase-2 primary-onboarding spine not present on this branch; secondary-user onboarding cannot be built until it merges (would create duplicate wizard/status/contract/app.tsx definitions)." Do not re-author the spine, the status route, the shared contract, the `app.tsx` branch, the `query-keys.onboarding` namespace, or the e2e onboarding mock. As of plan authoring the spine is confirmed **absent** on `phase2-portable-deploy` (verified: no `apps/web/src/onboarding/`, no `OnboardingStatusResponse`, no `/api/onboarding/*`), so the default expectation when executing this plan today is to halt at Task 0 and escalate.

- [ ] **Step 0.4: Pin the spine surface (if spine present)**

Read and record (for reference by later tasks) the exact:

- Wizard component file + the mechanism it uses to pick steps (step array, `me.isBootstrapOwner`, or `getOnboardingStatus().role`). Run: `sed -n '1,80p' apps/web/src/onboarding/onboarding-wizard.tsx`.
- The `OnboardingStatusResponse` shape + the status route schema name in `platform-api.ts`. Run: `grep -n "OnboardingStatusResponse\|onboardingStatusResponseSchema\|getOnboardingStatusRouteSchema\|role" packages/shared/src/platform-api.ts`.
- The status/complete/skip handler bodies in `routes.ts` (which auth helper they call). Run: `grep -n "/api/onboarding" packages/settings/src/routes.ts`.
- The `getOnboardingStatus`/`completeOnboarding`/`skipOnboarding` client functions + return types in `apps/web/src/api/client.ts`.
- The `app.tsx` onboarding branch predicate.

No commit. This task gates the rest of the plan.

---

### Task 1: Migration — `app.member_onboarding` owner-only table (no admin SELECT/UPDATE)

**Files:**

- Create: `infra/postgres/migrations/<NNNN>_member_onboarding.sql`
- Create: `tests/integration/onboarding-member.test.ts` (migration assertion block only this task)
- Test: `tests/integration/onboarding-member.test.ts`

> **Why a new table, not an `app.users` column (security-critical):** migration `0052_fix_admin_select_policy.sql` adds `users_app_runtime_admin_select ON app.users FOR SELECT USING (app.current_actor_is_admin())`, and `0050` adds `users_app_runtime_admin_update ... USING/WITH CHECK (app.current_actor_is_admin())`. Any column on `app.users` is therefore cross-user readable AND writable by any admin through `jarvis_app_runtime`. Omitting the column from the SECURITY DEFINER helpers does **not** help — an admin can issue a direct `selectFrom("app.users")`. Member onboarding state is private to the member (no-admin-bypass invariant), so it MUST live in a dedicated owner-only table whose RLS has **no** admin SELECT/UPDATE policy. Model it exactly on `app.chat_memory_facts` (`packages/memory/sql/0041_memory_facts.sql`): ENABLE + FORCE RLS, self-row SELECT/INSERT/UPDATE keyed on `user_id = app.current_actor_user_id()`.

> **Migration number is GLOBAL, assigned by landing order — never hardcode it.** Compute the next free number now: `ls infra/postgres/migrations/ packages/*/sql/ | grep -oE '^[0-9]{4}' | sort -n | tail -1`. As of authoring the high-water mark is `0065` (`packages/settings/sql/0065_module_enablement.sql`), so the next free file is `0066_member_onboarding.sql`. If a sibling slice has since taken `0066`, use the next free number. Coordinate ordering with any sibling slice that also adds a migration (the runner hash-checks applied files; a renumber after landing is forbidden).

- [ ] **Step 1.1: Write the failing test**

Create `tests/integration/onboarding-member.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("Phase 4 member onboarding — migration", () => {
  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
  });

  it("creates app.member_onboarding(user_id uuid PK, completed_at timestamptz) with ENABLE+FORCE RLS", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const cols = await client.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'member_onboarding'
          ORDER BY column_name`
      );
      const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
      expect(byName.user_id?.data_type).toBe("uuid");
      expect(byName.user_id?.is_nullable).toBe("NO");
      expect(byName.completed_at?.data_type).toBe("timestamp with time zone");

      // PK on user_id (one row per member).
      const pk = await client.query(
        `SELECT a.attname
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'app.member_onboarding'::regclass AND i.indisprimary`
      );
      expect(pk.rows.map((r) => r.attname)).toEqual(["user_id"]);

      // RLS enabled AND forced (no bypass for the table owner role either).
      const rls = await client.query(
        `SELECT relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = 'member_onboarding' AND relnamespace = 'app'::regnamespace`
      );
      expect(rls.rows[0].relrowsecurity).toBe(true);
      expect(rls.rows[0].relforcerowsecurity).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("has self-row-only policies and NO admin SELECT/UPDATE policy (no-admin-bypass)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const policies = await client.query(
        `SELECT policyname, cmd, qual, with_check FROM pg_policies
          WHERE schemaname = 'app' AND tablename = 'member_onboarding'
          ORDER BY policyname`
      );
      const names = policies.rows.map((r) => r.policyname);
      // Exactly the self-row policy set — modelled on chat_memory_facts.
      expect(names).toEqual(
        expect.arrayContaining([
          "member_onboarding_select",
          "member_onboarding_insert",
          "member_onboarding_update"
        ])
      );
      // CRITICAL: no policy grants admin-wide access. Every policy must key on the actor's own id;
      // none may reference current_actor_is_admin (which would re-introduce the app.users leak).
      for (const row of policies.rows) {
        const clause = `${row.qual ?? ""} ${row.with_check ?? ""}`;
        expect(clause).toMatch(/current_actor_user_id/);
        expect(clause).not.toMatch(/current_actor_is_admin/);
      }
      // The app.users admin SELECT leak does not apply here: this table is NOT app.users.
      expect(names.some((n) => /admin/i.test(n))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("does NOT add any column or policy to app.users (onboarding state never rides the user row)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const col = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'users'
            AND column_name = 'onboarding_completed_at'`
      );
      expect(col.rows).toHaveLength(0); // the unsafe column must NOT exist
      const policies = await client.query(
        `SELECT policyname FROM pg_policies
          WHERE schemaname = 'app' AND tablename = 'users'`
      );
      expect(policies.rows.some((r) => /onboarding/i.test(r.policyname))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("keeps FORCE RLS on the auth-secret tables (0045/0046 posture not weakened)", async () => {
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      const forced = await client.query(
        `SELECT relname, relforcerowsecurity
           FROM pg_class
          WHERE relname IN ('auth_accounts', 'better_auth_sessions')
            AND relnamespace = 'app'::regnamespace
          ORDER BY relname`
      );
      for (const row of forced.rows) {
        expect(row.relforcerowsecurity).toBe(true);
      }
    } finally {
      await client.end();
    }
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm db:up` (if Postgres is not already up), then
`pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: FAIL — `app.member_onboarding` does not exist (`information_schema.columns` returns nothing; `'app.member_onboarding'::regclass` throws).

- [ ] **Step 1.3: Write minimal implementation (the migration)**

Compute the number per the note above, then create `infra/postgres/migrations/0066_member_onboarding.sql` (rename if `0066` is taken):

```sql
-- Phase 4 — per-user (member) onboarding state, stored in a DEDICATED OWNER-ONLY table.
--
-- One row per household MEMBER recording when they finished (or skipped — terminal
-- "onboarded") the member onboarding wizard. completed_at NULL / no row = not-yet-onboarded.
-- The founder's completion stays INSTANCE-GLOBAL (instance_settings onboarding.completed/
-- skipped) and never uses this table.
--
-- WHY A NEW TABLE INSTEAD OF an app.users column (security-critical):
--   app.users carries an ADMIN-WIDE SELECT policy (users_app_runtime_admin_select, 0052)
--   and an ADMIN-WIDE UPDATE policy (users_app_runtime_admin_update, 0050), both
--   USING app.current_actor_is_admin(). A column on app.users would therefore be
--   cross-user READABLE and WRITABLE by any admin through jarvis_app_runtime, breaking
--   the no-admin-private-data-bypass invariant. Member onboarding state is private to the
--   member, so it lives in its own table whose RLS has NO admin policy — modelled on
--   app.chat_memory_facts (packages/memory/sql/0041_memory_facts.sql).
--
-- RLS: ENABLE + FORCE; self-row SELECT/INSERT/UPDATE keyed on user_id =
-- app.current_actor_user_id(). No DELETE policy (rows are never deleted in this slice;
-- ON DELETE CASCADE removes the row when the user is deleted). NO admin policy of any kind.

CREATE TABLE IF NOT EXISTS app.member_onboarding (
  user_id      uuid        PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.member_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member_onboarding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_onboarding_select ON app.member_onboarding;
CREATE POLICY member_onboarding_select ON app.member_onboarding
  FOR SELECT USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS member_onboarding_insert ON app.member_onboarding;
CREATE POLICY member_onboarding_insert ON app.member_onboarding
  FOR INSERT WITH CHECK (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS member_onboarding_update ON app.member_onboarding;
CREATE POLICY member_onboarding_update ON app.member_onboarding
  FOR UPDATE USING (user_id = app.current_actor_user_id())
            WITH CHECK (user_id = app.current_actor_user_id());

-- Least privilege: ONLY jarvis_app_runtime gets row-level CRUD (the self-row policies above
-- constrain visibility). No worker path touches member onboarding, so jarvis_worker_runtime gets
-- NO grant. No admin grant beyond the self-row policies either — an admin is just another actor here.
GRANT SELECT, INSERT, UPDATE ON app.member_onboarding TO jarvis_app_runtime;
```

> The new file lives in `infra/postgres/migrations/` because `app.member_onboarding` is an APP-CORE table consumed by `packages/settings` and the multi-user-isolation gate — it is not owned by a single feature module. (Module-owned SQL would live in that module's `sql/` dir; this is app spine, like `app.users`.) Verify the table-owner role lets FORCE RLS apply: the app migration runs as the migration role, but `jarvis_app_runtime` is non-owner, so FORCE is what makes the policies bite for it — mirrors `chat_memory_facts`.

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm db:migrate` (applies the new file idempotently), then
`pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: PASS (all migration assertions green — table shape, ENABLE+FORCE RLS, self-row-only policies with no admin policy, no `app.users` column added, auth-secret FORCE intact). The migration runner's hash-check on prior files is unaffected (only a new file was added).

- [ ] **Step 1.5: Commit**

```bash
git add infra/postgres/migrations/0066_member_onboarding.sql tests/integration/onboarding-member.test.ts
git commit -m "feat(db): add app.member_onboarding owner-only table for per-user onboarding (Phase 4) [grounded on <SHA from Step 0.1>]"
```

---

### Task 2: DB type — new `MemberOnboardingTable` registered on `JarvisDatabase`

**Files:**

- Modify: `packages/db/src/types.ts` (add `MemberOnboardingTable` interface; register on `JarvisDatabase`; do NOT touch `UsersTable`)
- Test: covered by `pnpm typecheck` + consumed by Task 3's repo methods (no standalone runnable unit test for a type; the TDD proof is typecheck baseline → red consumption in Task 3 → green).

- [ ] **Step 2.1: Typecheck baseline**

Run: `pnpm typecheck`
Expected: PASS (baseline, before the new table is referenced anywhere).

- [ ] **Step 2.2: Implement — add the table interface and register it**

In `packages/db/src/types.ts`, add a new interface near the other small app tables (e.g. after `UsersTable`, before `AuthSessionsTable`). **`UsersTable` is left UNCHANGED** — no onboarding field on the user row:

```ts
export interface MemberOnboardingTable {
  user_id: string;
  completed_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

Then register it on `JarvisDatabase` (the interface near line 460), alongside `"app.users"`:

```ts
  "app.member_onboarding": MemberOnboardingTable;
```

> `NullableTimestampColumn` / `TimestampColumn` are already defined at the top of this file (lines 3-8). No new import. **Do NOT** touch `UsersTable`, `User`, `UserDto` (`packages/shared/src/platform-api.ts`), or `serializeUser` (`packages/settings/src/routes.ts`) — per-user onboarding state never appears on the user row or the admin user list. (Optional: export `export type MemberOnboarding = Selectable<MemberOnboardingTable>;` next to the other `Selectable` exports if convenient for Task 3, but the repo can also select the single `completed_at` column without it.)

- [ ] **Step 2.3: Run to verify it passes**

Run: `pnpm typecheck`
Expected: PASS. (`scopedDb.db.selectFrom("app.member_onboarding")` is now typed for the repo methods in Task 3.)

- [ ] **Step 2.4: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): type app.member_onboarding on JarvisDatabase (Phase 4)"
```

---

### Task 3: Repository — `getMemberOnboardingState` + `setMemberOnboardingComplete`

**Files:**

- Modify: `packages/settings/src/repository.ts`
- Modify: `tests/integration/onboarding-member.test.ts` (add a repository describe block)
- Test: `tests/integration/onboarding-member.test.ts`

- [ ] **Step 3.1: Write the failing test**

Append to `tests/integration/onboarding-member.test.ts` (add the imports shown at top if not already present, then the new describe):

```ts
import { type Kysely } from "kysely";
import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { setInstanceSetting } from "./test-database.js";
import type { OutgoingHttpHeaders } from "node:http";

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("Phase 4 member onboarding — repository methods", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let dataContext: DataContextRunner;
  let memberAId: string;
  let memberBId: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    // First sign-up becomes the bootstrap owner + admin. Turn approval off so members
    // become active immediately (so their AccessContext resolves for the data-context calls).
    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Owner", email: "owner@p4.test", password: "correct horse battery staple" }
    });
    void owner;
    await setInstanceSetting("registration.requires_approval", { value: false });

    const memberA = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member A", email: "a@p4.test", password: "correct horse battery staple" }
    });
    memberAId = memberA.json<{ user: { id: string } }>().user.id;

    const memberB = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member B", email: "b@p4.test", password: "correct horse battery staple" }
    });
    memberBId = memberB.json<{ user: { id: string } }>().user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  let ownerId: string;

  it("getMemberOnboardingState returns completedAt: null for a fresh member", async () => {
    const repo = new SettingsRepository();
    const state = await dataContext.withDataContext(
      { actorUserId: memberAId, requestId: "p4-r1" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(state.completedAt).toBeNull();
  });

  it("setMemberOnboardingComplete stamps the actor's own row and a re-read returns non-null", async () => {
    const repo = new SettingsRepository();
    await dataContext.withDataContext({ actorUserId: memberAId, requestId: "p4-r2" }, (scopedDb) =>
      repo.setMemberOnboardingComplete(scopedDb, { actorUserId: memberAId, requestId: "p4-r2" })
    );
    const state = await dataContext.withDataContext(
      { actorUserId: memberAId, requestId: "p4-r3" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(state.completedAt).toBeInstanceOf(Date);
  });

  it("stamping is per-actor: completing as A does not stamp B (no row for B)", async () => {
    const repo = new SettingsRepository();
    // A is already stamped above. B has never completed, so B reads null — proving the
    // write was GUC-scoped to A's row only (no caller-supplied target id exists).
    const bState = await dataContext.withDataContext(
      { actorUserId: memberBId, requestId: "p4-r4" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    expect(bState.completedAt).toBeNull();
  });

  it("an ADMIN cannot read another member's onboarding state (no admin SELECT policy on member_onboarding)", async () => {
    // The bootstrap owner is an admin. Acting under the owner's GUC, a self-row read of
    // member_onboarding returns ONLY the owner's row (none), NEVER member A's stamped row.
    // This is the regression test that proves the no-admin-bypass fix: had onboarding state
    // ridden app.users, the 0052 admin SELECT policy would have leaked A's value here.
    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json" },
      payload: { email: "owner@p4.test", password: "correct horse battery staple" }
    });
    ownerId = owner.json<{ user: { id: string } }>().user.id;
    const repo = new SettingsRepository();
    const adminView = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "p4-r5" },
      (scopedDb) => repo.getMemberOnboardingState(scopedDb)
    );
    // The admin reads its OWN (absent) onboarding row, never member A's stamped one.
    expect(adminView.completedAt).toBeNull();

    // Direct raw assertion: under the admin GUC, the member_onboarding table exposes only
    // the admin's own rows — A's row is NOT visible. Use a raw count via the data context.
    const rowsVisibleToAdmin = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "p4-r6" },
      (scopedDb) =>
        scopedDb.db
          .selectFrom("app.member_onboarding")
          .select("user_id")
          .where("user_id", "=", memberAId)
          .execute()
    );
    expect(rowsVisibleToAdmin).toEqual([]); // A's row invisible to the admin → no leak
  });
});
```

> The admin-context negative read is the security backstop and the direct executable check Codex's finding #10 asked for: because `app.member_onboarding` has **no** admin SELECT policy (unlike `app.users` after 0052), an admin actor cannot see member A's stamped row — neither through the repo method nor a direct table query.

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: FAIL — `getMemberOnboardingState` / `setMemberOnboardingComplete` are not methods on `SettingsRepository`.

- [ ] **Step 3.3: Write minimal implementation**

In `packages/settings/src/repository.ts`, add an input interface near the other input interfaces (after `RegistrationSettings`, around line 33):

```ts
export interface SetMemberOnboardingCompleteInput {
  readonly actorUserId: string;
  readonly requestId: string;
}
```

Then add the two methods inside `class SettingsRepository`, immediately after `setRegistrationSettings` (after line 210):

```ts
  /**
   * Read the calling MEMBER's own onboarding completion timestamp from
   * app.member_onboarding. The table is OWNER-ONLY (self-row RLS, NO admin policy), so
   * even an admin actor sees only its own row — the headline no-admin-bypass invariant
   * for this surface. We filter on app.current_actor_user_id() (NOT a caller-supplied id)
   * for defense in depth: the RLS policy already guarantees only the actor's row is
   * visible, and matching on the GUC means a regressed caller can never even attempt a
   * cross-user read. Returns completedAt: null when the member has no row yet.
   *
   * NOTE: this deliberately does NOT read app.users — app.users carries an admin-wide
   * SELECT policy (0052), so storing/reading onboarding state there would leak it to admins.
   */
  async getMemberOnboardingState(
    scopedDb: DataContextDb
  ): Promise<{ completedAt: Date | null }> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.member_onboarding")
      .select("completed_at")
      .where("user_id", "=", sql<string>`app.current_actor_user_id()`)
      .executeTakeFirst();
    return { completedAt: row?.completed_at ?? null };
  }

  /**
   * Stamp the calling MEMBER's own completed_at = now() in app.member_onboarding, via an
   * UPSERT keyed on app.current_actor_user_id(). The self-row INSERT/UPDATE policies
   * authorize ONLY user_id = current actor; there is NO admin UPDATE policy, so an admin
   * actor cannot stamp another user's row. Idempotent (re-stamping is harmless). We do NOT
   * accept a target user id — the actor is taken from the GUC, closing finding #4 (admin
   * stamping another user's row). Records an admin_audit_events row
   * (action: "onboarding.member_complete"). Reads only requestId from the caller for the
   * audit row's actor (AccessContext invariant: actorUserId/requestId only).
   */
  async setMemberOnboardingComplete(
    scopedDb: DataContextDb,
    input: SetMemberOnboardingCompleteInput
  ): Promise<{ completedAt: Date | null }> {
    assertDataContextDb(scopedDb);
    const now = new Date();
    // UPSERT keyed on the GUC actor id — never on a caller-supplied target. The INSERT WITH
    // CHECK and UPDATE USING/WITH CHECK both require user_id = app.current_actor_user_id(),
    // so this only ever touches the actor's own row.
    const upserted = await scopedDb.db
      .insertInto("app.member_onboarding")
      .values({
        user_id: sql<string>`app.current_actor_user_id()`,
        completed_at: now,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.column("user_id").doUpdateSet({ completed_at: now, updated_at: now })
      )
      .returning("completed_at")
      .executeTakeFirst();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: "onboarding.member_complete",
      targetType: "user",
      targetId: input.actorUserId,
      metadata: {},
      requestId: input.requestId
    });

    return { completedAt: upserted?.completed_at ?? null };
  }
```

> `assertDataContextDb`, `DataContextDb`, and `sql` are already imported (`repository.ts:3,6`). `insertAuditEvent` already exists and takes exactly this shape. No new imports. `getMemberOnboardingState` takes **no** user-id argument (it reads the GUC actor); `setMemberOnboardingComplete` still takes `{ actorUserId, requestId }` solely for the audit row's actor/target — the DB write is GUC-scoped, not driven by `actorUserId`.

- [ ] **Step 3.4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: PASS (migration + repository describes all green).

- [ ] **Step 3.5: Commit**

```bash
git add packages/settings/src/repository.ts tests/integration/onboarding-member.test.ts
git commit -m "feat(settings): getMemberOnboardingState + setMemberOnboardingComplete repo methods (Phase 4)"
```

---

### Task 4: Shared contract — widen `OnboardingStatusResponse` to a role-discriminated union

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Test: `pnpm typecheck` + consumed by Tasks 5/7/8 (no standalone runnable type test; TDD proof = typecheck baseline → green after the change, plus the integration consumer in Task 5).

> **Coordination (spec §Open risks):** the spine (Task 0) already defines `OnboardingStatusResponse` as the **founder shape** (e.g. `{ completed, skipped, steps: { multiplexer, cliAuth, connectors } }`). This task **widens** it to a discriminated union on `role`; it does NOT redefine the founder fields. Read the spine's current definition (pinned in Task 0.4) and wrap it as the `"founder"` variant verbatim. Adjust the exact founder field names to whatever the spine shipped — the structure below assumes the Phase-2 plan's shape.

- [ ] **Step 4.1: Typecheck baseline**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4.2: Implement — convert to a discriminated union**

In `packages/shared/src/platform-api.ts`, locate the spine's `OnboardingStatusResponse` interface and its `onboardingStatusResponseSchema`. Replace them with the role-tagged union. Add `role: "founder"` to the existing founder interface, add the member interface + union, and make the response schema a `oneOf`:

```ts
// --- Phase 4: role-tagged onboarding status. The "founder" variant is the Phase-2
//     shape (instance-global provisioning); the "member" variant is per-user. ---

export interface OnboardingFounderStatus {
  readonly role: "founder";
  readonly completed: boolean;
  readonly skipped: boolean;
  readonly steps: OnboardingStepsDto; // Phase-2 founder steps (multiplexer/cliAuth/connectors)
}

export interface OnboardingMemberStepFlags {
  readonly apiKeyOptOut: { readonly done: boolean };
  readonly connectors: { readonly done: boolean };
}

export interface OnboardingMemberStatus {
  readonly role: "member";
  readonly completed: boolean;
  readonly steps: OnboardingMemberStepFlags;
}

export type OnboardingStatusResponse = OnboardingFounderStatus | OnboardingMemberStatus;
```

> `OnboardingStepsDto` is the spine's existing founder steps type (pinned in Task 0.4). If the spine named it differently, use that name. The `role` discriminant is the only addition to the founder variant.

Then update `onboardingStatusResponseSchema` to a `oneOf` of the two variants (Fastify validates the response against this). The founder branch reuses the spine's existing step sub-schemas verbatim; only `role` is added and the member branch is new:

```ts
const onboardingFounderStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "completed", "skipped", "steps"],
  properties: {
    role: { type: "string", enum: ["founder"] },
    completed: { type: "boolean" },
    skipped: { type: "boolean" },
    steps: onboardingStepsSchema // the spine's existing founder steps schema fragment
  }
} as const;

const onboardingMemberStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "completed", "steps"],
  properties: {
    role: { type: "string", enum: ["member"] },
    completed: { type: "boolean" },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["apiKeyOptOut", "connectors"],
      properties: {
        apiKeyOptOut: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        },
        connectors: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        }
      }
    }
  }
} as const;

const onboardingStatusResponseSchema = {
  oneOf: [onboardingFounderStatusSchema, onboardingMemberStatusSchema]
} as const;
```

> If the spine inlined its founder steps directly into `onboardingStatusResponseSchema` (no named `onboardingStepsSchema` fragment), extract that inline object into `onboardingFounderStatusSchema.properties.steps` unchanged. Do not alter the founder step shape. `UserDto` is **not** touched (no onboarding field).

- [ ] **Step 4.3: Run to verify it passes**

Run: `pnpm typecheck`
Expected: PASS. (TypeScript consumers that read `.completed` still work for both variants; `.skipped` and `.steps.multiplexer` now require narrowing on `role === "founder"`, which Tasks 5/7/8 do. If the spine had non-narrowed consumers of `.skipped`/`.steps`, fix them to narrow on `role` — see Task 5/8.)

- [ ] **Step 4.4: Commit**

```bash
git add packages/shared/src/platform-api.ts
git commit -m "feat(shared): widen OnboardingStatusResponse to role-tagged union (founder|member) (Phase 4)"
```

---

### Task 5: Routes — branch `/api/onboarding/status`, `/complete`, `/skip` on role

**Files:**

- Modify: `packages/settings/src/routes.ts`
- Modify: `tests/integration/onboarding-member.test.ts` (add a route-branch describe)
- Test: `tests/integration/onboarding-member.test.ts`

- [ ] **Step 5.1: Write the failing test**

Append to `tests/integration/onboarding-member.test.ts`:

```ts
import { recordAuditEvent } from "../../packages/settings/src/repository.js"; // (only if not already imported; remove if unused)

describe("Phase 4 member onboarding — route branch (status/complete/skip per actor)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const owner = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Owner", email: "owner2@p4.test", password: "correct horse battery staple" }
    });
    ownerCookie = cookieHeader(owner.headers);
    await setInstanceSetting("registration.requires_approval", { value: false });

    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member", email: "m2@p4.test", password: "correct horse battery staple" }
    });
    memberCookie = cookieHeader(member.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("founder GET /status returns role: founder (unchanged founder shape)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { role: string }).role).toBe("founder");
  });

  it("active member GET /status returns role: member with completed:false (admit via requireKnownUser)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      role: string;
      completed: boolean;
      steps: { apiKeyOptOut: { done: boolean }; connectors: { done: boolean } };
    };
    expect(body.role).toBe("member");
    expect(body.completed).toBe(false);
    expect(body.steps.apiKeyOptOut.done).toBe(false);
    expect(body.steps.connectors.done).toBe(false);
    // No secret-shaped field.
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|credential/i);
  });

  it("member POST /complete stamps completed and audits onboarding.member_complete", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { completed: boolean }).completed).toBe(true);

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect((status.json() as { completed: boolean }).completed).toBe(true);

    // The founder can read the audit log; the member_complete action is present.
    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).toContain("onboarding.member_complete");
  });

  it("member POST /skip == complete (terminal onboarded state)", async () => {
    // Fresh member to assert /skip stamps completion.
    const m = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Skipper", email: "skip@p4.test", password: "correct horse battery staple" }
    });
    const skipperCookie = cookieHeader(m.headers);
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: skipperCookie }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { completed: boolean }).completed).toBe(true);
  });
});
```

> Drop the `recordAuditEvent` import line if your editor flags it unused (`lint` runs `--max-warnings=0`). It is shown only as a reminder that the public audit path exists; the route uses the repository method directly.

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: FAIL — the member GET /status currently 403s (admin-gated by the spine) and returns no `role`/member shape; member /complete/skip do not stamp the column.

- [ ] **Step 5.3: Implement — branch the three handlers on role**

In `packages/settings/src/routes.ts`, modify the spine's three onboarding handlers (pinned in Task 0.4). The pattern below assumes the spine's handler structure; adapt field names to the spine.

**(a) `GET /api/onboarding/status`** — relax the gate to `requireKnownUser`, then branch on the server-read `is_bootstrap_owner`:

```ts
server.get(
  "/api/onboarding/status",
  { schema: getOnboardingStatusRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const result = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          // NOT admin-gated: a member must read its OWN onboarding status. requireKnownUser
          // admits any active authenticated user; pending/deactivated users never reach here
          // (resolveAccessContext throws first). Role is read from the server-side user row,
          // never from the client.
          const user = await requireKnownUser(repository, scopedDb, accessContext.actorUserId);
          if (user.is_bootstrap_owner) {
            // Founder branch — unchanged Phase-2 instance-global shape, tagged role: "founder".
            const founder = await repository.getOnboardingStatus(scopedDb, onboardingProbes);
            return { role: "founder" as const, ...founder };
          }
          // Member branch — per-user completion read from the member's OWN row
          // (app.member_onboarding, GUC-scoped; no id argument — RLS + the GUC pick the row).
          const state = await repository.getMemberOnboardingState(scopedDb);
          // apiKeyOptOut.done + connectors.done are DERIVED CLIENT-SIDE (module isolation);
          // the server returns neutral false defaults here.
          return {
            role: "member" as const,
            completed: state.completedAt !== null,
            steps: {
              apiKeyOptOut: { done: false },
              connectors: { done: false }
            }
          };
        }
      );
      return result;
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

> **`requireKnownUser` returns the SD-helper shape, NOT `onboarding_completed_at`.** `requireKnownUser` (`routes.ts:440-452`) resolves the user via `getUserById` → `app.get_user_by_id` (`repository.ts:55`), whose fixed return columns (`0050:59-69`) are identity/role only (`id, email, name, email_verified, image, is_instance_admin, status, is_bootstrap_owner, created_at, updated_at`) — they intentionally omit any onboarding field, and onboarding state lives in a separate table anyway. Use `user.is_bootstrap_owner` (present) to pick the branch; do NOT read an onboarding field off `user` (there isn't one). The member's completion comes solely from `repository.getMemberOnboardingState(scopedDb)`. `getOnboardingStatus` + `onboardingProbes` are the spine's founder-status method and injected probes (pinned in Task 0.4); the founder return spreads them and tags `role`. If the spine's founder status already carries no `role`, spreading `...founder` plus `role: "founder"` matches the union's founder variant. Reads only `accessContext.actorUserId` (AccessContext invariant). The `oneOf` response schema (Task 4) validates both branches.

**(b) `POST /api/onboarding/complete`** — branch on role:

```ts
server.post(
  "/api/onboarding/complete",
  { schema: onboardingCompleteRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const result = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const user = await requireKnownUser(repository, scopedDb, accessContext.actorUserId);
          if (user.is_bootstrap_owner) {
            // Founder: unchanged Phase-2 instance-global completion (admin-gated upsert).
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.setOnboardingFlag(scopedDb, {
              flag: "completed",
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
          // Member: stamp per-user completion on the member's own row (audited).
          const state = await repository.setMemberOnboardingComplete(scopedDb, {
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
          return { completed: state.completedAt !== null };
        }
      );
      return result;
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

**(c) `POST /api/onboarding/skip`** — member skip == complete; founder keeps the distinct skipped key:

```ts
server.post(
  "/api/onboarding/skip",
  { schema: onboardingSkipRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const result = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const user = await requireKnownUser(repository, scopedDb, accessContext.actorUserId);
          if (user.is_bootstrap_owner) {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.setOnboardingFlag(scopedDb, {
              flag: "skipped",
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
          }
          // For a member, skip is terminal "onboarded" — same as complete (no separate skipped state).
          const state = await repository.setMemberOnboardingComplete(scopedDb, {
            actorUserId: accessContext.actorUserId,
            requestId: requireRequestId(accessContext)
          });
          return { completed: state.completedAt !== null };
        }
      );
      return result;
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

> `setOnboardingFlag`, `getOnboardingStatusRouteSchema`, `onboardingCompleteRouteSchema`, `onboardingSkipRouteSchema` are the spine's exports (pinned in Task 0.4). `assertAdminUser`, `requireKnownUser`, `requireRequestId`, `handleRouteError` already exist in this file (lines 428-460, 523-541). The complete/skip response schemas are the spine's flag-response shapes; the member return `{ completed }` is a subset — if the spine's flag schema requires `skipped`, return `{ completed: state.completedAt !== null, skipped: false }` for the member branch to satisfy it (verify the spine's schema and match it exactly; do not add `additionalProperties`).

- [ ] **Step 5.4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/onboarding-member.test.ts`
Expected: PASS (all four describes green). Then `pnpm typecheck` → PASS.

- [ ] **Step 5.5: Commit**

```bash
git add packages/settings/src/routes.ts tests/integration/onboarding-member.test.ts
git commit -m "feat(settings): branch onboarding status/complete/skip on role; member uses per-user state (Phase 4)"
```

---

### Task 6: Early mockup — feelings-wheel / wellness scope note (NO UI build)

**Files:**

- Create: `apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md`
- Test: n/a (documentation artifact; verified by `pnpm format:check` formatting only — markdown is excluded, so just `git add`)

> **Why this task exists:** the orchestration template asked for "an early mockup task for the feelings-wheel modal" as part of a Wellness plan. **This spec has no Wellness module and no feelings-wheel.** Rather than silently drop the instruction (which could prompt an autonomous worker to invent a wellness build mid-run), this task records — as the "early mockup" — an explicit scope boundary so no one builds wellness UI under this slice. The section tour (Task 9) only _links_ to a wellness route IF one exists, and omits the line otherwise.

- [ ] **Step 6.1: Create the scope-note mockup**

Create `apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md`:

```markdown
# Mockup / scope note — feelings-wheel modal (NOT in this slice)

**Status:** intentionally NOT built in Phase 4 secondary-user onboarding.

The Phase-4 secondary-user-onboarding spec
(`docs/superpowers/specs/2026-06-13-p4-secondary-user-onboarding-design.md`) does NOT include
a Wellness module, a feelings-wheel modal, check-ins, medications, surfacing tools, or a
readiness signal. There is no approved Wellness spec, so per the CLAUDE.md "Spec before build"
hard gate, none of that may be built here.

In this slice, "Wellness" appears only as:

1. One informational line in the client-only `SectionTourStep` — and that line is OMITTED
   client-side if no wellness module/route exists (it does not exist as of this slice).
2. A DEFERRED multi-user-isolation test case (spec §Open risks "Wellness surface assumption"):
   the wellness isolation assertion is skipped/commented until a wellness module ships with
   real owner-scoped tables.

If/when a Wellness module is specced and built (its own milestone + spec), a feelings-wheel
modal mockup belongs in THAT plan, not here.
```

- [ ] **Step 6.2: Commit**

```bash
git add apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md
git commit -m "docs(onboarding): record feelings-wheel/wellness out-of-scope note (Phase 4)"
```

---

### Task 7: Web client — widen `getOnboardingStatus()` return type to the member union

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Test: `pnpm typecheck` + consumed by Tasks 8/9 + the e2e in Task 10.

- [ ] **Step 7.1: Typecheck baseline**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7.2: Implement**

In `apps/web/src/api/client.ts`, the spine already imports `OnboardingStatusResponse` from `@jarv1s/shared` and declares `getOnboardingStatus()` returning it. Because Task 4 widened that type to a union, the existing client function automatically returns the union — **no signature change is required**, only verify the import resolves. Confirm:

```bash
grep -n "getOnboardingStatus\|OnboardingStatusResponse" apps/web/src/api/client.ts
```

Expected: the function returns `Promise<OnboardingStatusResponse>` and the type is imported. If the spine narrowed the return type to the founder-only interface name (now removed/renamed), update the import to `OnboardingStatusResponse` (the union). No new function. `listConnectorAccounts()` (line 422) and `listAiProviders()` (line 318) already exist for the client-side `done` derivation — do not add new endpoints.

- [ ] **Step 7.3: Run to verify it passes**

Run: `pnpm typecheck`
Expected: PASS (any consumer that read founder-only fields without narrowing is now a type error — those are fixed in Task 8).

- [ ] **Step 7.4: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "refactor(web): getOnboardingStatus returns the role-tagged onboarding union (Phase 4)"
```

> If Step 7.2 found no change was needed (the spine already imported the union name), skip the commit and note "no client change required" — do not create an empty commit.

---

### Task 8: Wizard — select the member step array by role; mount member steps

**Files:**

- Create: `apps/web/src/onboarding/member-welcome-step.tsx`
- Create: `apps/web/src/onboarding/api-key-opt-out-step.tsx`
- Create: `apps/web/src/onboarding/member-connector-step.tsx` (section-tour step is Task 9)
- Modify: `apps/web/src/onboarding/onboarding-wizard.tsx`
- Test: verified at runtime by Task 10 e2e; type-verified by `pnpm typecheck`.

- [ ] **Step 8.1: Typecheck baseline**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8.2: Implement `member-welcome-step.tsx`**

```tsx
export function MemberWelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="panel" aria-labelledby="member-welcome-title">
      <div className="panel-heading">
        <h2 id="member-welcome-title">Welcome to Jarv1s</h2>
      </div>
      <p>
        You&apos;ve been added to this household instance. Your data is private to you — the
        assistant already works out of the box. Connect your own accounts if you like; every step is
        optional and you can skip setup at any time.
      </p>
      <button className="ghost-button" type="button" onClick={props.onSkipAll}>
        Skip setup
      </button>
    </section>
  );
}
```

- [ ] **Step 8.3: Implement `api-key-opt-out-step.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { listAiProviders } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function ApiKeyOptOutStep(props: { readonly onSkipStep: () => void }) {
  // Client-side apiKeyOptOut.done derivation (module isolation): the AI module's own public
  // endpoint is the source of truth — settings/onboarding NEVER reads an AI table directly.
  // "done" means the member has already configured at least one of their own AI providers
  // (i.e. opted IN to a personal key); a member who uses the shared assistant simply skips.
  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: () => listAiProviders(),
    retry: false
  });
  const done = (providersQuery.data?.providers.length ?? 0) > 0;

  return (
    <section className="panel" aria-labelledby="member-apikey-title">
      <div className="panel-heading">
        <h2 id="member-apikey-title">AI assistant</h2>
      </div>
      {done ? (
        <p className="form-hint">
          You&apos;ve added your own AI provider. You can manage it in Settings anytime.
        </p>
      ) : (
        <p>
          You can use the shared assistant this household already set up — no setup needed. If you
          prefer to use your own API key instead, you can add one in AI settings. This step is
          optional.
        </p>
      )}
      <div className="connect-steps">
        <Link className="primary-button" to="/settings">
          {done ? "Manage my AI provider in Settings" : "Add my own API key in Settings"}
        </Link>
        <button className="ghost-button" type="button" onClick={props.onSkipStep}>
          {done ? "Continue" : "Skip — I'll use the shared assistant"}
        </button>
      </div>
    </section>
  );
}
```

> Optional + skippable, never a gate. It writes nothing (key entry, if chosen, flows through the shipped `AiSettingsPanel` at `/settings`, whose keys are AES-256-GCM at rest and never returned). The `apiKeyOptOut.done` flag is derived **client-side** from `listAiProviders()` (`apps/web/src/api/client.ts:320`) — the AI module's public endpoint — never from a settings-side AI-table read (module isolation; this is the contract the plan summary promised). `ListAiProviderConfigsResponse.providers` is the array (`packages/shared/src/ai-api.ts:104-105`); `queryKeys.ai.providers` already exists (`query-keys.ts:19`). Uses `react-router`'s `Link` (already a dep). Reuses `panel`/`connect-steps`/`primary-button`/`ghost-button`/`form-hint` classes (`apps/web/src/styles.css`).

- [ ] **Step 8.4: Implement `member-connector-step.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";

import { listConnectorAccounts } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ConnectGooglePanel } from "../connectors/connect-google-panel";

export function MemberConnectorStep(props: { readonly onSkipStep: () => void }) {
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: () => listConnectorAccounts(),
    retry: false
  });
  // Client-side connectors.done derivation (module isolation): the connectors module's own
  // public endpoint is the source of truth, never a settings-side table read.
  const done = (accountsQuery.data?.accounts.length ?? 0) > 0;

  return (
    <section className="panel" aria-labelledby="member-connector-title">
      <div className="panel-heading">
        <h2 id="member-connector-title">Connect your accounts (optional)</h2>
      </div>
      {done ? (
        <p className="form-hint">Connected. You can connect more accounts in Settings later.</p>
      ) : (
        <ConnectGooglePanel />
      )}
      <button className="ghost-button" type="button" onClick={props.onSkipStep}>
        {done ? "Continue" : "Skip for now"}
      </button>
    </section>
  );
}
```

> `ConnectGooglePanel` is reused **verbatim** (`apps/web/src/connectors/connect-google-panel.tsx`) — its accounts are per-user/owner-scoped. `ListConnectorAccountsResponse` has an `accounts` array (the spine/connectors contract); verify the field name with `grep -n "ListConnectorAccountsResponse" packages/shared/src/connectors-api.ts` and match it. `queryKeys.connectors.accounts` already exists (`query-keys.ts:15`).

- [ ] **Step 8.5: Modify `onboarding-wizard.tsx` to select the step array by role**

Read the spine wizard (pinned in Task 0.4). The spine renders an ordered, role-agnostic step array. Generalize it to pick the array by role. The exact edit depends on the spine's structure; the contract is:

```tsx
// Inside OnboardingWizard, after reading status via getOnboardingStatus()/me:
// status.role is "founder" | "member" (Task 4 union).

import { MemberWelcomeStep } from "./member-welcome-step";
import { ApiKeyOptOutStep } from "./api-key-opt-out-step";
import { MemberConnectorStep } from "./member-connector-step";
import { SectionTourStep } from "./section-tour-step"; // created in Task 9

// ... where the spine builds its founder `steps` array, branch on role:
const steps =
  status.role === "member"
    ? [
        <MemberWelcomeStep key="welcome" onSkipAll={onSkipAll} />,
        <ApiKeyOptOutStep key="apikey" onSkipStep={goNext} />,
        <MemberConnectorStep key="connector" onSkipStep={goNext} />,
        <SectionTourStep key="tour" onDone={onComplete} />
      ]
    : founderSteps; // the spine's existing founder step array, UNCHANGED
```

> `onSkipAll`, `goNext`, `onComplete`, `founderSteps` are the spine's existing wizard handlers/array (pinned in Task 0.4); reuse them. The founder-only steps (multiplexer install, instance/registration settings, CLI-auth) are simply NOT in the member array — there is **no CLI-auth step** for members (ADR 0007 §4: members inherit the shared host CLI). The persistent "Skip setup" affordance and per-step skip call the member-completion path for members (the wizard's `onComplete`/`onSkipAll` already POST to `/api/onboarding/complete`/`/skip`, which Task 5 routes to `setMemberOnboardingComplete` for members). If the spine's handlers reference founder-only fields (`status.skipped`, `status.steps.multiplexer`), narrow them under `status.role === "founder"` to satisfy the union.

`SectionTourStep` does not exist until Task 9 — to keep this task's typecheck green, add a temporary one-line stub now and replace it in Task 9, OR reorder so Task 9 precedes the wizard's tour import. **Recommended:** create the real `SectionTourStep` (Task 9) BEFORE wiring it here. If executing strictly in order, add this stub in `apps/web/src/onboarding/section-tour-step.tsx` now and flesh it out in Task 9:

```tsx
export function SectionTourStep(props: { readonly onDone: () => void }) {
  return (
    <button className="primary-button" type="button" onClick={props.onDone}>
      Finish
    </button>
  );
}
```

- [ ] **Step 8.6: Run to verify it passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8.7: Commit**

```bash
git add apps/web/src/onboarding/member-welcome-step.tsx apps/web/src/onboarding/api-key-opt-out-step.tsx apps/web/src/onboarding/member-connector-step.tsx apps/web/src/onboarding/section-tour-step.tsx apps/web/src/onboarding/onboarding-wizard.tsx
git commit -m "feat(web): role-selected member step array in OnboardingWizard (Phase 4)"
```

---

### Task 9: `SectionTourStep` — client-only section tour (omit absent modules)

**Files:**

- Modify: `apps/web/src/onboarding/section-tour-step.tsx` (replace the Task 8 stub)
- Test: verified at runtime by Task 10 e2e; type-verified by `pnpm typecheck`.

- [ ] **Step 9.1: Typecheck baseline**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9.2: Implement the section tour**

Replace `apps/web/src/onboarding/section-tour-step.tsx` with:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { getModules } from "../api/client";
import { queryKeys } from "../api/query-keys";

interface TourSection {
  readonly path: string;
  readonly label: string;
  readonly blurb: string;
}

// One line each for the now-real product sections. A section is shown only if its
// route is enabled for this member (derived from the modules list — module isolation:
// we read the modules registry's public endpoint, never another module's tables).
const ALL_SECTIONS: readonly TourSection[] = [
  {
    path: "/tasks",
    label: "Tasks",
    blurb: "Your single action surface — todos, commitments, and plans."
  },
  { path: "/calendar", label: "Calendar", blurb: "Events synced from your connected accounts." },
  { path: "/email", label: "Email", blurb: "Recent messages from your connected accounts." },
  { path: "/briefings", label: "Briefings", blurb: "Scheduled summaries grounded in your data." },
  { path: "/wellness", label: "Wellness", blurb: "Your private well-being check-ins." },
  { path: "/notifications", label: "Notifications", blurb: "What needs your attention." },
  { path: "/settings", label: "Settings", blurb: "Connect accounts, AI, and manage your profile." }
];

export function SectionTourStep(props: { readonly onDone: () => void }) {
  const modulesQuery = useQuery({
    queryKey: queryKeys.modules,
    queryFn: () => getModules(),
    retry: false
  });

  // Build the set of enabled nav paths from the modules registry. Settings is always
  // present (core); a section whose route is not in the enabled nav set is omitted —
  // this is how "Wellness" disappears cleanly when no wellness module is installed.
  const enabledPaths = new Set<string>(["/settings"]);
  for (const mod of modulesQuery.data?.modules ?? []) {
    for (const nav of mod.navigation) {
      enabledPaths.add(nav.path);
    }
  }
  const sections = ALL_SECTIONS.filter((s) => enabledPaths.has(s.path));

  return (
    <section className="panel" aria-labelledby="member-tour-title">
      <div className="panel-heading">
        <h2 id="member-tour-title">A quick tour</h2>
      </div>
      <p>Here&apos;s what you can do. Everything below is private to you.</p>
      <ul className="connect-steps">
        {sections.map((s) => (
          <li key={s.path}>
            <Link to={s.path}>
              <strong>{s.label}</strong>
            </Link>
            {" — "}
            {s.blurb}
          </li>
        ))}
      </ul>
      <button className="primary-button" type="button" onClick={props.onDone}>
        Finish
      </button>
    </section>
  );
}
```

> **Client-only:** no coachmark/overlay engine, no persisted "tour seen" state, no server interaction beyond the existing public `GET /api/modules`. "Finish" calls `onDone` (the wizard's completion path → `POST /api/onboarding/complete`). The `/wellness` line is in `ALL_SECTIONS` but is **filtered out** because no wellness module contributes a `/wellness` nav entry today (verified: no wellness module). When a wellness module ships, it will register that nav path and the line appears automatically — no edit needed. `getModules()` and `ModuleDto.navigation` already exist (`client.ts:105`, `platform-api.ts:48-55`).

- [ ] **Step 9.3: Run to verify it passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9.4: Commit**

```bash
git add apps/web/src/onboarding/section-tour-step.tsx
git commit -m "feat(web): client-only member section tour, omits absent sections (Phase 4)"
```

---

### Task 10: `app.tsx` branch + e2e — fire onboarding for an active member

**Files:**

- Modify: `apps/web/src/app.tsx`
- Modify: `tests/e2e/mock-api.ts`
- Create: `tests/e2e/onboarding-member.spec.ts`
- Test: `tests/e2e/onboarding-member.spec.ts` (Playwright)

> **Verification scope:** `pnpm verify:foundation` does NOT run Playwright. This spec is authored and must pass via `pnpm test:e2e` (best-effort if the build host has the browser); the foundation gate covers it through lint + typecheck only. The member branch logic in `app.tsx` is the load-bearing change and is also smoke-checked structurally.

- [ ] **Step 10.1: Write the failing e2e**

Create `tests/e2e/onboarding-member.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { mockApi, type MockApiState } from "./mock-api.js";

function memberState(overrides: Partial<MockApiState> = {}): MockApiState {
  return {
    authenticated: true,
    isInstanceAdmin: false,
    notifications: [],
    tasks: [],
    // Drive the member onboarding branch: not the bootstrap owner, onboarding incomplete.
    isBootstrapOwner: false,
    onboardingStatus: {
      role: "member",
      completed: false,
      steps: { apiKeyOptOut: { done: false }, connectors: { done: false } }
    },
    ...overrides
  } as MockApiState;
}

test("active member sees the member step array (no CLI-auth/multiplexer) and can finish", async ({
  page
}) => {
  await mockApi(page, memberState());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Jarv1s" })).toBeVisible();
  // Member-specific steps exist; founder-only steps do NOT.
  await expect(page.getByText(/CLI auth/i)).toHaveCount(0);
  await expect(page.getByText(/multiplexer/i)).toHaveCount(0);
});

test('"Skip setup" reaches the app shell', async ({ page }) => {
  await mockApi(page, memberState());
  await page.goto("/");
  await page.getByRole("button", { name: "Skip setup" }).click();
  // After skip, the member completion path fires and the shell renders (Tasks land on /tasks).
  await expect(page).toHaveURL(/\/tasks/);
});

test("a completed member skips the wizard and sees the shell", async ({ page }) => {
  await mockApi(
    page,
    memberState({
      onboardingStatus: {
        role: "member",
        completed: true,
        steps: { apiKeyOptOut: { done: false }, connectors: { done: false } }
      }
    })
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/tasks/);
});

test("founder still sees the founder wizard (regression)", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    isBootstrapOwner: true,
    notifications: [],
    tasks: []
  } as MockApiState);
  await page.goto("/");
  // Founder onboarding shape comes from the spine's mock; assert a founder-only step is visible.
  await expect(page.getByText(/multiplexer/i)).toBeVisible();
});

test("status-error fall-through: a failing /api/onboarding/status does NOT trap the member", async ({
  page
}) => {
  // Onboarding is OPTIONAL — if its status endpoint errors, the app must NOT block the member
  // in the wizard. The app.tsx gate fires only when `!onboardingStatusQuery.isError`, so a 500
  // falls through to the shell (Task 10.3 predicate).
  await mockApi(page, memberState());
  // Override the onboarding status route to fail AFTER the base mock is installed.
  await page.route("**/api/onboarding/status", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  // The member is NOT trapped in the wizard; the shell renders (Tasks landing).
  await expect(page).toHaveURL(/\/tasks/);
  await expect(page.getByRole("heading", { name: "Welcome to Jarv1s" })).toHaveCount(0);
});
```

> The status-error route override must be registered AFTER `mockApi(page, ...)` so it takes precedence over the base mock's `/api/onboarding/status` handler (Playwright matches the most-recently-added route first). This is the e2e coverage the File Structure table lists as "status-error fall-through".

> Field names (`onboardingStatus`, `isBootstrapOwner` on `MockApiState`) follow the spine's mock (pinned in Task 0.4). If the spine named the mock field differently, match it. The founder regression test relies on the spine's existing founder mock content.

- [ ] **Step 10.2: Run to verify it fails**

Run: `pnpm exec playwright test tests/e2e/onboarding-member.spec.ts` (requires the Playwright browser; if unavailable on the build host, run `pnpm typecheck` instead and treat lint+typecheck as the floor per the scope note).
Expected: FAIL — `app.tsx` does not yet fire onboarding for a non-bootstrap member; the mock does not yet serve the member status shape.

- [ ] **Step 10.3: Implement the `app.tsx` branch generalization**

In `apps/web/src/app.tsx`, the spine added a founder onboarding branch firing for `isInstanceAdmin && isBootstrapOwner` (pinned in Task 0.4). Generalize it so it ALSO fires for an active member whose per-user onboarding is incomplete. The branch lives after `meQuery.data` is known (after line 76, before the `<BrowserRouter>` return). The structure:

```tsx
// (the spine already declares an onboardingStatusQuery keyed on queryKeys.onboarding.status,
//  enabled only for active users, retry: false. Keep it.)
const me = meQuery.data.user;
const onboarding = onboardingStatusQuery.data;

// Onboarding gate — fires for any ACTIVE user whose role-appropriate onboarding is incomplete.
// Founder: instance-global completed/skipped (spine). Member: per-user completed (this slice).
// On a status error, fall through to the shell (onboarding is optional; never trap the user).
if (me.status === "active" && onboarding && !onboardingStatusQuery.isError) {
  const incomplete =
    onboarding.role === "founder"
      ? !onboarding.completed && !onboarding.skipped
      : !onboarding.completed;
  if (incomplete) {
    return <OnboardingWizard />;
  }
}
```

> `OnboardingWizard`, `onboardingStatusQuery`, `queryKeys.onboarding.status` are the spine's (pinned in Task 0.4). The only change versus the spine is the predicate: the spine gated on `isInstanceAdmin && isBootstrapOwner`; this generalizes to "any active user, role-narrowed completion check." The `onboarding.role` discriminant (Task 4) drives the narrowing. On completion the wizard invalidates `queryKeys.onboarding.status` (spine behavior) and the branch falls through. **Does NOT touch `/api/bootstrap/status`** (OTNR-P4 #122).

- [ ] **Step 10.4: Implement the mock member status**

In `tests/e2e/mock-api.ts`, extend the onboarding mock (added by the spine) so the served `/api/onboarding/status` payload is the member shape when `state.isBootstrapOwner === false`. Add `onboardingStatus?: OnboardingStatusResponse` and `isBootstrapOwner?: boolean` to `MockApiState` if the spine did not, and make `meResponseFor` reflect `isBootstrapOwner`:

```ts
// In MockApiState (extend the interface):
  isBootstrapOwner?: boolean;
  onboardingStatus?: import("@jarv1s/shared").OnboardingStatusResponse;

// meResponseFor ALREADY computes `const isInstanceAdmin = state.isInstanceAdmin ?? true;` and sets
// `isBootstrapOwner: isInstanceAdmin && meResponse.user.isBootstrapOwner` (mock-api.ts:56,62).
// Do NOT introduce a separate `state.isBootstrapOwner ?? true` line (that would default a
// non-admin to bootstrap owner and disagree with /api/me). Instead, let an EXPLICIT
// state.isBootstrapOwner override while keeping the existing admin-derived default, e.g.:
//   const isInstanceAdmin = state.isInstanceAdmin ?? true;
//   ...
//   isBootstrapOwner: state.isBootstrapOwner ?? (isInstanceAdmin && meResponse.user.isBootstrapOwner),
// This preserves the current "admin ⇒ bootstrap owner" default and only overrides when a test
// passes isBootstrapOwner explicitly (the member tests pass `isBootstrapOwner: false`).

// Where the spine registers GET /api/onboarding/status, serve state.onboardingStatus if set,
// else the spine's default founder payload:
  await page.route("**/api/onboarding/status", async (route) => {
    const fallbackFounder = /* the spine's existing default founder status object */;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.onboardingStatus ?? fallbackFounder)
    });
  });
```

> If the spine already routes `/api/onboarding/status`, MODIFY that route to honor `state.onboardingStatus` rather than adding a duplicate route (a duplicate `page.route` for the same glob would shadow). `meResponseFor` already exists (`mock-api.ts:55`); add the `isBootstrapOwner` line to its returned user object.

- [ ] **Step 10.5: Run to verify it passes**

Run: `pnpm exec playwright test tests/e2e/onboarding-member.spec.ts` (or `pnpm typecheck` floor if no browser).
Expected: PASS (member branch fires, skip reaches shell, completed member sees shell, founder regression holds). Then `pnpm typecheck` → PASS.

- [ ] **Step 10.6: Commit**

```bash
git add apps/web/src/app.tsx tests/e2e/mock-api.ts tests/e2e/onboarding-member.spec.ts
git commit -m "feat(web): fire onboarding wizard for active members; e2e member flow (Phase 4)"
```

---

### Task 11: Extend the multi-user isolation gate (exit criterion #3)

**Files:**

- Modify: `tests/integration/multi-user-isolation.test.ts`
- Test: `tests/integration/multi-user-isolation.test.ts`

This is the CI isolation gate. The suite already proves admin-bypass + member-to-member isolation for tasks/auth_accounts (`multi-user-isolation.test.ts:60-138`) using the `signUp`/`signIn`/`disableApproval` helpers and per-user cookies. Add cases for the secondary-onboarding path and the remaining per-user surfaces.

- [ ] **Step 11.1: Write the failing tests**

Append inside the existing `describe("multi-user isolation", ...)` block in `tests/integration/multi-user-isolation.test.ts` (the `signUp`/`signIn`/`disableApproval`/`cookieHeader` helpers and `connectionStrings`/`pg`/`DataContextRunner`/`SettingsRepository`/`appDb` are already in scope).

> **Seed-before-assert (Codex finding #7):** an isolation test that asserts "Bob sees an empty list" without first creating Alice-owned rows proves nothing — the list is empty because nothing was created, not because RLS filtered. Each case below **seeds an Alice-owned row directly via the bootstrap connection** (`connectionStrings.bootstrap`, which writes across RLS because it is the privileged migration/owner role), captures the seeded id, then asserts (a) Bob's app_runtime read cannot see that id, (b) the admin's app_runtime read cannot see that id, and (c) no secret-shaped field is exposed. Add a small seeding helper at the top of the describe:

```ts
async function seedAsBootstrap(text: string, params: unknown[] = []): Promise<string> {
  const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    const res = await client.query(text, params);
    return (res.rows[0]?.id as string) ?? "";
  } finally {
    await client.end();
  }
}
```

```ts
it("a member's onboarding state is invisible to the founder/admin and to another member", async () => {
  const admin = await signUp("Admin", "iso-admin@example.com"); // bootstrap owner + admin
  await disableApproval();
  const alice = await signUp("Alice", "iso-alice@example.com");
  const bob = await signUp("Bob", "iso-bob@example.com");

  // Alice completes her member onboarding (stamps her own app.member_onboarding row).
  const complete = await server.inject({
    method: "POST",
    url: "/api/onboarding/complete",
    headers: { cookie: alice.cookie }
  });
  expect(complete.statusCode).toBe(200);
  expect((complete.json() as { completed: boolean }).completed).toBe(true);

  // Alice sees her own completion.
  const aliceStatus = await server.inject({
    method: "GET",
    url: "/api/onboarding/status",
    headers: { cookie: alice.cookie }
  });
  expect((aliceStatus.json() as { completed: boolean }).completed).toBe(true);

  // Bob's own status is independent (still false) — per-user, not instance-global.
  const bobStatus = await server.inject({
    method: "GET",
    url: "/api/onboarding/status",
    headers: { cookie: bob.cookie }
  });
  expect((bobStatus.json() as { role: string; completed: boolean }).role).toBe("member");
  expect((bobStatus.json() as { completed: boolean }).completed).toBe(false);

  // Admin user list NEVER exposes onboarding state (it doesn't ride the user row at all).
  const list = await server.inject({
    method: "GET",
    url: "/api/admin/users",
    headers: { cookie: admin.cookie }
  });
  expect(list.statusCode).toBe(200);
  expect(JSON.stringify(list.json())).not.toMatch(/onboarding/i);

  // CRITICAL no-admin-bypass backstop: under the ADMIN's GUC, a direct read of
  // app.member_onboarding for Alice's id returns NO row — the table has no admin SELECT
  // policy (unlike app.users after 0052), so Alice's stamped state is invisible to the admin.
  const dataCtx = new DataContextRunner(appDb);
  const adminSeesAlice = await dataCtx.withDataContext(
    { actorUserId: admin.id, requestId: "iso-1a" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.member_onboarding")
        .select("user_id")
        .where("user_id", "=", alice.id)
        .execute()
  );
  expect(adminSeesAlice).toEqual([]);

  // And under Bob's GUC, Alice's row is likewise invisible.
  const bobSeesAlice = await dataCtx.withDataContext(
    { actorUserId: bob.id, requestId: "iso-1b" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.member_onboarding")
        .select("user_id")
        .where("user_id", "=", alice.id)
        .execute()
  );
  expect(bobSeesAlice).toEqual([]);
});

it("lifecycle stitch: completing onboarding sets only the actor's own row", async () => {
  await disableApproval();
  const admin = await signUp("Admin", "iso2-admin@example.com");
  void admin;
  const a = await signUp("MemberA", "iso2-a@example.com");
  const b = await signUp("MemberB", "iso2-b@example.com");

  await server.inject({
    method: "POST",
    url: "/api/onboarding/complete",
    headers: { cookie: a.cookie }
  });

  const dataCtx = new DataContextRunner(appDb);
  const repo = new SettingsRepository();
  const aState = await dataCtx.withDataContext(
    { actorUserId: a.id, requestId: "iso-2a" },
    (scopedDb) => repo.getMemberOnboardingState(scopedDb)
  );
  const bState = await dataCtx.withDataContext(
    { actorUserId: b.id, requestId: "iso-2b" },
    (scopedDb) => repo.getMemberOnboardingState(scopedDb)
  );
  expect(aState.completedAt).toBeInstanceOf(Date); // A read under A's GUC → set
  expect(bState.completedAt).toBeNull(); // B read under B's GUC → still null
});

it("per-user connectors: a SEEDED Alice-owned account is invisible to member B and the admin (and no secrets leak)", async () => {
  const admin = await signUp("Admin", "iso3-admin@example.com");
  await disableApproval();
  const alice = await signUp("Alice", "iso3-alice@example.com");
  const bob = await signUp("Bob", "iso3-bob@example.com");

  // Seed an Alice-owned connector account directly (cross-RLS bootstrap write). Schema:
  // packages/connectors/sql/0009_connectors_module.sql — app.connector_accounts(id [no default],
  // provider_id [FK→connector_definitions.provider_id], owner_user_id, scopes, status,
  // encrypted_secret jsonb [must be a JSON object]). The connectors module seeds
  // 'google-calendar' at migrate time; reference an existing definition via subquery for
  // robustness. owner_user_id = alice.id is the load-bearing isolation column.
  const aliceAccountId = await seedAsBootstrap(
    `INSERT INTO app.connector_accounts (id, provider_id, owner_user_id, scopes, status, encrypted_secret)
       SELECT gen_random_uuid(), d.provider_id, $1, ARRAY[]::text[], 'active', '{}'::jsonb
         FROM app.connector_definitions d
        ORDER BY d.provider_id LIMIT 1
       RETURNING id`,
    [alice.id]
  );
  expect(aliceAccountId).not.toBe("");

  // Bob's app_runtime read cannot see Alice's seeded account.
  const dataCtx = new DataContextRunner(appDb);
  const bobSees = await dataCtx.withDataContext(
    { actorUserId: bob.id, requestId: "iso-3a" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.connector_accounts")
        .select("id")
        .where("id", "=", aliceAccountId)
        .execute()
  );
  expect(bobSees).toEqual([]);
  const adminSees = await dataCtx.withDataContext(
    { actorUserId: admin.id, requestId: "iso-3b" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.connector_accounts")
        .select("id")
        .where("id", "=", aliceAccountId)
        .execute()
  );
  expect(adminSees).toEqual([]);

  // The public endpoint never carries secret-shaped fields for any actor.
  const adminAccounts = await server.inject({
    method: "GET",
    url: "/api/connectors/accounts",
    headers: { cookie: admin.cookie }
  });
  expect(adminAccounts.statusCode).toBe(200);
  expect(JSON.stringify(adminAccounts.json())).not.toMatch(
    /encrypted_secret|access_token|refresh_token|client_secret/i
  );
});

it("per-user AI keys: a SEEDED Alice-owned provider config is invisible to member B and the admin (and no secrets leak)", async () => {
  const admin = await signUp("Admin", "iso4-admin@example.com");
  await disableApproval();
  const alice = await signUp("Alice", "iso4-alice@example.com");
  const bob = await signUp("Bob", "iso4-bob@example.com");

  // Seed an Alice-owned AI provider config (cross-RLS bootstrap write). Schema:
  // packages/ai/sql/0013_ai_module.sql — app.ai_provider_configs(id [no default], owner_user_id,
  // provider_kind [enum app.ai_provider_kind: 'openai-compatible'|'anthropic'|'google'|'ollama'|
  // 'custom'], display_name [non-blank], status, encrypted_credential jsonb [must be an object]).
  // owner_user_id = alice.id is load-bearing.
  const aliceConfigId = await seedAsBootstrap(
    `INSERT INTO app.ai_provider_configs (id, owner_user_id, provider_kind, display_name, status, encrypted_credential)
       VALUES (gen_random_uuid(), $1, 'anthropic', 'Alice key', 'active', '{}'::jsonb)
       RETURNING id`,
    [alice.id]
  );
  expect(aliceConfigId).not.toBe("");

  const dataCtx = new DataContextRunner(appDb);
  const bobSees = await dataCtx.withDataContext(
    { actorUserId: bob.id, requestId: "iso-4a" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.ai_provider_configs")
        .select("id")
        .where("id", "=", aliceConfigId)
        .execute()
  );
  expect(bobSees).toEqual([]);
  const adminSees = await dataCtx.withDataContext(
    { actorUserId: admin.id, requestId: "iso-4b" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.ai_provider_configs")
        .select("id")
        .where("id", "=", aliceConfigId)
        .execute()
  );
  expect(adminSees).toEqual([]);

  const adminProviders = await server.inject({
    method: "GET",
    url: "/api/ai/providers",
    headers: { cookie: admin.cookie }
  });
  expect(adminProviders.statusCode).toBe(200);
  expect(JSON.stringify(adminProviders.json())).not.toMatch(
    /encrypted_credential|api[_-]?key|secret/i
  );
});

it("per-user chat: a SEEDED Alice-owned thread is invisible to member B and the admin", async () => {
  const admin = await signUp("Admin", "iso5-admin@example.com");
  await disableApproval();
  const alice = await signUp("Alice", "iso5-alice@example.com");
  const bob = await signUp("Bob", "iso5-bob@example.com");

  // Seed an Alice-owned chat thread (cross-RLS bootstrap write). Schema:
  // packages/chat/sql/0014_chat_module.sql — app.chat_threads(id [no default], owner_user_id,
  // title [non-blank]). owner_user_id = alice.id is load-bearing.
  const aliceThreadId = await seedAsBootstrap(
    `INSERT INTO app.chat_threads (id, owner_user_id, title)
       VALUES (gen_random_uuid(), $1, 'Alice private thread')
       RETURNING id`,
    [alice.id]
  );
  expect(aliceThreadId).not.toBe("");

  const dataCtx = new DataContextRunner(appDb);
  const bobSees = await dataCtx.withDataContext(
    { actorUserId: bob.id, requestId: "iso-5a" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.chat_threads")
        .select("id")
        .where("id", "=", aliceThreadId)
        .execute()
  );
  expect(bobSees).toEqual([]);
  const adminSees = await dataCtx.withDataContext(
    { actorUserId: admin.id, requestId: "iso-5b" },
    (scopedDb) =>
      scopedDb.db
        .selectFrom("app.chat_threads")
        .select("id")
        .where("id", "=", aliceThreadId)
        .execute()
  );
  expect(adminSees).toEqual([]);
});

it("per-user memory: SEEDED Alice-owned memory_chunks AND chat_memory_facts are invisible to member B and the admin", async () => {
  const admin = await signUp("Admin", "iso6-admin@example.com");
  await disableApproval();
  const alice = await signUp("Alice", "iso6-alice@example.com");
  const bob = await signUp("Bob", "iso6-bob@example.com");

  // Seed BOTH memory tables for Alice (two separate RLS-protected surfaces).
  // app.memory_chunks (packages/memory/sql/0030_memory_index.sql): id [DEFAULT gen_random_uuid()],
  // owner_user_id, source_kind ['vault'|'connector'], source_path, line_start>=0,
  // line_end>=line_start, content_hash, text [NOT NULL]; embedding nullable (leave NULL).
  // app.chat_memory_facts (packages/memory/sql/0041_memory_facts.sql): id [DEFAULT
  // gen_random_uuid()], owner_user_id, category ['preference'|'fact'|'profile'|'goal'], content.
  // owner_user_id = alice.id is load-bearing in each.
  const aliceChunkId = await seedAsBootstrap(
    `INSERT INTO app.memory_chunks
         (owner_user_id, source_kind, source_path, line_start, line_end, content_hash, text)
       VALUES ($1, 'vault', 'iso6/alice.md', 0, 1, 'iso6hash', 'alice secret chunk')
       RETURNING id`,
    [alice.id]
  );
  const aliceFactId = await seedAsBootstrap(
    `INSERT INTO app.chat_memory_facts (owner_user_id, category, content)
       VALUES ($1, 'fact', 'alice secret fact')
       RETURNING id`,
    [alice.id]
  );
  expect(aliceChunkId).not.toBe("");
  expect(aliceFactId).not.toBe("");

  const dataCtx = new DataContextRunner(appDb);

  // memory_chunks is registered on JarvisDatabase → typed select.
  for (const actor of [bob.id, admin.id]) {
    const seen = await dataCtx.withDataContext(
      { actorUserId: actor, requestId: `iso-6-chunks-${actor}` },
      (scopedDb) =>
        scopedDb.db
          .selectFrom("app.memory_chunks")
          .select("id")
          .where("id", "=", aliceChunkId)
          .execute()
    );
    expect(seen).toEqual([]);
  }

  // chat_memory_facts is NOT in JarvisDatabase → assert via raw SQL under each actor's GUC.
  for (const actor of [bob.id, admin.id]) {
    const seen = await dataCtx.withDataContext(
      { actorUserId: actor, requestId: `iso-6-facts-${actor}` },
      (scopedDb) =>
        sql<{ id: string }>`SELECT id FROM app.chat_memory_facts WHERE id = ${aliceFactId}`.execute(
          scopedDb.db
        )
    );
    expect(seen.rows).toEqual([]);
  }
});

// DEFERRED (spec §Open risks "Wellness surface assumption"): there is no wellness module/
// owner-scoped wellness table in the codebase as of this slice, so the per-user wellness
// isolation case is intentionally NOT asserted here. When a wellness module ships with real
// owner-scoped tables, add a case mirroring the per-user memory test above against those
// tables. Do NOT assert against a non-existent table.
it.skip("per-user wellness: member B cannot read member A's wellness data (deferred — no wellness module yet)", () => {
  // Intentionally skipped; see comment above.
});

// Per-user vault: vault I/O goes through VaultContext (filesystem), not a DB table, and is
// owner-scoped by path. The vault.test.ts suite already proves VaultContext containment;
// cross-user vault isolation is covered there. (Spec §Testing lists vault among the surfaces;
// it is gated by the existing vault suite rather than duplicated here.)
```

> **Every seed INSERT above is grounded in the real schema as of plan authoring** (`connector_accounts` 0009, `ai_provider_configs` 0013, `chat_threads` 0014, `memory_chunks` 0030, `chat_memory_facts` 0041) — they are complete executable statements, not illustrations. Notes: `connector_accounts.id`, `ai_provider_configs.id`, and `chat_threads.id` have **no DB default**, so each INSERT supplies `gen_random_uuid()`; `memory_chunks.id` / `chat_memory_facts.id` default to `gen_random_uuid()` so they are omitted. `encrypted_secret` / `encrypted_credential` are `jsonb` with a `jsonb_typeof = 'object'` CHECK, so `'{}'::jsonb` (not `bytea`) is required. `connector_accounts.provider_id` is an FK to `connector_definitions.provider_id`, referenced via subquery against the module-seeded definitions. `provider_kind` is the `app.ai_provider_kind` enum (`'anthropic'` is valid). Only if a sibling migration has since altered one of these tables should the INSERT be adjusted — and never by weakening the isolation assertion. **Add `sql` to the kysely import** at the top of the suite — line 7 currently imports only `type { Kysely } from "kysely"`, so change it to `import { sql, type Kysely } from "kysely";` (the `chat_memory_facts` raw read needs it). `DataContextRunner`, `SettingsRepository`, `appDb`, `connectionStrings`, and `pg` are already imported (lines 3, 6, 9, 11). `app.memory_chunks` is in `JarvisDatabase`; `app.chat_memory_facts` is NOT, so it is read via the `sql` template (verified: no `"app.chat_memory_facts"` key in `packages/db/src/types.ts`).

- [ ] **Step 11.2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/multi-user-isolation.test.ts`
Expected: FAIL on the onboarding cases (status route returns the member shape only after Task 5; if Task 5 already landed, these PASS — in that case the RED was captured when the cases were first added against a pre-Task-5 build; re-run to confirm GREEN). The per-surface isolation cases should pass against the shipped owner-only RLS; if any fail, that is a real isolation finding — STOP and investigate (do not weaken the assertion).

- [ ] **Step 11.3: Confirm green**

Run: `pnpm vitest run tests/integration/multi-user-isolation.test.ts`
Expected: PASS (the `wellness` case is `.skip`ped; all others green).

- [ ] **Step 11.4: Commit**

```bash
git add tests/integration/multi-user-isolation.test.ts
git commit -m "test(isolation): cover per-user onboarding + connectors/AI/chat/memory isolation; defer wellness (Phase 4 exit #3)"
```

---

### Task 12: Final gate

**Files:** none (verification only).

- [ ] **Step 12.1: Stop any background worker**

If `pnpm dev:worker` is running, stop it (it steals pg-boss jobs; integration tests reset the shared dev DB). Run: `pkill -f dev:worker || true` (or stop it in its pane).

- [ ] **Step 12.2: Run the full foundation gate**

Run: `pnpm verify:foundation`
Expected: PASS — lint (`--max-warnings=0`), format:check, check:file-size (<1000 lines/file), typecheck, db:migrate, test:integration (including `onboarding-member.test.ts` and the extended `multi-user-isolation.test.ts`). Capture the real exit code (do not pipe through `tail`).

- [ ] **Step 12.3: Run the onboarding e2e (best-effort)**

Run: `pnpm exec playwright test tests/e2e/onboarding-member.spec.ts tests/e2e/connect-google.spec.ts` (if the Playwright browser is available on the host). Expected: PASS. If no browser, the lint+typecheck of the spec under the foundation gate is the floor (per the scope note).

- [ ] **Step 12.4: Commit nothing / report**

No commit (gate-only). Report the gate result and the verified-clean state. Do NOT touch the GitHub board/milestone/merge (that is the coordinator's/wrap-up's job).

---

## Self-Review

### 1. Spec coverage (§-by-§)

| Spec section / acceptance criterion                                                                                                                                                                                                                                                                                     | Implemented by                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §Architecture — one wizard, role-parameterized                                                                                                                                                                                                                                                                          | Task 8 (role-selected step array), Task 0 (reuse spine, no duplicate)                                                                                                                                                                                        |
| §Architecture / Acceptance #1 — per-user onboarding state in an OWNER-ONLY `app.member_onboarding` table (NOT an `app.users` column, which 0052/0050 would leak to admins), ENABLE+FORCE RLS, self-row-only policies, no admin policy; `UsersTable`/`UserDto`/`serializeUser` untouched                                 | Task 1 (migration + table/RLS/no-admin-policy + no-`app.users`-column assertions), Task 2 (new `MemberOnboardingTable` type; explicit no-touch on Users/UserDto)                                                                                             |
| §Components 2 / Acceptance #2 — `GET /status` per-actor, member shape, `requireKnownUser` admits active member                                                                                                                                                                                                          | Task 5 (status branch), Task 3 (`getMemberOnboardingState`)                                                                                                                                                                                                  |
| §Components 3 / Acceptance #3 — `/complete` + `/skip` member stamps column, audits `onboarding.member_complete`, AccessContext unchanged; founder unchanged                                                                                                                                                             | Task 3 (`setMemberOnboardingComplete` + audit), Task 5 (complete/skip branch)                                                                                                                                                                                |
| §Components 4 / Acceptance #4 — member step array (welcome / optional API-key opt-out / connector verbatim / client-only tour), founder-only steps hidden, no CLI-auth step                                                                                                                                             | Task 8 (steps + array), Task 9 (tour)                                                                                                                                                                                                                        |
| §Components 4 / Acceptance #5 — API-key opt-out optional/skippable, never gates (and derives `apiKeyOptOut.done` client-side from `listAiProviders()`); tour client-only, catalogues the seven sections one line each, rendering only those whose module/route is enabled (absent ones — e.g. Wellness today — omitted) | Task 8 (`ApiKeyOptOutStep` + AI derivation), Task 9 (`SectionTourStep` with module-filtered list)                                                                                                                                                            |
| §Components 5 / Acceptance #6 — `app.tsx` fires for active member, mirrors pending branch, no `/api/bootstrap/status` touch                                                                                                                                                                                             | Task 10 (branch generalization)                                                                                                                                                                                                                              |
| §Architecture / Acceptance #7 — connector-done + API-key-done derived client-side via public endpoints; settings never queries connectors/AI tables                                                                                                                                                                     | Task 8 (`MemberConnectorStep` via `listConnectorAccounts`; `ApiKeyOptOutStep` via `listAiProviders`), Task 5 (server returns neutral `false` defaults for both flags)                                                                                        |
| §Components 6 / Acceptance #8 — `OnboardingStatusResponse` role-discriminated union, barrel-exported; `UserDto` no onboarding field; `queryKeys.onboarding` reused                                                                                                                                                      | Task 4 (union + schema), Task 7 (client type)                                                                                                                                                                                                                |
| §Security / Acceptance #9 — no secret-shaped field; AccessContext unchanged; member completion audited; onboarding state read/written ONLY via the GUC-scoped self-row path on an owner-only table with no admin policy (an admin cannot read it)                                                                       | Task 1 (no-admin-policy + auth-FORCE assertions), Task 3 (GUC-scoped read/UPSERT, audit, admin-context negative read test), Task 5 (no secret fields; reads only actorUserId/requestId), tests in Tasks 5/11 assert no secret regex + admin-cannot-see-Alice |
| §Testing / Acceptance #10 — extend `multi-user-isolation` for onboarding + connectors/AI/chat/memory (+vault via existing suite, wellness deferred)                                                                                                                                                                     | Task 11                                                                                                                                                                                                                                                      |
| §Testing / Acceptance #11 — `pnpm verify:foundation` green incl. new integration + extended isolation                                                                                                                                                                                                                   | Task 12                                                                                                                                                                                                                                                      |
| Acceptance #12 — Katherine manual acceptance                                                                                                                                                                                                                                                                            | Explicitly out of scope for code (noted in §Out of scope below); a milestone checklist item, not a task                                                                                                                                                      |
| §Out of scope — no member multiplexer/CLI step, no coachmark engine, no separate member "skipped" state, no admin-list surfacing, no re-run affordance, no Wellness build                                                                                                                                               | Honored throughout; Task 6 records the wellness/feelings-wheel out-of-scope boundary; Task 5 collapses member skip→complete                                                                                                                                  |
| §Open risks — spine-first dependency; client-side connector + AI derivation; column-vs-table (resolved IN FAVOUR OF a separate owner-only table because of the 0052 admin SELECT leak); self-row GUC-scoped, not SD-helper; global migration number; wellness-absent; manual-acceptance-not-CI                          | Task 0 (spine HARD-BLOCK gate), Task 8 (client connector + AI derivation), Task 1 (owner-only table, no admin policy, SD-helper untouched), Task 1 (global number note: next free = 0066), Task 9/11 (wellness omitted/deferred), Task 12 (manual not gated) |

**Gaps:** none in code scope. Acceptance #12 (Katherine) is deliberately a manual milestone item, not a code task (spec §Testing "NOT a code task"). The wellness isolation case is deliberately deferred (spec §Open risks). Both are explicit, not omissions.

### 2. Placeholder scan

No "TBD/TODO/implement later/handle edge cases/similar to Task N" placeholders in code steps — every code step contains complete code. The two intentional "adapt to the spine" notes (Tasks 4, 5, 8, 10) are NOT placeholders: they exist because the spine is authored by a sibling plan and its exact symbol names cannot be pinned until Task 0 reads them; each gives the complete code plus the exact grep to confirm the spine symbol. Task 6's mockup file and the `it.skip` wellness case are intentional documented boundaries, not gaps.

### 3. Type consistency

- Repo method names: `getMemberOnboardingState(scopedDb): Promise<{ completedAt: Date | null }>` (no id argument — GUC-scoped) and `setMemberOnboardingComplete(scopedDb, { actorUserId, requestId }): Promise<{ completedAt: Date | null }>` (UPSERT keyed on `app.current_actor_user_id()`; the input is used only for the audit row) — used identically in Tasks 3, 5, 11.
- Table/column: `app.member_onboarding(user_id, completed_at, created_at, updated_at)` (snake_case DB / `MemberOnboardingTable`) consistently; NO field added to `UsersTable`/`User`/`UserDto` — checked in Tasks 1, 2, 5, 11. The unsafe `app.users.onboarding_completed_at` column is explicitly asserted ABSENT (Task 1).
- Shared union: `OnboardingStatusResponse = OnboardingFounderStatus | OnboardingMemberStatus`, discriminant `role: "founder" | "member"` — used in Tasks 4, 5, 7, 8, 10.
- Member status member-shape: `{ role: "member", completed, steps: { apiKeyOptOut: { done }, connectors: { done } } }` — identical in the shared type (Task 4), the route (Task 5), the e2e mock (Task 10), the isolation test (Task 11).
- Audit action string: `"onboarding.member_complete"` — identical in Task 3 (write) and Task 5 (assert).
- Component prop names: `onSkipAll`, `onSkipStep`, `onDone` — defined and consumed consistently across Tasks 8/9 and the wizard wiring.

### Final gate

`pnpm verify:foundation` (Task 12) is the mandatory terminal gate: lint, format:check, check:file-size, typecheck, db:migrate, test:integration — including `tests/integration/onboarding-member.test.ts` and the extended `tests/integration/multi-user-isolation.test.ts`. Playwright e2e is best-effort per the verification-scope note.
