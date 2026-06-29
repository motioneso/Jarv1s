# Natural-language task search field (#498)

**Status:** Draft - RFA  
**Date:** 2026-06-29  
**Owner:** Ben + Coordinator fleet  
**Issue:** #498 — "Tasks search field enhancement"  
**Tier:** routine frontend/API slice. No migration, no new module, no RLS policy change.
**Grounded on:** `~/Jarv1s/apps/web/src/tasks/tasks-page.tsx`,
`~/Jarv1s/apps/web/src/tasks/task-view-model.ts`,
`~/Jarv1s/apps/web/src/api/client.ts`, `~/Jarv1s/packages/shared/src/tasks-api.ts`,
`~/Jarv1s/packages/tasks/src/routes.ts`, `~/Jarv1s/packages/tasks/src/tools.ts`,
`~/Jarv1s/packages/tasks/src/repository.ts`, `~/Jarv1s/packages/ai/src/chat-adapter.ts`,
`~/Jarv1s/packages/ai/src/repository.ts`.

## 1. Problem

The Tasks page search field is literal substring search over task title and description. That is fast
for "tax" or "invoice", but it cannot express structured questions that users naturally type into a
task manager:

- "show me all medium effort tasks"
- "high priority things due this week"
- "done tasks tagged invoices"
- "tasks in the home list with no due date"

The data needed for these filters already exists on `TaskDto` (`status`, `priority`, `effort`,
`dueAt`, `doAt`, `listId`, `tags`, Eisenhower quadrant via `quadrantOf`). The missing piece is a
safe translation from natural language into the existing typed filter vocabulary.

## 2. Current Architecture

- `TasksPage` fetches all visible tasks with `listTasks()` and applies UI filters client-side.
- `deriveTaskFilters()` owns visible-task derivation for status, focus, list state, tag filter, and
  literal search.
- `GET /api/tasks` currently accepts only `tagId` and `quadrant` in practice, even though
  `tasks.list` assistant tooling supports a broader typed filter vocabulary.
- Existing assistant task tools already describe the canonical read filters:
  `listId`, `tagId`, `status`, `priority`, `dueBefore`, `dueAfter`, and `quadrant`.
- The AI package exposes provider-agnostic chat generation through `ChatProviderAdapter`, but API-key
  generation is available only for providers with stored HTTP credentials. CLI-only chat providers
  should fail soft rather than trying to mutate a live chat session from the Tasks page.

## 3. Decision

Add **natural-language filter interpretation** to the existing Tasks search field.

The search box keeps its current literal behavior while typing. Pressing Enter, or clicking a small
spark/search-action button inside the field, submits the current text to a new backend endpoint that
returns a typed `TaskSearchIntent`. The client folds that intent into the existing task filter model
and shows chips for the structured filters it activated.

This keeps filtering local and cheap: the LLM does not receive task titles, descriptions, or the full
task list. It only sees the user's query, the allowed filter schema, current date/time context, and a
small vocabulary of the user's list names and tag names so names can be resolved to IDs.

## 4. User Experience

Default behavior stays familiar:

- Typing in the field immediately performs literal title/description search.
- Pressing Enter runs natural-language interpretation for the full field contents.
- If interpretation succeeds, the field text remains visible and structured chips appear below the
  toolbar, for example `Effort: medium`, `Status: todo`, `Due: this week`.
- The existing clear affordance for active filters clears the structured intent as well as the raw
  search text.
- If no model or API-capable credential is available, the field continues literal search and a
  non-blocking toast says natural-language filtering is unavailable.
- If the model returns an unsupported or ambiguous intent, the client keeps literal search and shows
  "No structured filter found."

Do not turn the Tasks page into chat. This feature translates one search phrase into filters; it does
not answer prose questions, create tasks, or call assistant write tools.

## 5. Filter Contract

Add shared types and schemas to `packages/shared/src/tasks-api.ts`:

```ts
export interface InterpretTaskSearchRequest {
  readonly query: string;
}

export interface TaskSearchIntent {
  readonly text: string | null;
  readonly status: TaskApiStatus | null;
  readonly effort: TaskEffort | null;
  readonly priority: number | null;
  readonly listIds: readonly string[];
  readonly tagNames: readonly string[];
  readonly quadrant: TaskQuadrant | null;
  readonly due:
    | { readonly kind: "none" }
    | { readonly kind: "overdue" }
    | { readonly kind: "today" }
    | { readonly kind: "this_week" }
    | {
        readonly kind: "range";
        readonly dueAfter: string | null;
        readonly dueBefore: string | null;
      };
}

export interface InterpretTaskSearchResponse {
  readonly intent: TaskSearchIntent;
  readonly confidence: "high" | "medium" | "low";
  readonly warnings: readonly string[];
}
```

The server rejects unknown keys and invalid enum values. It normalizes tag names case-insensitively
against visible user tags and resolves list names to IDs under the actor's `DataContextDb`. Unknown
names become warnings instead of broadening the result set.

## 6. Backend Design

Add `POST /api/tasks/search/interpret`.

Route flow:

1. Resolve `AccessContext`.
2. Validate `query`: trim, require 1-300 characters.
3. Under `withDataContext`, load only the actor-visible task lists and distinct tag names.
4. Resolve the user's active chat-capable model with the existing AI repository path.
5. If the selected provider has an API-key credential, call `ChatProviderAdapter.generateChat()` with
   a short prompt and `maxOutputTokens` around 500.
6. Parse the model output as JSON, validate it against the shared schema, normalize names, and return
   the intent.
7. If no active model, no HTTP credential, provider error, invalid JSON, or timeout occurs, return a
   safe 400/503 with a sanitized error. Do not log raw provider output or credentials.

The prompt must be deterministic and schema-first:

```txt
Convert the user's task search phrase into this JSON shape only.
Allowed statuses: todo, done, archived.
Allowed efforts: quick, medium, large.
Allowed quadrants: do, schedule, delegate, eliminate.
Known lists: [...]
Known tags: [...]
Today in the user's locale: YYYY-MM-DD.
User phrase: "..."
Return JSON only. Do not invent task data.
```

No task titles, descriptions, source refs, activity, or private notes are sent to the provider.

## 7. Frontend Design

Extend `TasksPage` state with:

```ts
const [searchIntent, setSearchIntent] = useState<TaskSearchIntent | null>(null);
const [searchWarning, setSearchWarning] = useState<string | null>(null);
```

Add `interpretTaskSearch(query)` to `apps/web/src/api/client.ts`.

Update `deriveTaskFilters()` to accept `intent: TaskSearchIntent | null`.

- `text`: reuse the current `matchesSearch()` helper.
- `status`: when interpretation returns a status, `TasksPage` sets the existing segmented status
  state to that value and clears URL focus, matching the current behavior when a user clicks a status
  segment. This avoids the default `todo` segment hiding queries like "done tasks".
- `effort`, `priority`, `quadrant`: exact match using existing task fields and `quadrantOf()`.
- `listIds`: task `listId` must be included.
- `tagNames`: task must include every requested tag name, matched case-insensitively.
- `due`: compare against user-local `YYYY-MM-DD` date keys. If #579's shared locale formatter is
  merged, reuse it; otherwise add a small pure helper in the tasks view-model tests and production
  code that derives date keys with `Intl.DateTimeFormat("en-CA", { timeZone })`.

Apply structured intent filters after the effective status/focus decision and after existing list/tag
controls. The user-visible result is an intersection of explicit toolbar filters and NL chips, except
for `status`, which intentionally updates the existing segmented control rather than becoming a second
hidden status predicate.

Structured chips render in the existing `tk-activetags` area and can be removed independently. Removing
a chip rewrites `searchIntent` with that field cleared; clearing all chips sets it to `null`.

## 8. Security And Privacy

- Preserve RLS: list/tag vocabulary is read only through `withDataContext`; no root Kysely access.
- Keep provider-agnostic behavior: resolve a capability/model through the existing AI repository, not
  by hardcoding provider names.
- Do not send full task records to the LLM. The model translates syntax; local code filters data.
- Do not allow generated filters to request writes, hidden fields, raw SQL, arbitrary properties, or
  cross-user data.
- Never log prompts, provider raw output, credentials, or task/list/tag names at info/error level.

## 9. Testing

Unit tests:

- `task-view-model.test.ts`: filtering by `effort: "medium"` returns only medium-effort tasks.
- `task-view-model.test.ts`: `tagNames: ["invoices"]` requires that tag and combines with literal
  text.
- `task-view-model.test.ts`: `priority: 5` and `quadrant: "do"` compose with existing status/list
  filters.
- `tasks-search-interpret.test.ts`: model JSON is parsed, normalized, and unknown list/tag names
  become warnings.
- `tasks-search-interpret.test.ts`: invalid provider JSON returns a sanitized error and never leaks
  raw output.

Frontend component tests:

- Pressing Enter in the search field calls `interpretTaskSearch()` and renders structured chips.
- Removing a chip updates visible tasks without changing unrelated filters.
- No-model response keeps literal search behavior.

Integration tests:

- `POST /api/tasks/search/interpret` requires auth.
- The route resolves list/tag vocabulary under actor scope; another user's list/tag names are not
  accepted.

## 10. Definition Of Done

- Search field still performs immediate literal search while typing.
- Enter/action button translates "show me all medium effort tasks" into `effort: "medium"` and filters
  visible tasks without sending task records to the provider.
- The endpoint fails soft when no API-capable provider is configured.
- Structured chips compose with status, list, tag, focus, and view controls.
- Focused unit/component/integration tests pass; full local gate remains `pnpm verify:foundation`.

## 11. Non-goals

- No task creation, task updates, or assistant action requests from the search field.
- No semantic/vector search over task contents.
- No database migration or new task index.
- No background parsing, monitoring, saved searches, or cross-module search.
- No direct use of a live chat thread/session to parse a filter.
