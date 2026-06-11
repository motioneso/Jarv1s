# packages/shared — Thermo-Nuclear Quality Review

**Date:** 2026-06-10
**Reviewer:** PLO Audit subagent
**Files reviewed:**
- `packages/shared/src/index.ts`
- `packages/shared/src/ai-api.ts` (714 lines)
- `packages/shared/src/briefings-api.ts` (306 lines)
- `packages/shared/src/calendar-api.ts` (121 lines)
- `packages/shared/src/chat-api.ts` (97 lines)
- `packages/shared/src/connectors-api.ts` (290 lines)
- `packages/shared/src/email-api.ts` (121 lines)
- `packages/shared/src/notifications-api.ts` (117 lines)
- `packages/shared/src/platform-api.ts` (619 lines)
- `packages/shared/src/tasks-api.ts` (614 lines)
- `packages/shared/src/tasks-view.ts` (80 lines)
- `packages/shared/package.json`

---

## Summary

`packages/shared` is the Vite-bundled contract layer shared between the API server and the web frontend. Its core purpose is clean: pure TypeScript types + JSON Schema objects that Fastify uses for serialization/validation. The bundle safety invariant (no `node:*` imports) is satisfied. No TypeScript `any` types are used. File sizes are all well under 1000 lines.

The primary findings are: (1) a critical secret-in-request-body pattern in the Google OAuth connector flow, (2) widespread missing `additionalProperties: false` on response schemas in tasks and notifications (opens serialization bypass), (3) all task and notification route schemas are missing `401`/`403` error response declarations, (4) pervasive duplication of the same four helper schemas across every API file, and (5) a read/write asymmetry where `recurrence` is accepted on write but silently absent from the response DTO.

---

## Findings

### [CRITICAL] Google OAuth `clientSecret` carried in shared request body type

- **File:** `packages/shared/src/connectors-api.ts:242–265`
- **Category:** Security
- **Finding:** `GoogleAuthorizeRequest` exposes `clientSecret: string` as a required field in the shared contract. This means the OAuth client secret is sent from the browser to the API server in a plain JSON request body. The shared schema also exports a validation schema with `minLength: 1` for `clientSecret`, cementing this as an intended pattern. A client secret is a long-lived OAuth credential that must never travel through the browser.
- **Evidence:**
  ```typescript
  export interface GoogleAuthorizeRequest {
    clientId: string;
    clientSecret: string;
  }
  // ...
  export const googleAuthorizeRequestSchema = {
    type: "object",
    required: ["clientId", "clientSecret"],
    additionalProperties: false,
    properties: {
      clientId: { type: "string", minLength: 1 },
      clientSecret: { type: "string", minLength: 1 }
    }
  } as const;
  ```
- **Impact:** Any user with browser devtools can observe their own (or potentially any) OAuth client secret in the network request. If the frontend ever logs request bodies (e.g., error reporting), the secret is written to a log. This violates the "Secrets never escape" hard invariant. OAuth client secrets belong in server-side configuration (env vars or vault), not in browser-initiated request payloads.
- **Recommendation:** Remove `clientSecret` (and likely `clientId`) from `GoogleAuthorizeRequest`. The server should read the OAuth client credentials from its own config/vault. The browser should only send the redirect URI or a state parameter. If multi-tenant per-user credential entry is genuinely required, the secret must be stored in the vault before the OAuth flow begins, not transmitted on every authorize call.

---

### [HIGH] All task and notification route schemas missing `401`/`403` error response declarations

- **File:** `packages/shared/src/tasks-api.ts:293–615`, `packages/shared/src/notifications-api.ts:100–117`
- **Category:** Security / Architecture
- **Finding:** Every route schema in `tasks-api.ts` (18 routes) and `notifications-api.ts` (3 routes) declares only a success response and omits all error responses (`401 Unauthorized`, `403 Forbidden`, `404 Not Found`). Fastify uses these schemas to serialize responses. When an error response schema is absent, Fastify falls back to unvalidated serialization for that status code, meaning any field — including internal state or sensitive server data — can leak through error paths.
- **Evidence:**
  ```typescript
  export const listTasksRouteSchema = {
    response: {
      200: listTasksResponseSchema
      // no 401, no 403
    }
  } as const;

  export const createTaskRouteSchema = {
    body: createTaskRequestSchema,
    response: {
      201: createTaskResponseSchema
      // no 401, no 403, no 400
    }
  } as const;
  ```
  Compare with `ai-api.ts` which consistently includes `401: errorResponseSchema` on every route.
- **Impact:** Error responses bypass the schema-enforced serialization filter. If the route handler ever returns an error object that accidentally includes internal fields (stack trace, DB row, session token), they will serialize through to the client. This is especially concerning for the deferred task status endpoint and admin-facing list endpoints.
- **Recommendation:** Add `401: errorResponseSchema` to every route schema in both files, and add `404: errorResponseSchema` to any route that operates on a specific resource by ID. Follow the pattern already established in `ai-api.ts` and `briefings-api.ts`.

---

### [HIGH] Wholesale missing `additionalProperties: false` on tasks-api response schemas

- **File:** `packages/shared/src/tasks-api.ts` — entire file
- **Category:** Security / Architecture
- **Finding:** Not a single object schema in `tasks-api.ts` includes `additionalProperties: false`. This includes the primary DTO schemas (`taskDtoSchema`, `taskActivityDtoSchema`, `taskListDtoSchema`, `taskTagDtoSchema`, `taskPreferencesDtoSchema`) and all response wrapper schemas. Fastify's JSON serializer respects `additionalProperties: false` to strip extra fields from responses. Without it, any DB column or service-layer field that leaks into the serialized response object will be forwarded to the client verbatim.
- **Evidence:**
  ```typescript
  export const taskDtoSchema = {
    type: "object",
    // NO additionalProperties: false
    required: ["id", "ownerUserId", ...],
    properties: { ... }
  } as const;
  ```
  By contrast, `ai-api.ts`, `briefings-api.ts`, `calendar-api.ts`, and `connectors-api.ts` all use `additionalProperties: false` on their DTO schemas.
- **Impact:** If a future migration adds a column to the tasks table (e.g., an internal flag, an encryption key reference, or a soft-delete token), and the DB row is mapped to the DTO without explicit filtering, that field will be serialized to the frontend. The "private by default" invariant is technically satisfied only at the RLS level; schema-level filtering is the next defense layer and it is absent here.
- **Recommendation:** Add `additionalProperties: false` to all object schemas in `tasks-api.ts`. This is a non-breaking change since it only restricts what goes out, not what comes in on response schemas.

---

### [HIGH] `recurrence` accepted on write but silently absent from response DTO

- **File:** `packages/shared/src/tasks-api.ts:38–49, 59–70`
- **Category:** Architecture / TypeScript
- **Finding:** Both `CreateTaskRequest` and `UpdateTaskRequest` accept a `recurrence: Record<string, unknown> | null` field, but `TaskDto` (the response type) has no `recurrence` field at all. The JSON Schema for the request validates and accepts the field (`createTaskRequestSchema` line 211, `updateTaskRequestSchema` line 241), but `taskDtoSchema` has no corresponding property. The submitted recurrence value is silently swallowed — the client has no way to read it back.
- **Evidence:**
  ```typescript
  // Request (line 48)
  readonly recurrence?: Record<string, unknown> | null;

  // TaskDto (lines 5–23) — recurrence is absent
  export interface TaskDto {
    readonly id: string;
    readonly title: string;
    // ... no recurrence field
  }
  ```
- **Impact:** This is a write-only field in the API contract with no read surface. Either the field is stored and should be exposed (making the response type incomplete), or it should not be accepted at all (making the request type wrong). In either case the contract is structurally unsound. Any client code that writes `recurrence` and tries to read it back will get `undefined`, leading to subtle bugs.
- **Recommendation:** Either (a) add `recurrence` to `TaskDto` and `taskDtoSchema`, or (b) remove it from `CreateTaskRequest`, `UpdateTaskRequest`, and both request schemas. The decision should match what the backend actually stores and returns.

---

### [MEDIUM] `errorResponseSchema`, `jsonObjectSchema`, `nullableStringSchema`, and `idParamsSchema` duplicated across every API file

- **File:** All files in `packages/shared/src/`
- **Category:** Code Quality
- **Finding:** Four identical helper schema objects are re-declared as `const` in every API file. None are exported (they are `const`, not `export const`), so they cannot be shared. This is pure copy-paste duplication.

  | Schema | Files containing a copy |
  |---|---|
  | `errorResponseSchema` | `ai-api.ts`, `briefings-api.ts`, `calendar-api.ts`, `chat-api.ts`, `connectors-api.ts`, `email-api.ts`, `platform-api.ts` |
  | `jsonObjectSchema` | `ai-api.ts`, `briefings-api.ts`, `calendar-api.ts`, `connectors-api.ts`, `email-api.ts` |
  | `nullableStringSchema` | `calendar-api.ts`, `email-api.ts`, `notifications-api.ts`, `tasks-api.ts` |
  | `idParamsSchema` | `ai-api.ts`, `briefings-api.ts` |

- **Impact:** Any change to the canonical shape (e.g., adding a `code` field to error responses, or changing null encoding) requires editing 7+ files, with high risk of partial updates creating inconsistent behavior. The current `idParamsSchema` also has a minor inconsistency between files: `ai-api.ts` uses `additionalProperties: false` while `briefings-api.ts` does as well — but this would naturally diverge over time.
- **Recommendation:** Export these four as named constants from `index.ts` or a new `shared-schemas.ts` internal module, and import them in each API file. E.g.:
  ```typescript
  // shared-schemas.ts (not exported from index, used internally)
  export const errorResponseSchema = { ... } as const;
  export const jsonObjectSchema = { ... } as const;
  export const nullableStringSchema = { ... } as const;
  export const idParamsSchema = { ... } as const;
  ```

---

### [MEDIUM] `GoogleAuthorizeRequest` and `GoogleCompleteRequest` interfaces missing `readonly` modifiers

- **File:** `packages/shared/src/connectors-api.ts:242–257`
- **Category:** TypeScript / Code Quality
- **Finding:** `GoogleAuthorizeRequest`, `GoogleAuthorizeResponse`, `GoogleCompleteRequest`, and `GoogleCompleteResponse` declare fields without `readonly`, unlike every other interface in the package. All other DTO and request interfaces use `readonly` throughout.
- **Evidence:**
  ```typescript
  export interface GoogleAuthorizeRequest {
    clientId: string;       // missing readonly
    clientSecret: string;   // missing readonly
  }
  ```
  vs. all others:
  ```typescript
  export interface ConnectorAccountDto {
    readonly id: string;    // consistent pattern
    ...
  }
  ```
- **Impact:** Inconsistency weakens the structural guarantee. Code that accepts `GoogleAuthorizeRequest` can accidentally mutate the object. Low risk in practice but violates the established codebase convention.
- **Recommendation:** Add `readonly` to all fields in these four interfaces to match the rest of the package.

---

### [MEDIUM] `googleAuthorizeResponseSchema` missing `additionalProperties: false`

- **File:** `packages/shared/src/connectors-api.ts:269–272`
- **Category:** Security / Architecture
- **Finding:** The `googleAuthorizeResponseSchema` lacks `additionalProperties: false`, unlike the adjacent `googleCompleteRequestSchema` which does have it.
- **Evidence:**
  ```typescript
  export const googleAuthorizeResponseSchema = {
    type: "object",
    required: ["authUrl"],
    properties: { authUrl: { type: "string" } }
    // missing: additionalProperties: false
  } as const;
  ```
- **Impact:** Extra fields returned by the handler will pass through Fastify serialization unfiltered.
- **Recommendation:** Add `additionalProperties: false`.

---

### [MEDIUM] `ConnectorAccountDto` exposes `ownerUserId` and `scopes` via the admin listing endpoint

- **File:** `packages/shared/src/connectors-api.ts:15–28, 63–65`
- **Category:** Security / Architecture
- **Finding:** `ListAdminConnectorAccountsResponse` reuses the same `ConnectorAccountDto` as the per-user listing. `ConnectorAccountDto` includes `ownerUserId` and `scopes`. Via the admin endpoint (`listAdminConnectorAccountsRouteSchema`), an admin can retrieve connector accounts for all users, including their `ownerUserId` identifiers and OAuth scopes. The response type makes no distinction between the admin and user views.
- **Evidence:**
  ```typescript
  export interface ConnectorAccountDto {
    readonly ownerUserId: string;   // other users' IDs visible to admin
    readonly scopes: readonly string[];  // other users' OAuth scopes visible to admin
    // ...
  }

  export interface ListAdminConnectorAccountsResponse {
    readonly accounts: readonly ConnectorAccountDto[];  // same type, all users
  }
  export const listAdminConnectorAccountsResponseSchema = listConnectorAccountsResponseSchema;
  ```
- **Impact:** The hard invariant "Admin/owner power is configuration power only" is stated to mean no private-data bypass. Exposing all users' connector accounts and OAuth scopes to an admin actor may violate this if those scopes represent private access patterns. This requires a deliberate review of intent. If admin listing is a legitimate operational need (e.g., to revoke compromised accounts), it should be documented as an approved exception with a narrow-scope admin-only DTO that excludes content-level metadata.
- **Recommendation:** Either create a `ConnectorAccountAdminDto` that limits exposed fields to operational metadata only (id, status, providerId, revokedAt — not ownerUserId or scopes), or add an explicit note in the spec that this endpoint is approved as an operational exception. At minimum the schema alias `listAdminConnectorAccountsResponseSchema = listConnectorAccountsResponseSchema` should be broken out so the shapes can diverge independently.

---

### [MEDIUM] `NotificationDto.recipientUserId` and `actorUserId` are nullable but required in the JSON schema

- **File:** `packages/shared/src/notifications-api.ts:1–10, 43–63`
- **Category:** TypeScript / Architecture
- **Finding:** `NotificationDto` declares both `actorUserId: string | null` and `recipientUserId: string | null`. In the JSON schema these are marked as required with a nullable type union. This means every notification returned to the client includes `actorUserId` — the user ID of whoever triggered the action. Depending on context, this leaks the identity of another user (e.g., "user X performed action Y on your resource") to the recipient, when the actor's identity may not be intended to be visible.
- **Evidence:**
  ```typescript
  export interface NotificationDto {
    readonly actorUserId: string | null;
    readonly recipientUserId: string | null;
    // ...
  }
  ```
- **Impact:** If notifications are delivered cross-user (actor != recipient), the `actorUserId` field on the notification exposes that user's internal ID to another user. This may be intentional for UI display ("Ben commented on your task") but the raw UUID exposure rather than a display name suggests no explicit privacy review occurred.
- **Recommendation:** Either document that cross-user actor ID exposure is intentional and approved, or replace `actorUserId` in the response DTO with a `actorDisplayName: string | null` or remove it if the UI can derive actor identity through other means.

---

### [MEDIUM] `BriefingRunDto.summaryText` includes full AI-generated briefing content in a shared DTO

- **File:** `packages/shared/src/briefings-api.ts:18–27`
- **Category:** Security / Architecture
- **Finding:** `BriefingRunDto` includes `summaryText: string` (the full text of an AI-generated briefing) and `sourceMetadata: Record<string, unknown>` (opaque metadata about source data). This is a DTO in the shared contract — its schema has `additionalProperties: false` on `summaryText` (correct), but `sourceMetadata` uses `additionalProperties: true` (open schema). While `summaryText` itself is intended user content and its exposure is by design, `sourceMetadata` is an uncontrolled bag of unknown provenance that could contain calendar event details, email subjects, or other private data items that were used to generate the briefing.
- **Evidence:**
  ```typescript
  export interface BriefingRunDto {
    readonly summaryText: string;
    readonly sourceMetadata: Record<string, unknown>;  // unbounded, unknown contents
    // ...
  }
  ```
- **Impact:** Any private data accidentally captured in `sourceMetadata` at write time will be returned to the browser verbatim on the next read. The schema provides no filtering. This is a latent data-leakage vector if the briefing generation code is not strictly disciplined about what it stores in this field.
- **Recommendation:** Either (a) narrow `sourceMetadata` to a typed structure with only approved metadata fields (e.g., `{ toolNames: string[]; ranAt: string }`), or (b) explicitly document the allowed contents and add server-side filtering before it enters the DTO.

---

### [LOW] `createTaskRequestSchema` and `updateTaskRequestSchema` missing `additionalProperties: false`

- **File:** `packages/shared/src/tasks-api.ts:196–245`
- **Category:** Architecture
- **Finding:** Request body schemas for task create and update do not include `additionalProperties: false`. Extra, unknown fields in the request body are silently accepted and ignored by Fastify (default behavior without `additionalProperties: false`). This is a defense-in-depth gap.
- **Evidence:**
  ```typescript
  export const createTaskRequestSchema = {
    type: "object",
    required: ["title"],
    // missing additionalProperties: false
    properties: { ... }
  } as const;
  ```
- **Impact:** Clients can send arbitrary extra fields (e.g., `ownerUserId`, `id`, `position`) in the request body. Currently these are likely ignored, but if the handler code ever spreads the body object onto a DB insert, unknown fields could be injected. Low-severity today; higher severity if handler code changes.
- **Recommendation:** Add `additionalProperties: false` to all request body schemas in `tasks-api.ts`.

---

### [LOW] `taskDtoSchema` uses `type: "number"` for `priority` but `createTaskRequestSchema` validates it as `integer` with range

- **File:** `packages/shared/src/tasks-api.ts:159, 203–205`
- **Category:** TypeScript / Architecture
- **Finding:** The response schema (`taskDtoSchema`) declares `priority` as `nullableNumberSchema` (type: `"number"`), accepting any float. The request schema (`createTaskRequestSchema`) constrains it to `{ type: "integer", minimum: 1, maximum: 5 }`. A task created with priority 3 could theoretically be returned with priority 3.5 (if a bug in the backend allowed it) without schema validation failing on the read side.
- **Evidence:**
  ```typescript
  // taskDtoSchema (response)
  priority: nullableNumberSchema,  // { anyOf: [{ type: "number" }, { type: "null" }] }

  // createTaskRequestSchema (request)
  priority: {
    anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }]
  }
  ```
- **Impact:** Low. The constraint mismatch means invalid priority values could be returned to clients without JSON schema raising an alarm.
- **Recommendation:** Change `taskDtoSchema.priority` to `{ anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }] }` to match the write constraint and ensure the serializer enforces the invariant.

---

### [LOW] `listTaskActivityResponseSchema` is defined twice with different names pointing to the same shape

- **File:** `packages/shared/src/tasks-api.ts:329–335`
- **Category:** Code Quality
- **Finding:** `listTaskActivityResponseSchema` is a standalone definition. `addTaskActivityResponseSchema` (line 257) wraps a single item. These are structurally distinct but the naming relationship (`list` vs. `add`) is easy to confuse. More importantly, `listTaskActivityResponseSchema` (line 329) is declared separately rather than reusing `addTaskActivityResponseSchema` via `{ type: "array", items: taskActivityDtoSchema }`. This is not a true duplicate but results in an unnecessarily scattered schema definition.
- **Impact:** Minor maintainability hazard.
- **Recommendation:** Consolidate: define `taskActivityDtoSchema` once, reference it from both the single-item and list wrappers.

---

### [LOW] `ConnectorAccountDto` lacks `readonly` on `UpdateConnectorAccountRequest.tokenPayload`

- **File:** `packages/shared/src/connectors-api.ts:49–57`
- **Category:** TypeScript
- **Finding:** `UpdateConnectorAccountRequest` has `tokenPayload?: Record<string, unknown>`. While optional, `Record<string, unknown>` is mutable. All other fields in this interface correctly use `readonly`. This is an inconsistency in the type declaration.
- **Evidence:**
  ```typescript
  export interface UpdateConnectorAccountRequest {
    readonly scopes?: readonly string[];
    readonly status?: ...;
    readonly tokenPayload?: Record<string, unknown>;  // NOT `readonly Record<string, unknown>`
  }
  ```
- **Impact:** Cosmetic. Any caller could mutate the `tokenPayload` object after constructing the request, but this rarely causes real bugs.
- **Recommendation:** Change to `readonly tokenPayload?: Readonly<Record<string, unknown>>` for consistency.

---

### [LOW] Entire `tasks-api.ts` and `notifications-api.ts` route schemas lack error declarations: no `404` for ID-scoped routes

- **File:** `packages/shared/src/tasks-api.ts:306–350`
- **Category:** Architecture
- **Finding:** `getTaskRouteSchema`, `updateTaskRouteSchema`, `addTaskActivityRouteSchema`, `listTaskActivityRouteSchema`, and `deferredTaskStatusRouteSchema` — all operating on a specific task by ID — declare no `404` error response schema.
- **Evidence:**
  ```typescript
  export const getTaskRouteSchema = {
    params: taskParamsSchema,
    response: {
      200: getTaskResponseSchema
      // no 404
    }
  } as const;
  ```
- **Impact:** If the route returns a 404, it bypasses the schema-enforced serializer, potentially leaking internal fields from the error object.
- **Recommendation:** Add `404: errorResponseSchema` to all ID-scoped route schemas.

---

### [INFO] `tasks-view.ts` contains business logic (`quadrantOf`, `groupByPriority`) in the shared bundle

- **File:** `packages/shared/src/tasks-view.ts:38–79`
- **Category:** Architecture
- **Finding:** `tasks-view.ts` exports runtime functions `quadrantOf`, `groupByPriority`, and `quadrantTasks` that contain priority/urgency classification logic. These are pure TypeScript functions with no browser-unsafe imports, so they are safe in the Vite bundle. However, a comment at line 37 notes that `quadrantOf` "mirrors backend serialize.ts getQuadrant", indicating the same logic exists in the backend. This is intentional duplication.
- **Impact:** If the quadrant logic changes (e.g., the urgency threshold changes from 48h), it must be updated in two places. Currently there is no automated test verifying that both implementations agree.
- **Recommendation:** Document this intentional duplication explicitly (the comment is a start) and ensure integration tests cover that the backend and frontend produce matching quadrant assignments for the same task data.

---

### [INFO] `Brand<TValue, TBrand>` utility type exported from index but unused within the package

- **File:** `packages/shared/src/index.ts:1–3`
- **Category:** Code Quality
- **Finding:** The `Brand` utility type is the first export from `index.ts` and is not used anywhere within `packages/shared`. It appears to be a general utility export for use by other packages.
- **Impact:** None in isolation. If this is the only consumer-facing utility type, it may belong in a lower-level types package rather than the API contract package.
- **Recommendation:** Confirm this type is used elsewhere in the project (it likely is, in `packages/db`). If used only in server-side code, move it to a server-only types file to avoid polluting the browser bundle's surface unnecessarily. (No functional issue today.)

---

## Cross-cutting Notes

**Browser bundle safety:** PASS. No `node:*` imports anywhere in `packages/shared/src/`. The package is safe to Vite-bundle.

**TypeScript `any` usage:** PASS. No `any` type is used. All loose-typed fields use `Record<string, unknown>` (appropriate for JSON blobs) or named union types.

**File size limits:** PASS. Largest file is `ai-api.ts` at 714 lines, well under the 1000-line limit.

**Job payload metadata-only check:** PASS for the declared payload DTOs. `DeferredTaskStatusPayloadDto` contains only `actorUserId`, `taskId`, `requestedStatus`, and `idempotencyKey`. `BriefingRunPayloadDto` contains only `actorUserId`, `definitionId`, `briefingRunId`, `runKind`, and `idempotencyKey`. Neither contains content, prompts, or credentials. However, these types are exported from the package (visible to the browser bundle) and are not consumed by any non-shared code found in this audit — their placement in `@jarv1s/shared` rather than a server-only package is an architectural question worth resolving.

**Provider-agnostic AI:** PASS. `AiProviderKind` is an open union type; no feature hardcodes a specific model or provider in the shared types.
