## Phase 5 — Web surface

Built from `apps/web/src/job-search-prototype/variant-flow.tsx`. Read that file and `flow.css`
before starting: they hold the decided shape and the reasoning in their header comments. The
prototype's fake data does **not** come across — every value comes from a tool result.

### Task 18: Web entrypoint, the empty-install bootstrap, and the onboarding/board branch

The module's surface, the branch between onboarding and board, and the only path a freshly
installed module has out of having zero profiles.

**Depends on:** Task 15 (`job-search.profile.list` read tool, the `job-search.crawl-run` manual
queue), Task 16 (the tool names it calls).

**Files**

- Read first: `external-modules/finance/src/web/index.ts` — the entrypoint contract
- Read first: `apps/web/src/external-modules/host-actions.ts` — what `openAssistant` actually does
- Create: `external-modules/job-search/src/web/{index.ts,root.tsx,use-profiles.ts,api.ts,styles.css}`
- Test: `tests/unit/job-search-web-root.test.tsx`
- Test: `tests/unit/job-search-use-profiles.test.tsx`

**Contracts**

```ts
type ProfilesState =
  | { status: "loading" }
  | { status: "empty" } // zero profiles → bootstrap panel
  | { status: "ready"; profiles: Profile[]; selectedId: string };

export interface UseProfilesOptions {
  /** The bootstrap latch. `Root` owns it, not the hook: the thing that arms polling is a
   *  button press in `Root`'s bootstrap panel, and the thing that clears it is either a
   *  profile arriving or expiry. `false` means the hook schedules no interval at all. */
  pollArmed: boolean;
  /** Fired once when the window or the attempt cap is reached. `Root` responds by setting
   *  `pollArmed` back to false and rendering the retry action. The hook does not own the
   *  latch, so it cannot clear it itself — it reports. */
  onPollExpired(): void;
}

export function useProfiles(options: UseProfilesOptions): ProfilesState & {
  refetch(): void;
  select(id: string): void;
};
```

```ts
// src/web/api.ts — the module's transport, and the ONLY place it talks to the host.
export async function invokeTool(name: string, input?: Record<string, unknown>): Promise<unknown>;

/** Enqueue a manual run on a declared queue. Mirrors finance's `runQueue`
 *  (`external-modules/finance/src/web/api.ts:96`) exactly — same route, same body shape,
 *  same outcome union — because this is a host route with a fixed contract, not a place to
 *  be creative. `POST /api/modules/job-search/queues/:queueName/run`, body
 *  `{jobKind, params?}`, 202 → queued (a null jobId means the actor's manual singleton is
 *  already queued), 404 → the queue is not manual-runnable, anything else → error. */
export type RunOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "disabled" }
  | { kind: "error"; message: string };
export function runQueue(
  queueName: string,
  jobKind: string,
  params?: Record<string, unknown>
): Promise<RunOutcome>;
```

Module constants, named so the tests can shorten them and no call site hardcodes a number:
`POLL_INTERVAL_MS = 3_000`, `POLL_WINDOW_MS = 120_000`, `POLL_MAX_ATTEMPTS = 40`.

**The poll split.** The hook owns the **timing** — the interval, the attempt counter, the
`visibilitychange` subscription, and the hidden-time accounting. `Root` owns the **latch and the
UI** — `pollArmed`, the bootstrap button that sets it, and the retry action `onPollExpired` causes
it to render. Neither half can be tested without the other being nameable, which is why the
contract is written before the tests.

**Constraints**

- **The hook is plural.** Multiple profiles is a settled product decision, and a singular
  `useProfile` bakes "there is exactly one" into the first file every later screen imports.
- **`runQueue` is the only thing in the entire product that starts a crawl.** A worker handler
  cannot enqueue — there is no jobs port on `ModuleWorkerContext` — and the schedule only ever
  reaches `crawl.sweep`. If `runQueue` is not written and wired, a user can finish the
  conversation, watch `criteria.set` return `readyToCrawl: true`, and wait forever for a first
  crawl that nothing asked for. Two call sites, both required: the `readyToCrawl` transition here,
  and the board's "Search now" button (Task 20).
- **The enqueue latch persists under `actorScopeKey` + profile id, in module-local storage** —
  not in component state. An in-memory latch is cleared by a page reload, so the "once per
  transition" guarantee lasts exactly as long as the tab does: reload twice and the queue takes
  three jobs for one transition. `actorScopeKey` is in the latch key because module-local storage
  is per-browser, not per-actor, and a second signed-in user must not inherit the first's latch.
  **Task 20's "Search now" bypasses the latch entirely** — it is an explicit user action, and a
  deliberate re-run must not be swallowed by a record of an automatic one.
- **The empty install is a real state with a real path out of it.** A freshly installed module has
  zero profiles and cannot create one itself: `hostActions.openAssistant({starterPrompt})` inserts
  an **editable, unsent draft** into the assistant composer and never runs a tool
  (`apps/web/src/external-modules/host-actions.ts`); the browser REST invoke route serves
  `risk: "read"` tools only and 403s writes, and `profile.create` is a write tool; `Root` receives
  only `{hostActions, assistantSurface?}` (`apps/web/src/external-modules/loader.ts:10-19`) and is
  never handed a profile. So the bootstrap is a five-step handoff: empty state renders a
  module-owned panel with one primary action → the action opens the composer with a starter prompt
  → **the user presses send**, which is the consent boundary → the surface picks the new profile up
  by polling `profile.list` → `ready` renders the board or the switcher.
- **The poll is bounded on four axes.** Pressing the button is only a latch; the user may close the
  drawer, edit without sending, or send a turn that creates nothing. A latch with no exit is an
  infinite background poll on an abandoned tab.
  1. **Armed, not free-running** — no poll at all until the action is pressed. An untouched empty
     install issues zero tool calls.
  2. **Expiring** — `POLL_WINDOW_MS` **or** `POLL_MAX_ATTEMPTS`, whichever comes first, measured
     from the press.
  3. **Suspended while hidden** — while `document.hidden` the interval does not fire **and elapsed
     time does not accrue**, so a backgrounded tab does not burn the window down and expire the
     moment the user returns. Subscribe to `visibilitychange`; on becoming visible fetch once
     immediately before resuming the interval. The existing window-`focus` refetch stays.
  4. **Reset on expiry, with a way back** — the poll stops, the latch clears, and the panel
     re-renders with a retry action ("Still setting up? Try again") that re-arms the cycle. Expiry
     is **not** an error state and must not render one; the common cause is a user who decided not
     to finish, and they land back on the same panel they left.

  Do not assume an assistant-completion event exists on `assistantSurface`. If the implementer
  confirms one, they may replace the poll with it and should note that here — the four bounds still
  apply to whatever replaces it.
- **`selectedId` persists in module-local storage** and falls back to the first profile when the
  stored id no longer exists.
- **No chat button in the module surface.** The core header already has one; the prototype violates
  this deliberately (`variant-flow.tsx:145`). Do not port that button.
- **Every component uses the module's `h` factory** (`jsxFactory: "h"`), and **every keyed component
  needs an explicit `key?: string` prop** in its props type — external modules compile with their
  own factory, so `key` is not compiler-stripped and its absence is a TS2322.
  `pnpm check:external-modules` is the only gate that catches this.

**Test-file split — this is a correctness constraint, not organisation.** `job-search-web-root.test.tsx`
mocks `use-profiles.ts` with a hoisted `vi.mock`, because that is the only way to drive `Root`'s
branches. `vi.mock` is hoisted above the imports and applies to **the whole file**, so a case in that
file which claims to exercise the real hook — the poll timing, the attempt cap, the visibility
accounting — is asserting against the mock and would pass against a hook that was never written.
Every real-hook case therefore lives in `job-search-use-profiles.test.tsx`, which mocks only `api.ts`.

Two further mocking rules for the `Root` file: use **one** `vi.mock` per specifier — both transports
live in `api.ts`, and a second `vi.mock` of the same path replaces the first silently, so the earlier
factory's spies stop being installed and the failures land a long way from the cause. And stub
`hostActions` against the **real** `ExternalModuleHostActionsV1`, which requires both `actorScopeKey`
and `openAssistant` (`apps/web/src/external-modules/host-actions.ts:14-24`); typing it `any` to make
it compile hides the next field the contract grows. Omit `assistantSurface` — it is optional, and
`Root` must not require it.

**Tests** (`tests/unit/job-search-web-root.test.tsx` — branches, with `use-profiles` mocked)

1. **Zero profiles renders the bootstrap panel and no board** — asserts the set-up action is present
   and `queryByRole("table")` is null.
2. **Bootstrap goes through the assistant composer and never through a tool invoke.** Asserts
   `openAssistant` was called with a starter prompt matching `/job search profile/i` **and that the
   module's `invokeTool` was not called at all**. Assert the absence at the transport, not through a
   prop: `Root` takes only `{hostActions, assistantSurface?}`, so an `invokeTool` prop passed by a
   test would be ignored by the real component and the assertion would pass no matter what the
   bootstrap did. A direct invoke would 403 in production and pass in any test that stubs a prop.
3. **A profile with no criteria renders onboarding and no table** — a profile with nothing in it has
   nothing to put in a table.
4. **A profile with criteria renders the board and no onboarding.**
5. **No chat button is rendered** — `queryByRole("button", {name: /chat/i})` is null. Guards the
   prototype's deliberate violation from being ported.
6. **A profile that arrives already `active` enqueues the first crawl exactly once** — asserts
   `runQueue("job-search.crawl-run", "crawl.run", {profileId: "p1"})`, then refetches the same list
   and asserts the call count is still one. Clear the spy in `beforeEach` so the count measures this
   test's renders, not the file's.
7. **The enqueue latch survives a remount** — same profile, fresh mount with the same
   `actorScopeKey`, still one call. Fails against a latch held in component state, which is the
   implementation a passing case 6 alone would accept.
8. **A different `actorScopeKey` does not inherit the latch** — remount as a second actor and assert
   the crawl is enqueued for them. Guards the shared-browser case.
9. **A profile that arrives `in_conversation` enqueues nothing** — the crawl starts when criteria
   are complete, not when a profile exists.
10. **`runQueue` resolving `{kind: "already-queued"}` renders the calm queued state, not an error**,
    and `{kind: "disabled"}` says plainly that manual runs are off rather than failing silently.
11. **Binds and frames the assistant surface** — see Task 17, whose two cases live in this file.

**Tests** (`tests/unit/job-search-use-profiles.test.tsx` — the real hook, `api.ts` mocked)

Use `vi.useFakeTimers()`; drive visibility by stubbing `document.visibilityState` and dispatching
`visibilitychange` — jsdom does not change it for you.

1. **Armed and empty polls `profile.list` every `POLL_INTERVAL_MS`; the first non-empty response
   switches to `ready` and stops the interval** — advance a further 30 s and assert no more calls.
2. **Empty and not armed polls not at all** — zero calls. This is the case that keeps an untouched
   install silent.
3. **`POLL_WINDOW_MS` elapsing with every response empty fires `onPollExpired` once and stops** —
   advance a further 60 s and assert no additional calls.
4. **`POLL_MAX_ATTEMPTS` responses before the window elapses expire it the same way.** This is the
   axis a time-only bound misses the moment the interval is shortened.
5. **Re-arming after expiry resumes polling** and a non-empty response still resolves to `ready`.
6. **While `document.hidden` the interval does not fire and the window does not accrue** — hide,
   advance past `POLL_WINDOW_MS`, show again, and assert the poll is still live rather than expired.
   Fails against an implementation that merely skips the fetch while hidden.
7. **Becoming visible fetches once immediately, before the next interval tick.**
8. **One profile yields no switcher; three yield one, and `select` persists across a remount.**
9. **A stored `selectedId` that no longer exists falls back to the first profile** rather than
   rendering an empty board.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-root.test.tsx \
  tests/unit/job-search-use-profiles.test.tsx && pnpm check:external-modules   # exit 0
```

---
