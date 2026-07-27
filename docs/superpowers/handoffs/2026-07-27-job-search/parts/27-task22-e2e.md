### Task 22: UAT test on the real prod-shaped stack

**Required, not optional.** Every UI/UX feature ships with a Playwright test against a real running
instance. The unit tests prove the parts and Task 21 proves the isolation; neither can tell you that
the board renders, that the chat is scoped to the right thread, or that a degraded portal says
anything useful on screen.

**Depends on:** Tasks 18–20 (the surface), Task 11 (the saved fixtures), Task 2d (the badge).

**Files**

- Create: `tests/uat/specs/job-search-board.uat.spec.ts`
- **No new UAT seed chunk (ruling N33).** This part originally called for
  `tests/uat/seed/chunks/job-search.ts` registered in `tests/uat/seed/types.ts`'s `UatSeedChunk` and
  in `run-uat.ts`'s `CHUNKS` set. The coordinator overrode that: job-search gets **no chunk at all,
  not even a documented no-op**. #1087 finding 3 requires job-search to be NOT INSTALLED by default
  at admin+data, so #1026's absent-module UI path stays reachable — a registered chunk is exactly the
  vocabulary that invites a future agent to add it to `ADMIN_DATA_CHUNKS`
  (`tests/uat/seed/levels.ts`) and silently re-break that path. Phase 1 below installs the module
  LIVE via docker-cp + the admin UI (the finance precedent), so there is no install left for a chunk
  to do, and seeding a profile/criteria row would skip the very onboarding flow this UAT exists to
  exercise. See `tests/uat/seed/types.ts` (comment beside `UAT_SEED_CHUNKS`),
  `tests/uat/seed/levels.ts` (comment beside `ADMIN_DATA_CHUNKS`), and
  `rulings-ledger.md#n33` for the full reasoning.
- Create: the fixture portal server (a small static HTTP origin serving Task 11's captures)
- Modify: `tests/uat/provisioner.ts` — start the fixture origin and publish its base URL into the
  stack's env **before** `docker compose up` (the delta below)
- Modify: `apps/worker/src/external-module-job-handler.ts` — the **host-side** test-only `createFetch`
  injection (generic: it applies to every module, not to this one)
- Create: `tests/unit/external-module-test-fetch-seam.test.ts` — proves the seam is inert unless
  explicitly turned on

Note what is **not** in that list: nothing under `external-modules/job-search/src`. The module's
shipped bytes are identical in the UAT run and in production, which is the entire point of the fetch
ruling below.

**The harness exists — use it, do not invent one**

- **`pnpm test:uat` → `tsx tests/uat/run-uat.ts`** (`package.json:43`) boots a prod-shaped Docker
  Compose stack from `infra/docker-compose.prod.yml` under its own project name, its own `/24`
  subnet (`provisioner.ts:32`), a bind-probed high port, a real migrate pass and a real seed, then
  runs Playwright through `tests/uat/playwright.uat.config.ts`. Specs live in `tests/uat/specs/`.
- **`tests/e2e/` is the mocked tier by design.** All of its specs intercept routes and
  `playwright.config.ts` starts only Vite. A real-stack Job Search test does not belong there, and
  `pnpm test:e2e` is not this task's command.
- **Finance is the precedent.** `tests/uat/specs/finance-{budget,feed,reports,shared}.uat.spec.ts`
  already prove an *external* module end to end on this harness. Read `finance-feed` and
  `finance-budget` before writing a line: they carry the activation recipe — `docker cp` the built
  package in, restart so the fail-closed reconcile discovers it, enable it through the **real admin
  UI** (which is what records the trusted hashes), restart again so the module worker registers its
  pg-boss queues.
- **Every spec must `export const uatLevel = { level, without: [] } as const`** — `run-uat.ts:36-45`
  parses it out of the source with a regex before the stack boots, and an absent or malformed export
  is a hard error. Use `"admin+data"`.
- **`run-uat.ts`'s `finally` always tears down with `down -v`**, so container logs are unrecoverable
  after the run. Copy finance-budget's `test.afterEach` log dump: on a non-passing status, pull the
  worker logs into the run log **before** teardown. A silently failing queue job otherwise leaves no
  evidence at all.
- There is **no `pnpm dev:instance` script**, and nothing in this task needs one.

**The genuine gap: a provisioner delta, not a missing harness**

The stack the provisioner boots has no route to a test fixture, and two things must change for one to
exist:

- **The fixture origin must be reachable from inside the container**, not from the test runner's
  loopback. The crawl runs in the `jarv1s` service; `127.0.0.1` there is that container, not the
  host. Either run the fixture as an extra service on the UAT compose network, or bind it on the host
  and reach it through the gateway address of the run's own subnet (`UAT_DOCKER_SUBNET`,
  `provisioner.ts:32`) — whichever, the base URL that goes into the stack must be the one the
  **container** can resolve, and the run must fail loudly if it cannot.
- **`JARVIS_E2E_MODULE_FETCH_BASE` must be in the container's environment before the worker boots.**
  It is read at handler construction, so anything applied afterwards has no effect. That means
  writing it in `writeUatEnvFile` (`provisioner.ts:88-140`), which produces the `env.production.local`
  that `docker-compose.prod.yml` consumes through `env_file:` — and the fixture server therefore has
  to be listening, with its port known, before that file is written. Note the standing trap
  documented at `provisioner.ts:80-83,142-160`: `env_file:` feeds container env only and never
  compose-file `${…}` interpolation, so anything the compose YAML itself must see has to be exported
  as a real `process.env` var too.

**Deterministic sources — the fetch ruling**

The test must not touch LinkedIn or freehire. A live portal makes this fail on someone else's
Cloudflare rule at 3am, which trains everyone to ignore it. Three obvious routes are all closed:

- **A fixture origin cannot be reached through `ctx.fetch` as the policy stands** (E1/E2), and no
  amount of allowlisting changes it. `packages/host-fetch/src/index.ts:268,275` requires `https:` and
  a declared host, and `:79-97,148` rejects loopback and RFC-1918 ranges with `blocked_address` — and
  a Compose network is 10.x by construction. The allowlist is checked *before* the pinning policy,
  not instead of it, so adding the fixture to `fetchHosts` does nothing.
- **Playwright route interception cannot see it.** The crawl requests originate in a worker child
  process, so `page.route` never observes them.
- **A module-side seam is dead code.** A worker child receives an environment of exactly three keys —
  `LANG`, `LC_ALL`, `TZ` (`worker-runtime.ts:120`, B4). Any `process.env.JOB_SEARCH_*` read inside
  module code is `undefined` everywhere, test included. And a module-side bypass means the code path
  under test is not the code path that ships.

**Ruling: inject `createFetch` at the host, in the worker app.** The seam already exists —
`createExternalModuleRpcHandler` takes an optional `createFetch` (`worker-rpc-host.ts:99`) and uses it
at the one place the pinned fetch is constructed (`:134`). The worker app supplies it under a
test-only env var **in its own process**, at the existing call site
(`apps/worker/src/external-module-job-handler.ts:67`), keyed on nothing about job-search so any
module's UAT can use it.

```ts
// Gated POSITIVELY, on two conditions that must both hold.
const E2E_MODE = process.env.JARVIS_RUNTIME_MODE === "e2e";
const fixtureBase = process.env.JARVIS_E2E_MODULE_FETCH_BASE;

if (fixtureBase && !E2E_MODE) {
  throw new Error(
    'JARVIS_E2E_MODULE_FETCH_BASE is set but JARVIS_RUNTIME_MODE is not "e2e". ' +
      "This variable enables a host-fetch bypass and must never be set outside the UAT harness."
  );
}

const testFetchBase = E2E_MODE ? fixtureBase : undefined;

const rpc = createExternalModuleRpcHandler({
  /* …unchanged… */
  ...(testFetchBase ? { createFetch: createE2eFixtureFetch(testFetchBase) } : {})
});
```

**Constraints on the seam**

- **The guard is positive, and `NODE_ENV` plays no part.** `process.env.NODE_ENV !== "production"` is
  fail-**open**: `NODE_ENV` is unset in a plain `node dist/index.js`, in a container that forgot it,
  and in most systemd units, and `undefined !== "production"` is true. A bypass whose guard defaults
  to "on" is not a guard. `JARVIS_RUNTIME_MODE` is net-new — nothing in the tree reads it today — and
  unset never opens the seam.
- **Fail loud, not quiet.** The fixture variable present without the mode refuses to boot: in one
  direction it would hide a fixture that stopped being exercised, in the other a leaked variable in
  production.
- **`createE2eFixtureFetch(base)` keeps the allowlist meaningful.** It receives the module's declared
  `fetchHosts` exactly as `createHostPinnedFetch` does, **rejects any host not in that list**, and
  only then rewrites the origin. Otherwise the var would silently disable the one check `fetchHosts`
  exists to make.
- **Both variables are set by the UAT provisioner and nowhere else** — not in a checked-in compose
  file, not in `.env.example`, not in any dev script. A variable in a checked-in example file is a
  variable someone will copy.
- **No `http://…:PORT` literal appears in the spec or its assertions.** The base reaches the worker
  through the env var; the assertions name the portal's real hostname, which is what the module
  thinks it is talking to.

The rejected alternative — driving the run against recorded stage inputs and skipping the crawl —
stays rejected: it would leave the degraded-portal strip, the posting counts, and "Search now" all
rendering from hand-seeded rows, which is precisely the wiring this test exists to prove.

**Tests** (`tests/unit/external-module-test-fetch-seam.test.ts`)

"Test-only" is a claim until something checks it, and the check must cover the **default**
environment, not just the production one. Restore `process.env` in `afterEach`.

1. **With `JARVIS_E2E_MODULE_FETCH_BASE` unset, the handler is constructed with no `createFetch` key
   at all** — assert on the argument object, not on behaviour, so it fails if someone passes
   `createFetch: undefined` and leans on a `??` further down.
2. **Fixture var set and `JARVIS_RUNTIME_MODE` unset throws, and the message names the variable** —
   run this over `NODE_ENV` ∈ {unset, `development`, `test`, `production`} and assert all four
   outcomes are identical. `NODE_ENV` must have no influence on this decision at all.
3. **Both vars set passes `createFetch`** — otherwise the guard is untestably strict and the UAT run
   fails with no explanation.
4. **`createE2eFixtureFetch(base)(["www.linkedin.com"])` rejects a host outside the allowlist and
   rewrites one inside it.** A fixture fetch that answers everything would let the module reach
   anywhere.

**The spec is ONE test.** The phases below each depend on state the previous one created — an
installed module, a profile, criteria, crawl results, a notification, a scoped conversation.
Playwright tests are isolated and may run in parallel, and nothing here declares serial mode, so
splitting them into a dozen `test` blocks produces a dozen tests that pass or fail on execution order
and on leftovers in a shared backend. That is not flakiness; it proves nothing either way. One long
test is the honest shape for one long journey — the cost is a worse failure message, mitigated by
`test.step`, which names the failing phase. The only other shape that works is giving **every** test
an independent fixture that installs the module and seeds its own prerequisites; take that wholesale
or not at all.

**Journey phases** (one `test.step` each)

1. **Install and activate** — the finance recipe: `docker cp` the built package into the modules
   volume, `restartUatStack`, enable through the real admin UI, restart again so the module's queues
   register. Then open it from the nav.
2. **An empty install offers exactly one way forward.** The bootstrap panel renders, its primary
   action puts an **unsent, editable draft** in the composer, and no profile exists until the user
   sends it. The consent boundary from Task 18, and the one step a user cannot route around.
3. **A new profile shows chat and no table** — `getByRole("table")` is absent. Onboarding is
   chat-only, and a table appearing early is the specific regression.
4. **Criteria fill the progress chips from the record** — drive the conversation, assert each chip's
   state, then assert the chip state **survives a full page reload**. That reload is what
   distinguishes a stored record from model prose held in component state.
5. **The first crawl is actually enqueued, and it finishes.** Nothing on the worker side can enqueue
   (F6), so if the browser never calls `runQueue` the board sits empty forever and phases 6–10 fail
   for a reason none of them names. Observe
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` with body
   `{jobKind: "crawl.run", params: {profileId}}` at the **network layer** with `page.waitForRequest`,
   so it passes only if the real route is called with the real body; then poll the board for a
   non-empty match list with a timeout that fails saying "crawl never produced matches", not a bare
   locator timeout. Also press **"Search now"** and assert a second run is accepted or reported as
   already queued — both are correct and neither is an error.
6. **The board replaces the chat once the profile is active** — table present, onboarding chat gone.
7. **Both axes are separate columns** — a `Fit` column and a `Want` column exist, and no cell matches
   `/^\d{1,3}%\s*match$/`. The one product invariant that has to hold on screen, not just in the
   schema.
8. **A degraded portal states the whole cause** — five assertions: which portal, what kind of failure,
   what was retrieved before it stopped, when it last worked, what happens next. "Job search failed"
   tells the user nothing.
9. **An unscored row explains itself** — `—` in both axes plus a reason, never a zero. A zero is a
   judgement; this is the absence of one.
10. **A recall posting is visibly flagged** — an `outside_frame` row carries its flag, so the user can
    tell a deliberate stretch from a bad match.
11. **The core header chat carries the profile's thread — and only there.** Open the drawer inside the
    profile and assert the job-search turns are present; navigate out, open it again, assert they are
    **absent**. This proves the drawer-scoping ruling. It is the most likely thing to regress and the
    least likely to be caught by anything else in this plan, because both transcripts are correct in
    isolation — only the boundary between them is wrong.
12. **The nav badge shows the new-match count, and reading the notification clears it.** Task 2d
    defines the badge as the module's **unread notification count**, so that is what the phase drives:
    badge appears after a pass produces matches, mark the notification read through the existing
    notifications UI, assert `unreadByModule` drops to zero and the badge disappears. Do **not**
    assert that dismissing or acknowledging matches clears it — nothing marks those notifications
    read, so that would be testing undefined behaviour. If the product later wants the board to clear
    it, that is a core change with its own step in Task 2d.

**Harness notes** that cost an afternoon each if rediscovered: a seeded owner lands on onboarding
(Skip setup → Skip anyway); `getByLabel` substring-matches, so pass `{ exact: true }`; on failure the
DOM snapshot in `error-context.md` is far more useful than the stack trace; the seeded admin
credentials come from `tests/uat/seed/admin.ts`, never hardcoded.

**Verify**

```bash
pnpm test:uat job-search; echo "EXIT=$?"                            # EXIT=0 (boots the full stack)
pnpm vitest run tests/unit/external-module-test-fetch-seam.test.ts  # exit 0
```

If the module's tools 400 on every call, check the instance has a model configured for the module —
an unconfigured instance returns `needs_config` from `ai.generateStructured`, which surfaces as a
stuck onboarding rather than an error.

---
