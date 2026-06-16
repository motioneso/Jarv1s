# Settings Locale Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/me/locale` + `PUT /api/me/locale` routes backed by `app.preferences`, and wire the three locale selects in `GeneralPane` to them via React Query.

**Architecture:** Locale settings are stored as a single `"locale"` key in the existing `app.preferences` KV table (via `PreferencesRepository` from `@jarv1s/structured-state`). The settings module grows two routes; the frontend replaces uncontrolled selects with a controlled `useQuery`/`useMutation` pair. Quiet-hours controls are **NOT touched** (that is issue #250).

**Tech Stack:** Fastify 5, Kysely, `@jarv1s/structured-state` PreferencesRepository, React Query v5, TypeScript

---

## File Map

| File                                                     | Action | What changes                                                                                                   |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/platform-api.ts`                    | Modify | Add `LocaleSettingsDto`, request/response types, route schemas                                                 |
| `packages/shared/src/index.ts`                           | Modify | Re-export new locale types (via `platform-api.*`) — **already covered by `export * from "./platform-api.js"`** |
| `packages/settings/package.json`                         | Modify | Add `"@jarv1s/structured-state": "workspace:*"` dependency                                                     |
| `packages/settings/src/routes.ts`                        | Modify | Import `PreferencesRepository`; add GET + PUT `/api/me/locale` handlers                                        |
| `packages/settings/src/manifest.ts`                      | Modify | Register the two new routes so the route-guard knows about them                                                |
| `tests/integration/settings-locale.test.ts`              | Create | Full-server integration tests for GET + PUT locale routes                                                      |
| `apps/web/src/api/client.ts`                             | Modify | Add `getLocaleSettings()` and `putLocaleSettings()` client functions                                           |
| `apps/web/src/api/query-keys.ts`                         | Modify | Add `locale: ["me", "locale"]` key                                                                             |
| `apps/web/src/settings/settings-personal-data-panes.tsx` | Modify | Wire locale selects; remove `BACKEND-TODO` comment + `NotWired` banner                                         |
| `docs/settings-design-backend-followups.md`              | Modify | Tick the locale checkbox                                                                                       |

---

### Task 1: Locale types + route schemas in `@jarv1s/shared`

**Files:**

- Modify: `packages/shared/src/platform-api.ts`

- [ ] **Step 1: Add locale types to platform-api.ts**

Open `packages/shared/src/platform-api.ts` and append at the bottom:

```typescript
// ── Locale settings ──────────────────────────────────────────────────────────

export interface LocaleSettingsDto {
  readonly timezone: string;
  readonly region: string;
  readonly dateFormat: "24" | "12";
}

export interface GetLocaleSettingsResponse {
  readonly locale: LocaleSettingsDto;
}

export interface PutLocaleSettingsRequest {
  readonly timezone: string;
  readonly region: string;
  readonly dateFormat: "24" | "12";
}

const localeSettingsDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timezone", "region", "dateFormat"],
  properties: {
    timezone: { type: "string" },
    region: { type: "string" },
    dateFormat: { type: "string", enum: ["24", "12"] }
  }
} as const;

const getLocaleSettingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["locale"],
  properties: { locale: localeSettingsDtoSchema }
} as const;

const putLocaleSettingsRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timezone", "region", "dateFormat"],
  properties: {
    timezone: { type: "string", minLength: 1, maxLength: 100 },
    region: { type: "string", minLength: 1, maxLength: 50 },
    dateFormat: { type: "string", enum: ["24", "12"] }
  }
} as const;

export const getLocaleSettingsRouteSchema = {
  response: { 200: getLocaleSettingsResponseSchema }
} as const;

export const putLocaleSettingsRouteSchema = {
  body: putLocaleSettingsRequestSchema,
  response: { 200: getLocaleSettingsResponseSchema }
} as const;
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd packages/shared && pnpm typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/platform-api.ts
git commit -m "feat(shared): add LocaleSettingsDto + route schemas for locale settings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Settings package — add structured-state dep + locale routes

**Files:**

- Modify: `packages/settings/package.json`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/settings/src/manifest.ts`

- [ ] **Step 1: Add @jarv1s/structured-state to settings package.json**

In `packages/settings/package.json`, add to `"dependencies"`:

```json
"@jarv1s/structured-state": "workspace:*"
```

Full dependencies block after change:

```json
"dependencies": {
  "@jarv1s/db": "workspace:*",
  "@jarv1s/module-sdk": "workspace:*",
  "@jarv1s/shared": "workspace:*",
  "@jarv1s/structured-state": "workspace:*",
  "fastify": "^5.6.2",
  "kysely": "^0.29.2"
}
```

Then install:

```bash
pnpm install
```

- [ ] **Step 2: Import PreferencesRepository + locale schemas in routes.ts**

At the top of `packages/settings/src/routes.ts`, add two imports:

After the existing `@jarv1s/shared` import block, add:

```typescript
import {
  getLocaleSettingsRouteSchema,
  putLocaleSettingsRouteSchema,
  type PutLocaleSettingsRequest,
  type LocaleSettingsDto
} from "@jarv1s/shared";
```

After the existing `@jarv1s/module-sdk` import, add:

```typescript
import { PreferencesRepository } from "@jarv1s/structured-state";
```

- [ ] **Step 3: Add the locale constant + instantiation inside registerSettingsRoutes**

At the top of the `registerSettingsRoutes` function body (right after `const repository = ...` and `const bootstrapHelper = ...`), add:

```typescript
const prefsRepository = new PreferencesRepository();
const LOCALE_KEY = "locale";
const LOCALE_DEFAULTS: LocaleSettingsDto = {
  timezone: "America/Los_Angeles",
  region: "en-US",
  dateFormat: "24"
};

function resolveLocale(raw: unknown): LocaleSettingsDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return LOCALE_DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    timezone:
      typeof r["timezone"] === "string" && r["timezone"].length > 0
        ? r["timezone"]
        : LOCALE_DEFAULTS.timezone,
    region:
      typeof r["region"] === "string" && r["region"].length > 0
        ? r["region"]
        : LOCALE_DEFAULTS.region,
    dateFormat: r["dateFormat"] === "12" ? "12" : "24"
  };
}
```

- [ ] **Step 4: Add GET /api/me/locale route**

Inside `registerSettingsRoutes`, add after the existing `server.get("/api/me/modules", ...)` handler:

```typescript
server.get("/api/me/locale", { schema: getLocaleSettingsRouteSchema }, async (request, reply) => {
  try {
    const accessContext = await dependencies.resolveAccessContext(request);
    const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      prefsRepository.get(scopedDb, LOCALE_KEY)
    );
    return { locale: resolveLocale(raw) };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});
```

- [ ] **Step 5: Add PUT /api/me/locale route**

Immediately after the GET route added in Step 4:

```typescript
server.put("/api/me/locale", { schema: putLocaleSettingsRouteSchema }, async (request, reply) => {
  try {
    const accessContext = await dependencies.resolveAccessContext(request);
    const body = request.body as PutLocaleSettingsRequest;
    const value: LocaleSettingsDto = {
      timezone: body.timezone,
      region: body.region,
      dateFormat: body.dateFormat
    };
    await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
      prefsRepository.upsert(scopedDb, LOCALE_KEY, value)
    );
    return { locale: value };
  } catch (error) {
    return handleRouteError(error, reply);
  }
});
```

- [ ] **Step 6: Register routes in manifest.ts**

In `packages/settings/src/manifest.ts`, inside the `routes` array, add after the last existing entry (the `PATCH /api/me/modules/:id` entry):

```typescript
{
  method: "GET",
  path: "/api/me/locale",
  permissionId: "settings.view"
},
{
  method: "PUT",
  path: "/api/me/locale",
  permissionId: "settings.view"
}
```

- [ ] **Step 7: Typecheck the settings package**

```bash
cd packages/settings && pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/settings/package.json packages/settings/src/routes.ts packages/settings/src/manifest.ts pnpm-lock.yaml
git commit -m "feat(settings): add GET+PUT /api/me/locale backed by app.preferences

Stores locale (timezone/region/dateFormat) as a single 'locale' key in
app.preferences via PreferencesRepository. Missing key returns defaults.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Integration tests for locale routes

**Files:**

- Create: `tests/integration/settings-locale.test.ts`

The test file uses the same full-server pattern as `tests/integration/onboarding.test.ts`: sign up a user, get a cookie, inject HTTP requests.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/settings-locale.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { type Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import type { GetLocaleSettingsResponse } from "@jarv1s/shared";

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("Locale settings routes", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let cookie: string;
  let cookie2: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Locale User",
        email: "locale@example.test",
        password: "correct horse battery"
      }
    });
    cookie = cookieHeader(signUp.headers);

    const signUp2 = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Other User",
        email: "locale2@example.test",
        password: "other horse battery"
      }
    });
    cookie2 = cookieHeader(signUp2.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("GET /api/me/locale returns defaults when no preference stored", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<GetLocaleSettingsResponse>();
    expect(body.locale.timezone).toBe("America/Los_Angeles");
    expect(body.locale.region).toBe("en-US");
    expect(body.locale.dateFormat).toBe("24");
  });

  it("PUT /api/me/locale persists and returns the saved locale", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/locale",
      headers: { cookie, "content-type": "application/json" },
      payload: { timezone: "Europe/Berlin", region: "de-DE", dateFormat: "24" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<GetLocaleSettingsResponse>();
    expect(body.locale.timezone).toBe("Europe/Berlin");
    expect(body.locale.region).toBe("de-DE");
    expect(body.locale.dateFormat).toBe("24");
  });

  it("GET /api/me/locale reflects persisted values after PUT", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<GetLocaleSettingsResponse>();
    expect(body.locale.timezone).toBe("Europe/Berlin");
    expect(body.locale.region).toBe("de-DE");
  });

  it("PUT /api/me/locale rejects invalid dateFormat", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/me/locale",
      headers: { cookie, "content-type": "application/json" },
      payload: { timezone: "America/New_York", region: "en-US", dateFormat: "bad" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("locale is scoped per user — user2 still sees defaults", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/locale",
      headers: { cookie: cookie2 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<GetLocaleSettingsResponse>();
    expect(body.locale.timezone).toBe("America/Los_Angeles");
  });

  it("GET /api/me/locale returns 401 without auth", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me/locale" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests — expect failure (routes not wired yet at this point in the plan — tests run after Task 2)**

```bash
pnpm test:integration 2>&1 | grep -E "settings-locale|PASS|FAIL" | head -20
```

After Task 2 is complete these should pass. Run now to confirm the test file compiles and reports failures, not syntax errors.

- [ ] **Step 3: Run the full integration suite to verify tests pass**

```bash
pnpm test:integration 2>&1 | tail -20
```

Expected: all tests pass including the new `settings-locale` suite.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/settings-locale.test.ts
git commit -m "test(settings): integration tests for GET+PUT /api/me/locale

Covers defaults, round-trip persist, per-user isolation, 401 unauthed,
and 400 invalid dateFormat.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — wire GeneralPane locale selects

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Modify: `docs/settings-design-backend-followups.md`

- [ ] **Step 1: Add query key**

In `apps/web/src/api/query-keys.ts`, add a `locale` entry to the `settings` key group:

```typescript
settings: {
  providers: ["settings", "providers"] as const,
  adminConnectorAccounts: ["settings", "admin", "connector-accounts"] as const,
  adminAuditEvents: ["settings", "admin", "audit-events"] as const,
  adminUsers: ["settings", "admin", "users"] as const,
  adminModules: ["settings", "admin", "modules"] as const,
  registrationSettings: ["settings", "admin", "registration"] as const,
  chatMultiplexer: ["settings", "chat-multiplexer"] as const,
  locale: ["me", "locale"] as const
},
```

- [ ] **Step 2: Add API client functions**

In `apps/web/src/api/client.ts`, add two imports to the `@jarv1s/shared` import block at the top:

```typescript
GetLocaleSettingsResponse,
PutLocaleSettingsRequest,
```

Then append two functions after the existing settings-related functions (near the end of the file, after `updateTaskPreferences`):

```typescript
export async function getLocaleSettings(): Promise<GetLocaleSettingsResponse> {
  return requestJson<GetLocaleSettingsResponse>("/api/me/locale");
}

export async function putLocaleSettings(
  input: PutLocaleSettingsRequest
): Promise<GetLocaleSettingsResponse> {
  return requestJson<GetLocaleSettingsResponse>("/api/me/locale", {
    method: "PUT",
    body: input
  });
}
```

- [ ] **Step 3: Wire GeneralPane in settings-personal-data-panes.tsx**

The `GeneralPane` component in `apps/web/src/settings/settings-personal-data-panes.tsx` currently has three uncontrolled `<Select defaultValue=...>` elements (timezone, region, dateFormat) and a `<NotWired>` banner + `BACKEND-TODO` comment.

First, add the import for the new client functions. Find the existing import from the API client (e.g. wherever other settings functions are imported — likely `../api/client`). Add `getLocaleSettings` and `putLocaleSettings` to the import.

Also add the React Query import (`useMutation`, `useQuery`, `useQueryClient`) if not already imported at the file top. Check: `grep "useMutation\|useQuery\|useQueryClient" apps/web/src/settings/settings-personal-data-panes.tsx`

Add to the import block at the top of the file:

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
```

Add import for client functions (near where other api/client imports are):

```typescript
import { getLocaleSettings, putLocaleSettings } from "../api/client";
import { queryKeys } from "../api/query-keys";
```

(Check if these are already imported and add only what's missing.)

Replace the entire `function GeneralPane()` with:

```typescript
function GeneralPane() {
  const queryClient = useQueryClient();
  const localeQuery = useQuery({
    queryKey: queryKeys.settings.locale,
    queryFn: getLocaleSettings
  });
  const locale = localeQuery.data?.locale;

  const localeMutation = useMutation({
    mutationFn: putLocaleSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.locale });
    }
  });

  function handleTimezone(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!locale) return;
    localeMutation.mutate({ timezone: e.target.value, region: locale.region, dateFormat: locale.dateFormat });
  }

  function handleRegion(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!locale) return;
    localeMutation.mutate({ timezone: locale.timezone, region: e.target.value, dateFormat: locale.dateFormat });
  }

  function handleDateFormat(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!locale) return;
    localeMutation.mutate({ timezone: locale.timezone, region: locale.region, dateFormat: e.target.value as "24" | "12" });
  }

  return (
    <>
      <PaneHead title="General" desc="The few things that apply across all of Jarvis." />
      <Group title="Locale">
        <div className="fld">
          <div className="fld__lbl">Time zone</div>
          <div className="fld__row">
            <Select
              value={locale?.timezone ?? "America/Los_Angeles"}
              onChange={handleTimezone}
              aria-label="Time zone"
              disabled={localeQuery.isLoading}
            >
              <option value="America/Los_Angeles">Pacific — America/Los_Angeles</option>
              <option value="America/New_York">Eastern — America/New_York</option>
              <option value="Europe/London">GMT — Europe/London</option>
              <option value="Europe/Berlin">CET — Europe/Berlin</option>
            </Select>
          </div>
        </div>
        <div className="fld">
          <div className="fld__lbl">Language &amp; region</div>
          <div className="fld__row">
            <Select
              value={locale?.region ?? "en-US"}
              onChange={handleRegion}
              aria-label="Language and region"
              disabled={localeQuery.isLoading}
            >
              <option value="en-US">English (United States)</option>
              <option value="en-GB">English (United Kingdom)</option>
              <option value="fr-FR">Français (France)</option>
              <option value="de-DE">Deutsch (Deutschland)</option>
            </Select>
          </div>
        </div>
        <div className="fld">
          <div className="fld__lbl">Date &amp; time format</div>
          <div className="fld__row">
            <Select
              value={locale?.dateFormat ?? "24"}
              onChange={handleDateFormat}
              aria-label="Date and time format"
              disabled={localeQuery.isLoading}
            >
              <option value="24">13 Jun · 24-hour</option>
              <option value="12">Jun 13 · 12-hour</option>
            </Select>
          </div>
        </div>
      </Group>

      <Group
        title="Quiet hours"
        desc="Jarvis stays silent during these hours — no nudges unless something is genuinely urgent."
      >
        <Row
          name="Enable quiet hours"
          control={<Switch ariaLabel="Enable quiet hours" checked onChange={() => undefined} />}
        />
        <div className="fld">
          <div className="fld__lbl">From / to</div>
          <div className="fld__row">
            <input
              className="jds-input"
              type="time"
              defaultValue="21:00"
              aria-label="Quiet hours from"
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
            <span style={{ color: "var(--text-faint)" }}>→</span>
            <input
              className="jds-input"
              type="time"
              defaultValue="07:00"
              aria-label="Quiet hours to"
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
          </div>
        </div>
      </Group>
      <Note>Quiet hours don't persist yet.</Note>
    </>
  );
}
```

Note: The quiet-hours section is left unchanged (still uncontrolled, still has a Note). The `NotWired` banner and the `BACKEND-TODO` comment are removed. The `Note` at the bottom now only refers to quiet hours (locale is live).

- [ ] **Step 4: Tick the follow-ups doc**

In `docs/settings-design-backend-followups.md`, change:

```markdown
- [ ] **Locale + quiet hours persistence** — ...
```

to:

```markdown
- [x] **Locale persistence** — time zone, language/region, date format. `settings-personal-data-panes.tsx` (`GeneralPane`). Quiet hours (#250) remain pending.
```

- [ ] **Step 5: Run typecheck + lint**

```bash
pnpm lint && pnpm typecheck
```

Expected: exits 0. Fix any type errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-personal-data-panes.tsx docs/settings-design-backend-followups.md
git commit -m "feat(web): wire GeneralPane locale selects to /api/me/locale

Replaces uncontrolled selects with useQuery/useMutation; removes
BACKEND-TODO + NotWired banner; quiet-hours section unchanged (#250).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- ✅ Locale persists (timezone, region, dateFormat) — Tasks 1–2
- ✅ REST routes (GET + PUT /api/me/locale) — Task 2
- ✅ `GeneralPane` wired — Task 4
- ✅ BACKEND-TODO marker removed — Task 4
- ✅ RLS enforced via PreferencesRepository + GUC-scoped policy — inherits from existing app.preferences policies (no new policy needed)
- ✅ Per-user isolation tested — Task 3
- ✅ Quiet hours NOT touched — GeneralPane in Task 4 preserves quiet-hours controls unchanged
- ✅ Route guard coverage — manifest.ts updated in Task 2

**Placeholder scan:** None found.

**Type consistency:**

- `LocaleSettingsDto` defined in Task 1, consumed in Tasks 2, 3, 4 — consistent.
- `PutLocaleSettingsRequest` defined in Task 1, consumed in Task 4 — consistent.
- `queryKeys.settings.locale` defined in Task 4 Step 1, used in Task 4 Steps 2 and 3 — consistent.
- `resolveLocale` helper used in GET route, returns `LocaleSettingsDto` — matches response schema.
