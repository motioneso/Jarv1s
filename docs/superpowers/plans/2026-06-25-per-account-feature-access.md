# Per-account, per-feature access controls Implementation Plan

> **Coordination override:** `coordinated-build` disables execution sub-skills in this repo. Execute inline with TDD after Coordinator approval.

**Goal:** Decouple technical capability (OAuth scope) from user choice for email/calendar. Add a per-connected-account, per-feature grant stored in `app.preferences`. A feature is usable only when BOTH `account.scopes.includes(X)` AND the per-account grant is enabled.

**Architecture:** One JSON preference per account: `connector.<accountId>.feature_grants` = `{ email: boolean, calendar: boolean }` under owner-scoped RLS. A shared `isFeatureGranted` helper reads the pref (no-row = default-on for every scope the account has — legacy + fresh-connect parity). The gate is added at (a) sync sections, (b) the live read tools, (c) the calendar-write scope check. Cached-data retention on revoke (no deletion).

**Tech Stack:** Fastify routes, `DataContextRunner`, `PreferencesRepository`, `recordAuditEvent` from `@jarv1s/settings`, React, React Query, Vitest.

---

## Verified Branch State / Drift (grounded on `build/per-account-feature-access` @ `fdf381b`)

- Spec is current. Wave 2 (#494/#495/#496/#497) merged; no spec premise shifted.
- `sync-jobs.ts` gates calendar at **L321** (`account.scopes.includes(CALENDAR_SCOPE)`) and email at **L400** (`GMAIL_SCOPE`). Spec cited L313/L385 — minor drift, gates unchanged. `account.id` is in scope at both.
- `repository.ts:340` `hasCalendarWriteScope(scopedDb)` checks scope only; used by `chat/calendar-write-impl.ts:61` for focus-block insertion.
- **Live read tools** (`packages/connectors/src/live-tools.ts`): `gmail.searchLive`/`gmail.getLiveMessage`/`calendar.listLiveEvents` resolve the active google account implicitly via `freshToken`→`getActiveGoogleAccountSecret` (returns `{id}`). Per-account gate fits here.
- `PreferencesRepository` (`packages/structured-state/src/preferences-repository.ts`) matches spec: `get`/`upsert`/`delete`/`list`, owner-scoped RLS via `app.current_actor_user_id()`.
- `recordAuditEvent` (`@jarv1s/settings`) is the sanctioned cross-module audit writer (precedent: `ai/admin-ai-pin-routes.ts:73`).

### ⚠ Design fork to flag to Coordinator (resolved — see Task 0)

Spec §4 says gate "the email/calendar assistant tools (read tools) ... in `packages/email/src/tools.ts` / `packages/calendar/src/tools.ts`". **But those read module-wide CACHED data with no account ID in context** — `emailListVisibleMessagesExecute` / `calendarListVisibleEventsExecute` aggregate across all the owner's accounts, so a per-account grant cannot gate them cleanly. The **live** tools in `live-tools.ts` ARE per-account (resolve the active google account).

**Resolution taken (confirm with Coordinator):** gate the **live** per-account tools (Task 4) + sync (Task 3) + write scope (Task 6). The cached module-wide tools are OUT of scope for per-account gating (they're governed by the existing module-level `sourceBehaviors` axis + RLS). This matches the spec's "compose with module-level behaviors" framing (§6). If Coordinator wants cached tools gated too, that needs a separate design (per-row filter on `connector_account_id`'s grant) — flagged as out-of-scope phase-1.

---

## Files

- **Create** `packages/connectors/src/feature-grants.ts` — shared `isFeatureGranted` helper + pref shape + types.
- **Modify** `packages/connectors/src/sync-jobs.ts` — gate calendar (L321) + email (L400) sync sections on grant; add `PreferencesRepository` to `GoogleSyncDeps`.
- **Modify** `packages/connectors/src/repository.ts` — `hasCalendarWriteScope` gains grant check (needs `accountId`).
- **Modify** `packages/connectors/src/live-tools.ts` — gate the three live tools on the active account's grant.
- **Modify** `packages/connectors/src/routes.ts` — new GET/PUT `/api/connectors/accounts/:id/feature-grants`; PUT audits via `recordAuditEvent`.
- **Modify** `packages/connectors/src/manifest.ts` — register the two new routes.
- **Modify** `packages/connectors/src/index.ts` — export `feature-grants.ts`.
- **Modify** `packages/shared/src/connectors-api.ts` — DTOs + schemas for feature-grants.
- **Modify** `packages/chat/src/calendar-write-impl.ts` — pass resolved accountId into the scope check (or gate via helper).
- **Modify** `apps/web/src/api/client.ts` + `query-keys.ts` — client fns + keys.
- **Modify** `apps/web/src/settings/settings-personal-data-panes.tsx` (`AccountRow`) — per-feature toggles.
- **Modify** composition host — inject `PreferencesRepository` into sync deps (check where `registerConnectorsJobWorkers` is called).
- **Tests:** `tests/integration/connectors-feature-grants.test.ts` (new), extend `tests/integration/google-sync.test.ts`, `tests/unit/feature-grants.test.ts` (new).

---

### Task 0: Coordinator fork confirmation

- [ ] **Escalate** the cached-tools design fork (above) to Coordinator before building. Wait for ack. (If Coordinator defers cached tools to phase-2 as resolved, proceed to Task 1.)

---

### Task 1: Feature-grants helper + unit tests (TDD)

**Files:**
- Create: `packages/connectors/src/feature-grants.ts`
- Create: `tests/unit/feature-grants.test.ts`
- Modify: `packages/connectors/src/index.ts`

- [ ] **Step 1: Write failing tests** in `tests/unit/feature-grants.test.ts`:
  - `isFeatureGranted` returns `true` when pref is absent (default-on).
  - Returns the stored boolean when pref row present (`{email:false, calendar:true}` → email denied, calendar granted).
  - Malformed pref (not a record) → default-on (`true`).
  - Pref present but feature key missing → `false` (explicit absence ≠ default-on; only no-row-at-all defaults on). *Confirm this edge with Coordinator's reading of spec §4.*
  - `resolveEffectiveGrants(scopes, stored)` merges default-on-by-scope with stored: an account with calendar scope + no pref → `{calendar:true}`; with pref `{calendar:false}` → `{calendar:false}`.

- [ ] **Step 2: Implement** `feature-grants.ts`:
  ```ts
  export type ConnectorFeature = "email" | "calendar";
  export interface FeatureGrants { readonly email: boolean; readonly calendar: boolean; }
  export function featureGrantsPrefKey(accountId: string): string {
    return `connector.${accountId}.feature_grants`;
  }
  export function isFeatureGranted(stored: unknown, feature: ConnectorFeature): boolean {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return true; // no/malformed row = default-on
    return (stored as Record<string, unknown>)[feature] === true;
  }
  export function resolveEffectiveGrants(scopes: readonly string[], stored: unknown): FeatureGrants {
    const hasEmail = scopes.includes(GMAIL_SCOPE) || scopes.includes("gmail");
    const hasCal = scopes.includes(CALENDAR_SCOPE) || scopes.includes("calendar");
    const base = (f: ConnectorFeature) => isFeatureGranted(stored, f);
    return { email: hasEmail && base("email"), calendar: hasCal && base("calendar") };
  }
  ```
  Export `GMAIL_SCOPE`/`CALENDAR_SCOPE` from sync-jobs (currently module-private) OR redefine here — prefer export from sync-jobs to keep one source of truth.

- [ ] **Step 3:** Export from `index.ts`. Run `pnpm vitest tests/unit/feature-grants.test.ts` → green. Commit.

---

### Task 2: DTOs + schemas (shared)

**Files:**
- Modify: `packages/shared/src/connectors-api.ts`

- [ ] **Step 1:** Add `FeatureGrantsResponse { email: boolean; calendar: boolean }`, `UpdateFeatureGrantsRequest { email?: boolean; calendar?: boolean }`, JSON schemas (response 200 + PUT body), and route schemas `getFeatureGrantsRouteSchema` / `putFeatureGrantsRouteSchema`. Mirror the shape of existing connector schemas (`additionalProperties:false`, 400/401/403/404 error responses on PUT).
- [ ] **Step 2:** `pnpm typecheck` → green. Commit.

---

### Task 3: Sync grant gate (TDD)

**Files:**
- Modify: `packages/connectors/src/sync-jobs.ts`
- Test: `tests/integration/google-sync.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — add cases to `google-sync.test.ts`:
  - Pref `{calendar:false}` set on the account → sync skips calendar section (`calendarUpserted:0`, no calendar API call) but still syncs email.
  - Pref `{email:false}` → sync skips email section, still syncs calendar.
  - No pref row → both sync (default-on).
  - Mock `PreferencesRepository` via `GoogleSyncDeps` (add `preferences?: PreferencesRepository` to the deps interface; default `new PreferencesRepository()`).

- [ ] **Step 2: Implement** — add `readonly preferences?: PreferencesRepository` to `GoogleSyncDeps`; in `runGoogleSync` after resolving `account`, read grants once: `const grants = await preferences.get(scopedDb, featureGrantsPrefKey(account.id))`. Replace the calendar gate `account.scopes.includes(CALENDAR_SCOPE)` with `account.scopes.includes(CALENDAR_SCOPE) && isFeatureGranted(grants,"calendar")`; same for email. Wire `preferences` in `registerConnectorsJobWorkers` (instantiate `new PreferencesRepository()`).

- [ ] **Step 3:** Run sync tests → green. Commit.

---

### Task 4: Live tools grant gate (TDD)

**Files:**
- Modify: `packages/connectors/src/live-tools.ts`

- [ ] **Step 1: Write failing tests** — `tests/unit/live-tools-feature-grants.test.ts`:
  - `gmail.searchLive` returns a "feature disabled" result when the active account's email grant is off.
  - `calendar.listLiveEvents` likewise for calendar grant off.
  - Grant on → normal behavior (existing tests cover the happy path).
  - Resolve the active account via `repository.getActiveGoogleAccountSecret` (already used by `freshToken`); read grants for that `id`.

- [ ] **Step 2: Implement** — in `makeGmailSearchLiveExecute`/`makeGmailGetLiveMessageExecute`, after resolving the token (which resolves the active account), fetch the account id + grants and short-circuit with `{ data: { error: "Email access disabled for this account", code: "CONNECTOR_FEATURE_GRANT_DISABLED" } }` if `isFeatureGranted(grants,"email")===false`. Add `LiveGoogleToolDeps.preferences?: PreferencesRepository` + `repository` accessor for the account id. Same for calendar.

- [ ] **Step 3:** Run → green. Commit.

---

### Task 5: Routes GET/PUT feature-grants + audit (TDD)

**Files:**
- Modify: `packages/connectors/src/routes.ts`
- Test: `tests/integration/connectors-feature-grants.test.ts` (new)

- [ ] **Step 1: Write failing tests:**
  - `GET /api/connectors/accounts/:id/feature-grants` returns `{email:true, calendar:true}` for an account with both scopes, no pref (default-on).
  - `PUT` body `{email:false}` → returns `{email:false, calendar:true}` (partial update; calendar untouched); subsequent GET confirms.
  - `PUT` writes audit row `action:"connector.feature_grant.set"`, `targetType:"connector_account"`, `targetId:id`, metadata `{feature:"email", enabled:false}`.
  - `PUT` for another user's account → 404 (RLS hides it; `requireVisibleAccount` returns not-found).
  - Nonexistent account id → 404.

- [ ] **Step 2: Implement** in `routes.ts`:
  - `GET` handler: resolve account via `requireVisibleAccount`-style RLS check, read pref, return `resolveEffectiveGrants(account.scopes, stored)`.
  - `PUT` handler: validate body (`{email?:boolean, calendar?:boolean}`), read current pref (or default `{}`), merge provided keys, `preferences.upsert`, then audit via `recordAuditEvent` (one event per changed feature, or one aggregate event — *prefer one event per feature change for clarity*), then return effective grants.
  - Add `preferences?: PreferencesRepository` + `dataContext` (already present) to `ConnectorsRoutesDependencies`.

- [ ] **Step 3:** Run → green. Commit.

---

### Task 6: Calendar-write scope check + grant

**Files:**
- Modify: `packages/connectors/src/repository.ts`
- Modify: `packages/chat/src/calendar-write-impl.ts`

- [ ] **Step 1:** `hasCalendarWriteScope` currently reads the active google account + checks scope. Extend it to also require the calendar grant: accept the `PreferencesRepository` (or have the caller gate). **Cleanest:** rename existing to `getActiveGoogleAccountCalendarWriteScope(db): Promise<{accountId, hasScope} | undefined>` and let `calendar-write-impl.ts` check the grant via `isFeatureGranted` using the returned `accountId`. *Confirm API shape with a quick check it doesn't break other callers (grep shows only `calendar-write-impl.ts:61`).*
- [ ] **Step 2:** Update `calendar-write-impl.ts` to gate on `hasScope && isFeatureGranted(grants,"calendar")`; return the existing "couldn't create" style message when the grant is off.
- [ ] **Step 3:** typecheck + existing calendar-write tests → green. Commit.

---

### Task 7: Manifest route registration

**Files:**
- Modify: `packages/connectors/src/manifest.ts`

- [ ] Add the two routes to `manifest.routes[]` with `permissionId:"connectors.manage"` (user toggles own account; not admin-only — matches spec §7). Response schemas from Task 2. Commit.

---

### Task 8: Web client + query keys

**Files:**
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts`

- [ ] Add `getFeatureGrants(accountId)`, `updateFeatureGrants(accountId, body)` client fns (mirror `revokeConnectorAccount` pattern). Add `queryKeys.connectors.featureGrants: (id) => ["connectors","feature-grants",id]`. typecheck. Commit.

---

### Task 9: UI — per-account feature toggles

**Files:**
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx` (`AccountRow`)

- [ ] **Step 1:** In `AccountRow`, detect scope support: `hasEmail = account.scopes.some(s => s.includes("gmail") || s.includes("mail"))`, `hasCalendar = account.scopes.some(s => s.includes("calendar"))`. For each supported feature, render a small toggle (reuse `jds-btn`/authored toggle pattern — check existing toggle UI in `ModulesPane` around L660/L727). Label: "Email access" / "Calendar access" with copy *"Jarvis may read your email from this account."*
- [ ] **Step 2:** Toggle → `updateFeatureGrants` mutation → on success invalidate `queryKeys.connectors.accounts` + `featureGrants(id)`.
- [ ] **Step 3:** Visual check (manual or snapshot if a test exists). `pnpm format:check && pnpm lint && pnpm typecheck` → green. Commit.

---

### Task 10: Full gate + rebase + closeout

- [ ] `pnpm format:check && pnpm lint && pnpm typecheck`
- [ ] `pnpm vitest run` (or `pnpm verify:foundation` if fast enough) — all green.
- [ ] `git fetch origin main && git rebase origin/main`
- [ ] Re-run gate post-rebase.
- [ ] Invoke `coordinated-wrap-up`: push, open PR, report to Coordinator.

---

## Exit Criteria (from spec §9)

- [ ] Connected account shows separate email/calendar toggles where the account has those scopes.
- [ ] User can grant/revoke each feature independently, even on the same account.
- [ ] Jarvis uses email/calendar only when BOTH scope AND per-account grant allow it — verified in sync (Task 3) + live tools (Task 4) + write (Task 6).
- [ ] Default-on at connect; reversible anytime.
- [ ] Revoke blocks future use immediately; cached data retained.
- [ ] One feature grant cannot imply the other (independent JSON keys).
- [ ] No secrets in responses/audit; no new DB table/migration.

## Out of scope (per spec §11 + Task 0 resolution)

- Purge cached data on revoke (deferred to #473).
- Per-feature read granularity within email.
- Admin-managed per-account grants.
- Grant expiry / time-windowed access.

### Phase-2 deferred: gating the module-wide cached read tools

The cached read tools — `emailListVisibleMessagesExecute` (`packages/email/src/tools.ts`) and
`calendarListVisibleEventsExecute` (`packages/calendar/src/tools.ts`) — are **deliberately NOT
gated** by the per-account grant in this phase. This is a known design limitation, not an oversight.

**Why deferred — no `accountId` in tool context.** These tools aggregate cached rows across ALL of
the owner's connector accounts (e.g. `EmailRepository.listVisible` returns every visible
`app.email_messages` row for the actor, with no account filter). The `ToolExecute` signature
receives `(scopedDb, input, ctx, services)` — there is no account selector in `input`, and the tool
does not resolve "the active account" the way the live tools do. A per-account grant therefore
cannot gate these tools cleanly without a redesign of the read path:

- Option A (per-row): join cached rows to their `connector_account_id`, resolve each row's account
  grant, and filter — a cross-module query (`email`/`calendar` reading `connector_accounts` +
  `app.preferences`), which would violate **module isolation** unless surfaced via a sanctioned API.
- Option B (scope the tool): add an `accountId`/account-picker to the tool input + a per-account
  read variant — a product change, not just an access-control toggle.

Either option is real work and was not part of #482's phase-1 scope. **Phase-1 coverage of cached
reads relies on composition** (spec §6): the existing module-level `sourceBehaviors` axis
(module-wide behavior toggle in the Data sources pane) + owner-scoped RLS already govern these
tools. A user who wants cached reads fully blocked can disable the module behavior; per-account
granularity for cached reads ships in phase-2 alongside the per-row design (ideally paired with
#473's reconciliation machinery, which already touches per-account cached data).
