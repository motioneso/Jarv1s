# Thermo-Nuclear Code Quality Audit — apps/web

**Scope:** `apps/web/src/` (all source files)
**Date:** 2026-06-10
**Auditor:** Automated subagent (claude-sonnet-4-6)

---

## Summary

No file exceeds 1000 lines. No `dangerouslySetInnerHTML`, `innerHTML`, or raw HTML injection vectors found. No `node:*` imports in frontend source. No secrets or env vars embedded in the bundle. Authentication is entirely server-side via HTTP-only cookie session; no auth state is trusted from frontend storage.

The frontend is structurally sound for a single-user personal-data app. The findings below range from a multi-user readiness gap (MEDIUM) to dead code and quality issues (LOW/INFO).

---

## Findings

### [MEDIUM] Query cache not cleared on sign-in — will leak stale data to a second user when multi-user lands

- **File:** `apps/web/src/app.tsx:34-46`
- **Category:** Security
- **Finding:** `handleAuthenticated` (called on successful sign-in) uses `queryClient.invalidateQueries` on each namespace rather than `queryClient.clear()`. Invalidation marks queries stale and triggers background refetches, but in the window between sign-in and the refetch completing, React Query will serve the previous user's cached data to the new session. Sign-out correctly calls `queryClient.clear()` + full-page reload (`window.location.assign("/")`), so this is safe in the current single-user model. However, Phase 2 (multi-user accounts) is in active planning (`docs/superpowers/plans/2026-06-10-p2-multi-user-accounts.md`), and if the SPA gains user-switching without a full page reload, this becomes a direct cache-poisoning path: User A's tasks/notifications/AI config are briefly visible to User B.
- **Evidence:**
  ```ts
  const handleAuthenticated = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.bootstrap }),
      queryClient.invalidateQueries({ queryKey: ["auth"] }),
      // ... 8 more invalidateQueries calls
    ]);
  };
  ```
- **Impact:** In a future multi-user scenario, a newly authenticated user could see the previous user's personal data for a brief window. The `connectors` namespace is not even invalidated here, making it worse.
- **Recommendation:** Replace with `queryClient.clear()` followed by targeted prefetches, or at minimum ensure all namespaces are covered. Fix this before Phase 2 lands; do not wait until user-switching is implemented.

---

### [MEDIUM] SSE `kind` field is cast without allowlist validation — allows unknown kind values to flow through rendering

- **File:** `apps/web/src/chat/use-chat-stream.ts:61`
- **Category:** TypeScript / Security
- **Finding:** `parseRecord` validates that `kind` is a `string` and `text` is a `string`, then casts `kind` directly to `ChatRecordKind` without checking that the value is one of the 8 allowed enum members. An SSE event emitting `kind: "any-value"` will produce a `TranscriptRecord` with an arbitrary `kind`. The fallback rendering path in `RecordRow` (`{kind}: {text}`) safely uses React JSX escaping, so there is no XSS risk today. However, the unsound cast means TypeScript's type narrowing in `RecordRow` is wrong — future code added to handle a new `kind` value could be bypassed by an injected event.
- **Evidence:**
  ```ts
  kind: parsed.kind as ChatRecordKind,
  ```
  There is no `VALID_KINDS.includes(parsed.kind)` guard before the cast.
- **Impact:** Type unsoundness. Any backend bug or malicious SSE injection can produce a record with an unrecognised `kind` that passes the TypeScript guard but falls into the default render branch silently, potentially hiding important state.
- **Recommendation:** Add an allowlist check:
  ```ts
  const VALID_KINDS: readonly ChatRecordKind[] = [
    "user", "thinking", "tool", "status", "reply", "error", "action_request", "action_result"
  ];
  if (!VALID_KINDS.includes(parsed.kind as ChatRecordKind)) return null;
  ```

---

### [MEDIUM] `connectors` namespace missing from `handleAuthenticated` invalidation sweep

- **File:** `apps/web/src/app.tsx:34-46`
- **Category:** Security / Architecture
- **Finding:** The `handleAuthenticated` callback invalidates auth, ai, briefings, calendar, chat, email, modules, notifications, and tasks — but does not invalidate `connectors`. If a sign-in sequence ever occurs in-session (e.g., token refresh that triggers a re-auth event), the connector accounts and providers from a previous session remain cached.
- **Evidence:** The `queryKeys.connectors` namespace (`["connectors", "providers"]`, `["connectors", "accounts"]`) is absent from the invalidation list.
- **Impact:** After a re-authentication event, connector state from the old session is shown until the component remounts or its own staleness timer fires.
- **Recommendation:** Add `queryClient.invalidateQueries({ queryKey: ["connectors"] })` to `handleAuthenticated`. Longer-term, switch to `queryClient.clear()` as noted above.

---

### [LOW] `handleAuthenticated` is async and its return value (Promise) is discarded inside `onSuccess`

- **File:** `apps/web/src/auth/auth-screen.tsx:28`
- **Category:** Error Handling
- **Finding:** The `useMutation` `onSuccess` callback calls `props.onAuthenticated()` but does not `await` it or handle its rejection. If `handleAuthenticated` throws (e.g., a network error in one of the `invalidateQueries` calls), the error is silently swallowed.
- **Evidence:**
  ```ts
  onSuccess: () => props.onAuthenticated()
  ```
  `handleAuthenticated` is typed as `() => Promise<void>`, so this is a fire-and-forget.
- **Impact:** Auth state inconsistency after sign-in: the query cache may not have completed invalidation, and any error from it is lost.
- **Recommendation:** Either `await` it: `onSuccess: async () => { await props.onAuthenticated(); }`, or add a `.catch` that surfaces the error to the user.

---

### [LOW] Duplicate `formatDate` function — briefings-page defines its own instead of reusing task-format

- **File:** `apps/web/src/briefings/briefings-page.tsx:442-447`
- **Category:** Code Quality
- **Finding:** `briefings-page.tsx` defines a local `formatDate(value: string)` that formats a date with `dateStyle: "medium"` and `timeStyle: "short"`. `task-format.ts` already exports `formatDate(value: string | null)` with `dateStyle: "medium"`. These are functionally close but not identical (the briefings version adds `timeStyle`). However, a shared utility should be extracted that accepts an optional `timeStyle` parameter rather than forking the implementation.
- **Evidence:**
  ```ts
  // briefings-page.tsx:442
  function formatDate(value: string): string { ... timeStyle: "short" ... }
  // task-format.ts:9
  export function formatDate(value: string | null): string { ... dateStyle: "medium" ... }
  ```
- **Impact:** Two diverging date-formatting implementations; the briefings version silently differs (adds time) and is not exported/testable.
- **Recommendation:** Extend `task-format.ts` `formatDate` to accept `{ timeStyle?: ... }` options, or create a shared `apps/web/src/utils/format.ts` and delete both inline implementations.

---

### [LOW] Duplicate error-reading helper — `readError` in briefings-page duplicates `readErrorMessage` in app.tsx

- **File:** `apps/web/src/briefings/briefings-page.tsx:438-440`
- **Category:** Code Quality
- **Finding:** A local `readError(error: unknown, fallback: string)` function is defined in `briefings-page.tsx`. `app.tsx` defines `readErrorMessage(error: unknown): string` with the same structural pattern. Both extract `error.message` from an `Error` instance and return a fallback string otherwise.
- **Evidence:**
  ```ts
  // briefings-page.tsx:438
  function readError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }
  // app.tsx:117
  function readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unable to load Jarv1s";
  }
  ```
- **Impact:** Each new page that needs error display reinvents this. Currently 2 separate implementations; will grow.
- **Recommendation:** Extract to `apps/web/src/utils/errors.ts` and export a single `readError(error: unknown, fallback?: string): string`.

---

### [LOW] Dead API client exports: `deleteMemoryFact`, `switchChatProvider`, `getMemoryFacts`

- **File:** `apps/web/src/api/client.ts:279-291`
- **Category:** Code Quality
- **Finding:** Three exported functions have no callers anywhere in `apps/web/src/`:
  - `deleteMemoryFact(id: string)` — no component calls it
  - `switchChatProvider()` — no component calls it
  - `getMemoryFacts()` — no component calls it
  The corresponding query keys `queryKeys.chat.memoryFacts` is also defined but never used.
- **Evidence:** `grep -rn "deleteMemoryFact\|switchChatProvider\|getMemoryFacts"` in `apps/web/src/` returns only the definitions in `client.ts` and the key definition in `query-keys.ts`.
- **Impact:** Dead code that inflates the perceived API surface, confuses future developers about what features are active, and is not covered by tests.
- **Recommendation:** Remove `deleteMemoryFact`, `switchChatProvider`, `getMemoryFacts` from `client.ts` and `memoryFacts` from `query-keys.ts`. Restore them when `MemoryPanel` gains fact display/deletion functionality.

---

### [LOW] Dead query key: `queryKeys.chat.memoryFacts` unused

- **File:** `apps/web/src/api/query-keys.ts:33`
- **Category:** Code Quality
- **Finding:** `memoryFacts: ["chat", "memory-facts"] as const` is defined but has no consumer in the codebase. See also the dead `getMemoryFacts` export above.
- **Evidence:** No `queryKeys.chat.memoryFacts` reference outside `query-keys.ts`.
- **Impact:** Same as above — misleading API surface.
- **Recommendation:** Remove together with the dead API functions above.

---

### [LOW] `MemoryPanel` has a permanently-disabled checkbox with dead `factsEnabled` field

- **File:** `apps/web/src/chat/memory-panel.tsx:49`
- **Category:** Code Quality
- **Finding:** The "Remember facts about me" checkbox is unconditionally `disabled` and hardcoded `checked={false}`. The `factsEnabled` field exists in the `MemorySettings` interface in `client.ts` and is presumably a server-side field, but neither the `patchMemorySettings` call nor any query reads or writes it. This is scaffolding that was never connected.
- **Evidence:**
  ```tsx
  <input disabled type="checkbox" checked={false} />
  Remember facts about me (coming soon)
  ```
- **Impact:** Confusing dead UI that implies functionality which does not exist. `factsEnabled` in `MemorySettings` creates a misleading contract.
- **Recommendation:** Either remove the coming-soon checkbox entirely (it serves no function) or gate it behind a feature flag. Remove `factsEnabled` from `MemorySettings` until it has an implementation.

---

### [LOW] `ConnectorAccountRow` toggles between `active` and `error` states — misleading UX, correct domain logic

- **File:** `apps/web/src/connectors/connectors-panel.tsx:139`
- **Category:** Code Quality
- **Finding:** The `nextStatus` toggle on a connector account row cycles between `"active"` and `"error"`. This is technically correct given `ConnectorAccountStatus = "active" | "error" | "revoked"` (there is no `"disabled"` state for connector accounts), but the button label "Mark error" for what is effectively a "deactivate" action is confusing — it implies the connector has a problem rather than that the user is intentionally pausing it.
- **Evidence:**
  ```ts
  const nextStatus = props.account.status === "error" ? "active" : "error";
  // Button label:
  {nextStatus === "active" ? "Activate" : "Mark error"}
  ```
- **Impact:** Poor UX that may cause users to hesitate before using the action, or misunderstand the connector's health state.
- **Recommendation:** Evaluate whether a `"paused"` or `"disabled"` status should be added to `ConnectorAccountStatus` at the domain level. If not, improve the button label to "Pause" / "Resume" and add a tooltip explaining the semantics.

---

### [LOW] `RecordLog` uses array index as React key

- **File:** `apps/web/src/chat/chat-drawer.tsx:133`
- **Category:** Code Quality
- **Finding:** Chat transcript records are rendered with `key={index}`. Chat records are append-only (never reordered or deleted from the middle), so this is functionally correct in the current implementation. However, it is a fragile invariant — if `clearRecords` is ever replaced by a splice operation, React will reconcile incorrectly.
- **Evidence:**
  ```tsx
  {props.records.map((record, index) => (
    <RecordRow key={index} record={record} />
  ))}
  ```
- **Impact:** Low risk today due to append-only semantics, but brittle.
- **Recommendation:** Add a stable `id` field to `TranscriptRecord` (e.g., a sequential counter assigned by `parseRecord`), or at minimum use `${record.kind}-${index}` to make the intent explicit. A numeric counter assigned at parse time is the cleanest fix.

---

### [LOW] `main.tsx` non-null assertion on `getElementById("root")` without runtime guard

- **File:** `apps/web/src/main.tsx:20`
- **Category:** TypeScript
- **Finding:** `document.getElementById("root") as HTMLElement` asserts non-null without a guard. If `index.html` is ever modified to remove the `#root` div, `createRoot` will receive `null` and throw a runtime error with a confusing stack trace.
- **Evidence:**
  ```ts
  createRoot(document.getElementById("root") as HTMLElement).render(...)
  ```
- **Impact:** Developer experience — not a security issue. But this is a common source of confusing bootstrap failures.
- **Recommendation:**
  ```ts
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found in DOM");
  createRoot(root).render(...);
  ```

---

### [LOW] No React Error Boundary anywhere in the component tree

- **File:** `apps/web/src/` (all components)
- **Category:** Error Handling
- **Finding:** No `ErrorBoundary` class component (or equivalent library wrapper like `react-error-boundary`) exists anywhere in the frontend. If any synchronous rendering error occurs (e.g., a component receives an unexpected `undefined` where it expects an object, a third-party hook throws during render), React will unmount the entire tree and display a blank screen in production, with no user-visible error message or recovery path.
- **Evidence:** `grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError"` returns no results.
- **Impact:** Any rendering crash produces a blank screen with no retry mechanism. This is especially problematic for the `ChatDrawer` which renders SSE-driven data that could contain unexpected shapes.
- **Recommendation:** Add at minimum a top-level `<ErrorBoundary>` in `main.tsx` wrapping `<App />` that renders a "Something went wrong" message with a reload button. Consider also wrapping the `ChatDrawer` and `BriefingsPage` individually since they deal with dynamic/AI-generated data.

---

### [LOW] Admin-check in `ConnectorsPanel` is client-side UI gate only — `isAdmin` from `MeResponse` is trust-on-server

- **File:** `apps/web/src/connectors/connectors-panel.tsx:29`, `apps/web/src/settings/settings-page.tsx:17`
- **Category:** Security
- **Finding:** The `enabled: props.isAdmin` React Query gate prevents the admin connector accounts query from firing when `isInstanceAdmin` is false. This is purely a UI optimization — the actual server-side enforcement is via `requireAdmin()` in the route handler. This is the correct pattern: server enforces, UI optimizes. Confirmed: `packages/connectors/src/routes.ts:216` and `packages/settings/src/routes.ts` all call `requireAdmin`. This is not a security defect but is noted to confirm the pattern is correct.
- **Evidence:** `enabled: props.isAdmin` in `connectors-panel.tsx:29` and `settings-page.tsx:17/23`.
- **Impact:** None — security is server-enforced. Noting for audit completeness.
- **Recommendation:** No change required. Document the intentional two-layer pattern (UI gate + server enforcement) in a comment for future maintainers.

---

### [INFO] `requestJson` performs unchecked `JSON.parse(...) as T` casts — no runtime schema validation of API responses

- **File:** `apps/web/src/api/client.ts:509`
- **Category:** TypeScript
- **Finding:** Every API response is parsed with `JSON.parse(text) as T` — a structural cast with no runtime validation. If a backend API changes its response shape (e.g., removes a required field), TypeScript will not catch it and the component will receive `undefined` where it expects a string, leading to a rendering crash or silent data loss. This is idiomatic TypeScript for a tightly-coupled monorepo where the shared contract types are maintained in `@jarv1s/shared`, but it is worth noting as a fragility.
- **Evidence:**
  ```ts
  return text ? (JSON.parse(text) as T) : (undefined as T);
  ```
- **Impact:** No immediate security risk. Any contract mismatch between server and client will surface as a runtime TypeError rather than a helpful validation error. In a fast-iteration codebase this is a common source of subtle bugs.
- **Recommendation:** Not a blocker for current single-developer pace. For resilience, consider adding `zod` parse at the API boundary for critical paths (auth, task mutations) or at minimum add a linting rule to flag `as T` on `JSON.parse` results.

---

### [INFO] `parseJsonObject` in `ai-settings-panel.tsx` uses `JSON.parse(value) as unknown` with manual type narrowing — correct pattern

- **File:** `apps/web/src/ai/ai-settings-panel.tsx:533-541`
- **Category:** TypeScript
- **Finding:** `parseJsonObject` parses user-provided credential JSON with `JSON.parse(value) as unknown`, then manually checks it is an object and not an array before casting to `Record<string, unknown>`. This is the correct safe-cast pattern.
- **Evidence:**
  ```ts
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed as Record<string, unknown>;
  ```
- **Impact:** None — this is correct. Noted for completeness.
- **Recommendation:** No change required.

---

### [INFO] `authUrl` rendered as `<a href={authUrl}>` — confirmed safe: always a Google HTTPS URL

- **File:** `apps/web/src/connectors/connect-google-panel.tsx:79`
- **Category:** Security
- **Finding:** The `authUrl` received from the backend is rendered directly as an anchor `href`. A `javascript:` scheme URL here would be XSS. Verified: `buildAuthUrl` in `packages/connectors/src/oauth.ts:63` constructs the URL by calling `new URL(GOOGLE_AUTH_ENDPOINT)` where `GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"`. The resulting URL is always an HTTPS Google URL; the clientId is URL-parameter-encoded. No injection path exists.
- **Evidence:** `oauth.ts:63` — `const url = new URL(GOOGLE_AUTH_ENDPOINT)`.
- **Impact:** None — URL is safely constructed server-side. Noted for audit completeness.
- **Recommendation:** No change required. Optionally add a client-side `authUrl.startsWith("https://accounts.google.com/")` assertion before rendering the link to add defense-in-depth against a future regression.

---

### [INFO] `CalendarPage` and `EmailPage` are placeholder stubs using shared `ComingSoon` component

- **File:** `apps/web/src/calendar/calendar-page.tsx`, `apps/web/src/email/email-page.tsx`
- **Category:** Code Quality
- **Finding:** Both pages render only the `ComingSoon` component. The API functions `listCalendarEvents`, `getCalendarEvent`, `listEmailMessages`, `getEmailMessage` are exported from `client.ts` but have no callers. The corresponding query keys `queryKeys.calendar.*` and `queryKeys.email.*` are defined but unused in components.
- **Evidence:** No imports of those functions in any file outside `client.ts`.
- **Impact:** Dead exports. No security or architectural risk. As a positive signal, the stub pages are properly routed (no broken routes), and the query keys are pre-defined for when the feature lands.
- **Recommendation:** Remove the dead API function exports and query keys until the feature is built, consistent with the "no stale concepts" project standard. Restore them when Calendar/Email Phase 3 implementation begins.

---

## Non-Findings (Explicitly Cleared)

The following were investigated and found to be **not issues**:

- **XSS via chat SSE text:** All `{text}` values from SSE records are rendered through React JSX, which escapes HTML. No `dangerouslySetInnerHTML` anywhere.
- **Secret exposure in bundle:** No `VITE_*` env vars containing secrets. `import.meta.env.PROD` is the only env usage, for service worker registration gating. No credentials hardcoded.
- **Server-side auth for admin routes:** `requireAdmin()` is called in every `/api/admin/*` route handler. The frontend `isInstanceAdmin` flag is a UI optimization only.
- **IDOR on task detail routes:** `taskId` from URL params is passed to server-enforced routes that use `resolveAccessContext` and `DataContextDb` with RLS. Server enforces ownership.
- **`authUrl` injection (Google OAuth):** `buildAuthUrl` always generates an `https://accounts.google.com/...` URL. No user-controlled URL.
- **Credential pre-fill in AI provider update form:** The `AiProviderRow` only exposes activate/deactivate/revoke actions; there is no update form that would prefill a stored credential back into the browser.
- **`node:*` imports:** No `node:` protocol imports in any `apps/web/src/` file.
- **File size violations:** No file exceeds 1000 lines (largest is `ai-settings-panel.tsx` at 549 lines).
