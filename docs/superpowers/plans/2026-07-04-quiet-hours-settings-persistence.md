# Quiet Hours Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings > General quiet-hours controls load and save the current user's backend quiet-hours setting.

**Architecture:** Reuse the existing `/api/me/quiet-hours` GET/PUT routes and `QuietHoursSettingsDto` contract. Add tiny web client helpers, one query key, and wire `GeneralPane` to React Query; keep backend deferral code untouched because integration tests already cover owner-scoped persistence and overnight windows.

**Tech Stack:** React, TanStack Query, shared TypeScript API contracts, Vitest SSR-style component tests.

---

## Verified Premises

- Branch is `rfa-733-quiet-hours-settings-persistence` at `origin/main@ec6b8569`.
- Handoff/spec live in coordinator worktree, not this feature branch; `docs/coordination` must stay untouched.
- `packages/settings/src/quiet-hours-routes.ts` already registers `GET /api/me/quiet-hours` and `PUT /api/me/quiet-hours`.
- `tests/integration/settings-quiet-hours.test.ts` already covers defaults, persistence, per-user isolation, auth, invalid HH:MM, and overnight `22:00` to `07:00`.
- `apps/web/src/settings/settings-personal-data-panes.tsx` still hardcodes quiet-hours UI: switch checked, `defaultValue` time inputs, `BACKEND-TODO`, and coming-soon copy.

## Files

- Modify: `apps/web/src/api/client.ts` — add quiet-hours GET/PUT client helpers using existing `requestJson`.
- Modify: `apps/web/src/api/query-keys.ts` — add `queryKeys.settings.quietHours`.
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx` — load/save quiet-hours values in `GeneralPane`.
- Create: `tests/unit/settings-quiet-hours-pane.test.tsx` — focused frontend contract/render tests.

### Task 1: Client Helpers

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Test: `tests/unit/settings-quiet-hours-pane.test.tsx`

- [ ] **Step 1: Write failing client-helper tests**

Create `tests/unit/settings-quiet-hours-pane.test.tsx`:

```tsx
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GetQuietHoursSettingsResponse } from "@jarv1s/shared";
import { queryKeys } from "../../apps/web/src/api/query-keys.js";

vi.mock("virtual:jarvis-module-settings", () => ({
  MODULE_SETTINGS_SURFACES: [],
  MODULE_SETTINGS_COMPONENTS: {}
}));

const quietHours: GetQuietHoursSettingsResponse = {
  quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "America/Chicago" }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quiet-hours settings client", () => {
  it("uses the current-user quiet-hours API for reads and writes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(quietHours), { status: 200 }));
    const { getQuietHoursSettings, putQuietHoursSettings } = await import(
      "../../apps/web/src/api/client.js"
    );

    await expect(getQuietHoursSettings()).resolves.toEqual(quietHours);
    await expect(putQuietHoursSettings({ quietHours: quietHours.quietHours })).resolves.toEqual(
      quietHours
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/me/quiet-hours",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/quiet-hours",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ quietHours: quietHours.quietHours }),
        credentials: "include"
      })
    );
  });

  it("has a dedicated settings query key", () => {
    expect(queryKeys.settings.quietHours).toEqual(["settings", "quiet-hours"]);
  });
});

async function renderPane(seed: (client: QueryClient) => void): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const { FeedbackProvider } = await import("../../apps/web/src/settings/settings-feedback.js");
  const { GeneralPane } = await import("../../apps/web/src/settings/settings-personal-data-panes.js");
  return renderToString(
    createElement(
      FeedbackProvider,
      null,
      createElement(QueryClientProvider, { client }, createElement(GeneralPane) as ReactElement)
    )
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx
```

Expected: FAIL because `getQuietHoursSettings`, `putQuietHoursSettings`, and `queryKeys.settings.quietHours` do not exist.

- [ ] **Step 3: Add minimal client helpers**

In `apps/web/src/api/client.ts`, add imports beside the existing settings API imports:

```ts
  GetQuietHoursSettingsResponse,
  PutQuietHoursSettingsRequest,
  PutQuietHoursSettingsResponse,
```

Add helpers after `putLocaleSettings`:

```ts
export async function getQuietHoursSettings(): Promise<GetQuietHoursSettingsResponse> {
  return requestJson<GetQuietHoursSettingsResponse>("/api/me/quiet-hours");
}

export async function putQuietHoursSettings(
  body: PutQuietHoursSettingsRequest
): Promise<PutQuietHoursSettingsResponse> {
  return requestJson<PutQuietHoursSettingsResponse>("/api/me/quiet-hours", {
    method: "PUT",
    body
  });
}
```

In `apps/web/src/api/query-keys.ts`, add:

```ts
    quietHours: ["settings", "quiet-hours"] as const,
```

immediately after `locale`.

- [ ] **Step 4: Run test to verify helper coverage passes**

Run:

```bash
pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx
```

Expected: client-helper tests pass; render helper is unused until Task 2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts tests/unit/settings-quiet-hours-pane.test.tsx
git commit -m "feat(settings): add quiet-hours web client"
```

### Task 2: General Pane Persistence Wiring

**Files:**
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Modify: `tests/unit/settings-quiet-hours-pane.test.tsx`

- [ ] **Step 1: Add failing render test for backend-backed controls**

Append inside `describe("quiet-hours settings client", () => { ... })` or add a new `describe` in `tests/unit/settings-quiet-hours-pane.test.tsx`:

```tsx
describe("GeneralPane quiet-hours controls", () => {
  it("renders backend quiet-hours values and removes coming-soon copy", async () => {
    const html = await renderPane((client) => {
      client.setQueryData(queryKeys.settings.locale, {
        locale: { timezone: "America/Los_Angeles", region: "en-US", dateFormat: "24" }
      });
      client.setQueryData(queryKeys.settings.quietHours, quietHours);
    });

    expect(html).toContain('aria-label="Enable quiet hours"');
    expect(html).toContain('checked=""');
    expect(html).toContain('value="22:00"');
    expect(html).toContain('value="07:00"');
    expect(html).not.toContain("Saving quiet hours is coming soon");
    expect(html).not.toContain("BACKEND-TODO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx
```

Expected: FAIL because `GeneralPane` still renders hardcoded `defaultValue="21:00"` and coming-soon copy.

- [ ] **Step 3: Wire `GeneralPane` to quiet-hours query/mutation**

In `apps/web/src/settings/settings-personal-data-panes.tsx`, add imports from `../api/client`:

```ts
  getQuietHoursSettings,
  putQuietHoursSettings,
```

Add type import:

```ts
  type QuietHoursSettingsDto,
```

Add default constant near `DEFAULT_LOCALE_SETTINGS`:

```ts
const DEFAULT_QUIET_HOURS: QuietHoursSettingsDto = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timezone: null
};
```

Inside `GeneralPane`, after `localeMutation`, add:

```ts
  const quietHoursQuery = useQuery({
    queryKey: queryKeys.settings.quietHours,
    queryFn: getQuietHoursSettings,
    retry: false
  });
  const quietHours = quietHoursQuery.data?.quietHours ?? DEFAULT_QUIET_HOURS;
  const quietHoursMutation = useMutation({
    mutationFn: (next: QuietHoursSettingsDto) => putQuietHoursSettings({ quietHours: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.quietHours, data);
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const updateQuietHours = (patch: Partial<QuietHoursSettingsDto>) => {
    quietHoursMutation.mutate({ ...quietHours, ...patch });
  };
```

Replace the quiet-hours `Row` and inputs with controlled values:

```tsx
        <Row
          name="Enable quiet hours"
          control={
            <Switch
              ariaLabel="Enable quiet hours"
              checked={quietHours.enabled}
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(enabled) => updateQuietHours({ enabled })}
            />
          }
        />
        <div className="fld">
          <div className="fld__lbl">From / to</div>
          <div className="fld__row">
            <input
              className="jds-input"
              type="time"
              value={quietHours.start}
              aria-label="Quiet hours from"
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(event) => updateQuietHours({ start: event.currentTarget.value })}
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
            <span style={{ color: "var(--text-faint)" }}>→</span>
            <input
              className="jds-input"
              type="time"
              value={quietHours.end}
              aria-label="Quiet hours to"
              disabled={quietHoursQuery.isLoading || quietHoursMutation.isPending}
              onChange={(event) => updateQuietHours({ end: event.currentTarget.value })}
              style={{ flex: "0 0 130px", minWidth: 0 }}
            />
          </div>
        </div>
```

Delete:

```tsx
      {/* BACKEND-TODO: persist quiet-hours window. */}
      <Note>Saving quiet hours is coming soon — these don't persist yet.</Note>
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx tests/integration/settings-quiet-hours.test.ts
```

Expected: PASS. Integration test may require local Postgres; if unavailable, record exact failure and run the unit test plus full static checks.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-personal-data-panes.tsx tests/unit/settings-quiet-hours-pane.test.tsx
git commit -m "feat(settings): persist quiet-hours controls"
```

### Task 3: Gate

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run focused quiet-hours search**

Run:

```bash
rg -n "persist quiet-hours|Saving quiet hours is coming soon|BACKEND-TODO: persist quiet-hours" apps/web/src packages/settings/src tests
```

Expected: no matches.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx tests/integration/settings-quiet-hours.test.ts
```

Expected: PASS, unless integration DB is unavailable; then record DB error.

- [ ] **Step 3: Run pre-push trio**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Rebase freshness check**

Run:

```bash
git fetch origin main && git rebase origin/main
```

Expected: branch remains current or rebases cleanly.

## Coverage Review

- Load quiet-hours controls from backend: Task 2.
- Save switch/time changes through existing API: Task 2 via Task 1 helpers.
- Remove coming-soon and quiet-hours `BACKEND-TODO` copy: Task 2.
- Preserve overnight windows and deferral semantics: no app-code change; existing integration tests stay in gate.
- Owner-scoped settings only: existing route uses `resolveAccessContext` + `DataContextDb`; no new backend storage path.
