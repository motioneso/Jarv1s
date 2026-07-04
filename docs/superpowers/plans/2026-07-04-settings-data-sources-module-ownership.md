# Settings Data Sources Module Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` to implement this plan task-by-task. Coordinated-build overrides the stock execution-plan skills in this repo; do not use subagent/executing-plan mode here. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/settings` > Data sources Notes-only, and expose Email/Calendar briefing inclusion from Briefings settings using the existing persisted source-behavior settings.

**Architecture:** Keep the existing backend and module manifests. Add one small web settings model for the Email/Calendar briefing behavior ids and React Query cache update, then wire Briefings settings to `/api/me/source-behaviors`. Delete the generic source-behavior rendering from Data sources instead of filtering it.

**Tech Stack:** React 19, TanStack React Query, Vitest, existing Jarv1s REST client and settings UI primitives.

---

## Current-Branch Drift

Original spec assumed Email/Calendar module settings still needed moving. Current branch already has module settings in:

- `packages/email/src/settings/index.tsx`
- `packages/calendar/src/settings/index.tsx`

Both already expose `email.briefings` / `calendar.briefings` toggles through `/api/me/source-behaviors`. Current remaining work is:

- `apps/web/src/settings/settings-personal-data-panes.tsx` still renders every generic source behavior in Data sources, including Email/Calendar and `Coming soon` backlog rows.
- `apps/web/src/settings/settings-module-subviews.tsx` Briefings settings only shows read tools; it has no mirrored Email/Calendar include toggles.
- Module settings/manifests stay unchanged unless tests show cache coherence needs a minimal tweak.

## Files

- Create: `apps/web/src/settings/settings-source-behaviors.ts`
  - Owns briefing behavior ids, source-behavior lookup, and cache write helper.
- Create: `tests/settings-source-behaviors.test.ts`
  - Unit coverage for mirrored ids/defaults and cache update key.
- Modify: `apps/web/src/settings/settings-module-subviews.tsx`
  - Add Briefings Email/Calendar include toggles using existing `listSourceBehaviors` / `putSourceBehavior`.
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
  - Remove generic source-behavior query/mutation/rendering from Data sources; keep Notes folder/sync UI.

## Task 1: Add Source-Behavior Mirror Model

**Files:**
- Create: `apps/web/src/settings/settings-source-behaviors.ts`
- Create: `tests/settings-source-behaviors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/settings-source-behaviors.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";

import { queryKeys } from "../apps/web/src/api/query-keys";
import {
  BRIEFING_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled,
  writeSourceBehaviorCache
} from "../apps/web/src/settings/settings-source-behaviors";
import type { ListSourceBehaviorsResponse } from "@jarv1s/shared";

const response: ListSourceBehaviorsResponse = {
  sources: [
    {
      id: "email",
      name: "Email",
      description: "Email source",
      behaviors: [
        {
          id: "email.briefings",
          name: "Include in briefings",
          description: "Email briefing signal",
          enabled: false,
          toggleable: true
        }
      ]
    },
    {
      id: "calendar",
      name: "Calendar",
      description: "Calendar source",
      behaviors: [
        {
          id: "calendar.briefings",
          name: "Include in briefings",
          description: "Calendar briefing signal",
          enabled: true,
          toggleable: true
        }
      ]
    }
  ]
};

it("uses the existing module briefing behavior ids", () => {
  expect(BRIEFING_SOURCE_BEHAVIORS.map((behavior) => behavior.id)).toEqual([
    "email.briefings",
    "calendar.briefings"
  ]);
});

it("reads behavior state and defaults on when the backend row is absent", () => {
  expect(findSourceBehaviorEnabled(response.sources, "email.briefings")).toBe(false);
  expect(findSourceBehaviorEnabled(response.sources, "calendar.briefings")).toBe(true);
  expect(findSourceBehaviorEnabled(response.sources, "missing.behavior")).toBe(true);
});

it("writes source-behavior mutation results to the shared settings cache key", () => {
  const queryClient = new QueryClient();
  writeSourceBehaviorCache(queryClient, response);
  expect(queryClient.getQueryData(queryKeys.settings.sourceBehaviors)).toEqual(response);
});
```

- [ ] **Step 2: Run test and verify fail**

Run:

```bash
pnpm exec vitest run tests/settings-source-behaviors.test.ts
```

Expected: FAIL because `settings-source-behaviors.ts` does not exist.

- [ ] **Step 3: Implement minimal model**

Create `apps/web/src/settings/settings-source-behaviors.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import type { ListSourceBehaviorsResponse, SourceBehaviorSourceDto } from "@jarv1s/shared";

import { queryKeys } from "../api/query-keys";

export const BRIEFING_SOURCE_BEHAVIORS = [
  {
    id: "email.briefings",
    label: "Include email signal",
    description: "Surface important threads in scheduled briefings."
  },
  {
    id: "calendar.briefings",
    label: "Include calendar signal",
    description: "Use calendar-derived readiness signals in scheduled briefings."
  }
] as const;

export function findSourceBehaviorEnabled(
  sources: readonly SourceBehaviorSourceDto[],
  behaviorId: string
): boolean {
  return (
    sources
      .flatMap((source) => source.behaviors)
      .find((behavior) => behavior.id === behaviorId)?.enabled ?? true
  );
}

export function writeSourceBehaviorCache(
  queryClient: QueryClient,
  data: ListSourceBehaviorsResponse
): void {
  queryClient.setQueryData(queryKeys.settings.sourceBehaviors, data);
}
```

- [ ] **Step 4: Run test and verify pass**

Run:

```bash
pnpm exec vitest run tests/settings-source-behaviors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-source-behaviors.ts tests/settings-source-behaviors.test.ts
git commit -m "test: cover briefing source behavior cache"
```

## Task 2: Wire Briefings Toggles And Trim Data Sources

**Files:**
- Modify: `apps/web/src/settings/settings-module-subviews.tsx`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Test: `tests/settings-source-behaviors.test.ts`

- [ ] **Step 1: Add Briefings query/mutation**

In `apps/web/src/settings/settings-module-subviews.tsx`:

- Import `listSourceBehaviors` and `putSourceBehavior` from `../api/client`.
- Import `BRIEFING_SOURCE_BEHAVIORS`, `findSourceBehaviorEnabled`, and `writeSourceBehaviorCache` from `./settings-source-behaviors`.
- In `BriefingSettings`, add:

```ts
const sourceBehaviorsQuery = useQuery({
  queryKey: queryKeys.settings.sourceBehaviors,
  queryFn: listSourceBehaviors,
  retry: false
});
const sourceBehaviorMutation = useMutation({
  mutationFn: (input: { readonly id: string; readonly enabled: boolean }) =>
    putSourceBehavior(input.id, { enabled: input.enabled }),
  onSuccess: (data) => writeSourceBehaviorCache(queryClient, data)
});
```

- Include source behavior loading/mutation state in `busy`:

```ts
const busy =
  definitionsQuery.isLoading ||
  toolsQuery.isLoading ||
  sourceBehaviorsQuery.isLoading ||
  mutation.isPending ||
  sourceBehaviorMutation.isPending ||
  selectedToolNames.length === 0;
```

- Include source behavior errors in `error`:

```ts
const error =
  definitionsQuery.error ??
  toolsQuery.error ??
  sourceBehaviorsQuery.error ??
  mutation.error ??
  sourceBehaviorMutation.error;
```

- [ ] **Step 2: Render mirrored toggles in Briefings Sources group**

Replace the Briefings `Sources` group body with:

```tsx
<Row name="Read tools" desc={sourceListDescription(selectedToolNames)} />
{BRIEFING_SOURCE_BEHAVIORS.map((behavior) => (
  <Row
    key={behavior.id}
    name={behavior.label}
    desc={behavior.description}
    control={
      <Switch
        ariaLabel={behavior.label}
        checked={findSourceBehaviorEnabled(sourceBehaviorsQuery.data?.sources ?? [], behavior.id)}
        disabled={busy}
        onChange={(enabled) => sourceBehaviorMutation.mutate({ id: behavior.id, enabled })}
      />
    }
  />
))}
```

- [ ] **Step 3: Remove generic source behaviors from Data sources**

In `apps/web/src/settings/settings-personal-data-panes.tsx`:

- Remove `useQueryClient` usage from `SourcesPane` if no other code in the function needs it.
- Remove the `sourcesQuery` and `sourceMutation` declarations.
- Remove the `(sourcesQuery.data?.sources ?? []).map(...)` rendering block.
- Remove unused imports created by that deletion: `listSourceBehaviors`, `putSourceBehavior`, `Badge`, `EmailTaskCreationRow`, `sourceBehaviorStatus`, `DataSourceModel`, and `DataSourceBehavior` if no longer referenced.
- Change `PaneHead` description to:

```tsx
desc="Connect a notes folder Jarvis can index and use as context."
```

- Change the Connected accounts note from:

```tsx
What each account powers is set in <b>Data sources</b>.
```

to:

```tsx
What each account powers is set in its module settings.
```

- [ ] **Step 4: Run focused test**

Run:

```bash
pnpm exec vitest run tests/settings-source-behaviors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run static checks**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all exit 0.

- [ ] **Step 6: Manual grep acceptance check**

Run:

```bash
rg "Coming soon|EmailTaskCreationRow|sourceBehaviorStatus|Calendar, email" apps/web/src/settings
```

Expected: no matches in the Data sources pane path for Email/Calendar backlog rows. Matches outside Data sources are acceptable only if they are unrelated tracked-work UI.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/settings/settings-module-subviews.tsx apps/web/src/settings/settings-personal-data-panes.tsx apps/web/src/settings/settings-source-behaviors.ts tests/settings-source-behaviors.test.ts
git commit -m "feat: move briefing source controls out of data sources"
```

## Exit Criteria

- `/settings` > Data sources shows Notes folder/sync/indexing controls only.
- No Email/Calendar rows or generic `Coming soon` backlog rows render in Data sources.
- Briefings settings exposes Email and Calendar include toggles.
- Briefings toggles write `email.briefings` / `calendar.briefings` through existing `/api/me/source-behaviors`.
- React Query writes mutation results to `queryKeys.settings.sourceBehaviors`, so Briefings and module settings share the same cache entry.
- Email/Calendar module settings and manifests remain unchanged unless a check proves otherwise.

## Verification Before Wrap-Up

Run:

```bash
pnpm exec vitest run tests/settings-source-behaviors.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
```

Before push, run the coordinated-build pre-push trio again plus fresh rebase:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```
