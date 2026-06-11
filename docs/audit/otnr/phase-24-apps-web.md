## Phase 24 — apps/web (Vite React)

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 4
- LOW: 5
- INFO: 3

### Findings

#### [MED] React Query keys are not user-scoped — cross-user cache leakage depends entirely on one `queryClient.clear()`
**File:** `apps/web/src/api/query-keys.ts:1-51`, `apps/web/src/shell/app-shell.tsx:59-65`, `apps/web/src/app.tsx:34-47`  
**Invariant violated / concern:** "Private by default" / frontend cache hygiene — query keys carry no `actorUserId`, so cached private data (tasks, email, chat threads, memory facts, connector accounts) is keyed identically for every user.  
**Detail:** Every key is a static tuple (`["tasks","list"]`, `["chat","threads"]`, etc.) with no user component. The ONLY thing preventing user A's cached private data from being shown to user B in the same tab is `signOutMutation.onSuccess → queryClient.clear()` followed by `window.location.assign("/")` (a full reload). `handleAuthenticated` (sign-in) does NOT clear — it only `invalidateQueries` by prefix, which marks stale but keeps the stale data renderable until refetch resolves. The full reload on sign-out is the real safety net; if a future refactor turns sign-out into a SPA transition (no reload) or an auth-expiry path re-renders without `clear()`, stale private data from the previous user becomes visible. This is fragile defense-in-depth resting on an incidental `window.location.assign`.  
**Suggested fix:** Either (a) include `me.user.id` in the React Query key namespace (e.g. a top-level `["u", userId, ...]` prefix via a key factory), so a different user can never read another user's cache entry; or (b) make the invariant explicit by calling `queryClient.clear()` on every auth-state transition (sign-in success AND any 401/auth-expiry render) rather than relying on the sign-out reload.

#### [MED] `handleAuthenticated` enumerates query prefixes by hand — silently misses `notifications`, drifts as modules are added
**File:** `apps/web/src/app.tsx:34-47`  
**Invariant violated / concern:** Special-case sprawl / maintainability — a hand-maintained list of cache namespaces that must stay in sync with `query-keys.ts`.  
**Detail:** `handleAuthenticated` invalidates a hardcoded list: `auth, ai, briefings, calendar, chat, email, modules, notifications, tasks`. It happens to cover the current namespaces, but `settings` (auth providers, workspaces, admin connector accounts) and `connectors` are NOT in the list, so admin/connector data fetched before sign-in is not invalidated on a new sign-in. Any namespace added to `query-keys.ts` must be remembered here too — there is no compile-time link between the two. This is the same drift risk as the cache-scoping finding above and is best solved by the same fix.  
**Suggested fix:** Replace the enumerated `invalidateQueries` calls with a single `queryClient.clear()` (or `invalidateQueries()` with no key, which invalidates everything) on auth transition. The selective list buys nothing here and is a latent correctness bug.

#### [MED] Dead client API surface — ~9 exported functions and 2 types with zero callers
**File:** `apps/web/src/api/client.ts:233-239,176-186,289-291,279-287,307-309`  
**Invariant violated / concern:** Dead code / "remove dead vocabulary in the same pass" (CLAUDE.md No-Stale-Concepts).  
**Detail:** Grep across `apps/web/src` shows these exported functions are never called by any component: `getCalendarEvent`, `listCalendarEvents`, `getEmailMessage`, `listEmailMessages` (calendar/email are "Coming Soon" stubs — see `calendar-page.tsx`, `email-page.tsx`), `listFocusTasks`, `listAtRiskTasks`, `listOverdueTasks`, `switchChatProvider`, `getMemoryFacts`, `deleteMemoryFact`. The `MemoryFact` interface (`client.ts:262-269`) and the facts-related functions are unused — `memory-panel.tsx` hardcodes "Fact extraction coming in Phase 3" and never lists/deletes facts. This is a real maintenance tax: the client carries (and imports response types for) endpoints no UI exercises, obscuring which contracts are live.  
**Suggested fix:** Delete the unused functions and `MemoryFact` type (and their now-unused `@jarv1s/shared` type imports). Re-introduce per endpoint when the consuming UI is actually built, gated behind the relevant spec/milestone.

#### [MED] Credential JSON entered as free-form text and posted verbatim — bypasses typed contract, weak client validation
**File:** `apps/web/src/ai/ai-settings-panel.tsx:123-136,202-213,533-541`  
**Invariant violated / concern:** Cast-heavy/loose contract over a secret-bearing field; over-trusting user-typed JSON for credentials.  
**Detail:** The AI-provider API-key flow asks the user to paste raw `Credential JSON` (`{"apiKey":"sk-..."}`) into a `<textarea>`, then `parseJsonObject` only checks "is a non-array object" and ships the whole `Record<string, unknown>` to `POST /api/ai/providers` as `credentialPayload`. There is no client-side schema for the expected shape (e.g. `apiKey: string`), so typos produce an opaque server error rather than a field-level message, and the secret transits as an arbitrary blob. This is a UX/contract smell rather than a leak (the secret is meant to be sent and is encrypted server-side), but the free-form JSON textarea is exactly the kind of loose boundary the standards discourage. (Server-side validation/encryption is the real gate — confirm in the API/AI phase audits.)  
**Suggested fix:** Replace the JSON textarea with a typed field (single `API key` input for the common case), build the `credentialPayload` object in code, and validate the shape against the shared request type before mutating. Keep raw-JSON only behind an "advanced" toggle if a provider genuinely needs extra fields.

#### [LOW] `parseRecord` casts `parsed.kind` to the union without membership check — SSE can inject an out-of-union kind
**File:** `apps/web/src/chat/use-chat-stream.ts:55-71`  
**Invariant violated / concern:** Unsafe cast muddying the real contract (TS dimension D).  
**Detail:** `parseRecord` validates `typeof parsed.kind === "string"` then does `kind: parsed.kind as ChatRecordKind`. Any string the server emits (or a malformed/foreign `data:` frame) is accepted as a valid `ChatRecordKind`. `RecordRow` has a catch-all `else` branch so it renders harmlessly as `${kind}: ${text}`, but the type now lies — downstream code that switches on `kind` would believe it is exhaustive. Not a security issue (text is rendered via React text nodes, auto-escaped; no `dangerouslySetInnerHTML` anywhere in the tree), purely a soundness gap.  
**Suggested fix:** Validate `parsed.kind` against a `ChatRecordKind` set (`const KINDS = new Set([...])`) and return `null` (or a typed `"status"` fallback) when it is not a member, instead of casting.

#### [LOW] Repeated `(effort || null) as "quick" | "medium" | "large" | null` casts duplicate the canonical effort type
**File:** `apps/web/src/tasks/task-detail-page.tsx:63`, `apps/web/src/tasks/task-capture.tsx:33`  
**Invariant violated / concern:** Cast-heavy contract / duplicated inline literal of a type that already exists in `@jarv1s/shared` and in `task-format.ts` (`effortLabels` keys).  
**Detail:** Both task forms hold `effort` as a plain `string` state and assert it to the effort union at submit time. The literal `"quick" | "medium" | "large"` is repeated inline in two files even though the same triple is the key type of `effortLabels` in `task-format.ts:35`. A typo in either copy would not be caught. The `<select>` only offers valid values, so the cast is "safe" in practice, but it is an unverified assertion.  
**Suggested fix:** Export a shared `TaskEffort` type (from `@jarv1s/shared` if it exists there, else from `task-format.ts`) and type the `effort` state as `TaskEffort | ""`, eliminating the cast at both call sites.

#### [LOW] Briefing run idempotency key built on the client from `Date.now()`
**File:** `apps/web/src/briefings/briefings-page.tsx:276-278`  
**Invariant violated / concern:** Idempotency correctness — a client-minted `web:${id}:${Date.now()}` key changes on every click.  
**Detail:** The "Run briefing" button generates `idempotencyKey: web:${definitionId}:${Date.now()}`. Because the timestamp is fresh per click, the key provides no actual idempotency — a double-click (or a retry after a slow response) produces two distinct keys and can enqueue two runs. The whole point of an idempotency key is to dedupe retries of the *same* logical action; a per-click timestamp defeats it.  
**Suggested fix:** Derive the key from a stable per-invocation token captured once when the user initiates the run (e.g. a `useRef` UUID reset on success), or let the server mint/dedupe. At minimum disable the button while `runMutation.isPending` is already true (it is) AND key off something stable.

#### [LOW] `iconMap` lookup duplicated across `NavItem` and `ChatNavToggle`
**File:** `apps/web/src/shell/app-shell.tsx:168-204`  
**Invariant violated / concern:** Minor duplication / missed extraction.  
**Detail:** Both `NavItem` and `ChatNavToggle` compute `const Icon = props.entry.icon ? (iconMap[props.entry.icon] ?? Layers3) : Layers3;` identically, then render `<Icon size={18} />`. The icon-resolution rule is copied. Low impact, but it is the kind of incidental duplication a thermo-nuclear pass should collapse.  
**Suggested fix:** Extract `resolveNavIcon(entry): ComponentType` (or a tiny `<NavIcon entry=.../>`), used by both. Trivial.

#### [LOW] `settings-page.tsx` reconstructs workspace names via nested `.find()` per membership (O(n·m))
**File:** `apps/web/src/settings/settings-page.tsx:66-77`  
**Invariant violated / concern:** Incidental complexity / quadratic lookup over data the server already correlates.  
**Detail:** For each membership it runs `props.me.workspaces.find(item => item.id === membership.workspaceId)`. With the house model this is small, but it is an O(memberships × workspaces) scan rebuilt on every render to recover a name the backend could include directly on the membership DTO. The membership/workspace split here is also a remnant of the multi-workspace concept; per project memory the model is now a single-house model.  
**Suggested fix:** Either include `workspaceName` on the membership DTO server-side, or build a `Map<id, workspace>` once (`useMemo`). If memberships/workspaces are vestigial under the house model, consider removing this panel entirely (separate spec).

#### [INFO] No XSS, no client-side secret exposure, no `localStorage`/`sessionStorage` token storage, no `node:*` imports, no `as any`
**File:** `apps/web/src/` (whole tree)  
**Invariant violated / concern:** Reviewed and clean (dimensions A, secret exposure, browser-bundle hygiene).  
**Detail:** Grep across the tree found zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function`; all user/server content renders through React text nodes (auto-escaped). No `process.env`/secret access in the bundle — the only `import.meta.env` use is `import.meta.env.PROD` in `register-service-worker.ts:2` (a build flag, not a secret). No `localStorage`/`sessionStorage` — auth rides on `credentials: "include"` cookies (`client.ts:495`), so no token is exposed to JS. No `node:*` imports in the browser package (consistent with the Shared-Browser-Bundle invariant). No `as any` / non-null-assertion abuse; the single `as HTMLElement` in `main.tsx:20` is the idiomatic root mount.  
**Suggested fix:** None. Maintain the no-`dangerouslySetInnerHTML` posture if/when markdown rendering of chat replies is added (use a sanitizing renderer).

#### [INFO] Auth/admin gating is server-trusted, not client-enforced — correct posture
**File:** `apps/web/src/settings/settings-page.tsx:16-27,91-133`, `apps/web/src/connectors/connectors-panel.tsx:28-33`  
**Invariant violated / concern:** Reviewed — no client-side authorization that must be server-enforced (IDOR/priv-esc).  
**Detail:** `isInstanceAdmin` (from `me`) only gates whether admin queries are *fired* (`enabled: props.me.user.isInstanceAdmin`) and whether admin panels render — it is a UX affordance, not an authorization boundary. The actual admin endpoints (`/api/admin/...`) must enforce authorization server-side (verify in the API phase audit). There is no client-side filtering of resources by ID that substitutes for server RLS: all list/detail fetches hit owner-scoped endpoints and the client does not, e.g., filter someone else's tasks out in JS. `tasks-page.tsx` client filtering (`visibleTasks`) is purely presentational (search/status/list), over data the server already scoped to the owner.  
**Suggested fix:** None at the web layer. Ensure the corresponding `/api/admin/*` route audit confirms server-side admin checks and RLS.

#### [INFO] No source file exceeds the 1000-line limit; largest is `ai-settings-panel.tsx` at 549 lines
**File:** `apps/web/src/ai/ai-settings-panel.tsx:1-550`  
**Invariant violated / concern:** Reviewed — file-size gate (`pnpm check:file-size`) is satisfied.  
**Detail:** Total `apps/web/src` is ~4187 lines across 28 files. Largest files: `ai-settings-panel.tsx` (549), `api/client.ts` (527), `briefings-page.tsx` (447), `task-detail-page.tsx` (398). All well under 1000. `ai-settings-panel.tsx` bundles five sub-components (provider form, model form, two lists, capability lookup) in one file; it is cohesive but is the first candidate to split if it grows — flagging proactively, not as a violation.  
**Suggested fix:** None required now. If `ai-settings-panel.tsx` grows, split the create-forms and the row/list components into sibling files.
