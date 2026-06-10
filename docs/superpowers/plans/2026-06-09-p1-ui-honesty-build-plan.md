# Build Plan — P1 #60 (UI Honesty Pass)

**Issue:** #60 | **Branch:** p1-ui-honesty | **Agent:** build-60

## Tasks

### T1 — Create `ComingSoon` shared component

**File:** `apps/web/src/shell/coming-soon.tsx` (new)

Props: `{ title: string; note: string }`. Renders icon + title + one-line note using
existing `.empty-state` styling (~25 lines). No `node:*` imports; browser-safe.

---

### T2 — Calendar page → coming-soon

**File:** `apps/web/src/calendar/calendar-page.tsx`

- Remove: `useState`, `useMemo`, `useQuery`, filter state, filter toolbar section, event list
  section, `CalendarEventRow`, `EmptyState`, `readCalendarCounts`, `formatEventRange`, all now-unused
  imports (`CalendarEventDto`, `CalendarDays`, `Clock`, `Inbox`, `LoaderCircle`, `MapPin`,
  `listCalendarEvents`, `queryKeys`).
- Add: `<ComingSoon title="Calendar" note="Calendar sync arrives in Phase 3." />` inside
  `<section className="page-stack">`, below the existing page heading.
- Keep: page heading (`<div className="page-heading">` block), `CalendarPage` export.

---

### T3 — Email page → coming-soon

**File:** `apps/web/src/email/email-page.tsx`

- Remove: `useQuery`, message list section, `EmailMessageRow`, `EmptyState`,
  `formatMessageDate`, all now-unused imports (`EmailMessageDto`, `Inbox`, `LoaderCircle`, `Mail`,
  `listEmailMessages`, `queryKeys`).
- Add: `<ComingSoon title="Email" note="Email sync arrives in Phase 3." />` below page heading.
- Keep: page heading, `EmailPage` export.

---

### T4 — Chat facts panel → coming-soon + disable toggle

**File:** `apps/web/src/chat/memory-panel.tsx`

- Remove: `factsQuery` (`useQuery` for `getMemoryFacts`), `deleteFact` mutation, entire
  `memory-facts` section render (the `<h4>` + facts list).
- Remove imports: `deleteMemoryFact`, `getMemoryFacts` (no longer called; `X` icon stays — still
  used for the close button).
- Add in place of `memory-facts` section:
  ```tsx
  <section className="memory-facts">
    <h4>What Jarvis knows about you</h4>
    <p className="muted-text">Fact extraction coming in Phase 3.</p>
  </section>
  ```
- Disable "Remember facts about me" checkbox: add `disabled` and update label to
  `"Remember facts about me (coming soon)"`. The Recall toggle (`recallEnabled`) is untouched.

---

### T5 — Remove legacy connector token-paste form

**Files:** `apps/web/src/connectors/connectors-panel.tsx`, `apps/web/src/api/client.ts`

`connectors-panel.tsx`:

- Delete `CreateConnectorForm` function entirely (lines 104–189).
- Remove its call from `ConnectorsPanel` (lines 67–70 — `<CreateConnectorForm …/>`).
- Remove now-unused imports: `createConnectorAccount`, `useState`, `useMemo`, `useEffect`,
  `type { FormEvent }`, `LoaderCircle`, `Plus`.
- Remove `parseScopes` and `parseTokenPayload` helpers (lines 269–284).
- Remaining imports from client: `listAdminConnectorAccounts`, `listConnectorAccounts`,
  `listConnectorProviders`, `revokeConnectorAccount`, `updateConnectorAccount`.

`client.ts`:

- Delete `createConnectorAccount` export (line 425). Only caller was `CreateConnectorForm`.

---

### T6 — Clean AI provider credential placeholder

**File:** `apps/web/src/ai/ai-settings-panel.tsx`

- Line 123: change `useState('{"apiKey":"placeholder"}')` → `useState('{}')`
- Credential textarea: add `placeholder='{"apiKey":"sk-..."}'` attribute (hint, not default value).

---

### T7 — Update e2e tests

**`tests/e2e/app-shell.spec.ts`**

**Test "navigates Calendar and Email read surfaces through REST calls"** (line 84):

- Remove `calendarEvents` / `emailMessages` from mock state (not needed).
- Replace calendar event assertions (`getByText("Design review")`, `getByText("Alpha room")`) with
  assertion that the heading is visible + "coming soon" text is present.
- Replace email message assertions with equivalent coming-soon checks.

**Test "adds and revokes connector accounts through settings REST calls"** (line 117):

- Pre-seed one connector account in mock state (`connectorAccounts: [...]`).
- Remove form interactions (Provider select, Scopes, Token JSON fill, "Add connector" button click).
- Keep: verify the seeded account displays; verify the Revoke button still works and shows "Revoked".
- `createMockConnectorAccount` must be exported from `mock-api.ts` (currently private).

**`tests/e2e/mock-api.ts`**

- Export `createMockConnectorAccount` (add `export` keyword on line 818).
- No other changes — route handlers for calendar/email/createConnectorAccount can stay; they serve
  the backend routes even if the UI no longer calls them.

---

## Order of work

T1 → T2 → T3 → T4 → T5 → T6 → T7 (each committed green per task).

## Fast checks before PR

```
pnpm lint && pnpm format:check && pnpm typecheck
```

Then: `git fetch origin && git rebase origin/main`.
