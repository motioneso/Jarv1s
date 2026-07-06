# People Notes Suggest-Updates Toggle — Implementation Plan

> **For agentic workers:** This plan is executed inline by the coordinated-build agent itself
> (subagent-driven-development / executing-plans are disabled in this repo). Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Render a reachable UI toggle for the `people.notes.suggest-updates` source behavior in
the People settings pane, wired to the existing generic `/api/me/source-behaviors/{id}` endpoint.

**Architecture:** The backend is already fully wired — `packages/people/src/manifest.ts` declares
the `people.notes.suggest-updates` behavior (default-on), and
`packages/module-registry/src/index.ts:949` already gates the notes-sync `afterSync` projection
hook on `isPeopleNotesSuggestUpdatesEnabled`. `packages/settings/src/source-behavior-routes.ts`
already serves `GET /api/me/source-behaviors` and `PUT /api/me/source-behaviors/:id` generically
across every module's declared `sourceBehaviors` — no backend change needed. This is a pure
frontend gap: PR #752 deleted the generic module-agnostic "Data sources" pane and replaced it with
per-module toggles (e.g. `BRIEFING_SOURCE_BEHAVIORS` rendered inside `BriefingSettings` in
`apps/web/src/settings/settings-module-subviews.tsx`), but never added the equivalent toggle to
`apps/web/src/settings/settings-people-pane.tsx`. Fix: add a `PEOPLE_NOTES_SOURCE_BEHAVIORS`
descriptor array next to the existing `BRIEFING_SOURCE_BEHAVIORS` in
`apps/web/src/settings/settings-source-behaviors.ts`, and render it as a `Switch` row in
`SettingsPeoplePane`, following the exact pattern already proven in `BriefingSettings`'s "Sources"
group (query `queryKeys.settings.sourceBehaviors` via `listSourceBehaviors`, mutate via
`putSourceBehavior`, cache-write via `writeSourceBehaviorCache`, read state via
`findSourceBehaviorEnabled`).

**Tech Stack:** React, `@tanstack/react-query`, Vitest + `react-dom/server` `renderToString` SSR
tests (existing convention in `tests/unit/settings-people-pane.test.tsx` — no fetch mocking, tests
preset the `QueryClient` cache directly via `client.setQueryData`).

## Global Constraints

- Work only inside `apps/web/src/settings/settings-source-behaviors.ts` and
  `apps/web/src/settings/settings-people-pane.tsx` (plus their test files). Do not touch backend
  packages — they are already correct and covered by `tests/unit/module-registry-people-notes-source-behavior.test.ts`.
- No new API client functions — reuse `listSourceBehaviors` / `putSourceBehavior` from
  `apps/web/src/api/client.ts` (already used by `BriefingSettings`).
- `git add` only the files this plan touches — no `git add -A`.
- Full local gate before wrap-up: `pnpm verify:foundation`.

---

### Task 1: Add `PEOPLE_NOTES_SOURCE_BEHAVIORS` descriptor

**Files:**

- Modify: `apps/web/src/settings/settings-source-behaviors.ts`
- Test: `tests/unit/settings-source-behaviors.test.ts` (new file)

**Interfaces:**

- Consumes: nothing new — reuses existing `findSourceBehaviorEnabled` and
  `writeSourceBehaviorCache` already defined in this file.
- Produces: `PEOPLE_NOTES_SOURCE_BEHAVIORS: readonly { id: string; label: string; description:
string }[]` — a single entry array for `people.notes.suggest-updates`, consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settings-source-behaviors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  PEOPLE_NOTES_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled
} from "../../apps/web/src/settings/settings-source-behaviors.js";

describe("PEOPLE_NOTES_SOURCE_BEHAVIORS", () => {
  it("declares the people.notes.suggest-updates behavior", () => {
    expect(PEOPLE_NOTES_SOURCE_BEHAVIORS).toEqual([
      {
        id: "people.notes.suggest-updates",
        label: "Suggest note updates",
        description:
          "Create review candidates for Jarvis-managed People note updates instead of silently changing human notes."
      }
    ]);
  });

  it("defaults to enabled when no source data is present", () => {
    expect(findSourceBehaviorEnabled([], "people.notes.suggest-updates")).toBe(true);
  });

  it("reflects a disabled override from source data", () => {
    const sources = [
      {
        id: "people-notes",
        name: "People notes",
        description: "",
        behaviors: [
          {
            id: "people.notes.suggest-updates",
            sourceId: "people-notes",
            name: "Suggest note updates",
            description: "",
            default: "default-on" as const,
            enabled: false,
            toggleable: true
          }
        ]
      }
    ];
    expect(findSourceBehaviorEnabled(sources, "people.notes.suggest-updates")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/settings-source-behaviors.test.ts`
Expected: FAIL — `PEOPLE_NOTES_SOURCE_BEHAVIORS` is not exported from
`settings-source-behaviors.js`.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/settings/settings-source-behaviors.ts`, add below the existing
`BRIEFING_SOURCE_BEHAVIORS` export (do not modify the existing export or the two helper
functions):

```typescript
export const PEOPLE_NOTES_SOURCE_BEHAVIORS = [
  {
    id: "people.notes.suggest-updates",
    label: "Suggest note updates",
    description:
      "Create review candidates for Jarvis-managed People note updates instead of silently changing human notes."
  }
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/settings-source-behaviors.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-source-behaviors.ts tests/unit/settings-source-behaviors.test.ts
git commit -m "feat(people): declare people.notes.suggest-updates source behavior descriptor"
```

---

### Task 2: Render the toggle in `SettingsPeoplePane`

**Files:**

- Modify: `apps/web/src/settings/settings-people-pane.tsx`
- Test: `tests/unit/settings-people-pane.test.tsx`

**Interfaces:**

- Consumes: `PEOPLE_NOTES_SOURCE_BEHAVIORS`, `findSourceBehaviorEnabled`,
  `writeSourceBehaviorCache` from Task 1's `settings-source-behaviors.ts`; `listSourceBehaviors`,
  `putSourceBehavior` from `apps/web/src/api/client.ts` (existing, unmodified); `Switch` from
  `./settings-ui` (existing, unmodified); `queryKeys.settings.sourceBehaviors` from
  `apps/web/src/api/query-keys.ts` (existing, unmodified).
- Produces: nothing new for later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/settings-people-pane.test.tsx` (append inside the existing `describe` block,
alongside the existing imports at the top — add `import { queryKeys } from
"../../apps/web/src/api/query-keys.js";` is already imported; add no new imports needed since
`queryKeys` is already imported):

```typescript
it("shows the suggest note updates toggle reflecting a disabled override", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.settings.sourceBehaviors, {
    sources: [
      {
        id: "people-notes",
        name: "People notes",
        description: "People records projected from the configured People notes folder.",
        behaviors: [
          {
            id: "people.notes.suggest-updates",
            sourceId: "people-notes",
            name: "Suggest note updates",
            description: "",
            default: "default-on",
            enabled: false,
            toggleable: true
          }
        ]
      }
    ]
  });
  const html = renderWithQuery(createElement(SettingsPeoplePane), client);
  expect(html).toContain("Suggest note updates");
  expect(html).not.toContain('checked=""');
});

it("defaults the suggest note updates toggle to on with no override present", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderWithQuery(createElement(SettingsPeoplePane), client);
  expect(html).toContain("Suggest note updates");
  expect(html).toContain('checked=""');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/settings-people-pane.test.tsx`
Expected: FAIL — "Suggest note updates" not found in rendered output.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/settings/settings-people-pane.tsx`:

Add imports (extend the existing `"./settings-ui"` import and add two new import lines):

```typescript
import { listSourceBehaviors, putSourceBehavior } from "../api/client";
import {
  PEOPLE_NOTES_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled,
  writeSourceBehaviorCache
} from "./settings-source-behaviors";
```

Change the existing `Badge, Group, Note, PaneHead, Row` import from `"./settings-ui"` to also
include `Switch`:

```typescript
import { Badge, Group, Note, PaneHead, Row, Switch } from "./settings-ui";
```

Add a query and mutation inside `SettingsPeoplePane`, alongside the existing `notesSettingsQuery`:

```typescript
const sourceBehaviorsQuery = useQuery({
  queryKey: queryKeys.settings.sourceBehaviors,
  queryFn: listSourceBehaviors,
  retry: false
});

const sourceBehaviorMutation = useMutation({
  mutationFn: (input: { readonly id: string; readonly enabled: boolean }) =>
    putSourceBehavior(input.id, { enabled: input.enabled }),
  onSuccess: (data) => writeSourceBehaviorCache(queryClient, data),
  onError: (error) => toast(readError(error), { tone: "drift" })
});
```

This requires importing `queryKeys` (already imported) — no change needed there since it's already
imported at the top of the file.

Add a new `Row` inside the existing `<Group title="People notes">` block, after the "Refresh from
notes" `Row` and before the closing `</Group>`:

```tsx
{
  PEOPLE_NOTES_SOURCE_BEHAVIORS.map((behavior) => (
    <Row
      key={behavior.id}
      name={behavior.label}
      desc={behavior.description}
      control={
        <Switch
          ariaLabel={behavior.label}
          checked={findSourceBehaviorEnabled(sourceBehaviorsQuery.data?.sources ?? [], behavior.id)}
          disabled={sourceBehaviorMutation.isPending}
          onChange={(enabled) => sourceBehaviorMutation.mutate({ id: behavior.id, enabled })}
        />
      }
    />
  ));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/settings-people-pane.test.tsx`
Expected: PASS (6 tests — 4 existing + 2 new)

- [ ] **Step 5: Run the full frontend unit suite to check for regressions**

Run: `pnpm vitest run tests/unit/settings-people-pane.test.tsx tests/unit/settings-source-behaviors.test.ts`
Expected: PASS, 9 total

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/settings/settings-people-pane.tsx tests/unit/settings-people-pane.test.tsx
git commit -m "feat(people): surface suggest-updates toggle in People settings pane"
```

---

## Exit Criteria (from issue #756)

- [ ] `people.notes.suggest-updates` has a reachable UI toggle in People settings — Task 2.
- [ ] Toggle reads current state via `GET /api/me/source-behaviors` (existing endpoint) — Task 2.
- [ ] Toggle writes via `PUT /api/me/source-behaviors/{id}` (existing endpoint, same pattern PR
      #752 used for other modules) — Task 2.
- [ ] No backend changes — the gate at `packages/module-registry/src/index.ts:949` and the
      manifest declaration at `packages/people/src/manifest.ts:56` are already correct and already
      covered by `tests/unit/module-registry-people-notes-source-behavior.test.ts` (verified in
      spec-check, unchanged by this plan).
