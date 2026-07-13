# News settings dogfood hardening (#990) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to
> implement this plan task-by-task (subagent-driven-development and executing-plans are
> disabled for this build — see the relay handoff). Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Rename/recopy the News settings pane's four sections to explain what each control
does, replace the described-topics remove-only list with a single add/edit form reusing the
shipped PATCH route, and prove all of it (create/edit/delete/revalidate, empty state, safe
rendering, keyboard/live-region behavior) with unit + e2e coverage.

**Architecture:** Extract the "Topics across the web" (formerly "Topics you describe") section
into a new sibling component `packages/news/src/settings/describe-topics.tsx`, mirroring the
existing `add-source.tsx` extraction: standalone component, own mutations, pure exported
helpers for copy/state mapping. `index.tsx` shrinks by removing the topic-specific state/
mutations it delegates away, and gains a small PATCH client wrapper call.

**Tech Stack:** React + TanStack Query (existing), `@jarv1s/settings-ui`, `@jarv1s/module-web-sdk`
`requestJson`/`ApiError`, Vitest (`renderToString` harness — no jsdom/testing-library in this
repo, so interactive states are proven through pure exported helpers, not simulated clicks),
Playwright for `tests/e2e/news-settings.spec.ts`.

## Global Constraints

- Do not edit `packages/shared/src/news-api.ts`, `packages/news/src/personalization-routes.ts`,
  or any route/repository/policy/job/SQL/module-registry file — server-owned, out of scope.
- Do not edit `apps/web/src/shell/*` or `apps/web/src/settings/settings-personal-data-panes.tsx`
  — Settings-shell files, read-only reference only.
- Raw hex/rgb colors are forbidden outside `apps/web/src/styles/tokens.css` — new CSS uses
  `var(--token)` only.
- `packages/news/src/settings/index.tsx` must stay under the 1000-line file-size gate
  (`check:file-size`).
- Preserve the `topicCreateErrorMessage()` function body verbatim (422→policy copy, 503→
  "unavailable" copy, `ApiError.message` fallback, else generic copy) — only its file location
  changes (see Task 3).
- No dialog/second editor for topic edit — one form, "Save changes" swap, Cancel (spec
  Decision 2).
- Success announcements fire only after the returned state is visible, via `role="status"`;
  failures via `role="alert"`, retaining user input (spec Decision 5).
- Every create/update/delete of a described topic invalidates both
  `newsQueryKeys.personalization` and `newsQueryKeys.overview` (spec Decision 6).
- Stage only the explicit files this plan names — never `git add -A`.

---

## File map

- Modify: `packages/news/src/web/news-client.ts` — add `updateNewsTopic`.
- Modify: `packages/news/src/settings/index.tsx` — kicker/copy renames, delegate the described-
  topics section to the new component.
- Create: `packages/news/src/settings/describe-topics.tsx` — add/edit/remove form + list +
  pure helpers (including the relocated `topicCreateErrorMessage`/`PrereqGate`).
- Modify: `packages/news/src/settings/news-settings.css` — status-region classes.
- Modify: `tests/unit/news-settings-pane.test.tsx` — updated imports, new assertions.
- Create: `tests/e2e/news-settings.spec.ts` — stateful mock, full round-trip.

---

### Task 1: `updateNewsTopic` web-client wrapper

**Files:**

- Modify: `packages/news/src/web/news-client.ts`

**Interfaces:**

- Produces: `updateNewsTopic(id: string, input: UpdateNewsTopicRequest): Promise<UpdateNewsTopicResponse>`
  — consumed by Task 3's `describe-topics.tsx`.

This is a one-line addition with no isolated unit test file (the existing client wrappers have
none — they're exercised through the pane's `renderToString` tests and, for writes, only through
e2e). Task 4's e2e spec proves the PATCH round-trip; skip a redundant client-only test per YAGNI.

- [ ] **Step 1: Add the import and function**

In `packages/news/src/web/news-client.ts`, add `UpdateNewsTopicRequest` and
`UpdateNewsTopicResponse` to the existing type-only import block (alphabetical, matching the
rest of the list):

```ts
  TriggerNewsRevalidationResponse,
  UpdateNewsTopicRequest,
  UpdateNewsTopicResponse
} from "@jarv1s/shared";
```

Then add the function immediately after `deleteNewsTopic`:

```ts
export async function updateNewsTopic(
  id: string,
  input: UpdateNewsTopicRequest
): Promise<UpdateNewsTopicResponse> {
  return requestJson<UpdateNewsTopicResponse>(`/api/news/topics/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @jarv1s/news typecheck` (or `pnpm typecheck` if the package has no scoped
script — check `package.json` first).
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/news/src/web/news-client.ts
git commit -m "feat(news): add updateNewsTopic PATCH client wrapper"
```

---

### Task 2: Rename three section kickers in `index.tsx`

**Files:**

- Modify: `packages/news/src/settings/index.tsx`

Renames only the three sections that are NOT being extracted (the fourth, "Topics you
describe" → "Topics across the web", is renamed as part of Task 3's extraction so the section
markup isn't touched twice).

- [ ] **Step 1: Rename "Sources" → "Publications"**

In the `<section className="nw-set" aria-label="News sources">` block, change:

```tsx
<p className="nw-set__kicker">Sources</p>
```

to:

```tsx
<p className="nw-set__kicker">Publications</p>
```

- [ ] **Step 2: Rename "Topics" → "Topics from your publications" with narrowing copy**

In the `<section className="nw-set" aria-label="News topics">` block, change:

```tsx
        <p className="nw-set__kicker">Topics</p>
        <p className="nw-set__hint">
          Follow topics to narrow every source to those desks. With none followed you get each
          source&rsquo;s general front page.
        </p>
```

to:

```tsx
        <p className="nw-set__kicker">Topics from your publications</p>
        <p className="nw-set__hint">
          Narrow your enabled publications to these desks. With none followed you get each
          publication&rsquo;s general front page.
        </p>
```

- [ ] **Step 3: Rename "Personalized sources" → "Publications you add"**

In the `<section className="nw-set" aria-label="Personalized sources">` block, change:

```tsx
<p className="nw-set__kicker">Personalized sources</p>
```

to:

```tsx
<p className="nw-set__kicker">Publications you add</p>
```

- [ ] **Step 4: Update the failing-then-passing unit assertions**

`tests/unit/news-settings-pane.test.tsx` line ~121 currently asserts
`expect(html).toContain("Personalized sources");` — update it now (this test will fail after
Step 3 otherwise):

```ts
expect(html).toContain("Publications you add");
```

- [ ] **Step 5: Run the unit suite**

Run: `pnpm vitest run tests/unit/news-settings-pane.test.tsx`
Expected: PASS (the "Topics you describe" assertions are untouched until Task 3).

- [ ] **Step 6: Commit**

```bash
git add packages/news/src/settings/index.tsx tests/unit/news-settings-pane.test.tsx
git commit -m "feat(news): rename settings sections to explain publications vs topics"
```

---

### Task 3: Extract `describe-topics.tsx` (add/edit/remove + pure helpers)

**Files:**

- Create: `packages/news/src/settings/describe-topics.tsx`
- Modify: `packages/news/src/settings/index.tsx`
- Modify: `packages/news/src/settings/news-settings.css`
- Modify: `tests/unit/news-settings-pane.test.tsx`

**Interfaces:**

- Consumes: `updateNewsTopic(id, input)` from Task 1; `createNewsTopic`, `deleteNewsTopic` from
  `../web/news-client.js` (unchanged signatures); `newsQueryKeys` from `../web/query-keys.js`.
- Produces: `DescribeTopics(props: { customTopics, availability, needsAttention, retryRow })`
  JSX component; `PrereqGate(props: { requirement })` (relocated from `index.tsx`, now exported);
  `topicCreateErrorMessage(error: unknown): string` (relocated, body unchanged);
  `describedTopicFormValues(topic: NewsCustomTopicDto | null): { label: string; guidance: string }`;
  `describedTopicPendingMessage(operation: "create" | "edit"): string`;
  `describedTopicSuccessMessage(operation: "create" | "edit"): string`.

**Why pure helpers instead of simulated clicks:** this repo's Vitest unit harness renders with
`react-dom/server`'s `renderToString` and has no jsdom/`@testing-library/react` dependency (see
`tests/unit/settings-appearance-pane.test.tsx`'s comment on the same constraint), so DOM events
like clicking "Edit" cannot be simulated in a unit test. Edit-mode load/cancel logic is instead
factored into `describedTopicFormValues`, which is unit-testable directly; the live click-through
behavior is proven in Task 4's Playwright e2e spec.

- [ ] **Step 1: Write the failing pure-helper tests**

Add to `tests/unit/news-settings-pane.test.tsx`, in a new `describe` block after the existing
"add-flow error/candidate helpers" block:

```ts
describe("describe-topics pure helpers (#990)", () => {
  it("maps a stored topic to form field values, and null to the empty add-mode form", () => {
    expect(
      describedTopicFormValues({
        id: "t1",
        label: "Watches",
        guidance: "not smartwatches",
        validationStatus: "approved",
        createdAt: "2026-07-11T00:00:00.000Z"
      })
    ).toEqual({ label: "Watches", guidance: "not smartwatches" });
    expect(
      describedTopicFormValues({
        id: "t1",
        label: "Watches",
        guidance: null,
        validationStatus: "approved",
        createdAt: "2026-07-11T00:00:00.000Z"
      })
    ).toEqual({ label: "Watches", guidance: "" });
    expect(describedTopicFormValues(null)).toEqual({ label: "", guidance: "" });
  });

  it("gives create and edit distinct pending/success copy", () => {
    expect(describedTopicPendingMessage("create")).toBe("Checking topic…");
    expect(describedTopicPendingMessage("edit")).toBe("Saving changes…");
    expect(describedTopicSuccessMessage("create")).toBe("Topic added");
    expect(describedTopicSuccessMessage("edit")).toBe("Changes saved");
  });
});
```

Add the import at the top of the file (new import block, alongside the existing
`add-source.js` import):

```ts
import {
  describedTopicFormValues,
  describedTopicPendingMessage,
  describedTopicSuccessMessage,
  topicCreateErrorMessage
} from "../../packages/news/src/settings/describe-topics.js";
```

Remove `topicCreateErrorMessage` from the existing `NewsSettings` import line so it's imported
exactly once:

```ts
import NewsSettings from "../../packages/news/src/settings/index.js";
```

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `pnpm vitest run tests/unit/news-settings-pane.test.tsx`
Expected: FAIL — `describe-topics.js` module not found / `topicCreateErrorMessage` no longer
exported from `index.js` yet (index.tsx hasn't changed yet, so this second failure is expected
too until Step 5).

- [ ] **Step 3: Create `describe-topics.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@jarv1s/settings-ui";
import { ApiError } from "@jarv1s/module-web-sdk";
import type { NewsCustomTopicDto, NewsPersonalizationAvailabilityDto } from "@jarv1s/shared";

import { createNewsTopic, deleteNewsTopic, updateNewsTopic } from "../web/news-client.js";
import { newsQueryKeys } from "../web/query-keys.js";

/* #990: extracted from settings/index.tsx so the "Topics across the web" add/edit/remove flow
   — and the #981 safe-copy mapping it shares between create and edit — stays under the
   1000-line file-size gate. Mirrors add-source.tsx's standalone-component shape. */

/**
 * Human copy for a failed topic create OR edit. 422/503 are the route's deliberate
 * policy/availability signals (fixed copy, never model output); other ApiErrors carry
 * friendly server messages (limit/duplicate) that are safe to surface verbatim. Shared by both
 * mutations because PATCH re-runs the same policy/availability checks as POST.
 */
export function topicCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "That topic isn't allowed by the content policy.";
    if (error.status === 503) {
      return "Topic checking is unavailable right now — try again shortly.";
    }
    if (error.message) return error.message;
  }
  return "Could not add that topic. Try again.";
}

/**
 * #975 Task 9 flipped the writes live, so this gate now renders ONLY when a prerequisite is
 * missing, pointing at Assistant settings. Relocated from index.tsx (#990) — also used there
 * for the "Publications you add" section, so it must stay exported.
 */
export function PrereqGate(props: { readonly requirement: string }) {
  return (
    <span className="nw-set__gate">
      {props.requirement}{" "}
      <a className="nw-set__gatelink" href="/settings?section=assistant">
        Set it up in Assistant settings
      </a>
      .
    </span>
  );
}

/** Maps a stored topic (or null for add-mode) to the form's controlled field values. */
export function describedTopicFormValues(topic: NewsCustomTopicDto | null): {
  readonly label: string;
  readonly guidance: string;
} {
  if (!topic) return { label: "", guidance: "" };
  return { label: topic.label, guidance: topic.guidance ?? "" };
}

export type DescribedTopicOperation = "create" | "edit";

const PENDING_COPY: Record<DescribedTopicOperation, string> = {
  create: "Checking topic…",
  edit: "Saving changes…"
};

export function describedTopicPendingMessage(operation: DescribedTopicOperation): string {
  return PENDING_COPY[operation];
}

const SUCCESS_COPY: Record<DescribedTopicOperation, string> = {
  create: "Topic added",
  edit: "Changes saved"
};

export function describedTopicSuccessMessage(operation: DescribedTopicOperation): string {
  return SUCCESS_COPY[operation];
}

export function DescribeTopics(props: {
  readonly customTopics: readonly NewsCustomTopicDto[];
  readonly availability: NewsPersonalizationAvailabilityDto | null;
  readonly needsAttention: boolean;
  readonly retryRow: () => JSX.Element;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: newsQueryKeys.personalization });
    void queryClient.invalidateQueries({ queryKey: newsQueryKeys.overview });
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [guidance, setGuidance] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setLabel("");
    setGuidance("");
  }

  const createMutation = useMutation({
    mutationFn: createNewsTopic,
    onSuccess: () => {
      resetForm();
      setStatusMessage(describedTopicSuccessMessage("create"));
      invalidate();
    }
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; label: string; guidance?: string }) =>
      updateNewsTopic(input.id, { label: input.label, guidance: input.guidance }),
    onSuccess: () => {
      resetForm();
      setStatusMessage(describedTopicSuccessMessage("edit"));
      invalidate();
    }
  });
  const removeMutation = useMutation({
    mutationFn: deleteNewsTopic,
    onSuccess: () => {
      setStatusMessage("Topic removed");
      invalidate();
    }
  });

  const pending = createMutation.isPending || updateMutation.isPending;

  function startEdit(topic: NewsCustomTopicDto) {
    setEditingId(topic.id);
    const values = describedTopicFormValues(topic);
    setLabel(values.label);
    setGuidance(values.guidance);
    setStatusMessage(null);
  }

  function cancelEdit() {
    resetForm();
    setStatusMessage(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;
    const trimmedGuidance = guidance.trim();
    setStatusMessage(null);
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        label: trimmedLabel,
        guidance: trimmedGuidance || undefined
      });
    } else {
      createMutation.mutate(
        trimmedGuidance
          ? { label: trimmedLabel, guidance: trimmedGuidance }
          : { label: trimmedLabel }
      );
    }
  }

  const errorMessage = createMutation.isError
    ? topicCreateErrorMessage(createMutation.error)
    : updateMutation.isError
      ? topicCreateErrorMessage(updateMutation.error)
      : null;

  const pendingMessage = createMutation.isPending
    ? describedTopicPendingMessage("create")
    : updateMutation.isPending
      ? describedTopicPendingMessage("edit")
      : null;

  return (
    <>
      {props.customTopics.length > 0 ? (
        <ul className="nw-set__list">
          {props.customTopics.map((topic) => {
            const removing = removeMutation.isPending && removeMutation.variables === topic.id;
            return (
              <li key={topic.id} className="nw-set__item">
                <span className="nw-set__item-label">{topic.label}</span>
                {topic.guidance ? (
                  <span className="nw-set__item-meta">{topic.guidance}</span>
                ) : null}
                {topic.validationStatus !== "approved" ? (
                  <Badge tone="amber">Needs revalidation</Badge>
                ) : null}
                <button
                  type="button"
                  className="jds-btn jds-btn--sm jds-btn--secondary"
                  aria-label={`Edit ${topic.label}`}
                  disabled={pending || removing}
                  onClick={() => startEdit(topic)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="jds-btn jds-btn--sm jds-btn--secondary"
                  aria-label={`Remove ${topic.label}`}
                  disabled={removing}
                  onClick={() => removeMutation.mutate(topic.id)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="nw-set__hint">News still uses your selected publications.</p>
      )}
      {removeMutation.isError ? (
        <p className="nw-set__exerr" role="alert">
          Could not remove that topic. Try again.
        </p>
      ) : null}
      {props.needsAttention ? props.retryRow() : null}
      {props.availability?.freeformTopicsEnabled ? (
        <form className="nw-set__exform" onSubmit={submit}>
          <label className="nw-set__exlabel" htmlFor="nw-addtopic-label">
            Topic in your own words
          </label>
          <div className="nw-set__exrow">
            <input
              id="nw-addtopic-label"
              className="jds-input"
              type="text"
              value={label}
              placeholder="mechanical watches"
              disabled={pending}
              onChange={(event) => {
                setLabel(event.target.value);
                setStatusMessage(null);
              }}
            />
          </div>
          <label className="nw-set__exlabel" htmlFor="nw-addtopic-guidance">
            Optional guidance — what to include or leave out
          </label>
          <div className="nw-set__exrow">
            <input
              id="nw-addtopic-guidance"
              className="jds-input"
              type="text"
              value={guidance}
              placeholder="not smartwatches"
              disabled={pending}
              onChange={(event) => {
                setGuidance(event.target.value);
                setStatusMessage(null);
              }}
            />
            <button
              type="submit"
              className="jds-btn jds-btn--sm"
              disabled={pending || !label.trim()}
            >
              {createMutation.isPending
                ? "Checking…"
                : updateMutation.isPending
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Add topic"}
            </button>
            {editingId ? (
              <button
                type="button"
                className="jds-btn jds-btn--sm jds-btn--secondary"
                disabled={pending}
                onClick={cancelEdit}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="nw-set__addrow">
          <button
            type="button"
            className="jds-btn jds-btn--sm jds-btn--secondary nw-set__addbtn"
            disabled
          >
            Add topic
          </button>
          {props.availability ? (
            <PrereqGate requirement="Described topics need an AI model and web search." />
          ) : null}
        </div>
      )}
      {pendingMessage ? (
        <p className="nw-set__exstatus" role="status">
          {pendingMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="nw-set__exstatus is-success" role="status">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="nw-set__exerr" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run the suite again — pure-helper tests now pass, render tests still stale**

Run: `pnpm vitest run tests/unit/news-settings-pane.test.tsx`
Expected: the new "describe-topics pure helpers" tests PASS; the rest of the file still fails or
is stale until `index.tsx` is updated in the next step (it still defines its own
`topicCreateErrorMessage`/`PrereqGate` and the old inline section, causing a duplicate-export or
stale-copy mismatch).

- [ ] **Step 5: Update `index.tsx`**

Remove the local `PrereqGate` function definition (now imported).

Remove the local `topicCreateErrorMessage` function definition (now imported).

Change the import block to add:

```tsx
import { DescribeTopics, PrereqGate } from "./describe-topics.js";
```

Remove these now-unused pieces (owned by `DescribeTopics`):

- `const [topicLabel, setTopicLabel] = useState("");`
- `const [topicGuidance, setTopicGuidance] = useState("");`
- `const addTopicMutation = useMutation({ mutationFn: createNewsTopic, ... });`
- `const removeTopicMutation = useMutation({ mutationFn: deleteNewsTopic, ... });`
- `function submitTopic(event: FormEvent<HTMLFormElement>) { ... }`
- The `createNewsTopic`/`deleteNewsTopic` entries in the `../web/news-client.js` import (no
  longer called directly from `index.tsx`).

Keep `topicsNeedAttention` (still a pure derivation from `customTopics`, passed as a prop).

Replace the entire `<section className="nw-set" aria-label="Topics you describe">...</section>`
block (the one containing the old inline form and topic list) with:

```tsx
<section className="nw-set" aria-label="Topics across the web">
  <p className="nw-set__kicker">Topics across the web</p>
  <p className="nw-set__hint">
    Freeform topics in your own words — like &ldquo;mechanical watches, not smartwatches&rdquo; —
    discovered across the web, not just your publications.
  </p>
  <DescribeTopics
    customTopics={customTopics}
    availability={availability}
    needsAttention={topicsNeedAttention}
    retryRow={retryRow}
  />
</section>
```

- [ ] **Step 6: Add new render-based unit tests**

Add to `tests/unit/news-settings-pane.test.tsx`, inside the first `describe("NewsSettings
personalization sections (#953)"` block (or a new adjacent block — either is fine, prefer a new
`describe("NewsSettings described-topics section (#990)")` block to keep #990 assertions
together):

```ts
describe("NewsSettings described-topics section (#990)", () => {
  it("renames the section and explains the empty state honestly", () => {
    const html = render(personalization({ availability: allOn }));
    expect(html).toContain("Topics across the web");
    expect(html).toContain("News still uses your selected publications.");
  });

  it("renders an Edit affordance per stored topic alongside Remove", () => {
    const html = render(
      personalization({ availability: allOn, customTopics: [storedTopic("approved")] })
    );
    expect(html).toContain('aria-label="Edit Watches"');
    expect(html).toContain('aria-label="Remove Watches"');
  });

  it("escapes a hostile topic label in the Edit aria-label the same way Remove does", () => {
    const hostileTopic = {
      ...storedTopic("approved"),
      label: '<img src=x onerror=alert(1)>&lt;script&gt;"quoted'
    };
    const html = render(personalization({ availability: allOn, customTopics: [hostileTopic] }));
    expect(html).not.toContain("<img");
    expect(html).toMatch(/aria-label="Edit [^"]*&quot;quoted/);
  });
});
```

- [ ] **Step 7: Run the full unit file**

Run: `pnpm vitest run tests/unit/news-settings-pane.test.tsx`
Expected: PASS, including the pre-existing adversarial-content and Task-9 write-flow suites
(unchanged behavior — only the topic section's markup source moved).

- [ ] **Step 8: Add the CSS status-region classes**

Append to `packages/news/src/settings/news-settings.css`:

```css
/* ----- #990 described-topic add/edit status regions ----- */

.nw-set__exstatus {
  margin: calc(-1 * var(--space-2)) 0 var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.nw-set__exstatus.is-success {
  color: var(--accent-fg);
}
```

- [ ] **Step 9: Run typecheck + file-size gate**

Run: `pnpm typecheck && pnpm check:file-size`
Expected: no errors; `index.tsx` line count has dropped well under 1000.

- [ ] **Step 10: Commit**

```bash
git add packages/news/src/settings/describe-topics.tsx \
  packages/news/src/settings/index.tsx \
  packages/news/src/settings/news-settings.css \
  tests/unit/news-settings-pane.test.tsx
git commit -m "feat(news): extract described-topics add/edit/remove into its own component"
```

---

### Task 4: E2E coverage — `tests/e2e/news-settings.spec.ts`

**Files:**

- Create: `tests/e2e/news-settings.spec.ts`

**Interfaces:**

- Consumes: `mockApi` from `./mock-api.js` (existing baseline auth/notifications/tasks mock, same
  usage as `tests/e2e/wellness.spec.ts`). Drives the real `DescribeTopics` component built in
  Task 3 through its real DOM ids/aria-labels — no shared `mock-*.ts` helper (spec is explicit
  this stays a local, inline, stateful mock).

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";

// #990: local stateful mock for News Settings — proves the described-topic add/edit/remove
// round-trip through the real PATCH client wrapper (Task 1) and the extracted DescribeTopics
// component (Task 3). Deliberately not a shared tests/e2e/mock-*.ts helper (spec is explicit
// this stays local to this file). No live web-search/model/RSS/worker.

const NEWS_MODULE = {
  id: "news",
  name: "News",
  version: "0.1.0",
  lifecycle: "user-toggleable" as const,
  navigation: [{ id: "news", label: "News", path: "/news", icon: "newspaper", order: 34 }],
  settings: []
};

test.beforeEach(async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });

  await page.route("**/api/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: [NEWS_MODULE] })
    })
  );
  await page.route("**/api/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            ...NEWS_MODULE,
            required: false,
            supportsUserDisable: true,
            instanceDisabled: false,
            userDisabled: false,
            active: true
          }
        ]
      })
    })
  );

  await page.route("**/api/news/catalog", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sources: [
          {
            sourceKey: "bbc",
            label: "BBC News",
            homepageUrl: "https://www.bbc.com/news",
            defaultEnabled: true,
            topics: ["world"]
          }
        ],
        topics: [{ topicKey: "world", label: "World" }]
      })
    })
  );
  await page.route("**/api/news/prefs", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prefs: [] })
    })
  );

  let customTopics: Array<{
    id: string;
    label: string;
    guidance: string | null;
    validationStatus: "approved" | "needs_revalidation" | "rejected";
    createdAt: string;
  }> = [];

  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics,
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );

  await page.route("**/api/news/topics", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { label: string; guidance?: string };
    const topic = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      label: body.label,
      guidance: body.guidance ?? null,
      validationStatus: "approved" as const,
      createdAt: "2026-07-12T00:00:00.000Z"
    };
    customTopics = [...customTopics, topic];
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ topic })
    });
  });

  await page.route("**/api/news/topics/*", (route) => {
    const method = route.request().method();
    const id = route.request().url().split("/").pop();
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { label?: string; guidance?: string };
      customTopics = customTopics.map((topic) =>
        topic.id === id
          ? {
              ...topic,
              label: body.label ?? topic.label,
              guidance: body.guidance ?? topic.guidance
            }
          : topic
      );
      const updated = customTopics.find((topic) => topic.id === id)!;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ topic: updated })
      });
    }
    if (method === "DELETE") {
      customTopics = customTopics.filter((topic) => topic.id !== id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true })
      });
    }
    return route.continue();
  });

  await page.route("**/api/news/revalidation", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ queued: true })
    })
  );
});

test("described topics: empty state, create via Enter, edit, and remove", async ({ page }) => {
  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await expect(page.getByText("Topics across the web")).toBeVisible();
  await expect(page.getByText("News still uses your selected publications.")).toBeVisible();

  // Create via Enter from the label input (no explicit button click).
  const labelInput = page.getByLabel("Topic in your own words");
  const guidanceInput = page.getByLabel("Optional guidance — what to include or leave out");
  await labelInput.fill("Watches");
  await guidanceInput.fill("not smartwatches");
  const [createRequest] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/topics") && r.method() === "POST"),
    labelInput.press("Enter")
  ]);
  expect(createRequest.postDataJSON()).toEqual({ label: "Watches", guidance: "not smartwatches" });
  await expect(page.getByRole("status")).toContainText("Topic added");
  await expect(page.getByText("Watches", { exact: true })).toBeVisible();
  await expect(page.getByText("not smartwatches")).toBeVisible();

  // Edit loads the form and PATCHes on save.
  await page.getByRole("button", { name: "Edit Watches" }).click();
  await expect(labelInput).toHaveValue("Watches");
  await expect(guidanceInput).toHaveValue("not smartwatches");
  await guidanceInput.fill("mechanical only");
  const [updateRequest] = await Promise.all([
    page.waitForRequest((r) => /\/api\/news\/topics\/.+/.test(r.url()) && r.method() === "PATCH"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);
  expect(updateRequest.postDataJSON()).toMatchObject({ guidance: "mechanical only" });
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(page.getByText("mechanical only")).toBeVisible();

  // Remove returns to the honest empty state.
  const [deleteRequest] = await Promise.all([
    page.waitForRequest((r) => /\/api\/news\/topics\/.+/.test(r.url()) && r.method() === "DELETE"),
    page.getByRole("button", { name: "Remove Watches" }).click()
  ]);
  expect(deleteRequest.method()).toBe("DELETE");
  await expect(page.getByRole("status")).toContainText("Topic removed");
  await expect(page.getByText("News still uses your selected publications.")).toBeVisible();
});

test("cancel returns to add mode without writing, and validation failure keeps input", async ({
  page
}) => {
  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics: [
          {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            label: "Politics",
            guidance: null,
            validationStatus: "approved",
            createdAt: "2026-07-12T00:00:00.000Z"
          }
        ],
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );
  await page.route("**/api/news/topics", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ message: "Topic is not allowed" })
    });
  });

  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();

  // Cancel: edit loads the form, Cancel reverts without a write.
  await page.getByRole("button", { name: "Edit Politics" }).click();
  const labelInput = page.getByLabel("Topic in your own words");
  await expect(labelInput).toHaveValue("Politics");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(labelInput).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  // Validation failure: input is retained and the alert is actionable, not raw model output.
  await labelInput.fill("Banned topic");
  await labelInput.press("Enter");
  await expect(page.getByRole("alert")).toContainText("content policy");
  await expect(labelInput).toHaveValue("Banned topic");
});

test("retry validation queues owner-wide revalidation and surfaces queued/error feedback", async ({
  page
}) => {
  // Acceptance coverage only for the EXISTING shared retryRow/revalidateMutation — this test
  // adds no unit coverage and changes no shared code. It only proves, through the real
  // control, what the approved spec's acceptance checklist requires.
  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics: [
          {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            label: "Elections",
            guidance: null,
            validationStatus: "needs_revalidation",
            createdAt: "2026-07-12T00:00:00.000Z"
          }
        ],
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );

  let revalidationCalls = 0;
  await page.route("**/api/news/revalidation", (route) => {
    revalidationCalls += 1;
    if (revalidationCalls === 1) {
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true })
      });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "revalidation failed" })
    });
  });

  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();

  const retryButton = page.getByRole("button", { name: "Retry validation" });
  await expect(retryButton).toBeVisible();

  const [firstRequest] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/revalidation") && r.method() === "POST"),
    retryButton.click()
  ]);
  expect(firstRequest.method()).toBe("POST");
  await expect(
    page.getByText("Revalidation queued — statuses update after the next check.")
  ).toBeVisible();

  await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/revalidation") && r.method() === "POST"),
    retryButton.click()
  ]);
  await expect(page.getByText("Could not queue revalidation. Try again.")).toBeVisible();
});
```

- [ ] **Step 2: Run the new spec**

Run: `pnpm exec playwright test tests/e2e/news-settings.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Run the full local gate**

Run: `pnpm verify:foundation`
Expected: exit code 0. Record the exact command and exit code in the PR/handoff per
`CLAUDE.md`'s "if CI is unavailable" note if this is run instead of CI.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/news-settings.spec.ts
git commit -m "test(news): e2e coverage for described-topic round-trip and retry-validation feedback"
```

---

## Self-review notes (spec coverage)

- Decision 1 (naming) → Task 2 + Task 3 Step 5 (all four kickers renamed, hint copy updated).
- Decision 2 (one form, add/edit) → Task 3 `DescribeTopics` (`editingId`, Save changes/Cancel).
- Decision 3 (reuse PATCH route) → Task 1.
- Decision 4 (compact editable rows, safe text, accessible name includes topic) → Task 3
  component markup + Step 6 hostile-label test.
- Decision 5 (state beside the operation, role=status/alert, retain input on failure) → Task 3
  `pendingMessage`/`statusMessage`/`errorMessage` wiring; Task 4 e2e proves it live.
- Decision 6 (invalidate personalization + overview on create/edit/delete) → Task 3
  `invalidate()` called from all three `onSuccess` handlers.
- Decision 7 (honest empty state) → Task 3 Step 5 empty-state copy + Step 6 unit test.
- Slice 2 e2e acceptance checklist items (Enter submits once, pending→success, edit load/cancel,
  remove-to-empty, validation retains input, retry validation still queues) → Task 4's two tests
  cover all except "Retry validation still queues" explicitly with a request assertion — that
  control is unchanged from the existing `retryRow` (shared with Personalized sources, already
  covered by its own established behavior) and is out of this plan's new-code surface, so no new
  test was added for it; flag this to the coordinator as a deliberate scope call, not a gap.
