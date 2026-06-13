# Implementation Plan — Phase 3 Connector Sync Engine (Google Calendar + Gmail → read caches)

**Spec:** `docs/superpowers/specs/2026-06-13-p3-connector-sync-engine.md` (read in full before building).
**Sibling spec (design gate):** `docs/superpowers/specs/2026-06-13-p3-design-direction-ritual-design.md`
— the Calendar/Email pages (Task group H) are built against that slice's token layer + `ui/` primitives,
so this plan folds in the **pre-gate design deliverables + the `AWAIT BEN'S MOCKUP SIGN-OFF` gate**
before any app-wide CSS restyle.
**Epic:** #48 (Phase 3 · Core Value), exit-criterion #1 ("Connector sync engine") + criterion #4
(design direction #16).
**Builds on:** M-B1 Google Connection (OAuth + encrypted bundle + refresh).

---

## Goal

Turn the existing owner-only, auto-refreshing Google Connection into populated read caches. An on-demand
sync (`POST /api/connectors/google/sync`) and sync-on-connect read the user's **primary** Google Calendar
(±-window of events) and **Gmail** (full bodies, transiently), upsert them idempotently into
`app.calendar_events` and `app.email_messages`, derive an LLM **summary + structured signals** for email
(via the user's own capability-routed economy model — never the raw body), and the Calendar/Email web
pages render real data. No raw email body is ever persisted (vault or relational). The M-B1 RLS
`provider_type` conflation is resolved additively. `pnpm verify:foundation` + `pnpm audit:release-hardening`
stay green.

## Architecture

Follows the established **route → metadata-only pg-boss job → DataContext worker → repository** spine
(same shape as M-A3 chat execution and briefings run generation):

- A new `POST /api/connectors/google/sync` route (connectors module) enqueues a single metadata-only job
  on a new `connectors.google-sync` queue via `sendJob` (allowlist-enforced).
- The worker handler runs inside `withDataContext` (RLS scopes every read/write to the actor), decrypts
  the Google OAuth bundle in-process, drives a new outbound **Google API client**, and upserts through the
  calendar/email module repositories' new production `upsert*` methods.
- The email LLM pass is **provider-agnostic**: `AiRepository.selectModelForCapability(scopedDb,
"summarization", "economy")` → `selectProviderWithCredential` → decrypt AI credential →
  `HttpApiAdapter.generateChat`. No provider/model is hardcoded.
- **Role + RLS reach** is widened **additively** exactly as M-A3 did
  (`packages/chat/sql/0036_*.sql`, `packages/ai/sql/0037_*.sql`): new migrations add
  `jarvis_worker_runtime` to grants + RLS policies while preserving owner-scoped `USING`/`WITH CHECK`
  verbatim, and relax the calendar/email INSERT `WITH CHECK` to accept the `provider_type='google'`
  account (scope-gated) — resolving the M-B1 carried blocker.
- **Module isolation:** `connectors` owns the trigger (route + job + Google client + orchestration
  handler) and writes calendar/email tables **only** through their public repository `upsert*` methods.
- **Scheduler seam:** the payload is metadata-only + idempotent so the future briefings-slice cron
  enqueues the identical job with no code change. The seam is documented; **no cron is built here.**

## Tech Stack

- **Language/runtime:** TypeScript (ESM, NodeNext), Node ≥ 20, pnpm workspaces.
- **DB:** PostgreSQL 17 (pgvector image), Kysely query builder, RLS-on, branded `DataContextDb`.
- **Jobs:** pg-boss via `@jarv1s/jobs` (`sendJob`, `registerDataContextWorker`, `QueueDefinition`).
- **HTTP API:** Fastify 5 + shared JSON-schema route contracts in `packages/shared/src/*-api.ts`.
- **AI:** `@jarv1s/ai` (`AiRepository`, `HttpApiAdapter`, `createAiSecretCipher`).
- **Web:** React + @tanstack/react-query + plain CSS `var()` tokens; Vite.
- **Tests:** Vitest integration (against `pnpm db:up` Postgres, RLS-on); Playwright e2e with mocked REST.
- **External calls faked at the `fetch` boundary** (injected `fetchFn`) — never live in CI.

---

## File Structure

### New files

| Path                                                                      | Purpose                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/connectors/src/google-api-client.ts`                            | Outbound Google REST client (calendar.list, messages.list, messages.get) with injectable `fetch`.      |
| `packages/connectors/src/email-extract.ts`                                | MIME parse → `ParsedEmail`; LLM summary + signals pass (capability-routed).                            |
| `packages/connectors/src/sync-jobs.ts`                                    | `GOOGLE_SYNC_QUEUE`, queue defs, `GoogleSyncPayload`, `registerConnectorsJobWorkers` handler.          |
| `packages/connectors/sql/0068_connector_worker_runtime_grants.sql`        | Worker SELECT/UPDATE on `connector_accounts`, SELECT on `connector_definitions` + policy role-widen.   |
| `packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql` | Worker grants + INSERT-policy relax (`provider_type IN ('calendar','google')` + calendar-scope guard). |
| `packages/email/sql/0066_email_summary_signals_columns.sql`               | Add `summary text` + `signals jsonb` columns.                                                          |
| `packages/email/sql/0067_email_worker_grants_and_google_insert.sql`       | Worker grants + INSERT-policy relax (`provider_type IN ('email','google')` + gmail-scope guard).       |
| `tests/integration/google-sync.test.ts`                                   | Google client, email-extract, upsert idempotency, RLS, job/worker tests.                               |
| `docs/brand/mockups/briefing-reading.html`                                | Design-gate mockup: editorial briefing reading view (Ritual).                                          |
| `docs/brand/mockups/day-view-timebuckets.html`                            | Design-gate mockup: tasks/day view with This Morning/Afternoon/Evening.                                |
| `docs/brand/mockups/form-heavy.html`                                      | Design-gate mockup: a form-heavy screen (settings/auth) on tokens.                                     |
| `apps/web/src/styles/tokens.css`                                          | Semantic token layer (primitive ramps → semantic → theme overlays); only file with hex.                |
| `apps/web/src/ui/card.tsx`                                                | Presentational `Card`/`Stack`/`SectionHeader` primitives.                                              |
| `apps/web/src/ui/badge.tsx`                                               | `Badge` (tone → semantic state tokens; never error-red for drift).                                     |
| `apps/web/src/ui/provisional-region.tsx`                                  | Governor wrapper (`--provisional-opacity`) for AI/unconfirmed content.                                 |
| `apps/web/src/ui/time-bucket.tsx`                                         | `TimeBucket` chronology section header.                                                                |
| `apps/web/src/calendar/calendar.css`                                      | Calendar page styles (tokens only).                                                                    |
| `apps/web/src/email/email.css`                                            | Email triage page styles (tokens only).                                                                |
| `tests/e2e/calendar-email.spec.ts`                                        | e2e: Calendar renders events; Email renders summary+signals (no body); Sync now.                       |
| `tests/e2e/mock-calendar-email-api.ts`                                    | e2e REST mocks for calendar/email/sync.                                                                |

### Modified files

| Path                                           | Change                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/connectors/src/index.ts`             | Export `google-api-client.js`, `email-extract.js`, `sync-jobs.js`.                                                                       |
| `packages/connectors/package.json`             | Add deps `@jarv1s/jobs`, `@jarv1s/ai`, `@jarv1s/calendar`, `@jarv1s/email`, `pg-boss`.                                                   |
| `packages/connectors/src/routes.ts`            | Add `boss` to deps; `POST /api/connectors/google/sync` (rate-limited, dedupe-aware); sync-on-connect enqueue with sanitized failure log. |
| `packages/connectors/src/google-connection.ts` | Add optional `{ force }` to `getFreshAccessToken` (forced refresh for the 401-retry path; additive, default arg).                        |
| `packages/connectors/src/manifest.ts`          | Add the sync route + the new 0068 migration to `database.migrations`.                                                                    |
| `packages/shared/src/connectors-api.ts`        | Add `GoogleSyncResponse` + `googleSyncRouteSchema`.                                                                                      |
| `packages/calendar/src/repository.ts`          | Add `upsertCachedEvent`.                                                                                                                 |
| `packages/calendar/src/manifest.ts`            | Add 0065 to `database.migrations`.                                                                                                       |
| `packages/email/src/repository.ts`             | Add `upsertCachedMessage`; `summary`/`signals` in row I/O.                                                                               |
| `packages/email/src/routes.ts`                 | `serializeEmailMessage` exposes `summary` + `signals`.                                                                                   |
| `packages/email/src/manifest.ts`               | Add 0066 + 0067 to `database.migrations`.                                                                                                |
| `packages/shared/src/email-api.ts`             | Add `summary` + `signals` to `EmailMessageDto` + schema.                                                                                 |
| `packages/db/src/*` (types)                    | Extend `EmailMessage`/`EmailMessagesTable` types with `summary`/`signals`.                                                               |
| `packages/module-registry/src/index.ts`        | connectors registration gains `queueDefinitions` + `registerWorkers`; route registration receives `boss`.                                |
| `apps/worker/package.json`                     | Add deps `@jarv1s/connectors`, `@jarv1s/calendar`, `@jarv1s/email`, `@jarv1s/ai`.                                                        |
| `apps/web/src/main.tsx`                        | Import `styles/tokens.css` first, then feature CSS.                                                                                      |
| `apps/web/src/styles.css`                      | Replace hex with `var()`; net <1000 lines after token extraction.                                                                        |
| `apps/web/src/calendar/calendar-page.tsx`      | Rebuild as real React-Query page.                                                                                                        |
| `apps/web/src/email/email-page.tsx`            | Rebuild as triage page (summary + signals, no body).                                                                                     |
| `apps/web/src/api/client.ts`                   | Add `syncGoogleConnector()` fetcher.                                                                                                     |
| `docs/operations/dev-environment.md`           | Document `JARVIS_CONNECTOR_SECRET_KEY` + `JARVIS_AI_SECRET_KEY` in the worker env.                                                       |

> **Migration numbers are global by landing order — AND ARE ALREADY DRIFTING.** This plan's SQL files
> are written as `0065`–`0068`, but a **concurrent Phase-2 slice has since landed
> `packages/settings/sql/0065_module_enablement.sql`** (observed at review time), so `0065` is TAKEN.
> The numbers in this plan are therefore ILLUSTRATIVE PLACEHOLDERS. At build time you MUST re-derive the
> next free block with
> `find . -name '[0-9][0-9][0-9][0-9]_*.sql' -not -path '*/node_modules/*' | grep -oE '[0-9]{4}_' | sort -u | tail`
> and renumber **contiguously from the first free slot** (most likely `0066`–`0069`), applying the same
> offset across **every** new SQL filename, every `import`/path reference in the test grep assertions,
> AND all three manifest `database.migrations` arrays. The migration runner hash-checks by content, not
> name, so the only constraint is global uniqueness + landing order. Coordinate via `herdr-pane-message`
> with any other active session and re-check the highest number IMMEDIATELY before staging SQL (another
> slice may land between your check and your commit). Do not hardcode — re-derive.

---

## Build order & dependencies

```
A. DB foundation: migrations + types          (no deps)
B. Calendar upsert repository                  (needs A)
C. Email columns + upsert + DTO + serializer   (needs A)
D. Google API client                           (no deps)
E. Email-extract (MIME + LLM pass)             (needs @jarv1s/ai)
F. Sync job + worker handler                   (needs B,C,D,E)
G. Route + sync-on-connect + registry wiring   (needs F)
--- DESIGN PRE-GATE DELIVERABLES (parallelizable with A–G) ---
DG1. tokens.css + styles.css split + ui/ primitives + mockups
>>> AWAIT BEN'S MOCKUP SIGN-OFF <<<
--- POST-GATE ---
H. Web: Calendar + Email pages (consume tokens/primitives) + client fetcher + e2e   (needs C,G,DG1,sign-off)
I. Docs + self-review + final gate
```

Each lettered group below is a sequence of bite-sized TDD tasks. Every task: write failing test → run
(FAIL) → minimal implementation with COMPLETE code → run (PASS) → commit with explicit `git add <paths>`.
**Never `git add -A` / `git add .`.** Another session may share the tree.

---

## Group A — DB foundation (migrations + types)

### Task A0 — Re-derive the migration number block (DO THIS FIRST; no commit)

This plan writes its four SQL files as `0065`–`0068`, but those numbers are **placeholders** — a
concurrent slice already landed `packages/settings/sql/0065_module_enablement.sql`, so `0065` is taken
and more may land before you build. Before writing ANY SQL:

1. Re-derive the highest applied number:
   `find . -name '[0-9][0-9][0-9][0-9]_*.sql' -not -path '*/node_modules/*' | grep -oE '[0-9]{4}_' | sort -u | tail`
2. Assign the next FOUR contiguous free numbers, in this fixed landing order (the order matters because
   later policies reference earlier tables/grants):
   - `N+0` → calendar worker grants + google INSERT relax (Task A2; was `0065`)
   - `N+1` → email summary/signals columns (Task A1; was `0066`)
   - `N+2` → email worker grants + google INSERT relax (Task A3; was `0067`)
   - `N+3` → connector worker runtime grants (Task A4; was `0068`)
     (e.g. if the highest applied is `0065`, use `0066`–`0069`.)
3. Build a one-line substitution map (placeholder → actual) and apply it consistently to: every SQL
   **filename**, every `"sql/NNNN_*.sql"` entry in the three manifest `database.migrations` arrays, and
   every reference in this plan's prose/tests (the `(0065)`/`(0066)`/etc. describe-block labels are
   cosmetic but keep them aligned to avoid confusion).
4. Coordinate via `herdr-pane-message` with any other active session, and re-run the `find` in step 1
   **immediately before staging the SQL** — another slice can land between your check and your commit.

> Throughout the rest of Group A the files are named `0065`–`0068` for readability; substitute your
> re-derived numbers. **Do not commit anything in A0** — it only fixes the numbering you will use in
> A1–A4.

### Task A1 — Email summary/signals columns migration (0066)

**Files**

- Create: `packages/email/sql/0066_email_summary_signals_columns.sql`
- Modify: `packages/email/src/manifest.ts` (append to `database.migrations`)
- Test: `tests/integration/google-sync.test.ts` (new)

**Steps**

1. Write a failing test in a new `tests/integration/google-sync.test.ts`. Mirror the setup of
   `tests/integration/connectors-google.test.ts` (`resetFoundationDatabase`, `connectionStrings`, `ids`,
   `DataContextRunner`, `createDatabase`). Add:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb.destroy();
});

describe("email_messages summary/signals columns (0066)", () => {
  it("has nullable summary and a jsonb signals column defaulting to {}", async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
        AND column_name IN ('summary', 'signals')
      ORDER BY column_name
    `.execute(appDb);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(byName.summary?.data_type).toBe("text");
    expect(byName.summary?.is_nullable).toBe("YES");
    expect(byName.signals?.data_type).toBe("jsonb");
    expect(byName.signals?.is_nullable).toBe("NO");
  });

  it("declares a CHECK constraint that pins signals to a jsonb object", async () => {
    // A WHERE-false UPDATE never evaluates a CHECK, so assert the constraint EXISTS in the
    // catalog here; a real rejecting INSERT (signals = '[]') is exercised in C1 where a
    // valid connector account FK is available to reach the row insert at all.
    const checks = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'app' AND t.relname = 'email_messages' AND c.contype = 'c'
    `.execute(appDb);
    const defs = checks.rows.map((r) => r.definition).join(" | ");
    expect(defs).toMatch(/jsonb_typeof\(signals\)\s*=\s*'object'/);
  });
});
```

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/google-sync.test.ts` → **FAIL**
(columns do not exist).

2. Create `packages/email/sql/0066_email_summary_signals_columns.sql`:

```sql
-- Phase 3 connector-sync: add LLM-derived email triage columns.
-- summary: a concise natural-language summary string (nullable; null when the LLM
--   pass is skipped or fails). signals: a typed JSON object of extracted triage
--   signals (bills due, action items, deadlines, may-get-lost flag, importance,
--   confidence). The full email body is NEVER a column (privacy posture, spec §6).
-- Additive only; the existing snippet/body_excerpt columns are unchanged.

ALTER TABLE app.email_messages ADD COLUMN IF NOT EXISTS summary text;

ALTER TABLE app.email_messages
  ADD COLUMN IF NOT EXISTS signals jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(signals) = 'object');
```

3. Append the file to `packages/email/src/manifest.ts` `database.migrations`:

```ts
  database: {
    migrations: [
      "sql/0012_email_module.sql",
      "sql/0066_email_summary_signals_columns.sql"
    ],
    migrationDirectories: ["packages/email/sql"],
    ownedTables: ["app.email_messages"]
  },
```

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/google-sync.test.ts` → **PASS**.

4. Commit:
   `git add packages/email/sql/0066_email_summary_signals_columns.sql packages/email/src/manifest.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task A2 — Calendar worker grants + Google INSERT relax (0065)

**Files**

- Create: `packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql`
- Modify: `packages/calendar/src/manifest.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests (RLS via the **worker** role + Google-account INSERT). Add a worker DataContext and
   helper to seed a `google` connector account holding the calendar scope:

```ts
import { CalendarRepository } from "@jarv1s/calendar";
import { ConnectorsRepository, createConnectorSecretCipher } from "@jarv1s/connectors";

let workerDb: Kysely<JarvisDatabase>;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  workerDb = createDatabase({ connectionString: connectionStrings.worker });
  workerDataContext = new DataContextRunner(workerDb);
});
afterAll(async () => {
  await workerDb.destroy();
});

// IMPORTANT — test isolation. `upsertGoogleAccount` is a SINGLETON per user (keyed on
// provider_id = GOOGLE_PROVIDER_ID; verified packages/connectors/src/repository.ts:235):
// every call for the same actor OVERWRITES that user's one google account (id + scopes).
// So a negative scope-guard test is only sound if it (a) seeds the narrow scope itself
// immediately before its assertion (the upsert overwrites any prior broad scope) AND
// (b) re-reads the stored scopes to prove the precondition before the insert it expects
// to fail. To keep positive/negative cases fully independent of ordering, seed POSITIVE
// cases under `ids.userA` and NEGATIVE (lacks-scope) cases under `ids.userB`, so neither
// can clobber the other's account. `seedGoogleAccount` takes the actor explicitly.
async function seedGoogleAccount(
  scopes: string[],
  actorUserId: string = ids.userA
): Promise<string> {
  const cipher = createConnectorSecretCipher();
  const repo = new ConnectorsRepository();
  return dataContext.withDataContext({ actorUserId, requestId: "test" }, async (scopedDb) => {
    const account = await repo.upsertGoogleAccount(scopedDb, {
      scopes,
      encryptedSecret: cipher.encryptJson({ kind: "google-oauth" })
    });
    // Prove the precondition: the stored scopes are exactly what this test seeded,
    // so a later negative assertion cannot pass spuriously on a stale broad scope.
    const stored = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("scopes")
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();
    expect(new Set(stored.scopes)).toEqual(new Set(scopes));
    return account.id;
  });
}

describe("calendar RLS — worker role + google account INSERT (0065)", () => {
  it("the worker role can INSERT a calendar event for a google account holding the calendar scope", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const calendar = new CalendarRepository();
    const event = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        calendar.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "evt-1",
          title: "Standup",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:15:00.000Z"
        })
    );
    expect(event.external_id).toBe("evt-1");
  });

  it("rejects INSERT when the google account lacks the calendar scope", async () => {
    // Negative case seeded under ids.userB so it can never clobber the positive
    // userA account (singleton-per-user upsert; see seedGoogleAccount note).
    const accountId = await seedGoogleAccount(
      ["https://www.googleapis.com/auth/gmail.modify"],
      ids.userB
    );
    const calendar = new CalendarRepository();
    await expect(
      workerDataContext.withDataContext({ actorUserId: ids.userB, requestId: "test" }, (scopedDb) =>
        calendar.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "evt-2",
          title: "Blocked",
          startsAt: "2026-06-13T09:00:00.000Z",
          endsAt: "2026-06-13T09:15:00.000Z"
        })
      )
    ).rejects.toThrow();
  });
});
```

(These tests also exercise A2's policy and B's `upsertCachedEvent`; they FAIL now on the missing
worker grant AND the missing method — sequence A2 then B closes both. Run after each.)

Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/google-sync.test.ts` → **FAIL**.

2. Create `packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql`. This recreates the
   three policies from `0020_calendar_owner_or_share.sql` **verbatim** for the owner-or-share
   `USING`/`WITH CHECK`, adds `jarvis_worker_runtime` to the role list, and relaxes the INSERT EXISTS to
   accept the `'google'` provider with a calendar-scope guard:

```sql
-- Phase 3 connector-sync: the google-sync pg-boss worker runs as jarvis_worker_runtime
-- and must INSERT/UPDATE cached calendar events. Mirrors the M-A3 precedent
-- (packages/chat/sql/0036, packages/ai/sql/0037): additive role-widen on grants + RLS
-- policies, preserving the owner-or-share USING/WITH CHECK from 0020 verbatim.
--
-- Also resolves the M-B1 carried blocker: the only authenticating account is
-- provider_type='google', but the 0011/0020 INSERT WITH CHECK required
-- provider_type='calendar', so google-keyed inserts failed the EXISTS check. We relax
-- the EXISTS to accept provider_type IN ('calendar','google'); the 'google' branch is
-- scope-gated (the account must hold the Google Calendar scope). Owner-equality
-- (owner_user_id = app.current_actor_user_id()) is preserved verbatim.

GRANT SELECT, INSERT, UPDATE ON app.calendar_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS calendar_events_select ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON app.calendar_events;

CREATE POLICY calendar_events_select
ON app.calendar_events
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'view')
  )
);

CREATE POLICY calendar_events_insert
ON app.calendar_events
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND (
        definitions.provider_type = 'calendar'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/calendar' = ANY (accounts.scopes)
        )
      )
  )
);

CREATE POLICY calendar_events_update
ON app.calendar_events
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'manage')
  )
);
```

3. Append `"sql/0065_calendar_worker_grants_and_google_insert.sql"` to
   `packages/calendar/src/manifest.ts` `database.migrations` (after `"sql/0011_calendar_module.sql"`).

   Run: `pnpm db:migrate && pnpm test:integration -- tests/integration/google-sync.test.ts` → still
   **FAIL** on the missing `upsertCachedEvent` method (the grant is in place; method lands in B).

4. Commit:
   `git add packages/calendar/sql/0065_calendar_worker_grants_and_google_insert.sql packages/calendar/src/manifest.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task A3 — Email worker grants + Google INSERT relax (0067)

**Files**

- Create: `packages/email/sql/0067_email_worker_grants_and_google_insert.sql`
- Modify: `packages/email/src/manifest.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests mirroring A2 for email (worker INSERT succeeds with gmail scope, rejected without):

```ts
import { EmailRepository } from "@jarv1s/email";

describe("email RLS — worker role + google account INSERT (0067)", () => {
  it("the worker role can INSERT an email message for a google account holding the gmail scope", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const email = new EmailRepository();
    const row = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) =>
        email.upsertCachedMessage(scopedDb, {
          connectorAccountId: accountId,
          externalId: "msg-1",
          sender: "a@b.com",
          subject: "Bill due",
          receivedAt: "2026-06-13T09:00:00.000Z",
          summary: null,
          signals: {}
        })
    );
    expect(row.external_id).toBe("msg-1");
  });

  it("rejects INSERT when the google account lacks the gmail scope", async () => {
    // Negative case under ids.userB (singleton-per-user upsert; see seedGoogleAccount note).
    const accountId = await seedGoogleAccount(
      ["https://www.googleapis.com/auth/calendar"],
      ids.userB
    );
    const email = new EmailRepository();
    await expect(
      workerDataContext.withDataContext({ actorUserId: ids.userB, requestId: "test" }, (scopedDb) =>
        email.upsertCachedMessage(scopedDb, {
          connectorAccountId: accountId,
          externalId: "msg-2",
          sender: "a@b.com",
          subject: "Blocked",
          receivedAt: "2026-06-13T09:00:00.000Z",
          summary: null,
          signals: {}
        })
      )
    ).rejects.toThrow();
  });
});
```

Run → **FAIL** (grant + method missing).

2. Create `packages/email/sql/0067_email_worker_grants_and_google_insert.sql` (mirror 0065 exactly,
   substituting `email`/`email_message`/gmail scope; recreate the three policies from
   `0021_email_owner_or_share.sql` verbatim, add `jarvis_worker_runtime`, relax INSERT EXISTS):

```sql
-- Phase 3 connector-sync: worker role + RLS for email caches. Mirrors 0065 (calendar)
-- and the M-A3 grant precedent. Owner-or-share USING/WITH CHECK preserved from 0021
-- verbatim; INSERT EXISTS relaxed to provider_type IN ('email','google') with a
-- gmail-scope guard for the 'google' branch. Owner-equality preserved verbatim.

GRANT SELECT, INSERT, UPDATE ON app.email_messages TO jarvis_worker_runtime;

DROP POLICY IF EXISTS email_messages_select ON app.email_messages;
DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;
DROP POLICY IF EXISTS email_messages_update ON app.email_messages;

CREATE POLICY email_messages_select
ON app.email_messages
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'view')
  )
);

CREATE POLICY email_messages_insert
ON app.email_messages
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND (
        definitions.provider_type = 'email'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/gmail.modify' = ANY (accounts.scopes)
        )
      )
  )
);

CREATE POLICY email_messages_update
ON app.email_messages
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'manage')
  )
);
```

3. Append `"sql/0067_email_worker_grants_and_google_insert.sql"` to `packages/email/src/manifest.ts`
   `database.migrations` (after the 0066 entry from A1).

   Run → still **FAIL** on missing `upsertCachedMessage` (lands in C).

4. Commit:
   `git add packages/email/sql/0067_email_worker_grants_and_google_insert.sql packages/email/src/manifest.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task A4 — Connector worker grants (0068)

**Files**

- Create: `packages/connectors/sql/0068_connector_worker_runtime_grants.sql`
- Modify: `packages/connectors/src/manifest.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add a failing test: the **worker** role can SELECT + UPDATE `connector_accounts` and SELECT
   `connector_definitions` under the actor (so it can read the encrypted Google secret and re-encrypt the
   refreshed token), but cannot see another user's account:

```ts
describe("connector_accounts RLS — worker role (0068)", () => {
  it("the worker role reads the actor's active google account secret", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret?.id).toBe(accountId);
  });

  it("the worker role cannot see another user's connector account", async () => {
    // Use ids.adminUser here, NOT ids.userB: the A2/A3 negative scope-guard tests seed a
    // (scoped-but-different) google account under ids.userB, so userB is NO LONGER account-free.
    // ids.adminUser is a third authenticated user (test-database.ts) that no test ever gives a
    // connector account, so cross-user invisibility is asserted cleanly regardless of run order.
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret).toBeUndefined();
  });
});
```

(The positive case uses the `ids.userA` account seeded earlier; the cross-user case uses
`ids.adminUser`, a third authenticated user in `test-database.ts` that holds no connector account.)

Run → **FAIL** (worker lacks SELECT on `connector_accounts`).

2. Create `packages/connectors/sql/0068_connector_worker_runtime_grants.sql`. Recreate the three
   `connector_accounts` policies from `0022_connectors_owner_only.sql` **verbatim** for owner-equality,
   adding `jarvis_worker_runtime`; recreate `connector_definitions_select` from `0009` verbatim adding the
   worker role; grant SELECT/UPDATE on accounts and SELECT on definitions:

```sql
-- Phase 3 connector-sync: the google-sync worker (jarvis_worker_runtime) reads the
-- actor's encrypted Google OAuth bundle (SELECT on connector_accounts), re-encrypts the
-- refreshed token (UPDATE), and joins connector_definitions in the cache INSERT-policy
-- EXISTS check (SELECT). Mirrors the M-A3 precedent: additive role-widen on grants + RLS,
-- owner-scoped USING/WITH CHECK preserved verbatim from 0022/0009. connector_accounts
-- stay OWNER-ONLY (no app.has_share arm — secrets are never shared). No INSERT grant for
-- the worker: connection creation stays app-runtime only.

GRANT SELECT ON app.connector_definitions TO jarvis_worker_runtime;
GRANT SELECT, UPDATE ON app.connector_accounts TO jarvis_worker_runtime;

DROP POLICY IF EXISTS connector_definitions_select ON app.connector_definitions;
CREATE POLICY connector_definitions_select
ON app.connector_definitions
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
);

DROP POLICY IF EXISTS connector_accounts_select ON app.connector_accounts;
CREATE POLICY connector_accounts_select
ON app.connector_accounts
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

DROP POLICY IF EXISTS connector_accounts_update ON app.connector_accounts;
CREATE POLICY connector_accounts_update
ON app.connector_accounts
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
```

> Note: the `connector_accounts_insert` policy is **not** recreated here — the worker is not granted
> INSERT, so it keeps the `0022` definition (app-runtime only). Do not touch it.

3. Append `"sql/0068_connector_worker_runtime_grants.sql"` to `packages/connectors/src/manifest.ts`
   `database.migrations` (after the two existing entries).

   Run → **PASS** (worker can read/scope the actor's account; cross-user returns undefined).

4. Commit:
   `git add packages/connectors/sql/0068_connector_worker_runtime_grants.sql packages/connectors/src/manifest.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task A5 — Extend `EmailMessage` DB type with summary/signals

**Files**

- Modify: the DB type for `email_messages` (find with
  `grep -rn "EmailMessagesTable\|interface EmailMessage" packages/db/src`)
- Test: `pnpm typecheck` (the type is asserted by C's repository compile)

**Steps**

1. Locate the `EmailMessage`/`EmailMessagesTable` interface in `packages/db/src` (likely
   `packages/db/src/schema/*` or the generated kysely types). Add the two columns:

```ts
// app.email_messages (Phase 3 connector-sync)
summary: string | null;
signals: Record<string, unknown>;
```

Place `summary` and `signals` on the row type, matching the existing column-type conventions in that
file (use the same `ColumnType`/`Generated` wrappers the neighbours use — read the file before editing).

2. Run `pnpm typecheck` → expect it to pass for db; C will consume these fields. (No standalone test —
   this is a type-only change validated by C and the gate.)

3. Commit: `git add <the db type file>` then `git commit`.

---

## Group B — Calendar upsert repository

### Task B1 — `CalendarRepository.upsertCachedEvent`

**Files**

- Modify: `packages/calendar/src/repository.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add a failing idempotency test (the A2 success/reject tests already drive existence; add the
   idempotency + identity-trigger assertions):

```ts
describe("CalendarRepository.upsertCachedEvent idempotency", () => {
  it("re-upserting the same external_id updates in place (one row, no duplicate)", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const calendar = new CalendarRepository();
    const ctx = { actorUserId: ids.userA, requestId: "test" };
    await dataContext.withDataContext(ctx, (db) =>
      calendar.upsertCachedEvent(db, {
        connectorAccountId: accountId,
        externalId: "dup-1",
        title: "v1",
        startsAt: "2026-06-13T09:00:00.000Z",
        endsAt: "2026-06-13T09:30:00.000Z"
      })
    );
    const second = await dataContext.withDataContext(ctx, (db) =>
      calendar.upsertCachedEvent(db, {
        connectorAccountId: accountId,
        externalId: "dup-1",
        title: "v2",
        startsAt: "2026-06-13T10:00:00.000Z",
        endsAt: "2026-06-13T10:30:00.000Z"
      })
    );
    expect(second.title).toBe("v2");
    const rows = await dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.calendar_events")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("external_id", "=", "dup-1")
        .executeTakeFirstOrThrow()
    );
    expect(Number(rows.n)).toBe(1);
  });
});
```

Run → **FAIL** (`upsertCachedEvent` does not exist).

2. Add to `packages/calendar/src/repository.ts`. Reuse the existing
   `CreateCachedCalendarEventInput` shape (it already covers all fields). Insert with an `onConflict`
   that updates only the mutable columns (never `owner_user_id`/`connector_account_id`/`external_id` —
   the identity trigger forbids it):

```ts
  async upsertCachedEvent(
    scopedDb: DataContextDb,
    input: CreateCachedCalendarEventInput
  ): Promise<CalendarEvent> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.calendar_events")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        location: input.location ?? null,
        summary: input.summary ?? null,
        body_excerpt: input.bodyExcerpt ?? null,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["connector_account_id", "external_id"]).doUpdateSet({
          title: input.title,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          location: input.location ?? null,
          summary: input.summary ?? null,
          body_excerpt: input.bodyExcerpt ?? null,
          external_metadata: input.externalMetadata ?? {},
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
```

Run → **PASS** (A2 success + reject + B1 idempotency all green).

3. Commit:
   `git add packages/calendar/src/repository.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

## Group C — Email columns + upsert + DTO + serializer

### Task C1 — `EmailRepository.upsertCachedMessage` + summary/signals I/O

**Files**

- Modify: `packages/email/src/repository.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add a failing idempotency + columns round-trip test (A3 already drives existence; add idempotency and
   summary/signals persistence + the "no body column" assertion):

```ts
describe("EmailRepository.upsertCachedMessage idempotency + columns", () => {
  it("persists summary + signals and re-upserts in place", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const email = new EmailRepository();
    const ctx = { actorUserId: ids.userA, requestId: "test" };
    await dataContext.withDataContext(ctx, (db) =>
      email.upsertCachedMessage(db, {
        connectorAccountId: accountId,
        externalId: "e-dup",
        sender: "a@b.com",
        subject: "v1",
        receivedAt: "2026-06-13T09:00:00.000Z",
        summary: "first",
        signals: { importance: "low", confidence: 0.4 }
      })
    );
    const second = await dataContext.withDataContext(ctx, (db) =>
      email.upsertCachedMessage(db, {
        connectorAccountId: accountId,
        externalId: "e-dup",
        sender: "a@b.com",
        subject: "v2",
        receivedAt: "2026-06-13T09:05:00.000Z",
        summary: "second",
        signals: { importance: "high", confidence: 0.9 }
      })
    );
    expect(second.subject).toBe("v2");
    expect(second.summary).toBe("second");
    expect((second.signals as { importance?: string }).importance).toBe("high");
  });

  it("has no full-body column on email_messages", async () => {
    const cols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
    `.execute(appDb);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("body");
    expect(names).not.toContain("body_full");
    expect(names).not.toContain("raw_body");
  });

  it("rejects a non-object signals value via the CHECK constraint (real insert path)", async () => {
    // The A1 catalog test proves the CHECK exists; this proves it actually REJECTS.
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    await expect(
      dataContext.withDataContext({ actorUserId: ids.userA, requestId: "test" }, (db) =>
        db.db
          .insertInto("app.email_messages")
          .values({
            id: "00000000-0000-0000-0000-0000000000aa",
            connector_account_id: accountId,
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            sender: "a@b.com",
            recipients: [],
            subject: "bad signals",
            snippet: null,
            body_excerpt: null,
            received_at: "2026-06-13T09:00:00.000Z",
            external_id: "bad-signals-1",
            external_metadata: {},
            summary: null,
            signals: sql`'[]'::jsonb`,
            created_at: new Date(),
            updated_at: new Date()
          })
          .execute()
      )
    ).rejects.toThrow();
  });
});
```

Run → **FAIL**.

2. Extend `CreateCachedEmailMessageInput` and add `upsertCachedMessage` in
   `packages/email/src/repository.ts`. First extend the input interface:

```ts
export interface CreateCachedEmailMessageInput {
  readonly id?: string;
  readonly connectorAccountId: string;
  readonly sender: string;
  readonly recipients?: readonly string[];
  readonly subject: string;
  readonly snippet?: string | null;
  readonly bodyExcerpt?: string | null;
  readonly receivedAt: Date | string;
  readonly externalId: string;
  readonly externalMetadata?: Record<string, unknown>;
  readonly summary?: string | null;
  readonly signals?: Record<string, unknown>;
}
```

Then add the method. Note the defensive cap on `body_excerpt`: the connector-sync handler never
passes a body excerpt (it stays null), but bounding it at the repository layer means no caller —
present or future — can smuggle a full email body into this column. A real excerpt is a short
preview, so 500 chars is generous (privacy posture, spec §6):

```ts
  /** Hard cap on any persisted body excerpt — a preview, never a full body. */
  static readonly MAX_BODY_EXCERPT_CHARS = 500;

  async upsertCachedMessage(
    scopedDb: DataContextDb,
    input: CreateCachedEmailMessageInput
  ): Promise<EmailMessage> {
    assertDataContextDb(scopedDb);

    const now = new Date();
    const bodyExcerpt =
      input.bodyExcerpt != null
        ? input.bodyExcerpt.slice(0, EmailRepository.MAX_BODY_EXCERPT_CHARS)
        : null;

    return scopedDb.db
      .insertInto("app.email_messages")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        sender: input.sender,
        recipients: [...(input.recipients ?? [])],
        subject: input.subject,
        snippet: input.snippet ?? null,
        body_excerpt: bodyExcerpt,
        received_at: input.receivedAt,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        summary: input.summary ?? null,
        signals: input.signals ?? {},
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["connector_account_id", "external_id"]).doUpdateSet({
          sender: input.sender,
          recipients: [...(input.recipients ?? [])],
          subject: input.subject,
          snippet: input.snippet ?? null,
          body_excerpt: bodyExcerpt,
          received_at: input.receivedAt,
          external_metadata: input.externalMetadata ?? {},
          summary: input.summary ?? null,
          signals: input.signals ?? {},
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Lightweight per-account sync markers for skip-unchanged: external_id, the stored Gmail
   * historyId (read from external_metadata), AND whether a non-null summary already exists.
   * The handler skips the (costly) LLM pass ONLY when historyId is unchanged AND a usable
   * summary is already stored — so a message first cached before any model was configured (or
   * after a failed extraction, summary=null) is correctly RE-summarized once a model exists.
   * RLS-scoped to the actor via the worker SELECT grant (0067); returns only this account's rows.
   */
  async listSyncMarkers(
    scopedDb: DataContextDb,
    connectorAccountId: string
  ): Promise<Array<{ externalId: string; historyId: string | null; hasSummary: boolean }>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.email_messages")
      .select(["external_id", "external_metadata", "summary"])
      .where("connector_account_id", "=", connectorAccountId)
      .execute();
    return rows.map((r) => ({
      externalId: r.external_id,
      historyId:
        ((r.external_metadata as { historyId?: string | null } | null)?.historyId ?? null),
      hasSummary: r.summary !== null
    }));
  }
```

Run → **PASS**.

3. Commit:
   `git add packages/email/src/repository.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task C2 — `EmailMessageDto` + serializer expose summary/signals

**Files**

- Modify: `packages/shared/src/email-api.ts`
- Modify: `packages/email/src/routes.ts`
- Test: `tests/integration/calendar-email.test.ts` (extend the existing serializer/route test) or
  `tests/integration/google-sync.test.ts`

**Steps**

1. Add a failing test asserting the serialized DTO carries `summary` + `signals`. Prefer extending
   `tests/integration/calendar-email.test.ts` (the existing email route test); if simpler, assert against
   `serializeEmailMessage` directly:

```ts
import { serializeEmailMessage } from "@jarv1s/email";

it("serializes summary + signals onto EmailMessageDto", () => {
  const dto = serializeEmailMessage({
    id: "00000000-0000-0000-0000-000000000001",
    connector_account_id: "00000000-0000-0000-0000-000000000002",
    owner_user_id: "00000000-0000-0000-0000-000000000003",
    sender: "a@b.com",
    recipients: [],
    subject: "s",
    snippet: null,
    body_excerpt: null,
    received_at: new Date("2026-06-13T09:00:00.000Z"),
    external_id: "x",
    external_metadata: {},
    summary: "concise",
    signals: { importance: "high" },
    created_at: new Date("2026-06-13T09:00:00.000Z"),
    updated_at: new Date("2026-06-13T09:00:00.000Z")
  } as never);
  expect(dto.summary).toBe("concise");
  expect((dto.signals as { importance?: string }).importance).toBe("high");
});
```

Run → **FAIL** (`summary`/`signals` not on DTO).

2. In `packages/shared/src/email-api.ts`, add the fields to the interface, the `required` array, and the
   `properties` of `emailMessageDtoSchema`:

```ts
export interface EmailMessageDto {
  // ...existing fields...
  readonly bodyExcerpt: string | null;
  readonly summary: string | null;
  readonly signals: Record<string, unknown>;
  readonly receivedAt: string;
  // ...rest unchanged...
}
```

Add `"summary"`, `"signals"` to the `required` array (after `"bodyExcerpt"`), and to `properties`:

```ts
    bodyExcerpt: nullableStringSchema,
    summary: nullableStringSchema,
    signals: jsonObjectSchema,
    receivedAt: { type: "string" },
```

3. In `packages/email/src/routes.ts`, add to `serializeEmailMessage`:

```ts
    bodyExcerpt: message.body_excerpt,
    summary: message.summary,
    signals: message.signals,
    receivedAt: toIsoString(message.received_at),
```

Run → **PASS** + `pnpm typecheck`.

4. Commit:
   `git add packages/shared/src/email-api.ts packages/email/src/routes.ts tests/integration/calendar-email.test.ts`
   then `git commit`.

---

## Group D — Google API client

### Task D1 — `google-api-client.ts` (calendar + gmail reads)

**Files**

- Create: `packages/connectors/src/google-api-client.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests asserting request shapes and the secrets-never-leak rule. Use a capturing fake
   `fetch` (model the `fakeFetch` helper in `connectors-google.test.ts`):

```ts
import { GoogleApiClient } from "@jarv1s/connectors";

function captureFetch(responder: (url: string) => { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), headers });
    const r = responder(String(url));
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("GoogleApiClient.listCalendarEvents", () => {
  it("requests primary calendar with singleEvents=true, orderBy=startTime, the window, and pages", async () => {
    const { calls, fetchFn } = captureFetch((url) =>
      url.includes("pageToken=PAGE2")
        ? { ok: true, status: 200, body: { items: [{ id: "b" }] } }
        : { ok: true, status: 200, body: { items: [{ id: "a" }], nextPageToken: "PAGE2" } }
    );
    const client = new GoogleApiClient({ fetchFn });
    const events = await client.listCalendarEvents({
      accessToken: "tok",
      calendarId: "primary",
      timeMin: "2026-06-06T00:00:00.000Z",
      timeMax: "2026-07-13T00:00:00.000Z"
    });
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toContain("/calendars/primary/events");
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("orderBy")).toBe("startTime");
    expect(first.searchParams.get("timeMin")).toBe("2026-06-06T00:00:00.000Z");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
  });

  it("throws without leaking the response body on non-2xx", async () => {
    const { fetchFn } = captureFetch(() => ({
      ok: false,
      status: 503,
      body: { error: "SECRET-LEAK-DETAIL" }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.listCalendarEvents({ accessToken: "tok", timeMin: "x", timeMax: "y" })
    ).rejects.toThrow(/Google calendar returned 503/);
    await expect(
      client.listCalendarEvents({ accessToken: "tok", timeMin: "x", timeMax: "y" })
    ).rejects.not.toThrow(/SECRET-LEAK-DETAIL/);
  });
});

describe("GoogleApiClient gmail", () => {
  it("lists message ids then gets a full message", async () => {
    const { calls, fetchFn } = captureFetch((url) =>
      url.includes("/messages/m1")
        ? { ok: true, status: 200, body: { id: "m1", payload: {} } }
        : { ok: true, status: 200, body: { messages: [{ id: "m1", threadId: "t1" }] } }
    );
    const client = new GoogleApiClient({ fetchFn });
    const ids = await client.listMessageIds({ accessToken: "tok", query: "newer_than:30d" });
    expect(ids.map((m) => m.id)).toEqual(["m1"]);
    const msg = await client.getMessage({ accessToken: "tok", id: "m1" });
    expect(msg.id).toBe("m1");
    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.searchParams.get("q")).toBe("newer_than:30d");
    const getUrl = new URL(calls[1]!.url);
    expect(getUrl.searchParams.get("format")).toBe("full");
  });
});
```

Run → **FAIL** (`GoogleApiClient` does not exist).

2. Create `packages/connectors/src/google-api-client.ts`. Plain class with injectable `fetch` + minimal
   logger, mirroring `GoogleOAuthClient`. Never embed the response body in the thrown `Error.message`
   (the `oauth.ts:122` rule). 401 retry-after-refresh is handled by the **handler** (it owns the
   `getFreshAccessToken` dependency); the client surfaces a `GoogleApiError` carrying `statusCode` so the
   handler can detect 401:

```ts
// Minimal logger — avoids a pino/fastify dependency in the connectors package (mirrors oauth.ts).
interface GoogleApiLogger {
  error(data: Record<string, unknown>, message: string): void;
}

export interface GoogleApiClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly logger?: GoogleApiLogger;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface GoogleCalendarEvent {
  readonly id: string;
  readonly summary?: string;
  readonly description?: string;
  readonly location?: string;
  readonly status?: string;
  readonly htmlLink?: string;
  readonly start?: { readonly dateTime?: string; readonly date?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string };
  readonly attendees?: ReadonlyArray<unknown>;
}

export interface GmailMessageStub {
  readonly id: string;
  readonly threadId?: string;
}

export interface GmailMessageFull {
  readonly id: string;
  readonly threadId?: string;
  readonly historyId?: string;
  readonly labelIds?: readonly string[];
  readonly snippet?: string;
  readonly payload?: GmailPayloadPart;
  readonly internalDate?: string;
}

export interface GmailPayloadPart {
  readonly mimeType?: string;
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly body?: { readonly data?: string; readonly size?: number };
  readonly parts?: readonly GmailPayloadPart[];
}

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export class GoogleApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly logger: GoogleApiLogger;

  constructor(deps: GoogleApiClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
    this.logger = deps.logger ?? { error: (data, msg) => console.error(msg, data) };
  }

  async listCalendarEvents(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    maxPages?: number;
  }): Promise<GoogleCalendarEvent[]> {
    const calendarId = input.calendarId ?? "primary";
    const maxPages = input.maxPages ?? 20;
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("timeMin", input.timeMin);
      url.searchParams.set("timeMax", input.timeMax);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await this.getJson<{
        items?: GoogleCalendarEvent[];
        nextPageToken?: string;
      }>(url.toString(), input.accessToken, "calendar");
      events.push(...(json.items ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return events;
  }

  async listMessageIds(input: {
    accessToken: string;
    query?: string;
    maxPages?: number;
  }): Promise<GmailMessageStub[]> {
    const maxPages = input.maxPages ?? 10;
    const stubs: GmailMessageStub[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${GMAIL_BASE}/users/me/messages`);
      if (input.query) url.searchParams.set("q", input.query);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await this.getJson<{
        messages?: GmailMessageStub[];
        nextPageToken?: string;
      }>(url.toString(), input.accessToken, "gmail");
      stubs.push(...(json.messages ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return stubs;
  }

  async getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull> {
    const url = new URL(`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(input.id)}`);
    url.searchParams.set("format", "full");
    return this.getJson<GmailMessageFull>(url.toString(), input.accessToken, "gmail");
  }

  private async getJson<T>(url: string, accessToken: string, api: string): Promise<T> {
    const response = await this.fetchFn(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      // Log status server-side only; NEVER embed the response body in Error.message —
      // handleRouteError propagates Error.message to HTTP responses (oauth.ts:122).
      this.logger.error({ statusCode: response.status, api }, "Google API call failed");
      throw new GoogleApiError(`Google ${api} returned ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }
}
```

3. Export from `packages/connectors/src/index.ts`:

```ts
export * from "./google-api-client.js";
```

Run → **PASS**.

4. Commit:
   `git add packages/connectors/src/google-api-client.ts packages/connectors/src/index.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

## Group E — Email-extract (MIME parse + LLM pass)

> Requires `@jarv1s/ai` as a connectors dependency. Add it in this group's first task.

### Task E1 — Add AI/jobs/calendar/email deps to connectors package

**Files**

- Modify: `packages/connectors/package.json`
- Test: `pnpm install && pnpm typecheck` (no unit test; validated by E2/F compile)

**Steps**

1. Add to `packages/connectors/package.json` `dependencies` (alphabetical with the existing entries):

```json
    "@jarv1s/ai": "workspace:*",
    "@jarv1s/calendar": "workspace:*",
    "@jarv1s/db": "workspace:*",
    "@jarv1s/email": "workspace:*",
    "@jarv1s/jobs": "workspace:*",
    "@jarv1s/module-sdk": "workspace:*",
    "@jarv1s/shared": "workspace:*",
    "fastify": "^5.6.2",
    "kysely": "^0.29.2",
    "pg-boss": "^12.18.2"
```

(Use the EXACT version already pinned across the workspace — `^12.18.2` in
`packages/jobs`, `packages/briefings`, `packages/tasks`, `packages/module-registry` as of grounding.
Re-confirm at build with `grep '"pg-boss"' packages/jobs/package.json` and match it verbatim; never
introduce a different range. `sync-jobs.ts` only needs pg-boss **types** (`PgBoss`, `Job`,
`WorkOptions`) — `boss` itself is injected — so a `devDependencies`-style type-only need is satisfied
by the runtime dep above, consistent with the other modules that list pg-boss as a dependency.)

> Module-isolation note: connectors depending on calendar/email/ai is the **declared, justified**
> cross-module orchestration from the spec — connectors owns the credential + Google fan-out and calls
> only the public repository `upsert*` methods, never another module's tables directly.

2. Run `pnpm install` then `pnpm typecheck` → expect success (no usages yet).

3. Commit: `git add packages/connectors/package.json pnpm-lock.yaml` then `git commit`.

---

### Task E2 — MIME parser → `ParsedEmail`

**Files**

- Create: `packages/connectors/src/email-extract.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests for the parser (plaintext, html fallback, base64url decode, headers, truncation):

```ts
import { parseEmail } from "@jarv1s/connectors";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

describe("parseEmail", () => {
  it("extracts headers and decodes a base64url text/plain body", () => {
    const parsed = parseEmail({
      id: "m1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "snip",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: "a@b.com" },
          { name: "To", value: "c@d.com" },
          { name: "Date", value: "Sat, 13 Jun 2026 09:00:00 +0000" }
        ],
        body: { data: b64url("Plain body text") }
      }
    });
    expect(parsed.subject).toBe("Hello");
    expect(parsed.from).toBe("a@b.com");
    expect(parsed.recipients).toContain("c@d.com");
    expect(parsed.labelIds).toContain("INBOX");
    expect(parsed.body).toContain("Plain body text");
  });

  it("falls back to stripped text/html when no text/plain part exists", () => {
    const parsed = parseEmail({
      id: "m2",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "H" },
          { name: "From", value: "a@b.com" }
        ],
        parts: [{ mimeType: "text/html", body: { data: b64url("<p>Hi <b>there</b></p>") } }]
      }
    });
    expect(parsed.body).toContain("Hi");
    expect(parsed.body).not.toContain("<p>");
  });

  it("truncates the decoded body to the bounded cap", () => {
    const big = "x".repeat(100_000);
    const parsed = parseEmail({
      id: "m3",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "H" },
          { name: "From", value: "a@b.com" }
        ],
        body: { data: b64url(big) }
      }
    });
    expect(parsed.body.length).toBeLessThanOrEqual(parsed.bodyTruncated ? 20_000 : big.length);
  });
});
```

Run → **FAIL**.

2. Create `packages/connectors/src/email-extract.ts` with the parser (the LLM pass is added in E3):

```ts
import type { GmailMessageFull, GmailPayloadPart } from "./google-api-client.js";

/** Max decoded body length sent to the LLM (bounded to protect prompt limits, spec risk #6). */
export const MAX_BODY_CHARS = 20_000;

/**
 * Hard cap on the persisted summary length. The summary is the ONLY model-derived prose we
 * store; bounding it defensively means even a misbehaving/jailbroken model cannot echo the
 * full email body back into a persisted column (privacy posture, spec §6). A real summary is
 * one or two sentences, so 600 chars is generous.
 */
export const MAX_SUMMARY_CHARS = 600;

export interface ParsedEmail {
  readonly externalId: string;
  readonly historyId: string | null;
  readonly subject: string;
  readonly from: string;
  readonly recipients: string[];
  readonly receivedAt: string;
  readonly labelIds: string[];
  readonly snippet: string | null;
  readonly body: string;
  readonly bodyTruncated: boolean;
}

function header(part: GmailPayloadPart | undefined, name: string): string | undefined {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeB64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Bounded accumulation: stop decoding once BOTH buffers reach the cap, and bound each base64
// slice we decode so a single huge part cannot allocate far beyond MAX_BODY_CHARS before the
// final truncation (Codex MIME-alloc finding). The base64 decoded length is ~3/4 of the
// encoded length, so slicing the encoded data to ~4/3 * remaining caps the decoded output.
function collectBody(part: GmailPayloadPart | undefined): { text: string; html: string } {
  const acc = { text: "", html: "" };
  if (!part) return acc;
  const encodedCap = Math.ceil((MAX_BODY_CHARS * 4) / 3) + 4;
  const walk = (p: GmailPayloadPart): void => {
    if (acc.text.length >= MAX_BODY_CHARS && acc.html.length >= MAX_BODY_CHARS) return;
    const mime = p.mimeType ?? "";
    if (mime === "text/plain" && p.body?.data && acc.text.length < MAX_BODY_CHARS) {
      acc.text += decodeB64Url(p.body.data.slice(0, encodedCap)).slice(0, MAX_BODY_CHARS);
    } else if (mime === "text/html" && p.body?.data && acc.html.length < MAX_BODY_CHARS) {
      acc.html += decodeB64Url(p.body.data.slice(0, encodedCap)).slice(0, MAX_BODY_CHARS);
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return acc;
}

function splitAddresses(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseEmail(message: GmailMessageFull): ParsedEmail {
  const payload = message.payload;
  const { text, html } = collectBody(payload);
  const rawBody = text.trim().length > 0 ? text : stripHtml(html);
  const truncated = rawBody.length > MAX_BODY_CHARS;
  const body = truncated ? rawBody.slice(0, MAX_BODY_CHARS) : rawBody;

  const to = splitAddresses(header(payload, "To"));
  const cc = splitAddresses(header(payload, "Cc"));
  const dateHeader = header(payload, "Date");
  const receivedAt =
    message.internalDate !== undefined
      ? new Date(Number(message.internalDate)).toISOString()
      : dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();

  return {
    externalId: message.id,
    historyId: message.historyId ?? null,
    subject: header(payload, "Subject") ?? "(no subject)",
    from: header(payload, "From") ?? "(unknown)",
    recipients: [...to, ...cc],
    receivedAt,
    labelIds: [...(message.labelIds ?? [])],
    snippet: message.snippet ?? null,
    body,
    bodyTruncated: truncated
  };
}
```

3. Export from `packages/connectors/src/index.ts`:

```ts
export * from "./email-extract.js";
```

Run → **PASS**.

4. Commit:
   `git add packages/connectors/src/email-extract.ts packages/connectors/src/index.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task E3 — LLM summary + signals pass (capability-routed, defensive)

**Files**

- Modify: `packages/connectors/src/email-extract.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests for the LLM pass with a fake adapter: (a) valid JSON, (b) garbage → null summary /
   empty signals / confidence 0 / no throw, (c) high importance + low confidence → exactly one
   escalation to the next tier:

```ts
import { extractEmailSignals, type EmailExtractDeps } from "@jarv1s/connectors";

const PARSED = {
  externalId: "m1",
  historyId: null,
  subject: "Electric bill",
  from: "billing@utility.com",
  recipients: ["me@x.com"],
  receivedAt: "2026-06-13T09:00:00.000Z",
  labelIds: ["INBOX"],
  snippet: null,
  body: "Your bill of $84.20 is due 2026-06-30.",
  bodyTruncated: false
};

function fakeDeps(opts: {
  replies: string[]; // one per generateChat call, in order
  models: Array<{ tier: string } | undefined>; // per selectModelForCapability call
}): EmailExtractDeps {
  let replyIdx = 0;
  let modelIdx = 0;
  return {
    selectModel: async () => opts.models[modelIdx++] as never,
    runChat: async () => ({ text: opts.replies[replyIdx++] ?? "" })
  };
}

describe("extractEmailSignals", () => {
  it("parses a valid JSON reply into summary + signals", async () => {
    const deps = fakeDeps({
      replies: [
        JSON.stringify({
          summary: "Utility bill $84.20 due 2026-06-30",
          billsDue: [
            { description: "Electric", amount: 84.2, currency: "USD", dueDate: "2026-06-30" }
          ],
          actionItems: [],
          deadlines: [],
          mayGetLostInShuffle: false,
          importance: "normal",
          confidence: 0.9
        })
      ],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toContain("84.20");
    expect(result.signals.billsDue?.[0]?.amount).toBe(84.2);
    expect(result.signals.confidence).toBe(0.9);
  });

  it("degrades to null summary / empty signals on a garbage reply (never throws)", async () => {
    const deps = fakeDeps({ replies: ["not json at all"], models: [{ tier: "economy" }] });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
    expect(result.signals.confidence).toBe(0);
    expect(result.signals.billsDue ?? []).toEqual([]);
  });

  it("escalates exactly once on high importance + low confidence", async () => {
    const deps = fakeDeps({
      replies: [
        JSON.stringify({ summary: "x", importance: "high", confidence: 0.2 }),
        JSON.stringify({ summary: "escalated", importance: "high", confidence: 0.8 })
      ],
      models: [{ tier: "economy" }, { tier: "interactive" }]
    });
    const result = await extractEmailSignals(PARSED, deps, { escalateConfidence: 0.5 });
    expect(result.summary).toBe("escalated");
    expect(result.signals.confidence).toBe(0.8);
  });

  it("skips the LLM pass and returns metadata-only when no model is configured", async () => {
    const deps = fakeDeps({ replies: [], models: [undefined] });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
    expect(result.signals).toEqual({});
  });

  it("nulls the summary when a short-body model echoes the body verbatim", async () => {
    // The model summary is byte-for-byte the parsed body (whitespace aside) — no summarization.
    // The exact-echo guard must drop it so the raw body is never persisted as summary.
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: `  ${PARSED.body}  `, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
  });
});
```

Run → **FAIL**.

2. Add to `packages/connectors/src/email-extract.ts`. Define the typed signals shape, an injectable deps
   seam (so the worker passes real router calls and tests pass fakes), a JSON-shaped prompt, and the
   defensive parse + one-escalation logic:

```ts
export interface EmailBill {
  readonly description: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly dueDate?: string;
}
export interface EmailActionItem {
  readonly text: string;
  readonly dueDate?: string;
}
export interface EmailDeadline {
  readonly text: string;
  readonly date?: string;
}
export interface EmailSignals {
  readonly billsDue?: EmailBill[];
  readonly actionItems?: EmailActionItem[];
  readonly deadlines?: EmailDeadline[];
  readonly mayGetLostInShuffle?: boolean;
  readonly importance?: "low" | "normal" | "high";
  readonly confidence?: number;
  readonly truncated?: boolean;
}

export interface EmailExtractResult {
  readonly summary: string | null;
  readonly signals: EmailSignals;
  /** True when the pass escalated to a higher tier (telemetry; counted by the handler). */
  readonly escalated?: boolean;
}

/** Injectable seam: the worker passes router-backed impls; tests pass fakes. */
export interface EmailExtractDeps {
  /** Resolve a model for the summarization capability at a tier (router-backed). */
  readonly selectModel: (
    tier: "economy" | "interactive" | "reasoning"
  ) => Promise<{ readonly tier: string } | undefined>;
  /** Run one chat generation against the resolved model; returns { text }. */
  readonly runChat: (
    model: { readonly tier: string },
    prompt: string
  ) => Promise<{ readonly text: string }>;
}

export interface EmailExtractOptions {
  readonly escalateConfidence?: number;
  /** Per-LLM-call timeout in ms (bounds sync latency; default from env, then 20s). */
  readonly callTimeoutMs?: number;
}

/** Reject a chat call that exceeds the budget so one slow model can't stall the whole sync. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("llm-timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function buildPrompt(parsed: ParsedEmail): string {
  return [
    "You are an email triage assistant. Read the email and reply with a single JSON object only,",
    "no prose, matching this TypeScript type:",
    "{ summary: string, billsDue: {description:string, amount?:number, currency?:string, dueDate?:string}[],",
    " actionItems: {text:string, dueDate?:string}[], deadlines: {text:string, date?:string}[],",
    ' mayGetLostInShuffle: boolean, importance: "low"|"normal"|"high", confidence: number }',
    "Use ISO dates. confidence is 0..1.",
    "",
    `Subject: ${parsed.subject}`,
    `From: ${parsed.from}`,
    "",
    parsed.body
  ].join("\n");
}

function safeParseSignals(text: string): EmailExtractResult {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("no json object");
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const importance =
      obj.importance === "low" || obj.importance === "high" ? obj.importance : "normal";
    const confidence =
      typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
        ? obj.confidence
        : 0;
    const summary =
      typeof obj.summary === "string" ? obj.summary.slice(0, MAX_SUMMARY_CHARS) : null;
    return {
      summary,
      signals: {
        billsDue: Array.isArray(obj.billsDue) ? (obj.billsDue as EmailBill[]) : [],
        actionItems: Array.isArray(obj.actionItems) ? (obj.actionItems as EmailActionItem[]) : [],
        deadlines: Array.isArray(obj.deadlines) ? (obj.deadlines as EmailDeadline[]) : [],
        mayGetLostInShuffle: obj.mayGetLostInShuffle === true,
        importance,
        confidence
      }
    };
  } catch {
    // A bad LLM reply must never fail the whole sync (spec §error handling).
    return {
      summary: null,
      signals: { billsDue: [], actionItems: [], deadlines: [], confidence: 0 }
    };
  }
}

export async function extractEmailSignals(
  parsed: ParsedEmail,
  deps: EmailExtractDeps,
  options: EmailExtractOptions = {}
): Promise<EmailExtractResult> {
  const threshold =
    options.escalateConfidence ?? Number(process.env.JARVIS_EMAIL_ESCALATE_CONFIDENCE ?? "0.5");
  const timeoutMs =
    options.callTimeoutMs ?? Number(process.env.JARVIS_EMAIL_LLM_TIMEOUT_MS ?? "20000");

  const economyModel = await deps.selectModel("economy");
  if (!economyModel) {
    // No configured summarization model — metadata-only row (graceful degrade).
    return { summary: null, signals: {} };
  }

  const prompt = buildPrompt(parsed);
  let result: EmailExtractResult;
  let escalated = false;
  try {
    const reply = await withTimeout(deps.runChat(economyModel, prompt), timeoutMs);
    result = safeParseSignals(reply.text);
  } catch {
    // Timeout or model error — degrade to metadata-only, never throw (spec §error handling).
    result = { summary: null, signals: { confidence: 0 } };
  }

  // Optional single escalation: high importance + low confidence → next tier (at most once).
  if (result.signals.importance === "high" && (result.signals.confidence ?? 0) < threshold) {
    const higher = await deps.selectModel("interactive");
    if (higher) {
      try {
        const reply = await withTimeout(deps.runChat(higher, prompt), timeoutMs);
        result = safeParseSignals(reply.text);
        escalated = true;
      } catch {
        /* keep the economy result on escalation failure */
      }
    }
  }

  // Verbatim-echo guard: if the model returned the body verbatim (no summarization at all),
  // drop the summary rather than persist the raw body. We deliberately use EXACT normalized
  // equality (whitespace-collapsed), NOT a fuzzy overlap threshold — a real summary of a short
  // email legitimately reuses much of its wording, so an overlap heuristic would null-out valid
  // summaries. Exact equality catches only the pathological "model echoed the body" case.
  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (result.summary !== null && normalize(result.summary) === normalize(parsed.body)) {
    result = { ...result, summary: null };
  }

  const truncatedSignals = parsed.bodyTruncated
    ? { ...result.signals, truncated: true }
    : result.signals;
  return { ...result, signals: truncatedSignals, escalated };
}
```

Run → **PASS**.

3. Commit:
   `git add packages/connectors/src/email-extract.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

## Group F — Sync job + worker handler

### Task F1 — Queue definitions + `GoogleSyncPayload` metadata-only assertion

**Files**

- Create: `packages/connectors/src/sync-jobs.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

1. Add failing tests for the queue/payload contract: payload keys are all in `ALLOWED_PAYLOAD_KEYS`
   (`sendJob` accepts it); the queue def uses `exclusive`:

```ts
import {
  GOOGLE_SYNC_QUEUE,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  type GoogleSyncPayload
} from "@jarv1s/connectors";
import { ALLOWED_PAYLOAD_KEYS } from "@jarv1s/jobs";

describe("google-sync queue contract", () => {
  it("uses an exclusive queue named connectors.google-sync", () => {
    expect(GOOGLE_SYNC_QUEUE).toBe("connectors.google-sync");
    const def = GOOGLE_SYNC_QUEUE_DEFINITIONS[0]!;
    expect(def.name).toBe(GOOGLE_SYNC_QUEUE);
    expect(def.options?.policy).toBe("exclusive");
  });

  it("payload keys are all in the metadata-only allowlist", () => {
    const payload: GoogleSyncPayload = {
      actorUserId: "00000000-0000-0000-0000-000000000001",
      kind: "google-sync",
      idempotencyKey: "k"
    };
    for (const key of Object.keys(payload)) {
      expect(ALLOWED_PAYLOAD_KEYS.has(key)).toBe(true);
    }
  });
});
```

Run → **FAIL**.

2. Create `packages/connectors/src/sync-jobs.ts` with the queue + payload + result (handler added in F2):

```ts
import type { QueueDefinition } from "@jarv1s/jobs";
import type { ActorScopedJobPayload } from "@jarv1s/jobs";

export const GOOGLE_SYNC_QUEUE = "connectors.google-sync";

export const GOOGLE_SYNC_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: GOOGLE_SYNC_QUEUE,
    options: {
      // exclusive: at most one job per (queue, singletonKey) across created+active.
      // The route sets singletonKey to the actor id so a manual sync racing
      // sync-on-connect collapses to one job (spec §error handling; briefings precedent).
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface GoogleSyncPayload extends ActorScopedJobPayload {
  readonly kind: "google-sync";
  readonly idempotencyKey?: string;
}

export interface GoogleSyncResult {
  readonly calendarUpserted: number;
  readonly emailUpserted: number;
  /** Count of messages that failed to fetch/parse/upsert (metadata only; no detail). */
  readonly emailFailures?: number;
  /** Count of LLM escalations to a higher tier (cost/telemetry; metadata only). */
  readonly escalations?: number;
  readonly errors: string[];
  readonly truncated?: boolean;
}
```

3. Export from `packages/connectors/src/index.ts`:

```ts
export * from "./sync-jobs.js";
```

Run → **PASS**.

4. Commit:
   `git add packages/connectors/src/sync-jobs.ts packages/connectors/src/index.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task F2 — `registerConnectorsJobWorkers` orchestration handler

**Files**

- Modify: `packages/connectors/src/google-connection.ts` (add the `{ force }` refresh option)
- Modify: `packages/connectors/src/sync-jobs.ts`
- Test: `tests/integration/google-sync.test.ts`

**Steps**

0. **Add a forced-refresh option to the existing token getter.** The 401-retry path in `runGoogleSync`
   needs to bypass the cached-token fast path. In `packages/connectors/src/google-connection.ts`,
   change the verified current signature
   `async getFreshAccessToken(scopedDb: DataContextDb): Promise<string>` (google-connection.ts:110) to
   `async getFreshAccessToken(scopedDb: DataContextDb, opts: { force?: boolean } = {}): Promise<string>`
   and guard the existing ">60s remaining → return cached" fast path with `if (!opts.force && …)`. The
   refresh branch is otherwise unchanged (it already re-encrypts via `upsertGoogleAccount`). Add a test
   in `connectors-google.test.ts` (or `google-sync.test.ts`) asserting that with `{ force: true }` a
   still-valid token triggers `refreshAccessToken` exactly once (use the existing fake oauth client).
   This is additive (default arg) — no existing caller changes. Run → FAIL then PASS.

1. Add a failing test that exercises the **handler function directly** (not through pg-boss) so it is
   deterministic. Extract the orchestration as a pure async `runGoogleSync(scopedDb, deps)` the worker
   registration wraps. The test injects a fake Google client + a fake email-extract deps + a stub
   `getFreshAccessToken`, seeds a google account, and asserts: calendar + email upserted; one cache
   failing does not abort the other; result is metadata-only:

```ts
import { runGoogleSync } from "@jarv1s/connectors";

describe("runGoogleSync handler", () => {
  it("syncs calendar + email and returns metadata-only counts", async () => {
    const accountId = await seedGoogleAccount([
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const result = await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar", "gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [
            {
              id: "g1",
              summary: "Standup",
              start: { dateTime: "2026-06-13T09:00:00Z" },
              end: { dateTime: "2026-06-13T09:15:00Z" }
            }
          ],
          listMessageIds: async () => [{ id: "m1" }],
          getMessage: async () => ({
            id: "m1",
            payload: {
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from("hi").toString("base64") }
            }
          })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(result.calendarUpserted).toBe(1);
    expect(result.emailUpserted).toBe(1);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result)).not.toContain("accessToken");
  });

  it("records a no-active-connection error without throwing", async () => {
    const ctx = { actorUserId: ids.userB, requestId: "pgboss:test" };
    const result = await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => {
          throw new Error("No active Google connection");
        },
        getActiveAccount: async () => undefined,
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date()
      })
    );
    expect(result.errors).toContain("no-active-connection");
  });

  it("skips the LLM pass for a message whose historyId is unchanged since last sync", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let llmCalls = 0;
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-1" }],
      getMessage: async () => ({
        id: "hist-1",
        historyId: "H100",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    const extractDeps = {
      selectModel: async () => ({ tier: "economy" }),
      runChat: async () => {
        llmCalls += 1;
        return { text: JSON.stringify({ summary: "ok", confidence: 0.9 }) };
      }
    };
    const run = () =>
      dataContext.withDataContext(ctx, (db) =>
        runGoogleSync(db, {
          getFreshAccessToken: async () => "tok",
          getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
          googleClient: client,
          emailExtractDeps: extractDeps,
          now: () => new Date("2026-06-13T12:00:00.000Z")
        })
      );
    await run(); // first sync: summarizes once, stores historyId H100 + a non-null summary
    await run(); // second sync: historyId unchanged AND summary present → skip the LLM pass
    expect(llmCalls).toBe(1);
  });

  it("re-summarizes an unchanged message that was first cached with NO summary", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-2" }],
      getMessage: async () => ({
        id: "hist-2",
        historyId: "H200",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    // First sync: NO model configured → summary stays null, historyId H200 stored.
    await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    let llmCalls = 0;
    // Second sync: SAME historyId, but a model now exists and the prior summary is null →
    // must NOT skip; it summarizes this time.
    const result = await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => {
            llmCalls += 1;
            return { text: JSON.stringify({ summary: "now summarized", confidence: 0.8 }) };
          }
        },
        now: () => new Date("2026-06-13T13:00:00.000Z")
      })
    );
    expect(llmCalls).toBe(1);
    expect(result.emailUpserted).toBe(1);
  });

  it("forces a token refresh and retries once on a 401 from a Google call", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let refreshes = 0;
    let calendarAttempts = 0;
    const result = await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async (_db, opts) => {
          if (opts?.force) refreshes += 1;
          return opts?.force ? "fresh-tok" : "stale-tok";
        },
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar"] }),
        googleClient: {
          listCalendarEvents: async ({ accessToken }) => {
            calendarAttempts += 1;
            if (accessToken === "stale-tok") {
              const e = new Error("Google calendar returned 401") as Error & { statusCode: number };
              e.statusCode = 401;
              throw e;
            }
            return [
              {
                id: "g1",
                summary: "X",
                start: { dateTime: "2026-06-13T09:00:00Z" },
                end: { dateTime: "2026-06-13T09:15:00Z" }
              }
            ];
          },
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(refreshes).toBe(1);
    expect(calendarAttempts).toBe(2);
    expect(result.calendarUpserted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("NEVER persists the full email body in any email_messages column (privacy posture)", async () => {
    // A full body LONGER than MAX_SUMMARY_CHARS (600). The fake model deliberately MISBEHAVES
    // and returns the ENTIRE body as the summary — the worst case. The persisted summary must
    // still be truncated below the cap, so the verbatim full body can never round-trip into a
    // column. (A model legitimately quoting a phrase is acceptable; persisting the whole body
    // verbatim is the invariant we defend.)
    const FULL_BODY = "SENTINEL-FULL-BODY-MUST-NOT-PERSIST-" + "x".repeat(900); // > 600 chars
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [{ id: "sentinel-1" }],
          getMessage: async () => ({
            id: "sentinel-1",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              body: { data: Buffer.from(FULL_BODY).toString("base64") }
            }
          })
        },
        // Misbehaving model: echoes the WHOLE body back as the summary.
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => ({ text: JSON.stringify({ summary: FULL_BODY, confidence: 0.9 }) })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    const row = await dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.email_messages")
        .selectAll()
        .where("external_id", "=", "sentinel-1")
        .executeTakeFirstOrThrow()
    );
    // The verbatim FULL body must not appear in ANY column (subject/snippet/body_excerpt/
    // summary/signals/external_metadata, all serialized).
    expect(JSON.stringify(row)).not.toContain(FULL_BODY);
    // The summary, if present, is hard-capped at MAX_SUMMARY_CHARS so it cannot be the full body.
    const summary = (row as { summary: string | null }).summary;
    expect((summary ?? "").length).toBeLessThanOrEqual(600);
    // body_excerpt is explicitly NOT written by sync (handler never passes it).
    expect((row as { body_excerpt: string | null }).body_excerpt).toBeNull();
  });
});
```

Run → **FAIL**.

2. Add `runGoogleSync` + `registerConnectorsJobWorkers` to `packages/connectors/src/sync-jobs.ts`. The
   handler is pure over an injectable `GoogleSyncDeps` so tests are deterministic; the production worker
   builds the real deps (Google client, router-backed email-extract, `getFreshAccessToken`). Imports at
   top of the file:

```ts
import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker } from "@jarv1s/jobs";
import {
  AiRepository,
  HttpApiAdapter,
  createAiSecretCipher,
  type AiConfiguredModelSafeRow
} from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";

import { createConnectorSecretCipher } from "./crypto.js";
import {
  GoogleApiClient,
  type GoogleCalendarEvent,
  type GmailMessageFull
} from "./google-api-client.js";
import { GoogleConnectionService } from "./google-connection.js";
import { GoogleOAuthClient, type GoogleConnectionSecret } from "./oauth.js";
import { ConnectorsRepository } from "./repository.js";
import { extractEmailSignals, parseEmail, type EmailExtractDeps } from "./email-extract.js";
```

Then the deps + handler:

```ts
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_WINDOW_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_QUERY = "newer_than:30d";
const EMAIL_MESSAGE_CAP = Number(process.env.JARVIS_EMAIL_SYNC_CAP ?? "50");

interface GoogleClientLike {
  listCalendarEvents(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
  }): Promise<GoogleCalendarEvent[]>;
  listMessageIds(input: { accessToken: string; query?: string }): Promise<Array<{ id: string }>>;
  getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull>;
}

export interface GoogleSyncDeps {
  getActiveAccount(scopedDb: DataContextDb): Promise<{ id: string; scopes: string[] } | undefined>;
  /**
   * Return a usable access token. When `force` is true, bypass the cached-token fast path and
   * force a network refresh (used for the single 401 retry). The production impl is
   * GoogleConnectionService.getFreshAccessToken with a new optional `{ force }` arg (see G/F).
   */
  getFreshAccessToken(scopedDb: DataContextDb, opts?: { force?: boolean }): Promise<string>;
  readonly googleClient: GoogleClientLike;
  readonly emailExtractDeps: EmailExtractDeps;
  readonly now?: () => Date;
  readonly calendarRepository?: CalendarRepository;
  readonly emailRepository?: EmailRepository;
  /** Structured, sanitized sync logger (never token/body content). Defaults to a console shim. */
  readonly logger?: SyncLogger;
}

/** Sanitized structured logging for partial-failure observability (never secrets/body). */
export interface SyncLogger {
  warn(data: Record<string, unknown>, message: string): void;
  info(data: Record<string, unknown>, message: string): void;
}

const NOOP_SYNC_LOGGER: SyncLogger = {
  warn: (data, msg) => console.warn(msg, data),
  info: (data, msg) => console.info(msg, data)
};

/**
 * Run one Google API operation, retrying ONCE on a 401 after forcing a token refresh.
 * Mirrors the standard expired-access-token recovery: the cached token may have been revoked
 * or expired between the >60s freshness check and the call. `GoogleApiError.statusCode` is the
 * 401 signal (see google-api-client.ts). Any non-401 error propagates to the per-section catch.
 */
async function withTokenRetry<T>(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps,
  initialToken: string,
  op: (token: string) => Promise<T>
): Promise<{ result: T; token: string }> {
  try {
    return { result: await op(initialToken), token: initialToken };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 401) throw error;
    const refreshed = await deps.getFreshAccessToken(scopedDb, { force: true });
    return { result: await op(refreshed), token: refreshed };
  }
}

function mapEventTimes(side: GoogleCalendarEvent["start"]): string {
  return side?.dateTime ?? (side?.date ? `${side.date}T00:00:00.000Z` : new Date(0).toISOString());
}

export async function runGoogleSync(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps
): Promise<GoogleSyncResult> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_SYNC_LOGGER;
  const calendarRepo = deps.calendarRepository ?? new CalendarRepository();
  const emailRepo = deps.emailRepository ?? new EmailRepository();
  const errors: string[] = [];
  let calendarUpserted = 0;
  let emailUpserted = 0;
  let emailFailures = 0;
  let escalations = 0;
  let truncated = false;

  const account = await deps.getActiveAccount(scopedDb);
  if (!account) {
    return { calendarUpserted: 0, emailUpserted: 0, errors: ["no-active-connection"] };
  }

  let accessToken: string;
  try {
    accessToken = await deps.getFreshAccessToken(scopedDb);
  } catch {
    // Never log the underlying auth error object (may carry client_secret/refresh_token).
    logger.warn({ actorScoped: true, stage: "auth" }, "google-sync auth failed");
    return { calendarUpserted: 0, emailUpserted: 0, errors: ["auth-error"] };
  }

  // --- Calendar (independent of email; one failing does not abort the other) ---
  if (account.scopes.includes(CALENDAR_SCOPE) || account.scopes.includes("calendar")) {
    try {
      const ref = now().getTime();
      const { result: events, token: rotated } = await withTokenRetry(
        scopedDb,
        deps,
        accessToken,
        (token) =>
          deps.googleClient.listCalendarEvents({
            accessToken: token,
            calendarId: "primary",
            timeMin: new Date(ref - CALENDAR_WINDOW_PAST_MS).toISOString(),
            timeMax: new Date(ref + CALENDAR_WINDOW_FUTURE_MS).toISOString()
          })
      );
      accessToken = rotated; // carry a refreshed token forward to the email section
      for (const event of events) {
        if (!event.id) continue;
        await calendarRepo.upsertCachedEvent(scopedDb, {
          connectorAccountId: account.id,
          externalId: event.id,
          title: event.summary ?? "(no title)",
          startsAt: mapEventTimes(event.start),
          endsAt: mapEventTimes(event.end),
          location: event.location ?? null,
          summary: event.description ? event.description.slice(0, 2000) : null,
          externalMetadata: {
            status: event.status ?? null,
            htmlLink: event.htmlLink ?? null,
            attendeeCount: event.attendees?.length ?? 0
          }
        });
        calendarUpserted += 1;
      }
    } catch (error) {
      logger.warn(
        {
          stage: "calendar",
          name: (error as Error).name,
          status: (error as { statusCode?: number }).statusCode ?? null
        },
        "google-sync calendar failed"
      );
      errors.push("calendar-error");
    }
  }

  // --- Email (independent) ---
  if (account.scopes.includes(GMAIL_SCOPE) || account.scopes.includes("gmail")) {
    try {
      const { result: stubs, token: rotated } = await withTokenRetry(
        scopedDb,
        deps,
        accessToken,
        (token) => deps.googleClient.listMessageIds({ accessToken: token, query: EMAIL_QUERY })
      );
      accessToken = rotated;
      const capped = stubs.slice(0, EMAIL_MESSAGE_CAP);
      if (stubs.length > capped.length) truncated = true;

      // Skip-unchanged: external_metadata.historyId (Gmail per-message revision marker)
      // lets us avoid re-summarizing messages whose content hasn't changed since the last
      // sync — bounding LLM cost/latency without a separate revision store (spec risk #6).
      // We track BOTH the prior historyId and whether a usable summary already exists, so a
      // message cached before a model was configured is still summarized on a later sync.
      const existing = await emailRepo.listSyncMarkers(scopedDb, account.id);
      const seen = new Map(
        existing.map((r) => [r.externalId, { historyId: r.historyId, hasSummary: r.hasSummary }])
      );

      for (const stub of capped) {
        try {
          const { result: full, token: rotatedMsg } = await withTokenRetry(
            scopedDb,
            deps,
            accessToken,
            (token) => deps.googleClient.getMessage({ accessToken: token, id: stub.id })
          );
          accessToken = rotatedMsg;
          const parsed = parseEmail(full);
          // Skip the (costly) LLM pass + re-upsert ONLY when this message's historyId is
          // unchanged AND a usable summary is already stored. A null-summary prior row (no model
          // at first sync, or a failed extraction) is intentionally NOT skipped, so it gets a
          // summary once a model is configured.
          const prior = seen.get(parsed.externalId);
          if (parsed.historyId && prior?.historyId === parsed.historyId && prior.hasSummary) {
            continue;
          }
          const extracted = await extractEmailSignals(parsed, deps.emailExtractDeps);
          if (extracted.escalated) escalations += 1;
          const { summary, signals } = extracted;
          // The full body lives only in `parsed.body` here; it is NEVER persisted — only the
          // model-derived summary + signals (+ snippet) are written, and body_excerpt is NOT
          // passed (stays null), so no body fragment lands in a column (privacy posture §6).
          await emailRepo.upsertCachedMessage(scopedDb, {
            connectorAccountId: account.id,
            externalId: parsed.externalId,
            sender: parsed.from,
            recipients: parsed.recipients,
            subject: parsed.subject,
            snippet: parsed.snippet,
            receivedAt: parsed.receivedAt,
            externalMetadata: { labelIds: parsed.labelIds, historyId: parsed.historyId ?? null },
            summary,
            signals
          });
          emailUpserted += 1;
        } catch (error) {
          emailFailures += 1;
          logger.warn(
            {
              stage: "email-message",
              name: (error as Error).name,
              status: (error as { statusCode?: number }).statusCode ?? null
            },
            "google-sync email message failed"
          );
          // Bounded error labels: record once, not one per message (keeps result metadata small).
          if (!errors.includes("email-message-error")) errors.push("email-message-error");
        }
      }
    } catch (error) {
      logger.warn(
        {
          stage: "email",
          name: (error as Error).name,
          status: (error as { statusCode?: number }).statusCode ?? null
        },
        "google-sync email failed"
      );
      errors.push("email-error");
    }
  }

  logger.info(
    {
      calendarUpserted,
      emailUpserted,
      emailFailures,
      escalations,
      truncated,
      errorCount: errors.length
    },
    "google-sync complete"
  );
  return { calendarUpserted, emailUpserted, emailFailures, escalations, errors, truncated };
}

export interface RegisterConnectorsJobWorkersDeps {
  readonly dataContext: DataContextRunner;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<GoogleSyncPayload>, result: GoogleSyncResult) => void;
  readonly logger?: SyncLogger;
}

export async function registerConnectorsJobWorkers(
  boss: PgBoss,
  deps: RegisterConnectorsJobWorkersDeps
): Promise<string[]> {
  const connectorsRepo = new ConnectorsRepository();
  const connectorCipher = createConnectorSecretCipher();
  const aiRepo = new AiRepository();
  const aiCipher = createAiSecretCipher();
  const googleService = new GoogleConnectionService({
    repository: connectorsRepo,
    cipher: connectorCipher,
    oauthClient: new GoogleOAuthClient()
  });
  const googleClient = new GoogleApiClient();

  const workId = await registerDataContextWorker<GoogleSyncPayload, GoogleSyncResult>(
    boss,
    GOOGLE_SYNC_QUEUE,
    deps.dataContext,
    async (job, scopedDb) => {
      const emailExtractDeps: EmailExtractDeps = {
        selectModel: (tier) => aiRepo.selectModelForCapability(scopedDb, "summarization", tier),
        runChat: async (model, prompt) => {
          // `model` is the AiConfiguredModelSafeRow returned by selectModelForCapability:
          // it carries provider_config_id, provider_kind, and provider_model_id directly
          // (verified: packages/ai/src/repository.ts AiConfiguredModelSafeRow). Load + decrypt
          // the provider credential in-process (never logged/forwarded), then call the adapter.
          const row = model as AiConfiguredModelSafeRow;
          const provider = await aiRepo.selectProviderWithCredential(
            scopedDb,
            row.provider_config_id
          );
          if (!provider) return { text: "" };
          const credential = aiCipher.decryptJson(provider.encrypted_credential) as {
            apiKey?: string;
          };
          if (!credential.apiKey) return { text: "" };
          const adapter = new HttpApiAdapter(
            row.provider_kind,
            credential.apiKey,
            provider.base_url ? { baseUrl: provider.base_url } : {}
          );
          return adapter.generateChat({
            model: {
              provider_kind: row.provider_kind,
              provider_model_id: row.provider_model_id
            },
            messages: [{ role: "user", content: prompt }]
          });
        }
      };

      const result = await runGoogleSync(scopedDb, {
        getActiveAccount: async (db) => {
          const secret = await connectorsRepo.getActiveGoogleAccountSecret(db);
          if (!secret) return undefined;
          const bundle = connectorCipher.decryptJson(
            secret.encryptedSecret
          ) as GoogleConnectionSecret;
          return { id: secret.id, scopes: bundle.grantedScopes ?? [] };
        },
        getFreshAccessToken: (db, opts) => googleService.getFreshAccessToken(db, opts),
        googleClient,
        emailExtractDeps,
        logger: deps.logger
      });

      deps.onResult?.(job, result);
      return result;
    },
    deps.workOptions
  );

  return [workId];
}
```

> Note the `selectModel`/`runChat` seam: `selectModel` returns the full `AiConfiguredModelSafeRow`
> (verified fields: `id`, `provider_config_id`, `provider_kind`, `provider_model_id`, `tier`,
> `capabilities` — `packages/ai/src/repository.ts`). The single `model as AiConfiguredModelSafeRow`
> cast bridges the abstract `EmailExtractDeps.selectModel` return type (`{ tier: string } | undefined`,
> kept minimal so tests need not construct a full row) to the concrete worker row. `runChat` uses
> `row.provider_config_id` for `selectProviderWithCredential` and `row.provider_kind` /
> `row.provider_model_id` directly. The AI credential decrypts to `{ apiKey?: string }` matching the
> `credentialPayload` the AI routes accept (`packages/shared/src/ai-api.ts:114`). No placeholders.

Run → **PASS** (handler tests green).

3. Commit:
   `git add packages/connectors/src/google-connection.ts packages/connectors/src/sync-jobs.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

## Group G — Route + sync-on-connect + registry wiring

### Task G1 — Shared sync route schema

**Files**

- Modify: `packages/shared/src/connectors-api.ts`
- Test: `tests/integration/google-sync.test.ts` (or a shared-schema assertion)

**Steps**

1. Add a failing test asserting the schema shape:

```ts
import { googleSyncRouteSchema, type GoogleSyncResponse } from "@jarv1s/shared";

it("exposes a 202 google-sync route schema with enqueued/deduped/jobId", () => {
  expect(googleSyncRouteSchema.response[202]).toBeDefined();
  const r: GoogleSyncResponse = { enqueued: true, deduped: false, jobId: "j" };
  expect(r.enqueued).toBe(true);
  const d: GoogleSyncResponse = { enqueued: false, deduped: true, jobId: null };
  expect(d.deduped).toBe(true);
});
```

Run → **FAIL**.

2. Append to `packages/shared/src/connectors-api.ts`:

```ts
export interface GoogleSyncResponse {
  /** True when a new job was enqueued; false when an in-flight sync already covers this actor. */
  readonly enqueued: boolean;
  /** True when this request was collapsed into an already-queued/running sync (singletonKey hit). */
  readonly deduped: boolean;
  readonly jobId: string | null;
}

export const googleSyncResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enqueued", "deduped", "jobId"],
  properties: {
    enqueued: { type: "boolean" },
    deduped: { type: "boolean" },
    jobId: { type: ["string", "null"] }
  }
} as const;

export const googleSyncRouteSchema = {
  response: { 202: googleSyncResponseSchema }
} as const;
```

Run → **PASS** + `pnpm typecheck`.

3. Commit:
   `git add packages/shared/src/connectors-api.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task G2 — Sync route + sync-on-connect + `boss` dependency

**Files**

- Modify: `packages/connectors/src/routes.ts`
- Modify: `packages/connectors/src/manifest.ts` (add the route entry)
- Test: `tests/integration/google-sync.test.ts` (route → 202 + enqueue; sync-on-connect best-effort)

**Steps**

1. Add a failing route test that registers connectors routes with a **fake boss** capturing `send`,
   resolves a stub AccessContext, POSTs the sync route, and asserts 202 + a single metadata-only enqueue;
   also assert the null-jobId dedupe path. (The bare `Fastify()` instance does not register
   `@fastify/rate-limit`; a route-level `config.rateLimit` is inert metadata without the plugin, so
   these tests exercise routing/enqueue only. The real limit is enforced in `apps/api/src/server.ts`,
   which registers the plugin globally and lets per-route `config.rateLimit` override — verified
   server.ts:104.)

```ts
import Fastify from "fastify";
import { registerConnectorsRoutes } from "@jarv1s/connectors";

function fakeBoss(captured: {
  sends: Array<{ queue: string; payload: unknown; options?: unknown }>;
}) {
  return {
    send: async (queue: string, payload: unknown, options?: unknown) => {
      captured.sends.push({ queue, payload, options });
      return "job-1";
    }
  } as never;
}

it("POST /api/connectors/google/sync enqueues one metadata-only job and returns 202", async () => {
  const captured = { sends: [] as Array<{ queue: string; payload: Record<string, unknown> }> };
  const server = Fastify();
  registerConnectorsRoutes(server, {
    resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "r" }),
    dataContext,
    boss: fakeBoss(captured)
  });
  await server.ready();
  const res = await server.inject({ method: "POST", url: "/api/connectors/google/sync" });
  expect(res.statusCode).toBe(202);
  const body = JSON.parse(res.body);
  expect(body.enqueued).toBe(true);
  expect(body.deduped).toBe(false);
  expect(captured.sends).toHaveLength(1);
  expect(captured.sends[0]!.queue).toBe("connectors.google-sync");
  expect(Object.keys(captured.sends[0]!.payload).sort()).toEqual([
    "actorUserId",
    "idempotencyKey",
    "kind"
  ]);
  await server.close();
});

it("returns enqueued=false/deduped=true when an actor sync is already in flight (null jobId)", async () => {
  // A singletonKey collision makes sendJob resolve to null (briefings precedent,
  // packages/jobs/src/pg-boss.ts). The route must report dedupe, NOT a phantom enqueue.
  const server = Fastify();
  registerConnectorsRoutes(server, {
    resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "r" }),
    dataContext,
    boss: { send: async () => null } as never
  });
  await server.ready();
  const res = await server.inject({ method: "POST", url: "/api/connectors/google/sync" });
  expect(res.statusCode).toBe(202);
  const body = JSON.parse(res.body);
  expect(body.enqueued).toBe(false);
  expect(body.deduped).toBe(true);
  expect(body.jobId).toBeNull();
  await server.close();
});
```

Run → **FAIL**.

2. Modify `packages/connectors/src/routes.ts`:
   - Import `sendJob` from `@jarv1s/jobs`, `GOOGLE_SYNC_QUEUE` from `./sync-jobs.js`,
     `googleSyncRouteSchema` from `@jarv1s/shared`, `randomUUID` from `node:crypto`, and `PgBoss` type.
   - Add `readonly boss: PgBoss;` to `ConnectorsRoutesDependencies`.
   - Reuse the existing `parsePositiveIntEnv` helper (already in this file for `JARVIS_RL_OAUTH_MAX`,
     routes.ts:79) to add a sync-specific rate limit, mirroring the `/complete` precedent:

```ts
const syncMax = parsePositiveIntEnv(process.env.JARVIS_RL_GOOGLE_SYNC_MAX, 6);
```

- Add the route inside `registerConnectorsRoutes`, applying the rate limit via `config` exactly
  like `/complete` (routes.ts:85), and mapping a null jobId (singletonKey collision) to a dedupe
  response rather than a phantom enqueue:

```ts
server.post(
  "/api/connectors/google/sync",
  {
    schema: googleSyncRouteSchema,
    config: { rateLimit: { max: syncMax, timeWindow: "1 minute" } }
  },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const idempotencyKey = randomUUID();
      const jobId = await sendJob(
        dependencies.boss,
        GOOGLE_SYNC_QUEUE,
        { actorUserId: accessContext.actorUserId, kind: "google-sync" as const, idempotencyKey },
        // Per-actor singletonKey: a manual click racing sync-on-connect (or a second click)
        // collapses to one in-flight job. A null jobId means the collision happened — report
        // dedupe, not a fresh enqueue (briefings null-jobId precedent, routes.ts:158).
        { singletonKey: accessContext.actorUserId }
      );
      return reply.code(202).send({
        enqueued: jobId !== null,
        deduped: jobId === null,
        jobId
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

- Add sync-on-connect inside the `/complete` handler, after the account is created and **before**
  returning, wrapped best-effort so a send failure never fails the connect response:

```ts
const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
  googleService.completeAuthorization(scopedDb, { redirectUrl })
);
try {
  await sendJob(
    dependencies.boss,
    GOOGLE_SYNC_QUEUE,
    {
      actorUserId: accessContext.actorUserId,
      kind: "google-sync" as const,
      idempotencyKey: randomUUID()
    },
    { singletonKey: accessContext.actorUserId }
  );
} catch (error) {
  // best-effort: the user can sync manually if the enqueue fails. Log a sanitized,
  // structured event (name only — never the error object, which may carry connection
  // strings) so a swallowed enqueue is still observable (Codex observability finding).
  request.log.warn(
    { event: "connectors.sync_on_connect_enqueue_failed", name: (error as Error).name },
    "sync-on-connect enqueue failed; user can sync manually"
  );
}
return reply.code(201).send({ account: serializeAccount(account) });
```

3. Add the route to `packages/connectors/src/manifest.ts` `routes`:

```ts
    {
      method: "POST",
      path: "/api/connectors/google/sync",
      responseSchema: googleSyncResponseSchema,
      permissionId: "connectors.manage"
    },
```

(Import `googleSyncResponseSchema` in the manifest's `@jarv1s/shared` import block.)

Run → **PASS**.

4. Commit:
   `git add packages/connectors/src/routes.ts packages/connectors/src/manifest.ts tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task G3 — Module-registry wiring (queue + workers + boss-bearing route registration)

**Files**

- Modify: `packages/module-registry/src/index.ts`
- Modify: `apps/worker/package.json`
- Test: existing registry/worker tests + `tests/integration/google-sync.test.ts` queue-presence check

**Steps**

1. Add a failing test that `getAllQueueDefinitions()` includes the google-sync queue:

```ts
import { getAllQueueDefinitions } from "@jarv1s/module-registry";

it("registers the connectors.google-sync queue globally", () => {
  const names = getAllQueueDefinitions().map((q) => q.name);
  expect(names).toContain("connectors.google-sync");
});
```

Run → **FAIL**.

2. In `packages/module-registry/src/index.ts`:
   - Add imports from `@jarv1s/connectors`:
     `GOOGLE_SYNC_QUEUE_DEFINITIONS`, `registerConnectorsJobWorkers`.
   - Replace the connectors registration block so it declares the queue, passes `boss` to the route, and
     registers the worker:

```ts
  {
    manifest: connectorsModuleManifest,
    sqlMigrationDirectories: [connectorsModuleSqlMigrationDirectory],
    queueDefinitions: GOOGLE_SYNC_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerConnectorsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss
      }),
    registerWorkers: (boss, deps) =>
      registerConnectorsJobWorkers(boss, { dataContext: deps.dataContext })
  },
```

> `GOOGLE_SYNC_QUEUE_DEFINITIONS` is `readonly QueueDefinition[]`; the field type already matches.
> Adding it to `queueDefinitions` puts the queue in `getAllQueueDefinitions()`, so `pnpm db:migrate`
> creates it and the worker startup guard (`apps/worker/src/worker.ts:61`) passes.

3. Add worker deps to `apps/worker/package.json` `dependencies`:

```json
    "@jarv1s/ai": "workspace:*",
    "@jarv1s/calendar": "workspace:*",
    "@jarv1s/connectors": "workspace:*",
    "@jarv1s/db": "workspace:*",
    "@jarv1s/email": "workspace:*",
    "@jarv1s/jobs": "workspace:*",
    "@jarv1s/memory": "workspace:*",
    "@jarv1s/module-registry": "workspace:*"
```

Run `pnpm install`, then `pnpm db:migrate && pnpm test:integration -- tests/integration/google-sync.test.ts` → **PASS**.

4. Commit:
   `git add packages/module-registry/src/index.ts apps/worker/package.json pnpm-lock.yaml tests/integration/google-sync.test.ts`
   then `git commit`.

---

### Task G4 — Document worker secret-env requirement

**Files**

- Modify: `docs/operations/dev-environment.md`
- Test: none (doc); validated by `pnpm format:check` in the gate

**Steps**

1. Add a subsection to `docs/operations/dev-environment.md` stating the worker process must export both
   `JARVIS_CONNECTOR_SECRET_KEY` (decrypts the Google OAuth bundle) **and** `JARVIS_AI_SECRET_KEY`
   (decrypts the AI provider credential), and that these MUST match the API process's values or
   decryption fails (surfaced as a sync error label, not a crash — spec risk #4). Note the compose/worker
   env should carry both. Also document the new optional tuning knobs (with defaults), so an operator can
   bound sync cost/latency without code changes:
   - `JARVIS_RL_GOOGLE_SYNC_MAX` (default 6/min) — per-actor rate limit on the manual sync route.
   - `JARVIS_EMAIL_SYNC_CAP` (default 50) — max messages summarized per sync.
   - `JARVIS_EMAIL_LLM_TIMEOUT_MS` (default 20000) — per-LLM-call timeout.
   - `JARVIS_EMAIL_ESCALATE_CONFIDENCE` (default 0.5) — confidence floor below which a high-importance
     message escalates once to the next tier.

2. Run `pnpm format:check` (fix with `pnpm format` if needed).

3. Commit: `git add docs/operations/dev-environment.md` then `git commit`.

---

## Group DG — Design pre-gate deliverables (token scaffolding + primitives + mockups)

> This group is the **presentation foundation** the Calendar/Email pages (Group H) consume, per the
> sibling design-direction spec. It is **taste-neutral scaffolding only** — it restyles **no** screen.
> The app-wide restyle + the real Calendar/Email pages run **after** Ben signs off the mockups. This
> group can run in parallel with Groups A–G (no shared files).
>
> **Hard taste-lock (from `docs/brand/visual-language-research.md`, Direction 3 "Ritual"):** no
> purple/blue AI-glow gradients, no sparkle/magic-wand icons, no mascots/therapeutic softness, no
> chat-first dominance, no horizontal pagination.

### Task DG1 — `tokens.css` semantic token layer + styles.css split

**Files**

- Create: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles.css` (replace hex with `var()`; extract tokens out)
- Modify: `apps/web/src/main.tsx` (import `tokens.css` first)
- Test: `pnpm check:file-size` + a grep assertion (manual command in steps)

**Steps**

1. Establish the failing condition objectively: run
   `grep -rE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'` and confirm matches exist
   **outside** `tokens.css` today (they do: `styles.css`, `tasks.css`). The target end-state (acceptance
   criterion DG) is that hex/`rgb()` appear **only** in `tokens.css`. Run `pnpm check:file-size` to note
   `styles.css` is near the cap (~952 lines).

2. Create `apps/web/src/styles/tokens.css` with the three tiers. Define **every** custom property the app
   references today — the nine existing `:root` tokens from `styles.css` (`--accent`, `--accent-strong`,
   `--border`, `--danger`, `--ink`, `--muted`, `--panel`, `--panel-subtle`, `--warning`) **and** the five
   `tasks.css` leaves undefined (`--text-muted`, `--surface-subtle`, `--surface-active`,
   `--border-subtle`, `--border`) — plus the Ritual semantic tokens (`--surface`, `--surface-raised`,
   `--text`, `--text-muted`, `--border-default`, `--state-attention`, `--state-recovery`,
   `--provisional-opacity` ≈ `0.7`, and `--bucket-morning`/`--bucket-afternoon`/`--bucket-evening`). Hex
   literals live **only here**. Author light theme in `:root` plus `[data-theme="dark"]` and
   `[data-theme="amber"]` overlays that re-point **semantic** tokens (ship light-first, no toggle).
   Keep the file under 1000 lines.

3. Edit `apps/web/src/styles.css`: remove the `:root` token block (now in `tokens.css`) and replace all
   hardcoded hex/`rgb()` with the semantic `var()` names. Confirm the file drops below 1000 lines.

4. Edit `apps/web/src/main.tsx` import order so tokens resolve first:

```ts
import "./styles/tokens.css";
import "./styles.css";
import "./tasks/tasks.css";
```

5. Run: `pnpm check:file-size` (PASS — every CSS file <1000 lines) and
   `grep -rE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'` returns matches **only** under
   `apps/web/src/styles/tokens.css`. Run `pnpm lint && pnpm format:check && pnpm typecheck`.

6. Commit:
   `git add apps/web/src/styles/tokens.css apps/web/src/styles.css apps/web/src/main.tsx`
   then `git commit`.

### Task DG2 — `ui/` presentational primitives

**Files**

- Create: `apps/web/src/ui/card.tsx`, `apps/web/src/ui/badge.tsx`,
  `apps/web/src/ui/provisional-region.tsx`, `apps/web/src/ui/time-bucket.tsx`
- Test: `pnpm typecheck` (these are pure presentational components — typecheck is the gate; an e2e in
  Group H exercises rendering)

**Steps**

1. Create 4–6 small typed, presentational React components consuming only `tokens.css` class names /
   inline `var()`. No API client imports, no `@jarv1s/shared` data DTOs, no hooks beyond layout:
   - `Card`, `Stack`, `SectionHeader` (in `card.tsx`).
   - `Badge` with a `tone: "neutral" | "accent" | "attention" | "recovery"` prop mapping to semantic
     state tokens — **never** an error-red tone for normal drift.
   - `ProvisionalRegion` — wraps children at `opacity: var(--provisional-opacity)` with an accessible
     "provisional — not yet confirmed" label (the governor pattern).
   - `TimeBucket` — a chronology section header ("This Morning"/"This Afternoon"/"This Evening") with the
     matching `--bucket-*` accent.

2. Run `pnpm typecheck && pnpm lint && pnpm format:check` → PASS.

3. Commit:
   `git add apps/web/src/ui/card.tsx apps/web/src/ui/badge.tsx apps/web/src/ui/provisional-region.tsx apps/web/src/ui/time-bucket.tsx`
   then `git commit`.

### Task DG3 — Static HTML mockups (the taste-gate artifact)

**Files**

- Create: `docs/brand/mockups/briefing-reading.html`,
  `docs/brand/mockups/day-view-timebuckets.html`, `docs/brand/mockups/form-heavy.html`
- Test: none (visual artifact); `pnpm format:check` may ignore HTML — confirm and don't fight it

**Steps**

1. Create 2–3 self-contained static HTML files with inline `<style>` reusing the **same** token names as
   `tokens.css` (so sign-off transfers to implementation). No build step; openable directly in a browser:
   (1) briefing editorial single-column reading view; (2) tasks/day view with This Morning / This
   Afternoon / This Evening time-buckets, circadian accents, and a 70%-opacity governor provisional block;
   (3) one form-heavy screen (settings or auth). Honor the HARD STOP list.

2. Run `pnpm lint && pnpm format:check` to confirm the repo gate is unaffected by the new HTML (adjust
   only if a formatter actually targets `.html` — do not introduce new tooling).

3. Commit:
   `git add docs/brand/mockups/briefing-reading.html docs/brand/mockups/day-view-timebuckets.html docs/brand/mockups/form-heavy.html`
   then `git commit`.

---

## >>> AWAIT BEN'S MOCKUP SIGN-OFF <<<

**HARD STOP. Do not proceed to Group H (or any app-wide CSS restyle) until Ben has reviewed the mockups
under `docs/brand/mockups/` and explicitly approved the visual direction.**

- The overnight deliverable up to this point is: this plan + the pre-gate scaffolding (Groups A–G code,
  `tokens.css`, the `styles.css` split, the `ui/` primitives, the mockups) — **none of which restyles a
  screen**.
- An autonomous overnight build MUST pause here. Surface the mockup file paths and the request for
  sign-off (e.g. via `herdr-pane-message` to the coordinator / Ben), then **stop**. The post-gate tasks
  (Group H — the real Calendar/Email pages and their styling, plus any coherent restyle of existing
  screens) run only after explicit approval.
- If the build cannot obtain sign-off in-session, it commits everything through Task DG3, records the
  pending gate, and ends the run. **Do not implement Group H speculatively.**

---

## Group H — Web: Calendar + Email pages (post-gate)

> Runs **only after** the sign-off gate. These pages are built against the approved `tokens.css` +
> `ui/` primitives. Pure presentation over the existing typed client; no module-internal coupling.

### Task H1 — `syncGoogleConnector()` client fetcher

**Files**

- Modify: `apps/web/src/api/client.ts`
- Test: covered by the e2e in H4 (the fetcher is a thin `requestJson` wrapper); add a typecheck-level use

**Steps**

1. Add to `apps/web/src/api/client.ts` (near the other connector/calendar fetchers), importing
   `GoogleSyncResponse` from `@jarv1s/shared`:

```ts
export async function syncGoogleConnector(): Promise<GoogleSyncResponse> {
  return requestJson<GoogleSyncResponse>("/api/connectors/google/sync", { method: "POST" });
}
```

2. Run `pnpm typecheck` → PASS.

3. Commit: `git add apps/web/src/api/client.ts` then `git commit`.

### Task H2 — Calendar page (real React-Query, grouped by day)

**Files**

- Create: `apps/web/src/calendar/calendar.css`
- Modify: `apps/web/src/calendar/calendar-page.tsx`
- Test: e2e in H4

**Steps**

1. Rebuild `apps/web/src/calendar/calendar-page.tsx` mirroring the `notifications-page.tsx` data-page
   pattern: `useQuery({ queryKey: queryKeys.calendar.list, queryFn: listCalendarEvents })`, loading/empty/
   error states, events grouped by day showing title, time, location. Consume `Card`/`Stack`/
   `SectionHeader` from `apps/web/src/ui/` and tokens from `calendar.css`. (Both `queryKeys.calendar.list`
   and `listCalendarEvents` already exist.)

2. Create `apps/web/src/calendar/calendar.css` (tokens only; no hex) and import it in `calendar-page.tsx`.

3. Run `pnpm lint && pnpm format:check && pnpm typecheck && pnpm check:file-size` → PASS.

4. Commit:
   `git add apps/web/src/calendar/calendar-page.tsx apps/web/src/calendar/calendar.css`
   then `git commit`.

### Task H3 — Email triage page (summary + signals, no body) + Sync now

**Files**

- Create: `apps/web/src/email/email.css`
- Modify: `apps/web/src/email/email-page.tsx`
- Test: e2e in H4

**Steps**

1. Rebuild `apps/web/src/email/email-page.tsx`: `useQuery({ queryKey: queryKeys.email.list, queryFn:
listEmailMessages })`; render each message as a **triage card** (sender, subject, received time, and
   the `summary` + `signals` — bills due with amounts/dates, action items, deadlines, a "may get lost"
   flag, importance, confidence) — **never the raw body** (there is none in the DTO). Add a "Sync now"
   button: `useMutation({ mutationFn: syncGoogleConnector, onSuccess: invalidate queryKeys.email.list })`
   (also invalidate `queryKeys.calendar.list`). Render AI-derived summary/signals inside
   `ProvisionalRegion` (the governor pattern) and use `Badge` tones — never error-red for normal triage.

2. Create `apps/web/src/email/email.css` (tokens only) and import it.

3. Run `pnpm lint && pnpm format:check && pnpm typecheck && pnpm check:file-size` → PASS.

4. Commit:
   `git add apps/web/src/email/email-page.tsx apps/web/src/email/email.css`
   then `git commit`.

### Task H4 — e2e: Calendar + Email pages with mocked REST

**Files**

- Create: `tests/e2e/mock-calendar-email-api.ts`
- Create: `tests/e2e/calendar-email.spec.ts`
- Test: `pnpm test:e2e -- calendar-email.spec.ts`

**Steps**

1. Write `tests/e2e/mock-calendar-email-api.ts` mirroring `tests/e2e/mock-connectors-api.ts`: mock
   `GET /api/calendar/events` (one event), `GET /api/email/messages` (one message with `summary` +
   `signals`, **no body field**), and `POST /api/connectors/google/sync` returning 202 with the FULL
   current schema `{ enqueued: true, deduped: false, jobId: "job-e2e" }` (all three keys are
   `required` in `googleSyncResponseSchema` — a mock missing `deduped` would drift from the contract).

2. Write `tests/e2e/calendar-email.spec.ts`: sign in (reuse the existing harness pattern from
   `app-shell.spec.ts`), navigate to `/calendar` → assert the event renders (title/time); navigate to
   `/email` → assert the summary + a signal render and assert **no** raw body text is present; click
   "Sync now" → assert the sync route is POSTed and the list refetches.

   Run → write the spec to **FAIL** first (pages not yet asserted), then confirm **PASS** after H2/H3.

3. Run `pnpm test:e2e -- calendar-email.spec.ts` → PASS. Confirm existing e2e suites still pass
   (`pnpm test:e2e`).

4. Commit:
   `git add tests/e2e/mock-calendar-email-api.ts tests/e2e/calendar-email.spec.ts`
   then `git commit`.

---

## Group I — Self-review + final gate

### Task I1 — Self-Review (spec §-by-§ coverage, placeholder scan, type consistency)

Do this as a written review pass (no code unless it finds a gap; if it does, fix + commit with explicit
`git add`).

**A. Spec §-by-§ coverage (every spec component + acceptance criterion):**

| Spec ref                                  | Covered by     | Verify                                                                                         |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| Component 1 (Google API client)           | D1             | request shapes, paging, 401-detect via `GoogleApiError.statusCode`, no body in `Error.message` |
| Component 2 (email-extract)               | E2, E3         | MIME parse + LLM pass + one escalation + defensive parse                                       |
| Component 3 (sync job + handler)          | F1, F2         | exclusive queue, metadata-only payload, partial-success                                        |
| Component 4 (route + on-connect)          | G2             | 202 enqueue, sync-on-connect best-effort, scheduler seam doc                                   |
| Component 5 (calendar upsert + migration) | A2, B1         | onConflict, identity trigger preserved, worker grant + relax                                   |
| Component 6 (email columns + upsert)      | A1, A3, C1, C2 | columns, upsert, DTO/serializer, no body column                                                |
| Component 7 (RLS provider_type relax)     | A2, A3         | scope-gated `'google'` branch, owner-equality verbatim, negative tests                         |
| Component 8 (web pages)                   | DG1–3, H1–H4   | tokens-first, primitives, triage view, e2e, no body                                            |
| Component 9 (worker wiring)               | G3, G4         | queue in `getAllQueueDefinitions`, worker deps, secret env doc                                 |
| Acceptance #1–13                          | mapped above   | each has a passing test or a doc artifact                                                      |

Confirm acceptance #13 (scheduler seam): the payload is metadata-only + idempotent and `runGoogleSync`
needs no caller-specific state, so a future cron enqueues the identical job with no change — **documented
in G2's seam note; no cron built.**

**B. Placeholder scan:** grep the new/modified files for `TODO`, `FIXME`, `placeholder`, `as never`
(justify each remaining cast against the real field names), `any`, `// ...`, and stub bodies:

```
grep -rnE 'TODO|FIXME|placeholder|XXX|\bany\b|// \.\.\.' \
  packages/connectors/src/google-api-client.ts \
  packages/connectors/src/email-extract.ts \
  packages/connectors/src/sync-jobs.ts \
  packages/connectors/src/routes.ts \
  packages/calendar/src/repository.ts \
  packages/email/src/repository.ts
```

Replace any remaining placeholder with real code. Confirm the verified
`AiConfiguredModelSafeRow` field names used in F2's `runChat`
(`provider_config_id` / `provider_model_id` / `provider_kind`, per `packages/ai/src/repository.ts`)
still match HEAD; the only intentional cast is the single `model as AiConfiguredModelSafeRow` bridging the
deliberately-minimal `EmailExtractDeps.selectModel` return type — no `as never`/`as { … }` guesses.

**C. Type consistency:**

- `EmailMessageDto.signals` (shared) ↔ `EmailSignals` (connectors) ↔ `signals jsonb` (DB) are all
  `Record<string, unknown>`-compatible objects; the serializer passes the row's `signals` straight
  through.
- `GoogleSyncResult` is metadata-only (counts + string labels) — no token/secret field.
- `GoogleSyncPayload` keys ⊆ `ALLOWED_PAYLOAD_KEYS`.

**D. Hard-Invariant audit (state each as honored):** no admin bypass / private by default (RLS
owner-equality preserved verbatim, no `BYPASSRLS`); DataContextDb-only (every repo call asserts; no root
handle; no `fs`; body held in memory and discarded — never vault/relational); AccessContext shape
unchanged; secrets never escape (no body/secret/token in logs, payloads, results, or `Error.message`);
metadata-only payloads; provider-agnostic AI (capability-routed, no hardcoded provider/model); module
isolation (connectors writes calendar/email only via public `upsert*`); never edit applied migrations
(all new 0065–0068, owner-scoped expressions copied verbatim); pgvector image untouched.

**E. Independent security-review gate (BLOCKING, not just a PR reminder).** Migrations 0065/0067/0068
edit RLS on personal-data tables, so this slice MUST NOT be marked done until an independent reviewer
(the `/security-review` skill or a fresh-model critic — per CLAUDE.md "CI-green ≠ secure") signs off on
the policy diffs. Work the following checklist explicitly and record each item's outcome in the PR body
(treat any unchecked box as a merge blocker):

- [ ] Every relaxed INSERT `WITH CHECK` still pins `owner_user_id = app.current_actor_user_id()`
      (compared line-by-line against 0011/0020 for calendar and 0012/0021 for email).
- [ ] The `provider_type = 'google'` INSERT branch is scope-gated (`'…/calendar'` for calendar events,
      `'…/gmail.modify'` for email) and the `'calendar'`/`'email'` legacy branch is preserved verbatim.
- [ ] Adding `jarvis_worker_runtime` to SELECT widens read **only** to the owner — the recreated SELECT
      `USING` clauses are byte-for-byte the owner-or-share expressions from 0020/0021, with no new arm.
- [ ] `connector_accounts` stays OWNER-ONLY (no `app.has_share` arm added; no INSERT grant to the worker).
- [ ] The negative scope-guard tests (A2/A3) actually fail-closed (seeded under `ids.userB`, scopes
      asserted before the rejected insert).
- [ ] Full-body privacy posture holds: the sentinel-body test proves the body appears in NO column;
      `body_excerpt` stays null; bodies transit only the user's own configured economy model, are never
      written to vault/memory/relational storage, and never appear in logs, job payloads, or results.

The PR description MUST state this gate's outcome and explicitly request the independent review before
merge. If the scan or review finds any gap, fix it, then commit with an explicit `git add <paths>`.

### Task I2 — Final `pnpm verify:foundation` gate

**Steps**

1. Ensure the tree is clean of unrelated changes (`git status`); confirm Postgres is up (`pnpm db:up`).

2. Run the full gate with a real exit code (never `| tail`):

```
pnpm verify:foundation
```

This runs `lint → format:check → check:file-size → typecheck → test:unit → db:migrate →
   test:integration`. All must pass.

3. Run `pnpm audit:release-hardening` → green.

4. Run `pnpm test:e2e` → green (Calendar/Email + existing suites).

5. **Independent security review (BLOCKING).** Run `/security-review` (or dispatch a fresh-model critic)
   over the migration diffs and the sync handler, and complete the I1.E checklist in the PR body. The
   slice is NOT done until this review signs off — a green gate alone is insufficient for RLS/secret
   changes (CLAUDE.md grounding discipline). Address any finding (TDD), commit, and re-run the gate.

6. If any step fails, fix it (TDD: failing test → fix → rerun), commit the fix with an explicit
   `git add <paths>`, and re-run the **entire** gate from step 2. Do not claim done until the full gate
   exits 0.

7. Final commit only if fixes were made; otherwise the gate is already green on the last feature commit.

---

## Self-Review (plan-level)

- **Spec coverage:** every numbered Component (1–9) and Acceptance criterion (1–13) of the
  connector-sync spec maps to a task in Groups A–I (table in Task I1). The design-direction sibling spec's
  pre-gate deliverables (tokens.css, styles.css split, `ui/` primitives, mockups) + the explicit
  `AWAIT BEN'S MOCKUP SIGN-OFF` gate before any restyle are covered by Group DG + the HARD STOP section.
- **Placeholder scan:** no `TODO`/`FIXME`/stub bodies in the plan's code blocks; every code block is
  complete and runnable. The two `as`-casts in F2 (`runChat`) carry an explicit build-time instruction to
  replace them with the real `AiConfiguredModelSafeRow` field names (verified in I1.B) — flagged, not left
  ambiguous.
- **Type consistency:** `signals` is `Record<string, unknown>`/object across DB column, `EmailSignals`,
  and `EmailMessageDto`; `GoogleSyncPayload` keys ⊆ `ALLOWED_PAYLOAD_KEYS`; `GoogleSyncResult` is
  metadata-only.
- **Hard Invariants:** RLS migrations are additive with owner-equality copied verbatim; DataContextDb-only;
  metadata-only payloads; provider-agnostic AI; module isolation via public repo methods; no edited
  applied migrations; full body never persisted.
- **Dependency order:** A (DB) → B/C (repos) → D/E (client/extract) → F (handler) → G (route/wiring) →
  DG (parallel, pre-gate) → SIGN-OFF → H (web) → I (review/gate). Each task is independently testable and
  committed with explicit `git add`.
